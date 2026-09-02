// Escopo isolado: contextBridge cria globais não-configuráveis (window.api), e um
// `const api` no topo de um script clássico colide com eles e mata o arquivo inteiro.
(() => {
const api = window.api && typeof window.api.files?.list === "function" ? window.api : null;

const ALL_FILES = { id: "all", name: "Todos Arquivos", system: true };
const TRASH = { id: "deleted", name: "Apagadas recentemente", system: true };

const FORMAT_LABEL = {
  md: "md",
  txt: "txt",
  html: "html",
  db: "base",
  draw: "desenho",
  pdf: "pdf",
};

const day = 24 * 60 * 60 * 1000;

const state = {
  vault: { root: "", ready: false, vaults: [], activeVault: "" },
  config: null,
  folders: [],
  files: [],
  index: null,
  folderId: "all",
  fileId: null,
  tabs: [],
  query: "",
  view: "edit",
  save: "saved",
  notice: "",
  htmlSize: "fluid",
  creatingFolder: null,
  renamingFolder: null,
  renamingTab: null,
  collapsed: new Set(),
  detailsOpen: false,
  chatOpen: false,
  paletteOpen: false,
  paletteQuery: "",
  paletteIndex: 0,
  settingsTab: "vaults",
};

let saveTimer = 0;
let pending = { id: null, patch: {} };
let saveChain = Promise.resolve();
let ignoreWatch = 0;
let workspaceTimer = 0;
let focusFolderInput = false;
const slash = { open: false, index: 0, start: 0, items: [] };

const els = {};
for (const [key, id] of Object.entries({
  app: null,
  folders: "folders",
  files: "files",
  search: "search",
  searchWrap: "search-wrap",
  listHeading: "list-heading",
  tabs: "tabs",
  editor: "editor",
  editorEmpty: "editor-empty",
  editorStatus: "editor-status",
  body: "file-body",
  elementsBar: "elements-bar",
  slashMenu: "slash-menu",
  preview: "file-preview",
  htmlPreview: "html-preview",
  htmlStage: "html-stage",
  htmlStageUrl: "html-stage-url",
  htmlStageDevice: "html-stage-device",
  htmlStageSizes: "html-stage-sizes",
  pdfStage: "pdf-stage",
  pdfFrame: "pdf-frame",
  drawStage: "draw-stage",
  drawCanvas: "draw-canvas",
  drawTools: "draw-tools",
  drawStyle: "draw-style",
  drawHistory: "draw-history",
  drawZoom: "draw-zoom",
  db: "file-db",
  schema: "file-schema",
  codeEditor: "code-editor",
  diagram: "file-diagram",
  viewMode: "view-mode",
  exportPrisma: "export-prisma",
  importSchema: "import-schema",
  importSchemaFile: "import-schema-file",
  newFile: "new-file",
  newFileMenu: "new-file-menu",
  formatMenu: "format-menu",
  trashFile: "trash-file",
  trashFileList: "trash-file-list",
  emptyTrash: "empty-trash",
  revealFile: "reveal-file",
  vaultSwitch: "vault-switch",
  openSettings: "open-settings",
  previewBanner: "preview-banner",
  toggleSidebar: "toggle-sidebar",
  toggleSidebarList: "toggle-sidebar-list",
  foldersScrim: "folders-scrim",
  newFolder: "new-folder",
  backToList: "back-to-list",
  titlebar: "titlebar",
  titlebarDrag: "titlebar-drag",
  titlebarTitle: "titlebar-title",
  titlebarCrumb: "titlebar-crumb",
  titlebarVault: "titlebar-vault",
  windowControls: "window-controls",
  winMin: "win-min",
  winMax: "win-max",
  winClose: "win-close",
  details: "details",
  detailsBody: "details-body",
  closeDetails: "close-details",
  toggleDetails: "toggle-details",
  chat: "chat",
  chatLog: "chat-log",
  chatForm: "chat-form",
  chatInput: "chat-input",
  chatContext: "chat-context",
  chatNew: "chat-new",
  closeChat: "close-chat",
  toggleChat: "toggle-chat",
  toggleGraph: "toggle-graph",
  graph: "graph",
  graphCanvas: "graph-canvas",
  graphLegend: "graph-legend",
  graphCopy: "graph-copy",
  graphSave: "graph-save",
  welcome: "welcome",
  welcomeOpen: "welcome-open",
  welcomeCreate: "welcome-create",
  welcomeList: "welcome-list",
  welcomeHint: "welcome-hint",
  settings: "settings",
  settingsBody: "settings-body",
  settingsTabs: "settings-tabs",
  palette: "palette",
  paletteInput: "palette-input",
  paletteList: "palette-list",
  contextMenu: "context-menu",
})) {
  els[key] = id ? document.getElementById(id) : null;
}
els.app = document.querySelector(".app");

const tableView = typeof window.TableView === "function" ? new window.TableView() : null;

/* ---------------------------------------------------------------- helpers */

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatListDate(ts) {
  const date = new Date(ts);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startFile = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startToday - startFile) / day);
  if (diffDays === 0) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return date.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

function formatFullDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(size) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  const value = size / 1024 ** exp;
  return `${value >= 10 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}

function groupLabel(ts) {
  const date = new Date(ts);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startFile = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startToday - startFile) / day);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return "Últimos 7 dias";
  if (diffDays < 30) return "Últimos 30 dias";
  return "Anterior";
}

function shortPath(fullPath) {
  if (!fullPath) return "Cofre local";
  const parts = fullPath.split(/[/\\]/);
  if (parts[1] === "home" && parts[2]) {
    const home = `/${parts[1]}/${parts[2]}`;
    if (fullPath.startsWith(home)) return `~${fullPath.slice(home.length)}`;
  }
  return fullPath;
}

function selectedFile() {
  return state.files.find((file) => file.id === state.fileId) ?? null;
}

function fileById(id) {
  return state.files.find((file) => file.id === id) ?? null;
}

function folderName(folderId) {
  if (folderId === "all") return ALL_FILES.name;
  if (folderId === "deleted") return TRASH.name;
  if (!folderId) return "Raiz do cofre";
  return folderId.split("/").pop();
}

function filesInFolder(folderId) {
  return state.files.filter((file) => {
    if (folderId === "deleted") return file.deleted;
    if (file.deleted) return false;
    if (folderId === "all") return true;
    if (!folderId) return !file.folderId;
    return file.folderId === folderId || file.folderId.startsWith(`${folderId}/`);
  });
}

function matchesQuery(file, query) {
  if (!query) return true;
  return (
    file.title.toLowerCase().includes(query) ||
    file.relativePath.toLowerCase().includes(query) ||
    (file.body || "").toLowerCase().includes(query)
  );
}

function visibleFiles() {
  const query = state.query.trim().toLowerCase();
  const base = query && state.folderId !== "deleted" ? filesInFolder("all") : filesInFolder(state.folderId);
  return base.filter((file) => matchesQuery(file, query)).sort((a, b) => b.updatedAt - a.updatedAt);
}

function rebuildIndex() {
  state.index = window.Links ? window.Links.buildIndex(state.files) : null;
  window.wikilinkResolver = (name) => {
    if (!state.index) return null;
    const id = state.index.byKey.get(window.Links.normalizeKey(name));
    return id ? state.index.byId.get(id) : null;
  };
}

function formatIcon(format) {
  const glyph = {
    md: "M2 12V4h2l2 3 2-3h2v8H8V7L6 10 4 7v5H2Zm10 0V4h2v6h2v2h-4Z",
    html: "M3 3l1 10 4 1 4-1 1-10H3Zm7.6 3H6.4l.1 1.3h4l-.3 3.7-2.2.6-2.2-.6-.1-1.4h1.3l.1.7.9.2.9-.2.1-1.2H5.6L5.3 6h5.4l-.1 1Z",
    txt: "M3 4h10v1.6H8.9V12H7.1V5.6H3V4Z",
    db: "M8 2c3 0 5 .9 5 2v8c0 1.1-2 2-5 2s-5-.9-5-2V4c0-1.1 2-2 5-2Zm0 1.4c-2.4 0-3.6.6-3.6.8s1.2.8 3.6.8 3.6-.6 3.6-.8-1.2-.8-3.6-.8Z",
    draw: "M2 12.5 3.2 9l6-6 2.8 2.8-6 6L2 12.5Zm9.8-9.7 1.4 1.4-1.1 1.1-1.4-1.4 1.1-1.1Z",
    pdf: "M4 2h5l3 3v9H4V2Zm1.5 6.5h5V10h-5V8.5Zm0 2.5h3.5v1.5H5.5V11Z",
  };
  return `<svg class="file-row__icon file-row__icon--${format}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="${
    glyph[format] || glyph.txt
  }"/></svg>`;
}

function previewText(file) {
  if (file.format === "db") {
    const db = window.parseDatabase(file.body);
    const tables = db.tables || [];
    const rows = tables.reduce((count, table) => count + (table.rows?.length || 0), 0);
    if (tables.length > 1) return `${tables.length} tabelas · ${rows} ${rows === 1 ? "linha" : "linhas"}`;
    return `Base de dados · ${rows} ${rows === 1 ? "linha" : "linhas"}`;
  }
  if (file.format === "pdf") return `PDF · ${formatBytes(file.size)}`;
  if (file.format === "draw") {
    const count = readDrawDoc(file).elements.length;
    return `Desenho · ${count} ${count === 1 ? "elemento" : "elementos"}`;
  }
  const stripped = window.Links ? window.Links.splitFrontmatter(file.body).body : file.body;
  return stripped.replace(/\s+/g, " ").trim() || "Sem texto adicional";
}

function readDrawDoc(file) {
  try {
    const parsed = JSON.parse(file.body || "{}");
    return {
      type: "draw",
      version: 1,
      grid: parsed.grid !== false,
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    };
  } catch {
    return { type: "draw", version: 1, grid: true, elements: [] };
  }
}

/* -------------------------------------------------------------- titlebar */

function syncTitlebar() {
  const file = selectedFile();
  const label = file ? file.title : "Arquivos";
  if (els.titlebarTitle) els.titlebarTitle.textContent = label;
  if (els.titlebarVault) {
    els.titlebarVault.textContent = state.vault.root ? shortPath(state.vault.root).split("/").pop() : "Arquivos";
  }
  document.title = file ? `${file.title} — ${folderName(file.folderId)}` : "Arquivos";
}

function setupTitlebar() {
  if (!api?.window || !els.titlebar) return;
  document.documentElement.classList.add("is-electron");
  document.documentElement.classList.add(`platform-${api.platform || "linux"}`);
  els.titlebar.hidden = false;
  if (api.platform !== "darwin" && els.windowControls) els.windowControls.hidden = false;
  const setMaximized = (maximized) => {
    els.windowControls?.classList.toggle("is-maximized", Boolean(maximized));
    if (els.winMax) els.winMax.title = maximized ? "Restaurar" : "Maximizar";
  };
  api.window.isMaximized().then(setMaximized);
  api.window.onState((next) => setMaximized(next?.maximized));
  els.winMin?.addEventListener("click", () => api.window.minimize());
  els.winMax?.addEventListener("click", () => api.window.toggleMaximize());
  els.winClose?.addEventListener("click", () => api.window.close());
  els.titlebar.addEventListener("dblclick", (event) => {
    if (event.target.closest("button, input, .titlebar__center, .titlebar__right")) return;
    api.window.toggleMaximize();
  });
  els.titlebarCrumb?.addEventListener("click", () => openPalette());
}

