const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

const {
  emptyDatabase,
  serializeDatabase,
  parseDatabase,
  toDbms,
  toMermaid,
} = require("./database");

const TRASH_DIR = ".trash";
const SIDECAR_EXTS = [".dbms", ".mmd"];
const TEXT_FORMATS = new Set(["md", "txt", "html", "db", "draw"]);

const FORMAT_EXT = {
  md: ".md",
  txt: ".txt",
  html: ".html",
  db: ".table.json",
  draw: ".draw.json",
  pdf: ".pdf",
};

const NEW_FILE_NAME = {
  md: "Nova nota",
  txt: "Novo texto",
  html: "Nova página",
  db: "Nova base",
  draw: "Novo desenho",
};

const WELCOME = `# Bem-vindo ao cofre

Este cofre é só uma pasta no seu disco. Cada arquivo aqui é um arquivo de verdade.

- Markdown com preview e realce de sintaxe
- HTML com preview que roda JavaScript
- Bases de dados com tabela, SQL, Prisma e diagrama ER
- Desenhos e PDFs

Use [[wikilinks]] para ligar um arquivo a outro.
`;

function sanitizeSegment(name, fallback) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || fallback;
}

function createVault(root) {
  const vaultRoot = path.resolve(root);

  function toRel(filePath) {
    return path.relative(vaultRoot, filePath).split(path.sep).join("/");
  }

  function resolveInVault(relativePath) {
    const resolved = path.resolve(vaultRoot, relativePath || "");
    const rootWithSep = vaultRoot.endsWith(path.sep) ? vaultRoot : vaultRoot + path.sep;
    if (resolved !== vaultRoot && !resolved.startsWith(rootWithSep)) {
      throw new Error("Caminho fora do cofre");
    }
    return resolved;
  }

  function folderDir(folderId) {
    if (folderId === "deleted") return path.join(vaultRoot, TRASH_DIR);
    if (!folderId || folderId === "all") return vaultRoot;
    return resolveInVault(folderId);
  }

  function folderIdFromRel(relativePath) {
    if (relativePath.startsWith(`${TRASH_DIR}/`)) return "deleted";
    const dir = path.posix.dirname(relativePath);
    return dir === "." ? "" : dir;
  }

  function fileMeta(filePath) {
    const filename = path.basename(filePath);
    const lower = filename.toLowerCase();
    if (lower.endsWith(".table.json")) {
      return { title: filename.slice(0, -".table.json".length), format: "db", ext: ".table.json" };
    }
    if (lower.endsWith(".draw.json")) {
      return { title: filename.slice(0, -".draw.json".length), format: "draw", ext: ".draw.json" };
    }
    const ext = path.extname(filename).toLowerCase();
    let format = "md";
    if (ext === ".txt") format = "txt";
    else if (ext === ".html" || ext === ".htm") format = "html";
    else if (ext === ".pdf") format = "pdf";
    return { title: path.basename(filename, path.extname(filename)), format, ext };
  }

  function isVaultFile(name) {
    // Arquivos criados pela IA podem usar qualquer extensão, mas arquivos internos seguem ocultos.
    return Boolean(name) && !String(name).startsWith(".");
  }

  function extFor(format) {
    return FORMAT_EXT[format] || ".md";
  }

  function sidecarBase(filePath) {
    return filePath.replace(/\.table\.json$/i, "");
  }

  async function writeSidecars(filePath, body) {
    if (!/\.table\.json$/i.test(filePath)) return;
    const db = parseDatabase(body);
    const title = fileMeta(filePath).title;
    const base = sidecarBase(filePath);
    await fs.writeFile(`${base}.dbms`, toDbms(db, title), "utf8");
    await fs.writeFile(`${base}.mmd`, toMermaid(db, title), "utf8");
  }

  async function moveSidecars(fromJson, toJson) {
    if (!/\.table\.json$/i.test(fromJson)) return;
    const fromBase = sidecarBase(fromJson);
    const toBase = sidecarBase(toJson);
    if (fromBase === toBase) return;
    for (const ext of SIDECAR_EXTS) {
      const from = `${fromBase}${ext}`;
      if (!fsSync.existsSync(from)) continue;
      await fs.rename(from, `${toBase}${ext}`);
    }
  }

  async function dropSidecars(filePath) {
    if (!/\.table\.json$/i.test(filePath)) return;
    const base = sidecarBase(filePath);
    for (const ext of SIDECAR_EXTS) {
      await fs.rm(`${base}${ext}`, { force: true });
    }
  }

  function defaultBody(format) {
    if (format === "db") return serializeDatabase(emptyDatabase());
    if (format === "draw") {
      return `${JSON.stringify({ type: "draw", version: 1, grid: true, elements: [] }, null, 2)}\n`;
    }
    if (format === "html") {
      return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Página</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; line-height: 1.5; }
    main { max-width: 40rem; }
    button { font: inherit; padding: 8px 12px; border-radius: 8px; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>Olá</h1>
    <p>Edite este HTML e abra o Preview.</p>
    <button id="ok" type="button">Testar JS</button>
  </main>
  <script>
    document.getElementById("ok").addEventListener("click", () => {
      alert("JS ok");
    });
  </script>
</body>
</html>
`;
    }
    return "";
  }

  async function uniquePath(dir, base, ext) {
    let candidate = path.join(dir, `${base}${ext}`);
    let n = 2;
    while (fsSync.existsSync(candidate)) {
      candidate = path.join(dir, `${base} ${n}${ext}`);
      n += 1;
    }
    return candidate;
  }

  async function ensureRoot() {
    await fs.mkdir(vaultRoot, { recursive: true });
    await fs.mkdir(path.join(vaultRoot, TRASH_DIR), { recursive: true });
  }

  async function collectFiles(dir, acc = []) {
    if (!fsSync.existsSync(dir)) return acc;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        await collectFiles(full, acc);
      } else if (isVaultFile(entry.name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  async function fileFromPath(filePath) {
    const stat = await fs.stat(filePath);
    const relativePath = toRel(filePath);
    const meta = fileMeta(filePath);
    const body = meta.format === "pdf" ? "" : await fs.readFile(filePath, "utf8");
    return {
      id: relativePath,
      folderId: folderIdFromRel(relativePath),
      title: meta.title,
      body,
      format: meta.format,
      filename: path.basename(filePath),
      relativePath,
      absolutePath: filePath,
      size: stat.size,
      createdAt: Math.round(stat.birthtimeMs || stat.ctimeMs),
      updatedAt: Math.round(stat.mtimeMs),
      deleted: relativePath.startsWith(`${TRASH_DIR}/`),
    };
  }

  async function walkFolders(dir, parentId, out) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    for (const entry of dirs) {
      const id = parentId ? `${parentId}/${entry.name}` : entry.name;
      out.push({
        id,
        name: entry.name,
        parentId,
        depth: id.split("/").length - 1,
      });
      await walkFolders(path.join(dir, entry.name), id, out);
    }
    return out;
  }

  async function listFolders() {
    await ensureRoot();
    return walkFolders(vaultRoot, "", []);
  }

  async function list() {
    await ensureRoot();
    const files = await collectFiles(vaultRoot);
    await collectFiles(path.join(vaultRoot, TRASH_DIR), files);
    const entries = await Promise.all(files.map(fileFromPath));
    return entries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function read(id) {
    return fileFromPath(resolveInVault(id));
  }

  async function absolute(id) {
    return resolveInVault(id);
  }

  async function createFolder(parentId, name) {
    await ensureRoot();
    const parent = parentId && parentId !== "all" && parentId !== "deleted" ? parentId : "";
    const base = sanitizeSegment(name, "Nova pasta");
    let folderName = base;
    let n = 2;
    while (fsSync.existsSync(path.join(folderDir(parent), folderName))) {
      folderName = `${base} ${n}`;
      n += 1;
    }
    const id = parent ? `${parent}/${folderName}` : folderName;
    await fs.mkdir(resolveInVault(id), { recursive: true });
    return { id, name: folderName, parentId: parent, depth: id.split("/").length - 1 };
  }

  async function renameFolder(id, name) {
    if (!id || id === "all" || id === "deleted") throw new Error("Pasta inválida");
    const next = sanitizeSegment(name, "");
    if (!next) return { id, name: path.posix.basename(id) };
    const parent = path.posix.dirname(id) === "." ? "" : path.posix.dirname(id);
    if (next === path.posix.basename(id)) {
      return { id, name: next, parentId: parent, depth: id.split("/").length - 1 };
    }
    const nextId = parent ? `${parent}/${next}` : next;
    const to = resolveInVault(nextId);
    if (fsSync.existsSync(to)) throw new Error("Já existe uma pasta com esse nome");
    await fs.rename(resolveInVault(id), to);
    return { id: nextId, name: next, parentId: parent, depth: nextId.split("/").length - 1 };
  }

  async function deleteFolder(id) {
    if (!id || id === "all" || id === "deleted") throw new Error("Pasta inválida");
    const dir = resolveInVault(id);
    if (!fsSync.existsSync(dir)) return;
    const files = await collectFiles(dir);
    for (const file of files) {
      await remove(toRel(file));
    }
    await fs.rm(dir, { recursive: true, force: true });
  }

  async function writeRaw(relativePath, body, { create = false } = {}) {
    await ensureRoot();
    const filePath = resolveInVault(relativePath);
    if (!create && !fsSync.existsSync(filePath)) throw new Error("Arquivo não encontrado");
    if (fsSync.existsSync(filePath) && !create) {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw new Error("O destino não é um arquivo");
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, "utf8");
    return fileFromPath(filePath);
  }

  async function create({ folderId = "", format = "md", title } = {}) {
    await ensureRoot();
    const kind = FORMAT_EXT[format] && format !== "pdf" ? format : "md";
    const target = folderId === "all" || folderId === "deleted" ? "" : folderId || "";
    const dir = folderDir(target);
    await fs.mkdir(dir, { recursive: true });
    const base = sanitizeSegment(title, NEW_FILE_NAME[kind] || "Novo arquivo");
    const filePath = await uniquePath(dir, base, extFor(kind));
    const body = defaultBody(kind);
    await fs.writeFile(filePath, body, "utf8");
    if (kind === "db") await writeSidecars(filePath, body);
    return fileFromPath(filePath);
  }

  async function write(id, { title, body } = {}) {
    const current = await read(id);
    let filePath = resolveInVault(id);
    const nextBody = body === undefined ? current.body : body;
    if (TEXT_FORMATS.has(current.format)) {
      await fs.writeFile(filePath, nextBody, "utf8");
    }

    const nextTitle = title === undefined ? undefined : sanitizeSegment(title, current.title);
    if (nextTitle !== undefined && nextTitle !== current.title) {
      const dir = path.dirname(filePath);
      const nextPath = await uniquePath(dir, nextTitle, fileMeta(filePath).ext);
      await fs.rename(filePath, nextPath);
      await moveSidecars(filePath, nextPath);
      filePath = nextPath;
    }

    if (fileMeta(filePath).format === "db") await writeSidecars(filePath, nextBody);
    return fileFromPath(filePath);
  }

  async function move(id, folderId) {
    const current = await read(id);
    const target = folderId === "all" ? "" : folderId;
    const dir = folderDir(target);
    if (!fsSync.existsSync(dir)) await fs.mkdir(dir, { recursive: true });
    const src = resolveInVault(id);
    if (path.dirname(src) === path.resolve(dir)) return current;
    const meta = fileMeta(src);
    const dest = await uniquePath(dir, meta.title, meta.ext);
    await fs.rename(src, dest);
    await moveSidecars(src, dest);
    return fileFromPath(dest);
  }

  async function remove(id) {
    const current = await read(id);
    if (current.deleted) return current;
    await ensureRoot();
    return move(id, "deleted");
  }

  async function restore(id, folderId = "") {
    const current = await read(id);
    if (!current.deleted) return current;
    return move(id, folderId === "deleted" ? "" : folderId);
  }

  async function destroy(id) {
    const filePath = resolveInVault(id);
    await dropSidecars(filePath);
    await fs.rm(filePath, { force: true });
    return true;
  }

  async function emptyTrash() {
    const dir = path.join(vaultRoot, TRASH_DIR);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    return true;
  }

  async function importFile(folderId, sourcePath) {
    await ensureRoot();
    const target = folderId === "all" || folderId === "deleted" ? "" : folderId || "";
    const dir = folderDir(target);
    await fs.mkdir(dir, { recursive: true });
    const meta = fileMeta(sourcePath);
    if (!isVaultFile(path.basename(sourcePath))) throw new Error("Formato não suportado");
    const dest = await uniquePath(dir, meta.title, meta.ext);
    await fs.copyFile(sourcePath, dest);
    if (meta.format === "db") await writeSidecars(dest, await fs.readFile(dest, "utf8"));
    return fileFromPath(dest);
  }

  async function stats() {
    const files = await list();
    const alive = files.filter((file) => !file.deleted);
    const byFormat = {};
    for (const file of alive) byFormat[file.format] = (byFormat[file.format] || 0) + 1;
    return {
      root: vaultRoot,
      files: alive.length,
      trashed: files.length - alive.length,
      folders: (await listFolders()).length,
      bytes: alive.reduce((sum, file) => sum + (file.size || 0), 0),
      byFormat,
    };
  }

  async function ensureSidecars() {
    for (const file of await list()) {
      if (file.format !== "db" || file.deleted) continue;
      const filePath = resolveInVault(file.relativePath);
      const base = sidecarBase(filePath);
      if (!fsSync.existsSync(`${base}.dbms`) || !fsSync.existsSync(`${base}.mmd`)) {
        await writeSidecars(filePath, file.body);
      }
    }
  }

  async function init({ seed = true } = {}) {
    await ensureRoot();
    if (seed) {
      const files = await list();
      if (!files.length) {
        await fs.writeFile(path.join(vaultRoot, "Bem-vindo.md"), WELCOME, "utf8");
      }
    }
    await ensureSidecars();
    return vaultRoot;
  }

  return {
    root: vaultRoot,
    init,
    stats,
    listFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    list,
    read,
    absolute,
    create,
    write,
    writeRaw,
    move,
    remove,
    restore,
    destroy,
    emptyTrash,
    importFile,
  };
}

async function inspectFolder(dir) {
  const target = path.resolve(dir);
  const out = { path: target, exists: false, empty: true, files: 0, folders: 0, others: 0 };
  if (!fsSync.existsSync(target)) return out;
  out.exists = true;

  const supported = [".md", ".markdown", ".txt", ".html", ".htm", ".pdf", ".table.json", ".draw.json"];
  async function scan(current, depth) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        out.folders += 1;
        if (depth < 6) await scan(path.join(current, entry.name), depth + 1);
      } else {
        const lower = entry.name.toLowerCase();
        if (supported.some((ext) => lower.endsWith(ext))) out.files += 1;
        else out.others += 1;
      }
    }
  }
  await scan(target, 0);
  out.empty = out.files === 0 && out.folders === 0 && out.others === 0;
  return out;
}

module.exports = { createVault, inspectFolder, TRASH_DIR, FORMAT_EXT };
