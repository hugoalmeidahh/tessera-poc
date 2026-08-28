(() => {
  const api = window.api;
  const MAX_FILE_CHARS = 6000;

  const els = {
    log: null,
    form: null,
    input: null,
    context: null,
    newChat: null,
    send: null,
  };

  let config = null;
  let context = { file: null, folderId: "all", files: [], index: null, vault: {} };
  let messages = [];
  let streaming = null;
  let requestId = 0;
  const include = { file: true, neighbors: true, map: false };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function ensureEls() {
    els.log = els.log || document.getElementById("chat-log");
    els.form = els.form || document.getElementById("chat-form");
    els.input = els.input || document.getElementById("chat-input");
    els.context = els.context || document.getElementById("chat-context");
    els.newChat = els.newChat || document.getElementById("chat-new");
    els.send = els.send || document.getElementById("chat-send");
    return els.log && els.form && els.input;
  }

  function stopGeneration() {
    if (provider() === "browser") window.LocalLLM?.stop();
    else if (streaming) api?.llm?.abort(`chat-${requestId}`);
  }

  function syncSend() {
    if (!els.send) return;
    els.send.textContent = streaming ? "■" : "↑";
    els.send.title = streaming ? "Parar" : "Enviar";
    els.send.classList.toggle("is-stop", Boolean(streaming));
  }

  function truncate(text, limit = MAX_FILE_CHARS) {
    const value = String(text || "");
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}\n…(cortado, ${value.length - limit} caracteres a mais)`;
  }

  function neighbors() {
    const { file, index } = context;
    if (!file || !index || !window.Links) return [];
    const limit = Number(config?.llm?.contextFiles ?? 6);
    if (limit <= 0) return [];
    const seen = new Set([file.id]);
    const out = [];
    for (const link of window.Links.forwardLinks(index, file.id)) {
      if (link.file && !seen.has(link.file.id)) {
        seen.add(link.file.id);
        out.push(link.file);
      }
    }
    for (const back of window.Links.backlinks(index, file.id)) {
      if (!seen.has(back.id)) {
        seen.add(back.id);
        out.push(back);
      }
    }
    if (out.length < limit) {
      const sameFolder = context.files
        .filter((item) => !item.deleted && item.folderId === file.folderId && !seen.has(item.id))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      for (const item of sameFolder) {
        if (out.length >= limit) break;
        seen.add(item.id);
        out.push(item);
      }
    }
    return out.slice(0, limit);
  }

  function buildSystemPrompt() {
    const parts = [
      "Você é um assistente que trabalha dentro de um cofre de arquivos locais (Markdown, HTML, bases de dados, desenhos e PDFs).",
      "Responda em português do Brasil, direto ao ponto, citando o nome dos arquivos quando usar o conteúdo deles.",
      "Para sugerir ligações entre arquivos use a sintaxe [[nome do arquivo]].",
      "Se a resposta não estiver no contexto, diga o que falta em vez de inventar.",
    ];
    if (context.vault?.root) parts.push(`Cofre: ${context.vault.root}`);
    return parts.join(" ");
  }

  function buildContextMessage() {
    const blocks = [];
    if (include.file && context.file) {
      const file = context.file;
      blocks.push(
        `## Arquivo aberto: ${file.title} (${file.relativePath})\n` +
          `formato: ${file.format}\n\n${truncate(file.body)}`
      );
    }
    if (include.neighbors) {
      const list = neighbors();
      if (list.length) {
        blocks.push(
          `## Arquivos vizinhos\n${list
            .map((item) => `### ${item.title} (${item.relativePath})\n${truncate(item.body, 1500)}`)
            .join("\n\n")}`
        );
      }
    }
    if (include.map && context.index && window.Links) {
      blocks.push(`## Mapa do cofre\n${window.Links.toMarkdownMap(context.index, { limit: 150 })}`);
    }
    if (!blocks.length) return null;
    return { role: "system", content: `Contexto atual:\n\n${blocks.join("\n\n")}` };
  }

  function modelLabel() {
    if (provider() !== "browser") return config?.llm?.model || "modelo não definido";
    const engine = window.LocalLLM;
    const id = activeModel();
    const name = engine?.CATALOG.find((item) => item.id === id)?.label || id || "sem modelo";
    const status = engine?.state();
    if (status?.phase === "loading") return `${name} · baixando ${Math.round(status.percent)}%`;
    if (status?.phase === "ready" || status?.phase === "generating") {
      return `${name} · ${status.device === "webgpu" ? "GPU" : "CPU"} no app`;
    }
    return `${name} · no app`;
  }

  function renderContext() {
    if (!els.context) return;
    const list = neighbors();
    const chips = [
      { key: "file", label: context.file ? context.file.title : "nenhum arquivo", on: include.file },
      { key: "neighbors", label: `${list.length} vizinho(s)`, on: include.neighbors },
      { key: "map", label: "mapa do cofre", on: include.map },
    ];
    const model = modelLabel();
    els.context.innerHTML = `${chips
      .map(
        (chip) =>
          `<button type="button" class="chip${chip.on ? " is-on" : ""}" data-chat-chip="${chip.key}">${escapeHtml(
            chip.label
          )}</button>`
      )
      .join("")}<span class="chat__model">${escapeHtml(model)}</span>`;
  }

  function renderLog() {
    syncSend();
    if (!els.log) return;
    if (!messages.length) {
      els.log.innerHTML = `<div class="chat__empty">
        Pergunte sobre o arquivo aberto, peça um resumo em bullets ou sugestões de [[links]].
      </div>`;
      return;
    }
    els.log.innerHTML = messages
      .filter((message) => message.role !== "system")
      .map((message) => {
        const body =
          message.role === "assistant" && window.renderMarkdown
            ? window.renderMarkdown(message.content || "")
            : `<p>${escapeHtml(message.content || "").replace(/\n/g, "<br>")}</p>`;
        return `<div class="chat__msg chat__msg--${message.role}${message.pending ? " is-pending" : ""}">
          <div class="chat__role">${message.role === "user" ? "você" : "ia"}</div>
          <div class="chat__bubble markdown">${body}</div>
        </div>`;
      })
      .join("");
    els.log.scrollTop = els.log.scrollHeight;
  }

  function provider() {
    return config?.llm?.provider || "browser";
  }

  function activeModel() {
    if (provider() === "browser") {
      return config?.llm?.localModel || window.LocalLLM?.DEFAULT_MODEL || "";
    }
    return config?.llm?.model || "";
  }

  function buildPayload(assistant) {
    return [
      { role: "system", content: buildSystemPrompt() },
      buildContextMessage(),
      ...messages
        .filter((message) => message.role !== "system" && message !== assistant)
        .map(({ role, content }) => ({ role, content })),
    ].filter(Boolean);
  }

  function formatBytes(value) {
    if (!value) return "";
    const mb = value / 1048576;
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
  }

  // Modelo no navegador: baixa na primeira vez, depois sai da Cache API.
  async function sendLocal(text, assistant) {
    const engine = window.LocalLLM;
    if (!engine?.supported()) {
      assistant.content = "Este ambiente não tem Web Worker, então a IA local não roda aqui.";
      return;
    }
    const modelId = activeModel();
    const payload = buildPayload(assistant);
    const status = engine.state();

    if (status.phase !== "ready" && status.phase !== "generating") {
      const entry = engine.CATALOG.find((item) => item.id === modelId);
      assistant.content = `Preparando ${entry?.label || modelId}${
        entry ? ` (${entry.size})` : ""
      }…`;
      renderLog();
      try {
        await engine.load(modelId, {
          onProgress: (info) => {
            if (!info.total) return;
            assistant.content = `Baixando ${entry?.label || modelId}: ${Math.round(
              info.percent
            )}% (${formatBytes(info.loaded)} de ${formatBytes(info.total)})`;
            renderLog();
          },
        });
      } catch (err) {
        assistant.content = `Não deu para carregar o modelo: ${err.message}`;
        return;
      }
    }

    assistant.content = "";
    renderLog();
    try {
      const full = await engine.chat({
        messages: payload,
        options: {
          temperature: config?.llm?.temperature ?? 0.4,
          maxTokens: config?.llm?.maxTokens ?? 768,
        },
        onToken: (token) => {
          assistant.content += token;
          renderLog();
        },
      });
      if (!assistant.content && full) assistant.content = full;
    } catch (err) {
      assistant.content += `\n\n_Erro: ${err.message}_`;
    }
  }

  async function sendRemote(text, assistant) {
    if (!api?.llm) {
      assistant.content = "A ponte com a IA só existe no app Electron.";
      return;
    }
    if (!config?.llm?.model) {
      assistant.content = "Escolha um modelo em Configurações → IA / LLM antes de conversar.";
      return;
    }
    requestId += 1;
    const result = await api.llm.chat({
      id: `chat-${requestId}`,
      messages: buildPayload(assistant),
      model: config.llm.model,
    });
    if (!result?.ok && !assistant.content) {
      assistant.content = `Não deu para falar com o modelo: ${result?.error || "sem resposta"}`;
    }
  }

  async function send(text) {
    messages.push({ role: "user", content: text });
    const assistant = { role: "assistant", content: "", pending: true };
    messages.push(assistant);
    streaming = assistant;
    renderLog();

    if (provider() === "browser") await sendLocal(text, assistant);
    else await sendRemote(text, assistant);

    assistant.pending = false;
    streaming = null;
    renderLog();
  }

  function wire() {
    if (!ensureEls() || els.form.dataset.ready) return;
    els.form.dataset.ready = "1";
    els.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = els.input.value.trim();
      if (!text || streaming) return;
      els.input.value = "";
      send(text);
    });
    els.send?.addEventListener("click", (event) => {
      if (!streaming) return;
      event.preventDefault();
      stopGeneration();
    });
    els.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        els.form.requestSubmit();
      }
      event.stopPropagation();
    });
    els.context?.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-chat-chip]");
      if (!chip) return;
      const key = chip.dataset.chatChip;
      include[key] = !include[key];
      renderContext();
    });
    els.newChat?.addEventListener("click", () => {
      messages = [];
      streaming = null;
      renderLog();
      els.input?.focus();
    });
    window.LocalLLM?.onState(() => renderContext());
    api?.llm?.onChunk((payload) => {
      if (!streaming) return;
      if (payload.delta) {
        streaming.content += payload.delta;
        renderLog();
      }
      if (payload.error) {
        streaming.content += `\n\n_Erro: ${payload.error}_`;
        renderLog();
      }
    });
    renderLog();
  }

  window.Chat = {
    setConfig(next) {
      config = next;
      wire();
      renderContext();
    },
    setContext(next) {
      context = { ...context, ...next };
      wire();
      renderContext();
    },
    focus() {
      wire();
      els.input?.focus();
    },
    async listModels() {
      if (provider() === "browser") return window.LocalLLM?.CATALOG.map((item) => item.id) || [];
      try {
        return await api?.llm?.models();
      } catch (err) {
        console.error(err);
        return [];
      }
    },
    async test() {
      if (provider() === "browser") {
        const engine = window.LocalLLM;
        if (!engine?.supported()) return { ok: false, error: "sem Web Worker neste ambiente" };
        try {
          const probe = await engine.probe();
          return {
            ok: true,
            gpu: probe.gpu,
            models: engine.CATALOG.map((item) => item.id),
          };
        } catch (err) {
          return { ok: false, error: err.message || String(err) };
        }
      }
      try {
        const models = await api?.llm?.models();
        return { ok: Array.isArray(models), models };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    },
    stop: stopGeneration,
  };
})();