/* ------------------------------------------------------------ context menu */

function openContextMenu(x, y, items) {
  if (!els.contextMenu) return;
  els.contextMenu.innerHTML = items
    .map((item, i) => {
      if (item.sep) return `<div class="context-menu__sep"></div>`;
      const cls = item.danger ? " is-danger" : "";
      const disabled = item.disabled ? " disabled" : "";
      return `<button type="button" class="context-menu__item${cls}" data-ctx="${i}"${disabled}>${escapeHtml(
        item.label
      )}</button>`;
    })
    .join("");
  els.contextMenu.hidden = false;
  const rect = els.contextMenu.getBoundingClientRect();
  els.contextMenu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  els.contextMenu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  els.contextMenu.onclick = (event) => {
    const button = event.target.closest("[data-ctx]");
    if (!button) return;
    const item = items[Number(button.dataset.ctx)];
    closeContextMenu();
    item?.action?.();
  };
}

function closeContextMenu() {
  if (els.contextMenu) els.contextMenu.hidden = true;
}

/* ------------------------------------------------------------------ vault */

function renderWelcome() {
  const needsVault = Boolean(api) && !state.vault.ready;
  if (els.welcome) els.welcome.hidden = !needsVault;
  els.app?.classList.toggle("is-locked", needsVault);
  if (!needsVault || !els.welcomeList) return;
  const known = state.vault.vaults || [];
  els.welcomeList.innerHTML = known.length
    ? `<div class="welcome__label">Cofres conhecidos</div>${known
        .map(
          (vault) =>
            `<button class="welcome__item" type="button" data-open-vault="${escapeHtml(vault.path)}">
              <span>${escapeHtml(vault.name)}</span><span>${escapeHtml(shortPath(vault.path))}</span>
            </button>`
        )
        .join("")}`
    : "";
}

async function pickVault({ create }) {
  if (!api) return;
  const info = await api.vault.pick({ create });
  if (!info) return;
  if (!info.empty && create) {
    const ok = confirm(
      `A pasta já tem ${info.files} arquivo(s) e ${info.folders} pasta(s).\nUsar como cofre mesmo assim?`
    );
    if (!ok) return;
  }
  if (els.welcomeHint) {
    els.welcomeHint.textContent = info.empty
      ? "Cofre novo, vazio."
      : `${info.files} arquivo(s) e ${info.folders} pasta(s) encontrados.`;
  }
  await openVault(info.path);
}

async function openVault(vaultPath) {
  if (!api) return;
  const next = await api.vault.open(vaultPath);
  state.vault = next;
  state.fileId = null;
  state.tabs = [];
  state.folderId = "all";
  await restoreWorkspace();
  await refresh();
}

function vaultMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  const items = [];
  for (const vault of state.vault.vaults || []) {
    const active = vault.path === state.vault.root;
    items.push({
      label: `${active ? "● " : "○ "}${vault.name} — ${shortPath(vault.path)}`,
      action: () => (active ? null : openVault(vault.path)),
    });
  }
  if (items.length) items.push({ sep: true });
  items.push({ label: "Abrir outra pasta…", action: () => pickVault({ create: false }) });
  items.push({ label: "Criar novo cofre…", action: () => pickVault({ create: true }) });
  items.push({ sep: true });
  items.push({ label: "Abrir no gerenciador de arquivos", action: () => revealFile(null) });
  items.push({ label: "Configurações", action: () => openSettings("vaults") });
  openContextMenu(rect.left, rect.top - 8 - items.length * 30, items);
}

/* ---------------------------------------------------------------- folders */

function folderIcon(kind) {
  if (kind === "deleted") {
    return `<svg class="folder__icon folder__icon--muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 4.5h10M6 4.5V3.2A1.2 1.2 0 0 1 7.2 2h1.6A1.2 1.2 0 0 1 10 3.2v1.3M5.2 6.2v6.1A1.2 1.2 0 0 0 6.4 13.5h3.2a1.2 1.2 0 0 0 1.2-1.2V6.2" stroke-linecap="round"/></svg>`;
  }
  if (kind === "all") {
    return `<svg class="folder__icon" viewBox="0 0 16 16" fill="currentColor"><path d="M3.2 2.2h6.4c.6 0 1.1.5 1.1 1.1v.6h1c.7 0 1.3.6 1.3 1.3v7.5c0 .7-.6 1.3-1.3 1.3H4.2c-.7 0-1.3-.6-1.3-1.3V3.3c0-.6.5-1.1 1.1-1.1h.2Zm7.5 2.8H4.4v7.2h8.1V5.2c0-.1-.1-.2-.2-.2h-1.6Z"/></svg>`;
  }
  return `<svg class="folder__icon" viewBox="0 0 16 16" fill="currentColor"><path d="M2.4 4.2c0-.8.6-1.4 1.4-1.4h3l1.1 1.4h4.3c.8 0 1.4.6 1.4 1.4v6.2c0 .8-.6 1.4-1.4 1.4H3.8c-.8 0-1.4-.6-1.4-1.4V4.2Z"/></svg>`;
}

function isHidden(folder) {
  const parts = folder.id.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    if (state.collapsed.has(parts.slice(0, i).join("/"))) return true;
  }
  return false;
}

function hasChildren(folderId) {
  return state.folders.some((folder) => folder.parentId === folderId);
}

function folderRow(folder, { count, kind }) {
  if (state.renamingFolder === folder.id) {
    return `<div class="folder-create" style="padding-left:${8 + (folder.depth || 0) * 12}px">
      ${folderIcon(kind)}
      <input class="folder__name-input" data-rename-folder="${escapeHtml(folder.id)}" value="${escapeHtml(
      folder.name
    )}">
    </div>`;
  }
  const active = folder.id === state.folderId ? " is-active" : "";
  const twisty =
    kind === "folder" && hasChildren(folder.id)
      ? `<button class="folder__twisty${state.collapsed.has(folder.id) ? " is-closed" : ""}" type="button" data-twisty="${escapeHtml(
          folder.id
        )}">▾</button>`
      : `<span class="folder__twisty is-empty"></span>`;
  return `<div class="folder${active}" data-folder="${escapeHtml(folder.id)}" data-kind="${kind}"
      style="padding-left:${4 + (folder.depth || 0) * 12}px" ${kind === "folder" || kind === "all" ? 'data-drop="1"' : ""}>
    ${twisty}
    ${folderIcon(kind)}
    <span class="folder__name">${escapeHtml(folder.name)}</span>
    <span class="folder__count">${count || ""}</span>
  </div>`;
}

function renderFolders() {
  if (!els.folders) return;
  const rows = [];
  rows.push(folderRow({ ...ALL_FILES, depth: 0 }, { count: filesInFolder("all").length, kind: "all" }));

  const rootFiles = state.files.filter((file) => !file.deleted && !file.folderId).length;
  if (rootFiles) {
    rows.push(
      folderRow({ id: "", name: "Raiz do cofre", depth: 0 }, { count: rootFiles, kind: "folder" })
    );
  }

  for (const folder of state.folders) {
    if (isHidden(folder)) continue;
    rows.push(folderRow(folder, { count: filesInFolder(folder.id).length, kind: "folder" }));
    if (state.creatingFolder === folder.id) {
      rows.push(
        `<div class="folder-create" style="padding-left:${16 + (folder.depth || 0) * 12}px">${folderIcon(
          "folder"
        )}<input id="folder-create-input" placeholder="Nome da pasta"></div>`
      );
    }
  }

  if (state.creatingFolder === "") {
    rows.push(
      `<div class="folder-create">${folderIcon("folder")}<input id="folder-create-input" placeholder="Nome da pasta"></div>`
    );
  }

  rows.push(
    `<div class="folders__spacer"></div>` +
      folderRow({ ...TRASH, depth: 0 }, { count: filesInFolder("deleted").length, kind: "deleted" })
  );

  els.folders.innerHTML = rows.join("");
  if (els.vaultSwitch) els.vaultSwitch.textContent = shortPath(state.vault.root);

  if (focusFolderInput) {
    focusFolderInput = false;
    const input = els.folders.querySelector("#folder-create-input, [data-rename-folder]");
    if (input) {
      input.focus();
      input.select();
    }
  }
}

/* ------------------------------------------------------------- file list */

function renderFiles() {
  if (!els.files) return;
  const list = visibleFiles();
  if (!list.length) {
    const canCreate = state.folderId !== "deleted";
    els.files.innerHTML = `<div class="empty-list">${
      state.query ? "Nada encontrado" : "Nenhum arquivo"
    }${canCreate && !state.query ? `<button class="empty-list__new" type="button" data-empty-create>Novo arquivo</button>` : ""}</div>`;
    return;
  }

  const groups = [];
  for (const file of list) {
    const label = groupLabel(file.updatedAt);
    const last = groups[groups.length - 1];
    if (!last || last.label !== label) groups.push({ label, files: [file] });
    else last.files.push(file);
  }

  els.files.innerHTML = groups
    .map((group) => {
      const rows = group.files
        .map((file) => {
          const active = file.id === state.fileId ? " is-active" : "";
          const backs = state.index ? (state.index.incoming.get(file.id) || []).length : 0;
          const folderTag =
            state.query || state.folderId === "all"
              ? `<span class="file-row__folder">${escapeHtml(folderName(file.folderId))}</span>`
              : "";
          return `<div class="file-row${active}" data-file="${escapeHtml(file.id)}" draggable="true">
            <span class="file-row__head">
              ${formatIcon(file.format)}
              <span class="file-row__title">${escapeHtml(file.title || "Sem nome")}</span>
              <span class="file-row__date">${formatListDate(file.updatedAt)}</span>
            </span>
            <span class="file-row__preview">
              <span class="file-row__snippet">${escapeHtml(previewText(file))}</span>
              ${backs ? `<span class="file-row__badge" title="backlinks">↩ ${backs}</span>` : ""}
              ${folderTag}
              <span class="file-row__ext">${FORMAT_LABEL[file.format] || file.format}</span>
            </span>
          </div>`;
        })
        .join("");
      return `<div class="files__group"><div class="files__group-label">${group.label}</div>${rows}</div>`;
    })
    .join("");
}

/* ------------------------------------------------------------------ tabs */

function openFile(id, { focus = true } = {}) {
  const file = fileById(id);
  if (!file) return;
  closeSlash();
  if (!state.tabs.includes(id)) state.tabs.push(id);
  state.fileId = id;
  state.notice = "";
  syncFileView(file);
  render();
  saveWorkspace();
  if (focus && file.format === "txt") els.body?.focus();
  else if (focus && window.CodeEditor?.isOpen()) window.CodeEditor.focus();
}

function closeTab(id) {
  const position = state.tabs.indexOf(id);
  state.tabs = state.tabs.filter((tab) => tab !== id);
  if (state.fileId === id) {
    const next = state.tabs[position] || state.tabs[position - 1] || null;
    state.fileId = next;
    if (next) syncFileView(fileById(next));
  }
  render();
  saveWorkspace();
}

