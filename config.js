const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  vaults: [],
  activeVault: "",
  llm: {
    // "browser" roda o modelo dentro do app; os outros falam com um servidor.
    provider: "browser",
    localModel: "onnx-community/gemma-4-E2B-it-ONNX",
    baseUrl: "http://127.0.0.1:11434",
    apiKey: "",
    model: "",
    temperature: 0.4,
    maxTokens: 768,
    contextFiles: 6,
  },
  preview: {
    allowRemote: false,
    allowScripts: true,
  },
  editor: {
    fontSize: 13.5,
    tabSize: 2,
    wordWrap: true,
  },
  workspaces: {},
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function merge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!isPlainObject(extra)) return out;
  for (const [key, value] of Object.entries(extra)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = merge(out[key], value);
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

function createConfig(file) {
  let data = merge(DEFAULTS, readFile());
  // Migra seleções antigas para o único modelo Browser suportado.
  if (data.llm?.provider === "browser" && data.llm.localModel !== DEFAULTS.llm.localModel) {
    data.llm.localModel = DEFAULTS.llm.localModel;
    persist();
  }

  function readFile() {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }

  function persist() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    } catch (err) {
      console.error("config: falha ao gravar", err);
    }
  }

  function all() {
    return JSON.parse(JSON.stringify(data));
  }

  function patch(next) {
    data = merge(data, next);
    persist();
    return all();
  }

  function vaults() {
    return data.vaults.map((vault) => ({ ...vault }));
  }

  function activeVault() {
    return data.activeVault || "";
  }

  function addVault(vaultPath, name) {
    const resolved = path.resolve(vaultPath);
    const label = name || path.basename(resolved) || resolved;
    const existing = data.vaults.find((vault) => vault.path === resolved);
    if (existing) existing.name = existing.name || label;
    else data.vaults.push({ path: resolved, name: label });
    data.activeVault = resolved;
    persist();
    return resolved;
  }

  function removeVault(vaultPath) {
    const resolved = path.resolve(vaultPath);
    data.vaults = data.vaults.filter((vault) => vault.path !== resolved);
    delete data.workspaces[resolved];
    if (data.activeVault === resolved) data.activeVault = data.vaults[0]?.path || "";
    persist();
    return data.activeVault;
  }

  function setActiveVault(vaultPath) {
    const resolved = path.resolve(vaultPath);
    if (!data.vaults.some((vault) => vault.path === resolved)) return addVault(resolved);
    data.activeVault = resolved;
    persist();
    return resolved;
  }

  function workspace(vaultPath) {
    const key = path.resolve(vaultPath || data.activeVault || "");
    return { tabs: [], activeTab: "", folderId: "all", ...(data.workspaces[key] || {}) };
  }

  function setWorkspace(vaultPath, next) {
    const key = path.resolve(vaultPath || data.activeVault || "");
    if (!key) return;
    data.workspaces[key] = { ...workspace(key), ...next };
    persist();
  }

  return {
    file,
    all,
    patch,
    vaults,
    activeVault,
    addVault,
    removeVault,
    setActiveVault,
    workspace,
    setWorkspace,
  };
}

module.exports = { createConfig, DEFAULTS };
