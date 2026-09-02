(() => {
  /*
   * Ponte entre a UI e o worker de inferência. O modelo roda aqui na janela;
   * o processo principal não participa, ao contrário dos provedores por HTTP.
   */
  const CATALOG = [
    {
      id: "onnx-community/Qwen2.5-0.5B-Instruct",
      label: "Qwen2.5 0.5B",
      size: "~470 MB",
      note: "Mais leve. Roda até sem GPU, mas escreve pouco.",
    },
    {
      id: "onnx-community/Qwen3-0.6B-ONNX",
      label: "Qwen3 0.6B",
      size: "~590 MB",
      note: "Bom equilíbrio para o cofre. Padrão.",
      default: true,
    },
    {
      id: "onnx-community/Llama-3.2-1B-Instruct-ONNX",
      label: "Llama 3.2 1B",
      size: "~1,0 GB",
      note: "Responde melhor em texto corrido. Quer GPU.",
    },
    {
      id: "onnx-community/Qwen2.5-1.5B-Instruct",
      label: "Qwen2.5 1.5B",
      size: "~1,2 GB",
      note: "O mais capaz da lista. Exige GPU com folga de memória.",
    },
    {
      id: "onnx-community/gemma-4-E2B-it-ONNX",
      label: "Gemma 4 E2B",
      size: "~1,5 GB",
      note: "O mesmo que o LocalStudio usa no WebGPU.",
    },
  ];

  const DEFAULT_MODEL = CATALOG.find((item) => item.default)?.id || CATALOG[0].id;

  let worker = null;
  let seq = 0;
  const pending = new Map();
  let state = { phase: "idle", modelId: "", device: "", dtype: "", gpu: null, percent: 0 };
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn({ ...state });
  }

  function setState(patch) {
    state = { ...state, ...patch };
    notify();
  }

  function supported() {
    return typeof Worker === "function" && typeof navigator !== "undefined";
  }

  function hasGpu() {
    return Boolean(navigator.gpu);
  }

  function ensureWorker() {
    if (worker) return worker;
    if (!supported()) throw new Error("Este ambiente não tem Web Worker");
    // Bundle elimina imports bare (ex.: onnxruntime-web/webgpu), que o protocolo customizado não resolve.
    worker = new Worker(new URL("./llm-worker.bundle.js", document.baseURI));
    worker.addEventListener("message", (event) => {
      const data = event.data || {};
      const entry = pending.get(data.id);
      if (data.type === "progress") {
        setState({ phase: "loading", percent: data.percent || 0 });
        entry?.onProgress?.(data);
        return;
      }
      if (data.type === "token") {
        entry?.onToken?.(data.text);
        return;
      }
      if (!entry) return;
      pending.delete(data.id);
      if (data.type === "error") entry.reject(new Error(data.message));
      else entry.resolve(data);
    });
    worker.addEventListener("error", (event) => {
      const detail = event.error?.stack || event.error?.message || event.message || "falha desconhecida";
      const source = event.filename ? ` (${event.filename}:${event.lineno || 0}:${event.colno || 0})` : "";
      const message = `falha ao iniciar o worker da IA: ${detail}${source}`;
      console.error("LLM worker error", event.error || event);
      setState({ phase: "error", error: message });
      for (const [, entry] of pending) entry.reject(new Error(message));
      pending.clear();
      // Worker quebrado não se recupera: derruba para a próxima tentativa recriar.
      worker?.terminate();
      worker = null;
    });
    return worker;
  }

  function call(payload, { onToken, onProgress } = {}) {
    const target = ensureWorker();
    seq += 1;
    const id = `llm-${seq}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onToken, onProgress });
      target.postMessage({ ...payload, id });
    });
  }

  async function probe() {
    const result = await call({ type: "probe" });
    setState({ gpu: result.gpu });
    return result;
  }

  async function load(modelId, { dtype, device, onProgress } = {}) {
    const target = modelId || DEFAULT_MODEL;
    setState({ phase: "loading", modelId: target, percent: 0 });
    try {
      const result = await call({ type: "load", modelId: target, dtype, device }, { onProgress });
      setState({
        phase: "ready",
        modelId: target,
        device: result.info?.device || "",
        dtype: result.info?.dtype || "",
        gpu: result.info?.gpu || state.gpu,
        percent: 100,
      });
      return result.info;
    } catch (err) {
      setState({ phase: "error", error: err.message });
      throw err;
    }
  }

  async function chat({ messages, options, onToken }) {
    if (state.phase !== "ready") await load(state.modelId || DEFAULT_MODEL);
    setState({ phase: "generating" });
    try {
      const result = await call({ type: "chat", messages, options }, { onToken });
      setState({ phase: "ready" });
      return result.text || "";
    } catch (err) {
      setState({ phase: "ready" });
      throw err;
    }
  }

  function stop() {
    if (!worker) return;
    worker.postMessage({ type: "stop", id: `stop-${Date.now()}` });
  }

  async function unload() {
    if (!worker) return;
    try {
      await call({ type: "unload" });
    } finally {
      worker.terminate();
      worker = null;
      pending.clear();
      setState({ phase: "idle", modelId: "", device: "", dtype: "", percent: 0 });
    }
  }

  window.LocalLLM = {
    CATALOG,
    DEFAULT_MODEL,
    supported,
    hasGpu,
    probe,
    load,
    chat,
    stop,
    unload,
    state: () => ({ ...state }),
    onState(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