function renderTabs() {
  if (!els.tabs) return;
  const tabs = state.tabs.map((id) => fileById(id)).filter(Boolean);
  state.tabs = tabs.map((file) => file.id);
  els.tabs.hidden = tabs.length === 0;
  els.tabs.innerHTML = tabs
    .map((file) => {
      if (state.renamingTab === file.id) {
        return `<div class="tab is-renaming"><input class="tab__input" data-rename-tab="${escapeHtml(
          file.id
        )}" value="${escapeHtml(file.title)}"></div>`;
      }
      const active = file.id === state.fileId ? " is-active" : "";
      const dirty = file.id === state.fileId && state.save === "saving" ? " is-dirty" : "";
      return `<div class="tab${active}${dirty}" data-tab="${escapeHtml(file.id)}" title="${escapeHtml(
        file.relativePath
      )}" draggable="true">
        ${formatIcon(file.format)}
        <span class="tab__label">${escapeHtml(file.title)}</span>
        <button class="tab__close" type="button" data-close-tab="${escapeHtml(file.id)}" title="Fechar">×</button>
      </div>`;
    })
    .join("");
  const renaming = els.tabs.querySelector("[data-rename-tab]");
  if (renaming) {
    renaming.focus();
    renaming.select();
  }
}

/* ---------------------------------------------------------------- editor */

function defaultView(file) {
  if (file?.format === "db") return "table";
  return "edit";
}

function syncFileView(file) {
  if (!file) {
    state.view = "edit";
    return;
  }
  if (file.format === "db") {
    if (!["table", "code", "sql", "diagram", "prisma"].includes(state.view)) state.view = "table";
    return;
  }
  if (file.format === "md" || file.format === "html") {
    if (!["edit", "preview"].includes(state.view)) state.view = "edit";
    return;
  }
  state.view = "edit";
}

function schemaKindFor(view) {
  if (view === "code") return "dbms";
  if (view === "sql") return "sql";
  if (view === "diagram") return "mermaid";
  if (view === "prisma") return "prisma";
  return null;
}

function highlightLanguage(file) {
  if (!file) return "plaintext";
  if (file.format === "md") return "markdown";
  if (file.format === "html") return "html";
  const kind = schemaKindFor(state.view);
  if (kind === "sql") return "sql";
  if (kind === "prisma") return "prisma";
  if (kind === "dbms") return "dbms";
  if (kind === "mermaid") return "mermaid";
  return "plaintext";
}

function shouldHighlight(file) {
  if (!file || file.format === "txt" || file.format === "pdf" || file.format === "draw") return false;
  if (!window.CodeEditor || window.CodeEditor.failed) return false;
  if ((file.format === "md" || file.format === "html") && state.view === "edit") return true;
  if (file.format === "db" && schemaKindFor(state.view)) return true;
  return false;
}

function currentSourceValue() {
  if (window.CodeEditor?.isOpen()) return window.CodeEditor.getValue();
  if (els.schema && !els.schema.hidden) return els.schema.value;
  return els.body.value;
}

function schemaPlaceholder(view) {
  if (view === "code") {
    return `DATABASE "Minha base";\n\nTABLE "Clientes" (\n  id TEXT PRIMARY KEY,\n  Nome TEXT,\n  Status TEXT -- Ativo | Inativo\n);`;
  }
  if (view === "sql") return `CREATE TABLE clientes (\n  id TEXT PRIMARY KEY,\n  nome TEXT\n);`;
  if (view === "diagram") return `erDiagram\n  clientes {\n    string id PK\n    string nome\n  }`;
  if (view === "prisma") return `model Cliente {\n  id   String @id @default(cuid())\n  nome String?\n}`;
  return "";
}

function renderPreview(file) {
  try {
    els.preview.innerHTML = window.renderMarkdown(file.body);
  } catch (err) {
    console.error(err);
    els.preview.textContent = "Não deu para gerar o preview.";
  }
}

function wrapHtmlDocument(source) {
  const text = String(source || "");
  if (/<html[\s>]/i.test(text)) return text;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:16px;font-family:system-ui,sans-serif;line-height:1.5}</style></head>
<body>${text}</body></html>`;
}

async function renderHtmlPreview(file) {
  if (!els.htmlPreview) return;
  const html = wrapHtmlDocument(file.body);
  if (els.htmlStageUrl) els.htmlStageUrl.textContent = file.filename;
  if (api?.preview) {
    const key = await api.preview.html(file.id, html);
    els.htmlPreview.removeAttribute("srcdoc");
    els.htmlPreview.src = `vault-preview://preview/?k=${encodeURIComponent(key)}&v=${file.updatedAt}`;
    return;
  }
  els.htmlPreview.removeAttribute("src");
  els.htmlPreview.srcdoc = html;
}

function clearHtmlPreview() {
  if (!els.htmlPreview) return;
  els.htmlPreview.removeAttribute("srcdoc");
  els.htmlPreview.src = "about:blank";
}

function syncHtmlStageSize() {
  if (!els.htmlStageDevice) return;
  els.htmlStageDevice.classList.toggle("is-phone", state.htmlSize === "390");
  els.htmlStageDevice.classList.toggle("is-tablet", state.htmlSize === "768");
  document.querySelectorAll("[data-html-size]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.htmlSize === state.htmlSize);
  });
}

function renderPdf(file) {
  if (!els.pdfFrame) return;
  const url = api ? api.files.url(file.relativePath) : "";
  if (els.pdfFrame.dataset.src === url) return;
  els.pdfFrame.dataset.src = url;
  els.pdfFrame.src = url || "about:blank";
}

function clearPdf() {
  if (!els.pdfFrame) return;
  els.pdfFrame.dataset.src = "";
  els.pdfFrame.src = "about:blank";
}

function renderDiagram(db) {
  if (!els.diagram) return;
  els.diagram.innerHTML = window.toDiagramHtml(db);
  const paint = () => window.layoutErDiagram?.(els.diagram);
  requestAnimationFrame(() => requestAnimationFrame(paint));
  if (!renderDiagram.ro && typeof ResizeObserver === "function") {
    renderDiagram.ro = new ResizeObserver(paint);
    renderDiagram.ro.observe(els.diagram);
  }
}

function applyDbSchema(kind, text, { silent } = {}) {
  const file = selectedFile();
  if (!file || file.format !== "db") return false;
  const result = window.fromSchema(kind, text);
  if (!result.ok) {
    if (!silent) els.editorStatus.textContent = result.error;
    return false;
  }
  const prev = window.parseDatabase(file.body);
  const merged = window.mergeDatabase(prev, result.tables, result.relations);
  queueSave({ body: window.serializeDatabase(merged) }, 250);
  if (els.diagram && state.view === "diagram") renderDiagram(merged);
  return true;
}

let schemaTimer = 0;
function queueSchemaApply(kind, text) {
  clearTimeout(schemaTimer);
  schemaTimer = setTimeout(() => applyDbSchema(kind, text, { silent: true }), 400);
}

function renderEditor() {
  const file = selectedFile();
  const show = Boolean(file);
  els.editor.classList.toggle("is-open", show);
  els.editorEmpty.classList.toggle("is-visible", !show);
  els.app.classList.toggle("is-editing", show);
  const inTrash = Boolean(file?.deleted);
  els.trashFile.disabled = !show || inTrash;
  if (els.trashFileList) els.trashFileList.disabled = !show || inTrash;
  els.revealFile.disabled = !show && !state.vault.root;
  if (els.emptyTrash) els.emptyTrash.hidden = state.folderId !== "deleted";
  syncTitlebar();

  if (!file) {
    els.editorEmpty.textContent = state.notice || "Nenhum arquivo selecionado";
    els.viewMode.hidden = true;
    if (els.exportPrisma) els.exportPrisma.hidden = true;
    if (els.importSchema) els.importSchema.hidden = true;
    if (els.htmlStage) els.htmlStage.hidden = true;
    if (els.schema) els.schema.hidden = true;
    if (els.elementsBar) els.elementsBar.hidden = true;
    if (els.pdfStage) els.pdfStage.hidden = true;
    if (els.drawStage) els.drawStage.hidden = true;
    els.editorStatus.textContent = state.vault.root ? shortPath(state.vault.root) : "";
    clearHtmlPreview();
    clearPdf();
    window.DrawEditor?.unmount();
    window.CodeEditor?.hide();
    tableView?.unmount();
    return;
  }

  syncFileView(file);
  const md = file.format === "md";
  const isHtml = file.format === "html";
  const isDb = file.format === "db";
  const isPdf = file.format === "pdf";
  const isDraw = file.format === "draw";
  if (!md) closeSlash();

  els.editor.classList.toggle("is-md", md);
  els.editor.classList.toggle("is-html", isHtml);
  els.editor.classList.toggle("is-html-preview", isHtml && state.view === "preview");
  els.editor.classList.toggle("is-db", isDb);
  els.editor.classList.toggle("is-db-table", isDb && state.view === "table");
  els.editor.classList.toggle("is-db-diagram", isDb && state.view === "diagram");
  els.editor.classList.toggle("is-pdf", isPdf);
  els.editor.classList.toggle("is-draw", isDraw);

  els.viewMode.hidden = !(md || isHtml || isDb);
  if (els.exportPrisma) els.exportPrisma.hidden = !isDb;
  if (els.importSchema) els.importSchema.hidden = !isDb;

  const previewing = (md || isHtml) && state.view === "preview";
  const showTable = isDb && state.view === "table";
  const schemaKind = isDb ? schemaKindFor(state.view) : null;
  const showSchema = Boolean(schemaKind);
  const showDiagram = isDb && state.view === "diagram";
  const highlight = shouldHighlight(file);

  els.body.hidden = file.format !== "txt";
  els.preview.hidden = !(md && previewing);
  if (els.htmlStage) els.htmlStage.hidden = !(isHtml && previewing);
  if (els.pdfStage) els.pdfStage.hidden = !isPdf;
  if (els.drawStage) els.drawStage.hidden = !isDraw;
  els.db.hidden = !showTable;
  if (els.schema) els.schema.hidden = !showSchema || highlight;
  if (els.codeEditor) els.codeEditor.hidden = !highlight;
  if (els.diagram) els.diagram.hidden = !showDiagram;
  if (els.elementsBar) els.elementsBar.hidden = !(md && state.view === "edit");
  if (!highlight) window.CodeEditor?.hide();

  els.viewMode.querySelectorAll("button").forEach((button) => {
    const forKind = button.dataset.for;
    const visible = (forKind === "md" && md) || (forKind === "html" && isHtml) || (forKind === "db" && isDb);
    button.hidden = !visible;
    button.classList.toggle("is-active", visible && button.dataset.view === state.view);
  });

  if (!isDb && !highlight && document.activeElement !== els.body) {
    els.body.value = file.body;
  }
  if (md && previewing) renderPreview(file);
  if (isHtml && previewing) {
    syncHtmlStageSize();
    renderHtmlPreview(file);
  }
  if (!isHtml) clearHtmlPreview();
  if (isPdf) renderPdf(file);
  else clearPdf();

  if (isDraw) mountDraw(file);
  else window.DrawEditor?.unmount();

  if (isDb) {
    const db = window.parseDatabase(file.body);
    if (showSchema && els.schema && !highlight && document.activeElement !== els.schema) {
      els.schema.placeholder = schemaPlaceholder(state.view);
      els.schema.value = window.schemaTextFor(schemaKind, db, file.title);
    }
    if (showDiagram && els.diagram) renderDiagram(db);
    tableView?.mount(
      els.db,
      db,
      (next) => queueSave({ body: window.serializeDatabase(next) }, 250),
      file.id
    );
  } else {
    tableView?.unmount();
  }

  if (highlight) {
    const value =
      file.format === "db"
        ? window.schemaTextFor(schemaKind, window.parseDatabase(file.body), file.title)
        : file.body;
    window.CodeEditor.show({
      key: `${file.id}:${state.view}`,
      language: highlightLanguage(file),
      value,
      onChange(text) {
        const current = selectedFile();
        if (!current) return;
        if (current.format === "db") {
          const kind = schemaKindFor(state.view);
          if (kind) queueSchemaApply(kind, text);
          return;
        }
        queueSave({ body: text });
        if (current.format === "md") syncSlashMenu();
      },
    });
  }

  if (state.notice) {
    els.editorStatus.textContent = state.notice;
    return;
  }
  const saveLabel =
    state.save === "saving" ? "Salvando…" : state.save === "error" ? "Erro ao salvar" : "Salvo";
  const extra = showSchema
    ? " · edite o schema para criar ou alterar tabelas"
    : isHtml && previewing
      ? " · JavaScript ativo no preview"
      : isPdf
        ? ` · ${formatBytes(file.size)}`
        : "";
  els.editorStatus.textContent = `${file.relativePath} · ${saveLabel}${extra}`;
}

