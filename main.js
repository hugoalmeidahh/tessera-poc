const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  screen,
  nativeTheme,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const { createVault, inspectFolder } = require("./vault");
const { createConfig } = require("./config");

// A janela é servida por um esquema próprio, não por file://. Origem opaca de
// file:// derruba WebGPU, worker de módulo e Cache API — que é o que a IA local usa.
const APP_SCHEME = "vault-app";
const APP_ORIGIN = `${APP_SCHEME}://app`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      allowServiceWorkers: true,
    },
  },
  {
    scheme: "vault-preview",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    scheme: "vault-file",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

if (app && process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
}

const MIME = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const htmlPreviews = new Map();

let config;
let vault = null;
let watcher = null;
let writing = false;

function previewCsp() {
  const remote = config?.all().preview?.allowRemote;
  const scripts = config?.all().preview?.allowScripts !== false;
  return [
    "default-src 'none'",
    scripts
      ? `script-src 'unsafe-inline' 'unsafe-eval' blob: data:${remote ? " https:" : ""}`
      : "script-src 'none'",
    `style-src 'unsafe-inline'${remote ? " https:" : ""}`,
    "img-src data: blob: vault-file: https: http:",
    `font-src data:${remote ? " https:" : ""}`,
    "media-src data: blob: vault-file:",
    remote ? "connect-src https:" : "connect-src 'none'",
    "frame-src 'none'",
  ].join("; ");
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function watchVault() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (!vault) return;
  try {
    watcher = fs.watch(vault.root, { recursive: true }, () => {
      if (writing) return;
      clearTimeout(watchVault.timer);
      watchVault.timer = setTimeout(() => broadcast("vault:changed"), 120);
    });
  } catch {
    watcher = null;
  }
}

async function openVault(vaultPath, { seed = true } = {}) {
  const resolved = path.resolve(vaultPath);
  fs.mkdirSync(resolved, { recursive: true });
  vault = createVault(resolved);
  await vault.init({ seed });
  config.addVault(resolved);
  watchVault();
  broadcast("vault:opened", vaultState());
  return vaultState();
}

function vaultState() {
  return {
    root: vault?.root || "",
    ready: Boolean(vault),
    vaults: config.vaults(),
    activeVault: config.activeVault(),
  };
}

function requireVault() {
  if (!vault) throw new Error("Nenhum cofre aberto");
  return vault;
}

function revealWithFileManager(filePath) {
  return new Promise((resolve, reject) => {
    const uri = pathToFileURL(filePath).href;
    execFile(
      "dbus-send",
      [
        "--session",
        "--print-reply",
        "--dest=org.freedesktop.FileManager1",
        "--type=method_call",
        "/org/freedesktop/FileManager1",
        "org.freedesktop.FileManager1.ShowItems",
        `array:string:${uri}`,
        "string:",
      ],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function revealOnDisk(filePath) {
  if (filePath && process.platform === "linux") {
    try {
      await revealWithFileManager(filePath);
      return;
    } catch {
      /* dbus pode falhar em alguns ambientes; abre a pasta */
    }
    const error = await shell.openPath(path.dirname(filePath));
    if (error) throw new Error(error);
    return;
  }
  if (!filePath) {
    const error = await shell.openPath(requireVault().root);
    if (error) throw new Error(error);
    return;
  }
  shell.showItemInFolder(filePath);
}

async function withWrite(fn) {
  writing = true;
  try {
    return await fn();
  } finally {
    setTimeout(() => {
      writing = false;
    }, 250);
  }
}

function createWindow() {
  const work = screen.getPrimaryDisplay().workAreaSize;
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: Math.max(360, Math.round(work.width * 0.92)),
    height: Math.max(480, Math.round(work.height * 0.9)),
    minWidth: 360,
    minHeight: 480,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#2c2c2e" : "#e6e6eb",
    autoHideMenuBar: true,
    title: "Arquivos",
    show: false,
    frame: isMac,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    trafficLightPosition: isMac ? { x: 14, y: 11 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true,
    },
  });

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on("preload-error", (_event, preloadPath, err) => {
    console.error("preload-error", preloadPath, err);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("render-process-gone", details);
  });

  const sendWindowState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send("window:state", { maximized: win.isMaximized() });
  };
  win.on("maximize", sendWindowState);
  win.on("unmaximize", sendWindowState);

  // O id tem de ser lido agora: em "closed" o webContents já foi destruído.
  const previewPrefix = `${win.webContents.id}:`;
  win.on("closed", () => {
    for (const key of [...htmlPreviews.keys()]) {
      if (key.startsWith(previewPrefix)) htmlPreviews.delete(key);
    }
  });

  win.once("ready-to-show", () => win.show());
  win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function legacyVaultPath() {
  const legacy = path.join(app.getPath("documents"), "Notas");
  return fs.existsSync(legacy) ? legacy : "";
}

function registerProtocols() {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const target = path.resolve(__dirname, rel);
      const root = path.resolve(__dirname);
      if (target !== root && !target.startsWith(root + path.sep)) {
        return new Response("Fora do app", { status: 403 });
      }
      const data = await fs.promises.readFile(target);
      const ext = path.extname(target).toLowerCase();
      return new Response(data, {
        headers: {
          "content-type": MIME[ext] || "application/octet-stream",
          // Os pesos do modelo são baixados por fetch e guardados na Cache API,
          // então o que serve daqui é só código: cache curto evita surpresa em dev.
          "cache-control": "no-cache",
        },
      });
    } catch (err) {
      const status = err?.code === "ENOENT" ? 404 : 500;
      return new Response(`${err.message}`, { status });
    }
  });

  protocol.handle("vault-preview", (request) => {
    let html = "";
    try {
      const key = new URL(request.url).searchParams.get("k") || "";
      html = htmlPreviews.get(key) || "";
    } catch {
      html = "";
    }
    if (!html) {
      html =
        "<!doctype html><meta charset='utf-8'><body style='font:15px system-ui;padding:24px'>Preview vazio</body>";
    }
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": previewCsp(),
      },
    });
  });

  protocol.handle("vault-file", async (request) => {
    try {
      const rel = decodeURIComponent(new URL(request.url).searchParams.get("p") || "");
      const filePath = await requireVault().absolute(rel);
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return new Response(data, {
        headers: {
          "content-type": MIME[ext] || "application/octet-stream",
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      return new Response(`Não encontrado: ${err.message}`, { status: 404 });
    }
  });
}

const inflight = new Map();

function llmConfig() {
  const llm = config?.all().llm || {};
  const provider = llm.provider || "ollama";
  const baseUrl = (llm.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
  return { ...llm, provider, baseUrl };
}

function llmHeaders(llm) {
  const headers = { "content-type": "application/json" };
  if (llm.apiKey) headers.authorization = `Bearer ${llm.apiKey}`;
  return headers;
}

async function listModels() {
  const llm = llmConfig();
  if (llm.provider === "ollama") {
    const response = await fetch(`${llm.baseUrl}/api/tags`, { headers: llmHeaders(llm) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json();
    return (data.models || []).map((model) => model.name).filter(Boolean);
  }
  const response = await fetch(`${llm.baseUrl}/v1/models`, { headers: llmHeaders(llm) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const data = await response.json();
  return (data.data || []).map((model) => model.id).filter(Boolean);
}

async function streamChat(event, { id, messages, model }) {
  const llm = llmConfig();
  const controller = new AbortController();
  inflight.set(id, controller);
  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send("llm:chunk", { id, ...payload });
  };

  try {
    const ollama = llm.provider === "ollama";
    const url = ollama ? `${llm.baseUrl}/api/chat` : `${llm.baseUrl}/v1/chat/completions`;
    const body = ollama
      ? { model: model || llm.model, messages, stream: true, options: { temperature: llm.temperature ?? 0.4 } }
      : { model: model || llm.model, messages, stream: true, temperature: llm.temperature ?? 0.4 };
    const response = await fetch(url, {
      method: "POST",
      headers: llmHeaders(llm),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`${response.status} ${response.statusText || "sem resposta"}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = ollama
            ? json.message?.content || ""
            : json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
          if (delta) send({ delta });
        } catch {
          /* linha parcial ou comentário do SSE */
        }
      }
    }
    send({ done: true });
    return { ok: true };
  } catch (err) {
    if (err.name === "AbortError") {
      send({ done: true, aborted: true });
      return { ok: true, aborted: true };
    }
    send({ done: true, error: err.message || String(err) });
    return { ok: false, error: err.message || String(err) };
  } finally {
    inflight.delete(id);
  }
}

function registerIpc() {
  const wrap = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error("ipc", err);
      throw err;
    }
  };

  ipcMain.handle("vault:state", () => vaultState());
  ipcMain.handle(
    "vault:pick",
    wrap(async (event, { create = false } = {}) => {
      const win = windowFromEvent(event);
      const result = await dialog.showOpenDialog(win, {
        title: create ? "Escolha onde criar o cofre" : "Escolha a pasta do cofre",
        buttonLabel: create ? "Criar aqui" : "Abrir cofre",
        properties: ["openDirectory", "createDirectory", "showHiddenFiles"],
        defaultPath: vault?.root || app.getPath("documents"),
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return inspectFolder(result.filePaths[0]);
    })
  );
  ipcMain.handle("vault:inspect", wrap((_event, dir) => inspectFolder(dir)));
  ipcMain.handle(
    "vault:createFolder",
    wrap(async (event, { parent, name } = {}) => {
      const base = parent || app.getPath("documents");
      const folder = path.join(base, String(name || "Cofre").replace(/[\\/:*?"<>|]/g, " ").trim());
      fs.mkdirSync(folder, { recursive: true });
      return inspectFolder(folder);
    })
  );
  ipcMain.handle("vault:open", wrap((_event, dir) => openVault(dir)));
  ipcMain.handle(
    "vault:forget",
    wrap(async (_event, dir) => {
      const next = config.removeVault(dir);
      if (vault && path.resolve(dir) === vault.root) {
        vault = null;
        if (watcher) watcher.close();
        watcher = null;
        if (next) await openVault(next, { seed: false });
        else broadcast("vault:opened", vaultState());
      }
      return vaultState();
    })
  );
  ipcMain.handle("vault:stats", wrap(() => requireVault().stats()));

  ipcMain.handle("files:list", wrap(() => (vault ? vault.list() : [])));
  ipcMain.handle("files:read", wrap((_event, id) => requireVault().read(id)));
  ipcMain.handle("files:create", wrap((_event, opts) => withWrite(() => requireVault().create(opts))));
  ipcMain.handle("files:write", wrap((_event, id, patch) => withWrite(() => requireVault().write(id, patch))));
  ipcMain.handle("files:move", wrap((_event, id, folderId) => withWrite(() => requireVault().move(id, folderId))));
  ipcMain.handle("files:trash", wrap((_event, id) => withWrite(() => requireVault().remove(id))));
  ipcMain.handle(
    "files:restore",
    wrap((_event, id, folderId) => withWrite(() => requireVault().restore(id, folderId)))
  );
  ipcMain.handle("files:destroy", wrap((_event, id) => withWrite(() => requireVault().destroy(id))));
  ipcMain.handle("files:emptyTrash", wrap(() => withWrite(() => requireVault().emptyTrash())));
  ipcMain.handle(
    "files:import",
    wrap(async (event, folderId) => {
      const win = windowFromEvent(event);
      const result = await dialog.showOpenDialog(win, {
        title: "Importar arquivos para o cofre",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Suportados", extensions: ["md", "markdown", "txt", "html", "htm", "pdf", "json"] },
          { name: "Todos", extensions: ["*"] },
        ],
      });
      if (result.canceled) return [];
      const imported = [];
      for (const file of result.filePaths) {
        imported.push(await withWrite(() => requireVault().importFile(folderId, file)));
      }
      return imported;
    })
  );
  ipcMain.handle(
    "files:reveal",
    wrap(async (_event, id) => {
      if (!id) {
        await revealOnDisk(null);
        return true;
      }
      await revealOnDisk(await requireVault().absolute(id));
      return true;
    })
  );

  ipcMain.handle("folders:list", wrap(() => (vault ? vault.listFolders() : [])));
  ipcMain.handle(
    "folders:create",
    wrap((_event, parentId, name) => withWrite(() => requireVault().createFolder(parentId, name)))
  );
  ipcMain.handle(
    "folders:rename",
    wrap((_event, id, name) => withWrite(() => requireVault().renameFolder(id, name)))
  );
  ipcMain.handle("folders:delete", wrap((_event, id) => withWrite(() => requireVault().deleteFolder(id))));

  ipcMain.handle("config:get", () => config.all());
  ipcMain.handle("config:patch", (_event, patch) => config.patch(patch));
  ipcMain.handle("workspace:get", () => config.workspace(vault?.root || ""));
  ipcMain.handle("workspace:set", (_event, next) => {
    if (vault) config.setWorkspace(vault.root, next);
    return true;
  });

  ipcMain.handle("preview:html", (event, fileId, html) => {
    const key = `${event.sender.id}:${fileId || "preview"}`;
    htmlPreviews.set(key, String(html || ""));
    return key;
  });

  ipcMain.handle("llm:models", wrap(() => listModels()));
  ipcMain.handle("llm:chat", wrap((event, payload) => streamChat(event, payload)));
  ipcMain.handle("llm:abort", (_event, id) => {
    inflight.get(id)?.abort();
    inflight.delete(id);
    return true;
  });

  ipcMain.handle("window:minimize", (event) => {
    windowFromEvent(event)?.minimize();
  });
  ipcMain.handle("window:toggleMaximize", (event) => {
    const win = windowFromEvent(event);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle("window:close", (event) => {
    const win = windowFromEvent(event);
    // Fechar no próximo tick deixa a resposta do invoke sair antes do renderer morrer.
    setImmediate(() => win?.close());
    return true;
  });
  ipcMain.handle("window:isMaximized", (event) => windowFromEvent(event)?.isMaximized() ?? false);
}

app.whenReady().then(async () => {
  config = createConfig(path.join(app.getPath("userData"), "config.json"));
  registerProtocols();
  registerIpc();

  const active = config.activeVault() || legacyVaultPath();
  if (active) {
    try {
      await openVault(active, { seed: false });
    } catch (err) {
      console.error("Falha ao abrir o cofre", err);
    }
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (watcher) watcher.close();
  if (process.platform !== "darwin") app.quit();
});
