const { contextBridge, ipcRenderer } = require("electron");

function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("api", {
  platform: process.platform,

  vault: {
    state: () => ipcRenderer.invoke("vault:state"),
    pick: (opts) => ipcRenderer.invoke("vault:pick", opts),
    inspect: (dir) => ipcRenderer.invoke("vault:inspect", dir),
    createFolder: (opts) => ipcRenderer.invoke("vault:createFolder", opts),
    open: (dir) => ipcRenderer.invoke("vault:open", dir),
    forget: (dir) => ipcRenderer.invoke("vault:forget", dir),
    stats: () => ipcRenderer.invoke("vault:stats"),
    onOpened: (callback) => on("vault:opened", callback),
  },

  tools: {
    apply: (actions) => ipcRenderer.invoke("tools:apply", actions),
  },

  files: {
    list: () => ipcRenderer.invoke("files:list"),
    read: (id) => ipcRenderer.invoke("files:read", id),
    create: (opts) => ipcRenderer.invoke("files:create", opts),
    write: (id, patch) => ipcRenderer.invoke("files:write", id, patch),
    move: (id, folderId) => ipcRenderer.invoke("files:move", id, folderId),
    trash: (id) => ipcRenderer.invoke("files:trash", id),
    restore: (id, folderId) => ipcRenderer.invoke("files:restore", id, folderId),
    destroy: (id) => ipcRenderer.invoke("files:destroy", id),
    emptyTrash: () => ipcRenderer.invoke("files:emptyTrash"),
    import: (folderId) => ipcRenderer.invoke("files:import", folderId),
    reveal: (id) => ipcRenderer.invoke("files:reveal", id),
    url: (relativePath) => `vault-file://file/?p=${encodeURIComponent(relativePath)}`,
  },

  folders: {
    list: () => ipcRenderer.invoke("folders:list"),
    create: (parentId, name) => ipcRenderer.invoke("folders:create", parentId, name),
    rename: (id, name) => ipcRenderer.invoke("folders:rename", id, name),
    remove: (id) => ipcRenderer.invoke("folders:delete", id),
  },

  config: {
    get: () => ipcRenderer.invoke("config:get"),
    patch: (next) => ipcRenderer.invoke("config:patch", next),
  },

  workspace: {
    get: () => ipcRenderer.invoke("workspace:get"),
    set: (next) => ipcRenderer.invoke("workspace:set", next),
  },

  preview: {
    html: (id, html) => ipcRenderer.invoke("preview:html", id, html),
  },

  llm: {
    models: () => ipcRenderer.invoke("llm:models"),
    chat: (payload) => ipcRenderer.invoke("llm:chat", payload),
    abort: (id) => ipcRenderer.invoke("llm:abort", id),
    onChunk: (callback) => on("llm:chunk", callback),
  },

  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    onState: (callback) => on("window:state", callback),
  },

  onChanged: (callback) => on("vault:changed", callback),
});