function mountDraw(file) {
  if (!window.DrawEditor || !els.drawCanvas) return;
  window.DrawEditor.mount({
    key: file.id,
    canvas: els.drawCanvas,
    toolsEl: els.drawTools,
    styleEl: els.drawStyle,
    historyEl: els.drawHistory,
    zoomEl: els.drawZoom,
    doc: readDrawDoc(file),
    onChange: (doc) => queueSave({ body: `${JSON.stringify(doc, null, 2)}\n` }, 500),
  });
}

/* --------------------------------------------------------------- details */

function renderDetails() {
  if (!els.details) return;
  els.details.hidden = !state.detailsOpen;
  els.app.classList.toggle("is-details-open", state.detailsOpen);
  if (!state.detailsOpen || !els.detailsBody) return;
  const file = selectedFile();
  if (!file) {
    els.detailsBody.innerHTML = `<p class="details__empty">Selecione um arquivo.</p>`;
    return;
  }
  const meta = state.index?.meta.get(file.id);
  const backs = state.index ? window.Links.backlinks(state.index, file.id) : [];
  const outs = state.index ? window.Links.forwardLinks(state.index, file.id) : [];
  const rows = [
    ["Nome", file.filename],
    ["Pasta", folderName(file.folderId)],
    ["Caminho", file.relativePath],
    ["Formato", FORMAT_LABEL[file.format] || file.format],
    ["Tamanho", formatBytes(file.size)],
    ["Criado", formatFullDate(file.createdAt)],
    ["Modificado", formatFullDate(file.updatedAt)],
  ];
  const tags = meta?.tags || [];
  els.detailsBody.innerHTML = `
    <dl class="details__grid">
      ${rows
        .map(
          ([label, value]) =>
            `<dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd>`
        )
        .join("")}
    </dl>
    ${
      tags.length
        ? `<div class="details__section"><h4>Tags</h4><div class="details__tags">${tags
            .map((tag) => `<button class="tag" type="button" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`)
            .join("")}</div></div>`
        : ""
    }
    <div class="details__section">
      <h4>Backlinks (${backs.length})</h4>
      ${
        backs.length
          ? `<ul class="details__links">${backs
              .map(
                (item) =>
                  `<li><button type="button" data-open-file="${escapeHtml(item.id)}">${escapeHtml(
                    item.title
                  )}</button></li>`
              )
              .join("")}</ul>`
          : `<p class="details__empty">Nenhum arquivo aponta para cá.</p>`
      }
    </div>
    <div class="details__section">
      <h4>Links deste arquivo (${outs.length})</h4>
      ${
        outs.length
          ? `<ul class="details__links">${outs
              .map((link) =>
                link.file
                  ? `<li><button type="button" data-open-file="${escapeHtml(link.file.id)}">${escapeHtml(
                      link.file.title
                    )}</button></li>`
                  : `<li><button type="button" class="is-missing" data-create-link="${escapeHtml(
                      link.target
                    )}">${escapeHtml(link.target)} — criar</button></li>`
              )
              .join("")}</ul>`
          : `<p class="details__empty">Use [[nome do arquivo]] para ligar.</p>`
      }
    </div>`;
}

/* --------------------------------------------------------------- palette */

function paletteItems() {
  const query = state.paletteQuery.trim().toLowerCase();
  const commands = [
    { kind: "cmd", label: "Novo arquivo Markdown", run: () => createFile("md") },
    { kind: "cmd", label: "Novo desenho", run: () => createFile("draw") },
    { kind: "cmd", label: "Nova base de dados", run: () => createFile("db") },
    { kind: "cmd", label: "Nova pasta", run: () => startCreateFolder(currentFolderForCreate()) },
    { kind: "cmd", label: "Importar arquivos…", run: () => importFiles() },
    { kind: "cmd", label: "Abrir grafo do cofre", run: () => openGraph() },
    { kind: "cmd", label: "Chat com IA", run: () => toggleChat(true) },
    { kind: "cmd", label: "Configurações", run: () => openSettings("vaults") },
    { kind: "cmd", label: "Trocar de cofre…", run: () => pickVault({ create: false }) },
  ];
  const files = state.files
    .filter((file) => !file.deleted)
    .map((file) => ({
      kind: "file",
      label: file.title,
      hint: file.relativePath,
      run: () => openFile(file.id),
    }));
  const all = [...files, ...commands];
  if (!query) return all.slice(0, 40);
  return all
    .filter((item) => `${item.label} ${item.hint || ""}`.toLowerCase().includes(query))
    .slice(0, 40);
}

function renderPalette() {
  if (!els.palette) return;
  els.palette.hidden = !state.paletteOpen;
  if (!state.paletteOpen) return;
  const items = paletteItems();
  if (state.paletteIndex >= items.length) state.paletteIndex = 0;
  els.paletteList.innerHTML = items.length
    ? items
        .map(
          (item, i) =>
            `<button type="button" class="palette__item${i === state.paletteIndex ? " is-active" : ""}" data-palette="${i}">
              <span class="palette__kind">${item.kind === "cmd" ? "cmd" : "arq"}</span>
              <span class="palette__label">${escapeHtml(item.label)}</span>
              <span class="palette__hint">${escapeHtml(item.hint || "")}</span>
            </button>`
        )
        .join("")
    : `<div class="palette__empty">Nada encontrado</div>`;
}

function openPalette() {
  state.paletteOpen = true;
  state.paletteQuery = "";
  state.paletteIndex = 0;
  renderPalette();
  els.paletteInput.value = "";
  els.paletteInput.focus();
}

function closePalette() {
  state.paletteOpen = false;
  renderPalette();
}

function runPalette(index) {
  const items = paletteItems();
  const item = items[index ?? state.paletteIndex];
  closePalette();
  item?.run?.();
}

/* ---------------------------------------------------------------- slash */

function closeSlash() {
  slash.open = false;
  slash.index = 0;
  slash.items = [];
  if (els.slashMenu) els.slashMenu.hidden = true;
}

function slashQuery() {
  if (window.CodeEditor?.isOpen()) return window.CodeEditor.slashContext();
  const caret = els.body.selectionStart;
  const before = els.body.value.slice(0, caret);
  const lineStart = before.lastIndexOf("\n") + 1;
  const match = before.slice(lineStart).match(/^\/([^\s]*)$/);
  if (!match) return null;
  return { start: lineStart, query: match[1], caret };
}

function caretMenuPosition() {
  const fromCode = window.CodeEditor?.isOpen() ? window.CodeEditor.caretPoint() : null;
  if (fromCode) {
    return {
      top: Math.min(window.innerHeight - 280, Math.max(8, fromCode.top + 6)),
      left: Math.min(window.innerWidth - 280, Math.max(8, fromCode.left)),
    };
  }
  const ta = els.body;
  const rect = ta.getBoundingClientRect();
  return {
    top: Math.min(window.innerHeight - 280, Math.max(8, rect.top + 32)),
    left: Math.min(window.innerWidth - 280, Math.max(8, rect.left + 16)),
  };
}

function renderSlashMenu() {
  if (!els.slashMenu || !slash.open) return;
  els.slashMenu.innerHTML = slash.items.length
    ? slash.items
        .map(
          (command, index) =>
            `<button class="slash-menu__item${index === slash.index ? " is-active" : ""}" type="button" data-slash="${escapeHtml(
              command.id
            )}">
              <span class="slash-menu__label">${escapeHtml(command.label)}</span>
              <span class="slash-menu__hint">${escapeHtml(command.hint)}</span>
            </button>`
        )
        .join("")
    : `<div class="slash-menu__empty">Nenhum comando</div>`;
  const pos = caretMenuPosition();
  els.slashMenu.style.top = `${pos.top}px`;
  els.slashMenu.style.left = `${pos.left}px`;
  els.slashMenu.hidden = false;
}

function openSlash(query, start) {
  slash.items = window.matchSlashCommands(query);
  slash.start = start;
  slash.open = true;
  if (slash.index >= slash.items.length) slash.index = 0;
  renderSlashMenu();
}

function applySlash(command) {
  if (!command) return;
  const snippet = command.snippet;
  const cursor = slash.start + (command.cursor ?? snippet.length);
  if (window.CodeEditor?.isOpen()) {
    const caret = window.CodeEditor.slashContext()?.caret ?? slash.start;
    window.CodeEditor.replace(slash.start, caret, snippet, cursor);
    closeSlash();
    queueSave({ body: window.CodeEditor.getValue() });
    return;
  }
  const caret = els.body.selectionStart;
  const value = els.body.value;
  const next = `${value.slice(0, slash.start)}${snippet}${value.slice(caret)}`;
  els.body.value = next;
  els.body.focus();
  els.body.setSelectionRange(cursor, cursor);
  closeSlash();
  queueSave({ body: next });
}

function syncSlashMenu() {
  const file = selectedFile();
  if (!file || file.format !== "md" || state.view === "preview") {
    closeSlash();
    return;
  }
  const found = slashQuery();
  if (!found) {
    closeSlash();
    return;
  }
  openSlash(found.query, found.start);
}

function handleSlashKeys(event, monacoEvent) {
  if (!slash.open) return false;
  const prevent = () => {
    event?.preventDefault();
    monacoEvent?.preventDefault();
  };
  if (event.key === "ArrowDown") {
    prevent();
    if (slash.items.length) slash.index = (slash.index + 1) % slash.items.length;
    renderSlashMenu();
    return true;
  }
  if (event.key === "ArrowUp") {
    prevent();
    if (slash.items.length) slash.index = (slash.index - 1 + slash.items.length) % slash.items.length;
    renderSlashMenu();
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    if (!slash.items.length) return false;
    prevent();
    applySlash(slash.items[slash.index]);
    return true;
  }
  if (event.key === "Escape") {
    prevent();
    closeSlash();
    return true;
  }
  return false;
}

/* --------------------------------------------------------- elements bar */

