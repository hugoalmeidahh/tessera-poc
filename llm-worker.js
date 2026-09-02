/*
 * Worker clássico: carrega e roda o modelo dentro da própria janela, via WebGPU.
 * Só funciona porque o app é servido pelo esquema vault-app:// (origem segura);
 * em file:// o Chromium bloqueia worker de módulo, WebGPU e Cache API.
 */
let env;
let pipeline;
let TextStreamer;
let runtime;

async function initRuntime() {
  if (runtime) return runtime;
  runtime = import("./node_modules/@huggingface/transformers/dist/transformers.web.js").then((module) => {
    ({ env, pipeline, TextStreamer } = module);
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    env.cacheKey = "vault-llm-v1";
    // Runtime ONNX servido do próprio app, não de CDN.
    env.backends.onnx.wasm.wasmPaths = new URL(
      "./node_modules/onnxruntime-web/dist/",
      self.location.href
    ).href;
    // Threads de WASM exigem SharedArrayBuffer, que exige COOP/COEP. Não vale o risco.
    env.backends.onnx.wasm.numThreads = 1;
  });
  return runtime;
}

let generator = null;
let loaded = { modelId: "", dtype: "", device: "" };
let stopper = null;

async function gpuReport() {
  if (!navigator.gpu) return { available: false, f16: false, adapter: "" };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { available: false, f16: false, adapter: "" };
    const info = adapter.info || (await adapter.requestAdapterInfo?.()) || {};
    return {
      available: true,
      f16: adapter.features?.has("shader-f16") || false,
      adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") || "GPU",
    };
  } catch (err) {
    return { available: false, f16: false, adapter: "", error: String(err?.message || err) };
  }
}

function post(payload) {
  self.postMessage(payload);
}

async function load(id, { modelId, dtype, device }) {
  await initRuntime();
  const gpu = await gpuReport();
  const wantedDevice = device || (gpu.available ? "webgpu" : "wasm");
  // q4f16 depende de shader-f16; sem isso o carregamento estoura no meio.
  const wantedDtype = dtype || (wantedDevice === "webgpu" && gpu.f16 ? "q4f16" : "q4");

  if (
    generator &&
    loaded.modelId === modelId &&
    loaded.dtype === wantedDtype &&
    loaded.device === wantedDevice
  ) {
    post({ id, type: "ready", info: { ...loaded, gpu, cached: true } });
    return;
  }

  if (generator) {
    try {
      await generator.dispose();
    } catch {
      /* modelo antigo já foi */
    }
    generator = null;
  }

  const files = new Map();
  generator = await pipeline("text-generation", modelId, {
    device: wantedDevice,
    dtype: wantedDtype,
    progress_callback: (info) => {
      if (info.status === "progress" && info.file) {
        files.set(info.file, { loaded: info.loaded || 0, total: info.total || 0 });
      }
      let loadedBytes = 0;
      let totalBytes = 0;
      for (const entry of files.values()) {
        loadedBytes += entry.loaded;
        totalBytes += entry.total;
      }
      post({
        id,
        type: "progress",
        status: info.status,
        file: info.file || "",
        percent: totalBytes ? (loadedBytes / totalBytes) * 100 : info.progress || 0,
        loaded: loadedBytes,
        total: totalBytes,
      });
    },
  });

  loaded = { modelId, dtype: wantedDtype, device: wantedDevice };
  post({ id, type: "ready", info: { ...loaded, gpu, cached: false } });
}

async function chat(id, { messages, options }) {
  await initRuntime();
  if (!generator) throw new Error("Modelo não carregado");
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      if (text) post({ id, type: "token", text });
    },
  });

  const output = await generator(messages, {
    max_new_tokens: options?.maxTokens ?? 768,
    temperature: options?.temperature ?? 0.4,
    top_p: options?.topP ?? 0.95,
    do_sample: (options?.temperature ?? 0.4) > 0,
    repetition_penalty: options?.repetitionPenalty ?? 1.05,
    streamer,
  });
  const generated = output?.[0]?.generated_text;
  const text = Array.isArray(generated)
    ? generated.at(-1)?.content || ""
    : String(generated || "");
  post({ id, type: "done", text });
}

self.addEventListener("message", async (event) => {
  const { id, type } = event.data || {};
  try {
    if (type === "probe") {
      await initRuntime();
      post({ id, type: "probe", gpu: await gpuReport(), loaded: { ...loaded } });
      return;
    }
    if (type === "load") {
      await load(id, event.data);
      return;
    }
    if (type === "chat") {
      await chat(id, event.data);
      return;
    }
    if (type === "stop") {
      post({ id, type: "stopped" });
      return;
    }
    if (type === "unload") {
      if (generator) await generator.dispose();
      generator = null;
      loaded = { modelId: "", dtype: "", device: "" };
      post({ id, type: "unloaded" });
      return;
    }
    post({ id, type: "error", message: `Comando desconhecido: ${type}` });
  } catch (err) {
    stopper = null;
    post({ id, type: "error", message: String(err?.message || err) });
  }
});