const ELEMENTS = {
  h1: { prefix: "# " },
  h2: { prefix: "## " },
  h3: { prefix: "### " },
  ul: { prefix: "- " },
  ol: { prefix: "1. " },
  todo: { prefix: "- [ ] " },
  quote: { prefix: "> " },
  bold: { wrap: ["**", "**"], placeholder: "negrito" },
  italic: { wrap: ["*", "*"], placeholder: "itálico" },
  strike: { wrap: ["~~", "~~"], placeholder: "riscado" },
  code: { wrap: ["`", "`"], placeholder: "código" },
  link: { wrap: ["[", "](url)"], placeholder: "texto" },
  wikilink: { wrap: ["[[", "]]"], placeholder: "arquivo" },
  table: { insert: "\n| Coluna 1 | Coluna 2 |\n| --- | --- |\n|  |  |\n" },
  fence: { insert: "\n```\n\n```\n" },
  hr: { insert: "\n---\n" },
};

function applyElement(kind) {
  const spec = ELEMENTS[kind];
  const file = selectedFile();
  if (!spec || !file) return;
  if (window.CodeEditor?.isOpen()) {
    if (spec.prefix) window.CodeEditor.prefixLines(spec.prefix);
    else if (spec.wrap) window.CodeEditor.wrap(spec.wrap[0], spec.wrap[1], spec.placeholder || "");
    else if (spec.insert) window.CodeEditor.insert(spec.insert);
    queueSave({ body: window.CodeEditor.getValue() });
    return;
  }
  const ta = els.body;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  let next = value;
  let caret = end;
  if (spec.wrap) {
    const inner = value.slice(start, end) || spec.placeholder || "";
    next = `${value.slice(0, start)}${spec.wrap[0]}${inner}${spec.wrap[1]}${value.slice(end)}`;
    caret = start + spec.wrap[0].length + inner.length;
  } else if (spec.prefix) {
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    next = `${value.slice(0, lineStart)}${spec.prefix}${value.slice(lineStart)}`;
    caret = start + spec.prefix.length;
  } else if (spec.insert) {
    next = `${value.slice(0, start)}${spec.insert}${value.slice(end)}`;
    caret = start + spec.insert.length;
  }
  ta.value = next;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  queueSave({ body: next });
}

/* ------------------------------------------------------------------ save */

function queueSave(patch, delay = 400) {
  const file = selectedFile();
  if (!file) return;
  state.notice = "";
  if (pending.id && pending.id !== file.id) flushNow();
  pending.id = file.id;
  Object.assign(pending.patch, patch);
  Object.assign(file, patch, { updatedAt: Date.now() });
  rebuildIndex();
  renderFiles();
  renderTabs();
  state.save = "saving";
  els.editorStatus.textContent = `${file.relativePath} · Salvando…`;
  if (!api) {
    state.save = "saved";
    els.editorStatus.textContent = `${file.relativePath} · Preview, não grava no disco`;
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushNow, delay);
}

function flushNow() {
  clearTimeout(saveTimer);
  saveChain = saveChain.then(flushSave, flushSave);
}

async function flushSave() {
  const { id, patch } = pending;
  pending = { id: null, patch: {} };
  if (!id || !api || !Object.keys(patch).length) return;
  try {
    ignoreWatch += 1;
    const next = await api.files.write(id, patch);
    const position = state.files.findIndex((file) => file.id === id);
    if (position >= 0) state.files[position] = next;
    else state.files.unshift(next);
    if (next.id !== id) {
      state.tabs = state.tabs.map((tab) => (tab === id ? next.id : tab));
      if (state.fileId === id) state.fileId = next.id;
      if (tableView?.fileId === id) tableView.fileId = next.id;
      saveWorkspace();
    }
    state.save = "saved";
    rebuildIndex();
    renderFiles();
    renderTabs();
    renderEditor();
    if (state.detailsOpen) renderDetails();
  } catch (err) {
    console.error(err);
    state.save = "error";
    renderEditor();
  } finally {
    setTimeout(() => {
      ignoreWatch = Math.max(0, ignoreWatch - 1);
    }, 400);
  }
}

/* ------------------------------------------------------------ file actions */

function currentFolderForCreate() {
  if (state.folderId === "all" || state.folderId === "deleted") return "";
  return state.folderId;
}

async function createFile(format = "md", { folderId, title } = {}) {
  if (els.formatMenu) els.formatMenu.hidden = true;
  const target = folderId ?? currentFolderForCreate();
  try {
    ignoreWatch += 1;
    if (!api) {
      state.notice = "Preview no navegador: use npm run start para gravar arquivos";
      render();
      return null;
    }
    const file = await api.files.create({ folderId: target, format, title });
    state.files = [file, ...state.files.filter((item) => item.id !== file.id)];
    state.save = "saved";
    state.notice = "";
    rebuildIndex();
    openFile(file.id);
    return file;
  } catch (err) {
    console.error(err);
    state.notice = `Não deu para criar: ${err.message || err}`;
    render();
    return null;
  } finally {
    setTimeout(() => {
      ignoreWatch = Math.max(0, ignoreWatch - 1);
    }, 500);
  }
}

async function importFiles() {
  if (!api) return;
  if (els.formatMenu) els.formatMenu.hidden = true;
  try {
    ignoreWatch += 1;
    const imported = await api.files.import(currentFolderForCreate());
    if (!imported.length) return;
    await refresh();
    openFile(imported[0].id);
    state.notice = `${imported.length} arquivo(s) importado(s)`;
    render();
  } catch (err) {
    console.error(err);
    state.notice = `Falha ao importar: ${err.message || err}`;
    render();
  } finally {
    setTimeout(() => {
      ignoreWatch = Math.max(0, ignoreWatch - 1);
    }, 500);
  }
}

async function trashFile(id = state.fileId) {
  const file = fileById(id);
  if (!file || file.deleted) return;
  try {
    ignoreWatch += 1;
    if (api) await api.files.trash(file.id);
    state.tabs = state.tabs.filter((tab) => tab !== file.id);
    if (state.fileId === file.id) state.fileId = state.tabs[state.tabs.length - 1] || null;
    await refresh(state.fileId);
    state.notice = `“${file.title}” foi para ${TRASH.name}`;
    render();
  } catch (err) {
    console.error(err);
    state.notice = `Não deu para apagar: ${err.message || err}`;
    render();
  } finally {
    setTimeout(() => {
      ignoreWatch = Math.max(0, ignoreWatch - 1);
    }, 500);
  }
}

async function restoreFile(id) {
  if (!api) return;
  try {
    ignoreWatch += 1;
    const file = await api.files.restore(id, "");
    await refresh(file.id);
    state.notice = `“${file.title}” voltou para o cofre`;
    render();
  } finally {
    setTimeout(() => {
      ignoreWatch = Math.max(0, ignoreWatch - 1);
    }, 500);
  }
}

async function destroyFile(id) {
  const file = fileById(id);
  if (!file || !api) return;
  if (!confirm(`Apagar “${file.title}” de vez? Não tem como desfazer.`)) return;
  try {
    ignoreWatch += 1;
    await api.files.destroy(id);
    state.tabs = state.tabs.filter((tab) => tab !== id);
    if (state.fileId === id) state.fileId = state.tabs[state.tabs.length - 1] || null;
    await refresh(state.fileId);
  } finally {
    setTimeout(() => {
      ignoreWatch = Math.max(0, ignoreWatch - 1);
    }, 500);
  }
}

async function moveFile(id, folderId) {
  if (!api) return;
  const file = fileById(id);
  if (!file) return;
  try {
    ignoreWatch += 1;
    const next = await api.files.move(id, folderId);
    state.tabs = state.tabs.map((tab) => (tab === id ? next.id : tab));
    if (state.fileId === id) state.fileId = next.id;
    await refresh(state.fileId);
    state.notice = `“${next.title}” foi para ${folderName(next.folderId)}`;
    render();
    saveWorkspace();
  } catch (err) {
    console.error(err);
    state.notice = `Não deu para mover: ${err.message || err}`;
    render();
  } finally {
    setTimeout(() => {
      ignoreWatch = Math.max(0, ignoreWatch - 1);
    }, 500);
  }
}

async function revealFile(id) {
  if (!api) return;
  try {
    await api.files.reveal(id);
  } catch (err) {
    state.notice = `Não deu para abrir a pasta: ${err.message || err}`;
    render();
  }
}

function moveMenu(fileId, x, y) {
  const items = [{ label: "Raiz do cofre", action: () => moveFile(fileId, "") }];
  for (const folder of state.folders) {
    items.push({ label: `${"  ".repeat(folder.depth)}${folder.name}`, action: () => moveFile(fileId, folder.id) });
  }
  openContextMenu(x, y, items);
}

function fileMenu(fileId, x, y) {
  const file = fileById(fileId);
  if (!file) return;
  const items = file.deleted
    ? [
        { label: "Restaurar", action: () => restoreFile(fileId) },
        { label: "Apagar de vez", danger: true, action: () => destroyFile(fileId) },
      ]
    : [
        { label: "Abrir", action: () => openFile(fileId) },
        { label: "Renomear", action: () => startRenameTab(fileId) },
        { label: "Mover para…", action: () => moveMenu(fileId, x, y) },
        { sep: true },
        { label: "Detalhes", action: () => toggleDetails(true) },
        { label: "Perguntar à IA", action: () => toggleChat(true) },
        { label: "Abrir no gerenciador", action: () => revealFile(fileId) },
        { sep: true },
        { label: "Mover para a lixeira", danger: true, action: () => trashFile(fileId) },
      ];
  openContextMenu(x, y, items);
}

/* --------------------------------------------------------------- folders */

function startCreateFolder(parentId) {
  state.creatingFolder = parentId ?? "";
  state.renamingFolder = null;
  focusFolderInput = true;
  renderFolders();
}

async function submitNewFolder(name) {
  const parent = state.creatingFolder ?? "";
  const trimmed = name.trim();
  state.creatingFolder = null;
  if (!trimmed || !api) {
    renderFolders();
    return;
  }
  const folder = await api.folders.create(parent, trimmed);
  state.folders = await api.folders.list();
  state.folderId = folder.id;
  render();
}

async function submitRenameFolder(id, name) {
  const trimmed = name.trim();
  state.renamingFolder = null;
  if (!trimmed || !api) {
    renderFolders();
    return;
  }
  try {
    const folder = await api.folders.rename(id, trimmed);
    if (state.folderId === id) state.folderId = folder.id;
    state.tabs = state.tabs.map((tab) => (tab.startsWith(`${id}/`) ? tab.replace(id, folder.id) : tab));
    if (state.fileId?.startsWith(`${id}/`)) state.fileId = state.fileId.replace(id, folder.id);
    await refresh(state.fileId);
  } catch (err) {
    state.notice = `Não deu para renomear: ${err.message || err}`;
    render();
  }
}

async function removeFolder(id) {
  if (!api) return;
  const files = filesInFolder(id).length;
  const label = folderName(id);
  if (!confirm(`Apagar a pasta “${label}”?${files ? ` ${files} arquivo(s) vão para a lixeira.` : ""}`)) return;
  try {
    ignoreWatch += 1;
    await api.folders.remove(id);
    if (state.folderId === id || state.folderId.startsWith(`${id}/`)) state.folderId = "all";
    await refresh(state.fileId);
  } catch (err) {
    state.notice = `Não deu para apagar a pasta: ${err.message || err}`;
    render();
  } finally {
    setTimeout(() => {
      ignoreWatch = Math.max(0, ignoreWatch - 1);
    }, 500);
  }
}

function folderMenu(folderId, kind, x, y) {
  const items = [];
  if (kind === "deleted") {
    items.push({ label: "Esvaziar lixeira", danger: true, action: () => emptyTrash() });
  } else {
    items.push({ label: "Novo arquivo aqui", action: () => createFile("md", { folderId }) });
    items.push({ label: "Nova subpasta", action: () => startCreateFolder(folderId) });
    if (folderId && kind === "folder") {
      items.push({ sep: true });
      items.push({
        label: "Renomear",
        action: () => {
          state.renamingFolder = folderId;
          focusFolderInput = true;
          renderFolders();
        },
      });
      items.push({ label: "Apagar pasta", danger: true, action: () => removeFolder(folderId) });
    }
  }
  openContextMenu(x, y, items);
}

async function emptyTrash() {
  if (!api) return;
  if (!confirm("Apagar de vez tudo que está na lixeira?")) return;
  ignoreWatch += 1;
  await api.files.emptyTrash();
  await refresh(state.fileId);
  setTimeout(() => {
    ignoreWatch = Math.max(0, ignoreWatch - 1);
  }, 500);
}

function selectFolder(folderId) {
  closeSlash();
  state.folderId = folderId;
  state.notice = "";
  render();
  saveWorkspace();
}

/* ---------------------------------------------------------------- panels */

function toggleDetails(force) {
  state.detailsOpen = force ?? !state.detailsOpen;
  renderDetails();
}

function toggleChat(force) {
  state.chatOpen = force ?? !state.chatOpen;
  els.chat.hidden = !state.chatOpen;
  els.app.classList.toggle("is-chat-open", state.chatOpen);
  if (state.chatOpen) window.Chat?.focus();
  syncChatContext();
}

function syncChatContext() {
  if (!state.chatOpen) return;
  window.Chat?.setContext({
    file: selectedFile(),
    folderId: state.folderId,
    files: state.files,
    index: state.index,
    vault: state.vault,
  });
}

function openGraph() {
  if (!els.graph) return;
  els.graph.hidden = false;
  const graph = window.Links ? window.Links.toGraph(state.index) : { nodes: [], links: [] };
  window.GraphView?.render(els.graphCanvas, graph, {
    onOpen: (id) => {
      els.graph.hidden = true;
      openFile(id);
    },
  });
  if (els.graphLegend) {
    const broken = state.index?.unresolved.size || 0;
    els.graphLegend.textContent = `${graph.nodes.filter((n) => n.kind === "file").length} arquivos · ${
      graph.links.filter((l) => l.kind === "link").length
    } links · ${broken} link(s) quebrado(s)`;
  }
}

function graphMarkdown() {
  if (!state.index || !window.Links) return "";
  return window.Links.toMarkdownMap(state.index, { vaultPath: state.vault.root });
}

/* -------------------------------------------------------------- settings */

function openSettings(tab) {
  state.settingsTab = tab || state.settingsTab;
  els.settings.hidden = false;
  renderSettings();
}

function renderSettings() {
  if (!els.settingsBody) return;
  els.settingsTabs?.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.settingsTab === state.settingsTab);
  });
  const config = state.config || {};
  if (state.settingsTab === "vaults") {
    els.settingsBody.innerHTML = `
      <div class="setting">
        <div class="setting__label">Cofre atual</div>
        <div class="setting__value">${escapeHtml(state.vault.root || "nenhum")}</div>
      </div>
      <div class="setting">
        <div class="setting__label">Cofres</div>
        <div class="vault-list">
          ${(state.vault.vaults || [])
            .map(
              (vault) => `<div class="vault-list__row${vault.path === state.vault.root ? " is-active" : ""}">
                <button type="button" data-open-vault="${escapeHtml(vault.path)}">
                  <strong>${escapeHtml(vault.name)}</strong><span>${escapeHtml(shortPath(vault.path))}</span>
                </button>
                <button class="vault-list__forget" type="button" data-forget-vault="${escapeHtml(
                  vault.path
                )}" title="Remover da lista (não apaga arquivos)">×</button>
              </div>`
            )
            .join("")}
        </div>
        <div class="setting__actions">
          <button class="btn" type="button" data-vault-action="open">Abrir pasta…</button>
          <button class="btn" type="button" data-vault-action="create">Criar cofre…</button>
        </div>
      </div>`;
    return;
  }
  if (state.settingsTab === "preview") {
    const preview = config.preview || {};
    els.settingsBody.innerHTML = `
      <div class="setting">
        <div class="setting__label">Content-Security-Policy do preview HTML</div>
        <p class="setting__hint">
          O preview roda num protocolo isolado (<code>vault-preview:</code>). Estas chaves montam o CSP dele.
        </p>
        <label class="check"><input type="checkbox" data-config="preview.allowScripts" ${
          preview.allowScripts !== false ? "checked" : ""
        }> Permitir JavaScript no preview</label>
        <label class="check"><input type="checkbox" data-config="preview.allowRemote" ${
          preview.allowRemote ? "checked" : ""
        }> Permitir recursos remotos (https:) e fetch</label>
        <pre class="setting__code">${escapeHtml(
          [
            "default-src 'none'",
            preview.allowScripts !== false
              ? `script-src 'unsafe-inline' 'unsafe-eval' blob: data:${preview.allowRemote ? " https:" : ""}`
              : "script-src 'none'",
            `style-src 'unsafe-inline'${preview.allowRemote ? " https:" : ""}`,
            "img-src data: blob: vault-file: https: http:",
            preview.allowRemote ? "connect-src https:" : "connect-src 'none'",
          ].join(";\n")
        )}</pre>
      </div>`;
    return;
  }
  const llm = config.llm || {};
  const local = (llm.provider || "browser") === "browser";
  const engine = window.LocalLLM;
  const catalog = engine?.CATALOG || [];
  const chosen = llm.localModel || engine?.DEFAULT_MODEL || "";
  const localState = engine?.state?.() || { phase: "idle", percent: 0 };
  const localStatus =
    localState.phase === "ready"
      ? `Pronto · ${localState.device === "webgpu" ? "GPU" : "CPU"}`
      : localState.phase === "loading"
        ? `Baixando/carregando · ${Math.round(localState.percent || 0)}%`
        : localState.phase === "error"
          ? `Falhou · ${localState.error || "erro desconhecido"}`
          : "Não carregado";
  const localStatusKind =
    localState.phase === "ready" ? "ready" : localState.phase === "loading" ? "loading" : localState.phase === "error" ? "error" : "idle";
  els.settingsBody.innerHTML = `
    <div class="setting">
      <div class="setting__label">Onde a IA roda</div>
      <select data-config="llm.provider">
        ${[
          ["browser", "no app (WebGPU)"],
          ["ollama", "ollama"],
          ["openai-compat", "openai-compat"],
          ["openrouter", "openrouter"],
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}"${llm.provider === value ? " selected" : ""}>${label}</option>`
          )
          .join("")}
      </select>
      <p class="setting__hint">
        <strong>no app</strong> baixa o modelo uma vez e roda dentro da janela pela GPU, sem servidor nenhum.
        <strong>ollama</strong> e <strong>openai-compat</strong> falam com um servidor por HTTP, pelo processo
        principal, então o CSP não bloqueia e a chave não vaza para a página.
      </p>
    </div>
    ${
      local
        ? `<div class="setting">
      <div class="setting__label">Modelo embutido</div>
      <div class="setting__models" id="llm-local-models">
        ${catalog
          .map(
            (item) =>
              `<button class="chip${item.id === chosen ? " is-on" : ""}" type="button" data-pick-local="${escapeHtml(
                item.id
              )}" title="${escapeHtml(item.note)}">${escapeHtml(item.label)} · ${escapeHtml(item.size)}</button>`
          )
          .join("")}
      </div>
      <p class="setting__hint" id="llm-local-note">
        ${escapeHtml(catalog.find((item) => item.id === chosen)?.note || "")}
        Os pesos ficam no cache da janela; baixa só na primeira conversa.
      </p>
      <div class="setting__row">
        <span class="llm-status llm-status--${localStatusKind}"><i></i>${escapeHtml(localStatus)}</span>
        <button class="btn" type="button" id="llm-load"${localState.phase === "loading" ? " disabled" : ""}>${localState.phase === "ready" ? "Recarregar modelo" : "Baixar e carregar"}</button>
      </div>
    </div>
    <div class="setting">
      <div class="setting__label">Resposta máxima (tokens)</div>
      <input type="number" min="128" max="4096" step="64" data-config="llm.maxTokens" value="${Number(
        llm.maxTokens ?? 768
      )}">
    </div>`
        : `<div class="setting">
      <div class="setting__label">Base URL</div>
      <input type="text" data-config="llm.baseUrl" value="${escapeHtml(llm.baseUrl || "")}" placeholder="http://127.0.0.1:11434">
    </div>
    <div class="setting">
      <div class="setting__label">Modelo</div>
      <div class="setting__row">
        <input type="text" data-config="llm.model" value="${escapeHtml(llm.model || "")}" placeholder="llama3.1:8b">
        <button class="btn" type="button" id="llm-refresh">Listar modelos</button>
      </div>
      <div class="setting__models" id="llm-models"></div>
    </div>
    <div class="setting">
      <div class="setting__label">API key (só para provedores remotos)</div>
      <input type="password" data-config="llm.apiKey" value="${escapeHtml(llm.apiKey || "")}" placeholder="opcional">
    </div>`
    }
    <div class="setting">
      <div class="setting__label">Arquivos de contexto por pergunta</div>
      <input type="number" min="0" max="20" data-config="llm.contextFiles" value="${Number(
        llm.contextFiles ?? 6
      )}">
    </div>
    <div class="setting">
      <button class="btn" type="button" id="llm-test">${
        local ? "Checar GPU" : "Testar conexão"
      }</button>
      ${local ? '<button class="btn" type="button" id="llm-unload">Descarregar modelo</button>' : ""}
      <span class="setting__status" id="llm-status"></span>
    </div>`;
}

async function patchConfig(path, value) {
  if (!api) return;
  const parts = path.split(".");
  const patch = {};
  let cursor = patch;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else {
      cursor[part] = {};
      cursor = cursor[part];
    }
  });
  state.config = await api.config.patch(patch);
  window.Chat?.setConfig(state.config);
}

/* ------------------------------------------------------------- workspace */

function saveWorkspace() {
  if (!api) return;
  clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(() => {
    api.workspace.set({ tabs: state.tabs, activeTab: state.fileId || "", folderId: state.folderId });
  }, 400);
}

async function restoreWorkspace() {
  if (!api) return;
  const saved = await api.workspace.get();
  state.tabs = Array.isArray(saved.tabs) ? saved.tabs : [];
  state.fileId = saved.activeTab || null;
  state.folderId = saved.folderId || "all";
}

/* ----------------------------------------------------------------- render */

function renderListChrome() {
  if (els.listHeading) els.listHeading.textContent = folderName(state.folderId);
  if (els.search && document.activeElement !== els.search) els.search.value = state.query;
}

function render() {
  renderWelcome();
  renderListChrome();
  renderFolders();
  renderFiles();
  renderTabs();
  renderEditor();
  renderDetails();
  renderPalette();
  syncChatContext();
  const collapsed = els.app.classList.contains("is-sidebar-collapsed");
  if (els.toggleSidebar) els.toggleSidebar.title = collapsed ? "Mostrar pastas" : "Ocultar pastas";
}

async function refresh(selectId = state.fileId) {
  if (!api) {
    render();
    return;
  }
  const [files, folders] = await Promise.all([api.files.list(), api.folders.list()]);
  state.files = files;
  state.folders = folders;
  rebuildIndex();
  state.tabs = state.tabs.filter((id) => files.some((file) => file.id === id));
  if (selectId && files.some((file) => file.id === selectId)) state.fileId = selectId;
  else if (state.tabs.length) state.fileId = state.tabs[state.tabs.length - 1];
  else state.fileId = null;
  if (state.folderId !== "all" && state.folderId !== "deleted" && state.folderId !== "") {
    if (!folders.some((folder) => folder.id === state.folderId)) state.folderId = "all";
  }
  render();
}

/* ----------------------------------------------------------------- events */

els.folders?.addEventListener("click", (event) => {
  const twisty = event.target.closest("[data-twisty]");
  if (twisty) {
    event.stopPropagation();
    const id = twisty.dataset.twisty;
    if (state.collapsed.has(id)) state.collapsed.delete(id);
    else state.collapsed.add(id);
    renderFolders();
    return;
  }
  const row = event.target.closest("[data-folder]");
  if (row) selectFolder(row.dataset.folder);
});

els.folders?.addEventListener("contextmenu", (event) => {
  const row = event.target.closest("[data-folder]");
  if (!row) return;
  event.preventDefault();
  folderMenu(row.dataset.folder, row.dataset.kind, event.clientX, event.clientY);
});

els.folders?.addEventListener("dblclick", (event) => {
  const row = event.target.closest("[data-folder]");
  if (!row || row.dataset.kind !== "folder" || !row.dataset.folder) return;
  state.renamingFolder = row.dataset.folder;
  state.creatingFolder = null;
  focusFolderInput = true;
  renderFolders();
});

els.folders?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    if (event.target.id === "folder-create-input") {
      event.preventDefault();
      submitNewFolder(event.target.value);
    }
    if (event.target.dataset.renameFolder) {
      event.preventDefault();
      submitRenameFolder(event.target.dataset.renameFolder, event.target.value);
    }
  }
  if (event.key === "Escape") {
    state.creatingFolder = null;
    state.renamingFolder = null;
    renderFolders();
  }
});

els.folders?.addEventListener("focusout", (event) => {
  if (event.target.id === "folder-create-input") {
    const value = event.target.value;
    setTimeout(() => {
      if (state.creatingFolder !== null) submitNewFolder(value || "");
    }, 0);
  }
  if (event.target.dataset.renameFolder) {
    const { renameFolder } = event.target.dataset;
    const value = event.target.value;
    setTimeout(() => {
      if (state.renamingFolder) submitRenameFolder(renameFolder, value);
    }, 0);
  }
});

els.folders?.addEventListener("dragover", (event) => {
  const row = event.target.closest('[data-drop="1"]');
  if (!row) return;
  event.preventDefault();
  row.classList.add("is-drop");
});
els.folders?.addEventListener("dragleave", (event) => {
  event.target.closest('[data-drop="1"]')?.classList.remove("is-drop");
});
els.folders?.addEventListener("drop", (event) => {
  const row = event.target.closest('[data-drop="1"]');
  if (!row) return;
  event.preventDefault();
  row.classList.remove("is-drop");
  const id = event.dataTransfer.getData("text/vault-file");
  if (!id) return;
  const target = row.dataset.folder === "all" ? "" : row.dataset.folder;
  moveFile(id, target);
});

els.newFolder?.addEventListener("click", () => startCreateFolder(currentFolderForCreate()));

els.files?.addEventListener("click", (event) => {
  if (event.target.closest("[data-empty-create]")) {
    createFile("md");
    return;
  }
  const row = event.target.closest("[data-file]");
  if (row) openFile(row.dataset.file);
});

els.files?.addEventListener("dblclick", (event) => {
  const row = event.target.closest("[data-file]");
  if (row) startRenameTab(row.dataset.file);
});

els.files?.addEventListener("contextmenu", (event) => {
  const row = event.target.closest("[data-file]");
  if (!row) return;
  event.preventDefault();
  fileMenu(row.dataset.file, event.clientX, event.clientY);
});

els.files?.addEventListener("dragstart", (event) => {
  const row = event.target.closest("[data-file]");
  if (!row) return;
  event.dataTransfer.setData("text/vault-file", row.dataset.file);
  event.dataTransfer.effectAllowed = "move";
});

els.search?.addEventListener("input", () => {
  state.query = els.search.value;
  renderFiles();
});

els.tabs?.addEventListener("click", (event) => {
  const close = event.target.closest("[data-close-tab]");
  if (close) {
    event.stopPropagation();
    closeTab(close.dataset.closeTab);
    return;
  }
  const tab = event.target.closest("[data-tab]");
  if (tab) openFile(tab.dataset.tab);
});

els.tabs?.addEventListener("dblclick", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) startRenameTab(tab.dataset.tab);
});

els.tabs?.addEventListener("contextmenu", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (!tab) return;
  event.preventDefault();
  const id = tab.dataset.tab;
  openContextMenu(event.clientX, event.clientY, [
    { label: "Renomear", action: () => startRenameTab(id) },
    { label: "Mover para…", action: () => moveMenu(id, event.clientX, event.clientY) },
    { sep: true },
    { label: "Fechar", action: () => closeTab(id) },
    {
      label: "Fechar as outras",
      action: () => {
        state.tabs = [id];
        state.fileId = id;
        render();
        saveWorkspace();
      },
    },
    {
      label: "Fechar todas",
      action: () => {
        state.tabs = [];
        state.fileId = null;
        render();
        saveWorkspace();
      },
    },
  ]);
});

els.tabs?.addEventListener("keydown", (event) => {
  if (!event.target.dataset.renameTab) return;
  if (event.key === "Enter") {
    event.preventDefault();
    submitRenameTab(event.target.dataset.renameTab, event.target.value);
  }
  if (event.key === "Escape") {
    state.renamingTab = null;
    renderTabs();
  }
});

els.tabs?.addEventListener("focusout", (event) => {
  if (!event.target.dataset.renameTab) return;
  const { renameTab } = event.target.dataset;
  const { value } = event.target;
  setTimeout(() => {
    if (state.renamingTab) submitRenameTab(renameTab, value);
  }, 0);
});

function startRenameTab(id) {
  if (!state.tabs.includes(id)) state.tabs.push(id);
  state.fileId = id;
  state.renamingTab = id;
  render();
}

function submitRenameTab(id, name) {
  state.renamingTab = null;
  const file = fileById(id);
  const trimmed = name.trim();
  if (!file || !trimmed || trimmed === file.title) {
    render();
    return;
  }
  state.fileId = id;
  queueSave({ title: trimmed }, 0);
  flushNow();
}

els.body?.addEventListener("input", () => {
  const file = selectedFile();
  if (!file) return;
  queueSave({ body: els.body.value });
  if (file.format === "md") syncSlashMenu();
});
els.body?.addEventListener("keydown", (event) => handleSlashKeys(event));

els.slashMenu?.addEventListener("mousedown", (event) => {
  event.preventDefault();
  const button = event.target.closest("[data-slash]");
  if (!button) return;
  applySlash(slash.items.find((item) => item.id === button.dataset.slash));
});

els.elementsBar?.addEventListener("mousedown", (event) => event.preventDefault());
els.elementsBar?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-el]");
  if (button) applyElement(button.dataset.el);
});

els.newFile?.addEventListener("click", (event) => {
  event.stopPropagation();
  createFile("md");
});
els.newFileMenu?.addEventListener("click", (event) => {
  event.stopPropagation();
  els.formatMenu.hidden = !els.formatMenu.hidden;
});
els.formatMenu?.addEventListener("mousedown", (event) => event.preventDefault());
els.formatMenu?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (event.target.closest("[data-import]")) {
    importFiles();
    return;
  }
  const button = event.target.closest("[data-create]");
  if (button) createFile(button.dataset.create);
});

els.trashFile?.addEventListener("click", () => trashFile());
els.trashFileList?.addEventListener("click", () => trashFile());
els.emptyTrash?.addEventListener("click", () => emptyTrash());
els.revealFile?.addEventListener("click", () => revealFile(state.fileId));
els.vaultSwitch?.addEventListener("click", (event) => {
  event.stopPropagation();
  vaultMenu(els.vaultSwitch);
});
els.openSettings?.addEventListener("click", () => openSettings());

els.toggleDetails?.addEventListener("click", () => toggleDetails());
els.closeDetails?.addEventListener("click", () => toggleDetails(false));
els.toggleChat?.addEventListener("click", () => toggleChat());
els.closeChat?.addEventListener("click", () => toggleChat(false));
els.toggleGraph?.addEventListener("click", () => openGraph());

els.details?.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open-file]");
  if (open) {
    openFile(open.dataset.openFile);
    return;
  }
  const create = event.target.closest("[data-create-link]");
  if (create) {
    createFile("md", { title: create.dataset.createLink });
    return;
  }
  const tag = event.target.closest("[data-tag]");
  if (tag) {
    state.query = `#${tag.dataset.tag}`;
    els.search.value = state.query;
    state.folderId = "all";
    render();
  }
});

els.preview?.addEventListener("click", (event) => {
  const wiki = event.target.closest("[data-wikilink]");
  if (wiki) {
    event.preventDefault();
    const name = wiki.dataset.wikilink;
    const found = window.wikilinkResolver?.(name);
    if (found) openFile(found.id);
    else if (confirm(`“${name}” não existe. Criar agora?`)) createFile("md", { title: name });
    return;
  }
  const tag = event.target.closest("[data-tag]");
  if (tag) {
    event.preventDefault();
    state.query = `#${tag.dataset.tag}`;
    els.search.value = state.query;
    state.folderId = "all";
    render();
    return;
  }
  if (event.target.closest("a")) event.preventDefault();
});

els.viewMode?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  const kind = schemaKindFor(state.view);
  if (kind) applyDbSchema(kind, currentSourceValue(), { silent: true });
  state.view = button.dataset.view;
  renderEditor();
});

els.htmlStageSizes?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-html-size]");
  if (!button) return;
  state.htmlSize = button.dataset.htmlSize || "fluid";
  syncHtmlStageSize();
});

els.schema?.addEventListener("input", () => {
  const kind = schemaKindFor(state.view);
  if (kind) queueSchemaApply(kind, currentSourceValue());
});
els.schema?.addEventListener("blur", () => {
  const kind = schemaKindFor(state.view);
  if (kind) applyDbSchema(kind, currentSourceValue());
});

els.exportPrisma?.addEventListener("click", async () => {
  const file = selectedFile();
  if (!file || file.format !== "db") return;
  const text = window.toPrisma(window.parseDatabase(file.body), file.title);
  try {
    await navigator.clipboard.writeText(text);
    state.notice = "Schema Prisma copiado";
  } catch {
    state.notice = "Não deu para copiar o schema";
  }
  renderEditor();
});

els.importSchema?.addEventListener("click", () => {
  const file = selectedFile();
  if (!file || file.format !== "db") return;
  els.importSchemaFile.value = "";
  els.importSchemaFile.click();
});
els.importSchemaFile?.addEventListener("change", async () => {
  const chosen = els.importSchemaFile.files?.[0];
  if (!chosen) return;
  const text = await chosen.text();
  const file = selectedFile();
  if (!file || file.format !== "db") return;
  const kind = window.detectSchemaKind(text, chosen.name);
  const result = window.fromSchema(kind, text);
  if (!result.ok) {
    state.notice = result.error;
    renderEditor();
    return;
  }
  const merged = window.mergeDatabase(window.parseDatabase(file.body), result.tables, result.relations);
  queueSave({ body: window.serializeDatabase(merged) }, 0);
  state.view = "table";
  state.notice = `${result.tables.length} modelo(s) importado(s)`;
  renderEditor();
});

els.welcomeOpen?.addEventListener("click", () => pickVault({ create: false }));
els.welcomeCreate?.addEventListener("click", () => pickVault({ create: true }));
els.welcome?.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open-vault]");
  if (open) openVault(open.dataset.openVault);
});

els.settings?.addEventListener("click", async (event) => {
  if (event.target.closest('[data-close-modal="settings"]')) {
    els.settings.hidden = true;
    return;
  }
  const tab = event.target.closest("[data-settings-tab]");
  if (tab) {
    state.settingsTab = tab.dataset.settingsTab;
    renderSettings();
    return;
  }
  const openVaultBtn = event.target.closest("[data-open-vault]");
  if (openVaultBtn) {
    els.settings.hidden = true;
    openVault(openVaultBtn.dataset.openVault);
    return;
  }
  const forget = event.target.closest("[data-forget-vault]");
  if (forget) {
    state.vault = await api.vault.forget(forget.dataset.forgetVault);
    await refresh();
    renderSettings();
    return;
  }
  const action = event.target.closest("[data-vault-action]");
  if (action) {
    els.settings.hidden = true;
    pickVault({ create: action.dataset.vaultAction === "create" });
    return;
  }
  if (event.target.id === "llm-refresh") {
    const box = document.getElementById("llm-models");
    if (box) box.textContent = "Carregando…";
    const models = await window.Chat?.listModels();
    if (box) {
      box.innerHTML = models?.length
        ? models
            .map((model) => `<button class="chip" type="button" data-pick-model="${escapeHtml(model)}">${escapeHtml(model)}</button>`)
            .join("")
        : "Nenhum modelo encontrado. O servidor está rodando?";
    }
    return;
  }
  const pick = event.target.closest("[data-pick-model]");
  if (pick) {
    await patchConfig("llm.model", pick.dataset.pickModel);
    renderSettings();
    return;
  }
  const pickLocal = event.target.closest("[data-pick-local]");
  if (pickLocal) {
    // Trocar de modelo descarrega o anterior: dois pesos na memória não cabem.
    await window.LocalLLM?.unload();
    await patchConfig("llm.localModel", pickLocal.dataset.pickLocal);
    renderSettings();
    return;
  }
  if (event.target.id === "llm-load") {
    const status = document.getElementById("llm-status");
    const engine = window.LocalLLM;
    const model = state.config?.llm?.localModel || engine?.DEFAULT_MODEL;
    if (status) status.textContent = "Baixando e carregando…";
    try {
      await engine?.unload();
      await engine?.load(model);
      if (status) status.textContent = "Modelo pronto";
    } catch (err) {
      if (status) status.textContent = `Falhou: ${err.message || String(err)}`;
    }
    renderSettings();
    return;
  }
  if (event.target.id === "llm-unload") {
    const status = document.getElementById("llm-status");
    await window.LocalLLM?.unload();
    if (status) status.textContent = "Modelo descarregado da memória";
    return;
  }
  if (event.target.id === "llm-test") {
    const status = document.getElementById("llm-status");
    if (status) status.textContent = "Testando…";
    const result = await window.Chat?.test();
    if (!status) return;
    if (!result?.ok) {
      status.textContent = `Falhou: ${result?.error || "sem resposta"}`;
      return;
    }
    if (result.gpu) {
      status.textContent = result.gpu.available
        ? `WebGPU disponível em ${result.gpu.adapter}${result.gpu.f16 ? " (com shader-f16)" : " (sem shader-f16, usa q4)"}`
        : "Sem WebGPU: o modelo vai rodar na CPU, bem mais devagar";
      return;
    }
    status.textContent = "Conectado";
  }
});

els.settings?.addEventListener("change", (event) => {
  const field = event.target.closest("[data-config]");
  if (!field) return;
  const value =
    field.type === "checkbox" ? field.checked : field.type === "number" ? Number(field.value) : field.value;
  patchConfig(field.dataset.config, value).then(() => {
    if (state.settingsTab === "preview") renderSettings();
    if (field.dataset.config === "llm.provider") renderSettings();
    const file = selectedFile();
    if (file?.format === "html" && state.view === "preview") renderHtmlPreview(file);
  });
});

els.graph?.addEventListener("click", (event) => {
  if (event.target.closest('[data-close-modal="graph"]')) els.graph.hidden = true;
});
els.graphCopy?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(graphMarkdown());
    els.graphLegend.textContent = "Mapa copiado para a área de transferência";
  } catch {
    els.graphLegend.textContent = "Não deu para copiar";
  }
});
els.graphSave?.addEventListener("click", async () => {
  const file = await createFile("md", { title: "Mapa do cofre" });
  if (!file) return;
  els.graph.hidden = true;
  queueSave({ body: graphMarkdown() }, 0);
  flushNow();
});

els.palette?.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-palette]")) {
    closePalette();
    return;
  }
  const item = event.target.closest("[data-palette]");
  if (item) runPalette(Number(item.dataset.palette));
});
els.paletteInput?.addEventListener("input", () => {
  state.paletteQuery = els.paletteInput.value;
  state.paletteIndex = 0;
  renderPalette();
});
els.paletteInput?.addEventListener("keydown", (event) => {
  const items = paletteItems();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.paletteIndex = (state.paletteIndex + 1) % Math.max(1, items.length);
    renderPalette();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    state.paletteIndex = (state.paletteIndex - 1 + items.length) % Math.max(1, items.length);
    renderPalette();
  } else if (event.key === "Enter") {
    event.preventDefault();
    runPalette();
  } else if (event.key === "Escape") {
    closePalette();
  }
});

document.addEventListener("click", (event) => {
  if (els.formatMenu) els.formatMenu.hidden = true;
  if (!event.target.closest("#context-menu")) closeContextMenu();
  if (!event.target.closest("#slash-menu, #file-body, #code-editor")) closeSlash();
});

document.addEventListener("contextmenu", (event) => {
  if (!event.target.closest("#folders, #files, #tabs")) closeContextMenu();
});

function toggleFoldersPane() {
  if (window.matchMedia("(max-width: 960px)").matches) {
    els.app.classList.toggle("is-folders-open");
    if (els.foldersScrim) els.foldersScrim.hidden = !els.app.classList.contains("is-folders-open");
    return;
  }
  els.app.classList.toggle("is-sidebar-collapsed");
  render();
}

els.toggleSidebar?.addEventListener("click", toggleFoldersPane);
els.toggleSidebarList?.addEventListener("click", toggleFoldersPane);
els.foldersScrim?.addEventListener("click", () => {
  els.app.classList.remove("is-folders-open");
  els.foldersScrim.hidden = true;
});
els.backToList?.addEventListener("click", () => {
  state.fileId = null;
  render();
});

document.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (mod && key === "p") {
    event.preventDefault();
    openPalette();
    return;
  }
  if (mod && key === ",") {
    event.preventDefault();
    openSettings();
    return;
  }
  if (mod && key === "n") {
    event.preventDefault();
    createFile(event.shiftKey ? "txt" : "md");
    return;
  }
  if (mod && key === "w") {
    event.preventDefault();
    if (state.fileId) closeTab(state.fileId);
    return;
  }
  if (mod && key === "g") {
    event.preventDefault();
    openGraph();
    return;
  }
  if (mod && key === "j") {
    event.preventDefault();
    toggleChat();
    return;
  }
  if (mod && key === "f") {
    event.preventDefault();
    els.search?.focus();
    els.search?.select();
    return;
  }
  if (mod && key === "s") {
    event.preventDefault();
    const file = selectedFile();
    if (!file) return;
    const kind = schemaKindFor(state.view);
    if (file.format === "db" && kind) applyDbSchema(kind, currentSourceValue());
    else if (file.format !== "db" && file.format !== "pdf") queueSave({ body: currentSourceValue() }, 0);
    flushNow();
    return;
  }
  if (event.key === "Escape") {
    if (state.paletteOpen) closePalette();
    else if (!els.settings.hidden) els.settings.hidden = true;
    else if (!els.graph.hidden) els.graph.hidden = true;
    closeContextMenu();
    return;
  }
  const typing =
    /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) ||
    event.target.isContentEditable ||
    event.target.closest(".sheet, .db-page, .db-title, .draw-stage");
  if (!typing && event.key === "Delete" && state.fileId) {
    event.preventDefault();
    trashFile();
  }
});

function setupGutters() {
  const vars = { sidebar: "--sidebar-w", list: "--list-w" };
  const panes = { sidebar: ".pane-sidebar", list: ".pane-list" };
  const min = { sidebar: 148, list: 180 };
  const max = { sidebar: 360, list: 480 };
  document.querySelectorAll("[data-gutter]").forEach((gutter) => {
    gutter.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const key = gutter.dataset.gutter;
      gutter.classList.add("is-dragging");
      const startX = event.clientX;
      const start = document.querySelector(panes[key]).getBoundingClientRect().width;
      const onMove = (moveEvent) => {
        const next = Math.min(max[key], Math.max(min[key], start + (moveEvent.clientX - startX)));
        els.app.style.setProperty(vars[key], `${next}px`);
      };
      const onUp = () => {
        gutter.classList.remove("is-dragging");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
}

/* ------------------------------------------------------------------- boot */

setupTitlebar();
setupGutters();

if (window.CodeEditor?.whenReady) {
  window.CodeEditor.handleKeyDown = (monacoEvent) => {
    handleSlashKeys(monacoEvent.browserEvent, monacoEvent);
  };
  window.CodeEditor.whenReady()
    .then(() => renderEditor())
    .catch((err) => console.error(err));
}

async function boot() {
  if (!api) {
    if (els.previewBanner) els.previewBanner.hidden = false;
    state.files = [
      {
        id: "Bem-vindo.md",
        folderId: "",
        title: "Bem-vindo",
        body: "# Preview no navegador\n\nAbra com `npm run start` para gravar arquivos.\n\nVeja [[Pipeline comercial]].\n",
        format: "md",
        filename: "Bem-vindo.md",
        relativePath: "Bem-vindo.md",
        size: 120,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
      },
    ];
    rebuildIndex();
    state.fileId = state.files[0].id;
    state.tabs = [state.fileId];
    render();
    return;
  }

  state.config = await api.config.get();
  state.vault = await api.vault.state();
  window.Chat?.setConfig(state.config);

  if (!state.vault.ready) {
    render();
    return;
  }
  await restoreWorkspace();
  await refresh(state.fileId);

  api.onChanged(() => {
    if (state.save === "saving" || ignoreWatch) return;
    refresh(state.fileId);
  });
  api.vault.onOpened((next) => {
    state.vault = next;
    syncTitlebar();
  });
}

boot().catch((err) => {
  console.error(err);
  if (els.editorStatus) els.editorStatus.textContent = `Falha ao iniciar: ${err.message || err}`;
});

window.VaultApp = {
  state,
  openFile,
  createFile,
  refresh,
  render,
  graphMarkdown,
};
})();
