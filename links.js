(() => {
  const WIKILINK = /\[\[([^\][|]+)(?:\|([^\][]+))?\]\]/g;
  const TAG = /(^|[\s(])#([\p{L}\d][\p{L}\d/_-]{1,40})/gu;

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function splitFrontmatter(source) {
    const text = String(source || "");
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { data: {}, body: text, raw: "" };
    return { data: parseYaml(match[1]), body: text.slice(match[0].length), raw: match[1] };
  }

  function parseYaml(block) {
    const data = {};
    let currentKey = "";
    for (const rawLine of String(block || "").split("\n")) {
      const line = rawLine.replace(/\s+$/, "");
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const listItem = line.match(/^\s*-\s+(.*)$/);
      if (listItem && currentKey) {
        if (!Array.isArray(data[currentKey])) data[currentKey] = [];
        data[currentKey].push(stripQuotes(listItem[1]));
        continue;
      }
      const pair = line.match(/^([\w.-]+)\s*:\s*(.*)$/);
      if (!pair) continue;
      currentKey = pair[1];
      const value = pair[2].trim();
      if (!value) {
        data[currentKey] = [];
        continue;
      }
      if (value.startsWith("[") && value.endsWith("]")) {
        data[currentKey] = value
          .slice(1, -1)
          .split(",")
          .map((item) => stripQuotes(item))
          .filter(Boolean);
        continue;
      }
      data[currentKey] = stripQuotes(value);
    }
    return data;
  }

  function stripQuotes(value) {
    const text = String(value || "").trim();
    if (/^".*"$/.test(text) || /^'.*'$/.test(text)) return text.slice(1, -1);
    return text;
  }

  function linksIn(body) {
    const found = [];
    const text = String(body || "");
    WIKILINK.lastIndex = 0;
    let match = WIKILINK.exec(text);
    while (match) {
      const target = match[1].trim();
      if (target) found.push({ target, alias: (match[2] || "").trim(), key: normalizeKey(target) });
      match = WIKILINK.exec(text);
    }
    return found;
  }

  function tagsIn(body, frontmatter) {
    const tags = new Set();
    const fromMatter = frontmatter?.tags ?? frontmatter?.tag;
    if (Array.isArray(fromMatter)) fromMatter.forEach((tag) => tags.add(String(tag).replace(/^#/, "")));
    else if (typeof fromMatter === "string") {
      fromMatter
        .split(/[,\s]+/)
        .filter(Boolean)
        .forEach((tag) => tags.add(tag.replace(/^#/, "")));
    }
    const text = String(body || "");
    TAG.lastIndex = 0;
    let match = TAG.exec(text);
    while (match) {
      tags.add(match[2]);
      match = TAG.exec(text);
    }
    return [...tags];
  }

  function textOf(file) {
    if (!file) return "";
    if (file.format === "md" || file.format === "txt" || file.format === "html") return file.body || "";
    return "";
  }

  function buildIndex(files) {
    const alive = (files || []).filter((file) => !file.deleted);
    const byKey = new Map();
    const byId = new Map();
    for (const file of alive) {
      byId.set(file.id, file);
      const keys = [normalizeKey(file.title), normalizeKey(file.relativePath.replace(/\.[^.]+$/, ""))];
      for (const key of keys) {
        if (key && !byKey.has(key)) byKey.set(key, file.id);
      }
    }

    const outgoing = new Map();
    const incoming = new Map();
    const unresolved = new Map();
    const tags = new Map();
    const meta = new Map();

    for (const file of alive) {
      const parsed = splitFrontmatter(textOf(file));
      const fileTags = tagsIn(parsed.body, parsed.data);
      meta.set(file.id, { frontmatter: parsed.data, tags: fileTags });
      for (const tag of fileTags) {
        if (!tags.has(tag)) tags.set(tag, []);
        tags.get(tag).push(file.id);
      }
      const out = [];
      for (const link of linksIn(parsed.body)) {
        const targetId = byKey.get(link.key) || "";
        out.push({ ...link, id: targetId });
        if (targetId) {
          if (!incoming.has(targetId)) incoming.set(targetId, []);
          const list = incoming.get(targetId);
          if (!list.includes(file.id)) list.push(file.id);
        } else {
          if (!unresolved.has(link.target)) unresolved.set(link.target, []);
          unresolved.get(link.target).push(file.id);
        }
      }
      outgoing.set(file.id, out);
    }

    return { byKey, byId, outgoing, incoming, unresolved, tags, meta, files: alive };
  }

  function backlinks(index, fileId) {
    return (index.incoming.get(fileId) || []).map((id) => index.byId.get(id)).filter(Boolean);
  }

  function forwardLinks(index, fileId) {
    return (index.outgoing.get(fileId) || []).map((link) => ({
      ...link,
      file: link.id ? index.byId.get(link.id) : null,
    }));
  }

  function toGraph(index, { includeFolders = true } = {}) {
    const nodes = [];
    const links = [];
    const folders = new Set();

    for (const file of index.files) {
      const refs = (index.incoming.get(file.id) || []).length;
      nodes.push({
        id: file.id,
        kind: "file",
        label: file.title,
        format: file.format,
        folder: file.folderId,
        refs,
        out: (index.outgoing.get(file.id) || []).filter((link) => link.id).length,
      });
      if (includeFolders && file.folderId) folders.add(file.folderId);
    }

    if (includeFolders) {
      for (const folder of folders) {
        const parts = folder.split("/");
        for (let i = 0; i < parts.length; i += 1) {
          const id = parts.slice(0, i + 1).join("/");
          if (!nodes.some((node) => node.kind === "folder" && node.id === id)) {
            nodes.push({ id, kind: "folder", label: parts[i], refs: 0, out: 0 });
          }
          if (i > 0) {
            links.push({ from: parts.slice(0, i).join("/"), to: id, kind: "tree" });
          }
        }
      }
      for (const file of index.files) {
        if (file.folderId) links.push({ from: file.folderId, to: file.id, kind: "tree" });
      }
    }

    for (const [fileId, list] of index.outgoing.entries()) {
      for (const link of list) {
        if (link.id) links.push({ from: fileId, to: link.id, kind: "link" });
      }
    }

    return { nodes, links };
  }

  function toMarkdownMap(index, { vaultPath = "", limit = 400 } = {}) {
    const lines = [];
    lines.push("# Mapa do cofre");
    if (vaultPath) lines.push(`\nCaminho: \`${vaultPath}\``);
    lines.push(`\nArquivos: ${index.files.length}`);

    const byFolder = new Map();
    for (const file of index.files) {
      const key = file.folderId || "(raiz)";
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key).push(file);
    }

    lines.push("\n## Árvore\n");
    for (const folder of [...byFolder.keys()].sort()) {
      lines.push(`- **${folder}/**`);
      for (const file of byFolder.get(folder).slice(0, limit)) {
        const out = (index.outgoing.get(file.id) || []).filter((link) => link.id).length;
        const back = (index.incoming.get(file.id) || []).length;
        const tags = index.meta.get(file.id)?.tags || [];
        const bits = [`${file.format}`];
        if (out) bits.push(`${out} link${out > 1 ? "s" : ""}`);
        if (back) bits.push(`${back} backlink${back > 1 ? "s" : ""}`);
        if (tags.length) bits.push(tags.map((tag) => `#${tag}`).join(" "));
        lines.push(`  - ${file.title} (${bits.join(" · ")}) — \`${file.relativePath}\``);
      }
    }

    const edges = [];
    for (const [fileId, list] of index.outgoing.entries()) {
      for (const link of list) {
        if (!link.id) continue;
        const from = index.byId.get(fileId);
        const to = index.byId.get(link.id);
        if (from && to) edges.push(`- ${from.title} -> ${to.title}`);
      }
    }
    if (edges.length) {
      lines.push("\n## Links\n");
      lines.push(...edges.slice(0, limit));
    }

    if (index.unresolved.size) {
      lines.push("\n## Links quebrados\n");
      for (const [target, sources] of index.unresolved.entries()) {
        const names = sources
          .map((id) => index.byId.get(id)?.title)
          .filter(Boolean)
          .join(", ");
        lines.push(`- [[${target}]] citado em ${names}`);
      }
    }

    if (index.tags.size) {
      lines.push("\n## Tags\n");
      for (const [tag, ids] of [...index.tags.entries()].sort((a, b) => b[1].length - a[1].length)) {
        lines.push(`- #${tag} (${ids.length})`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  window.Links = {
    normalizeKey,
    splitFrontmatter,
    linksIn,
    tagsIn,
    buildIndex,
    backlinks,
    forwardLinks,
    toGraph,
    toMarkdownMap,
  };
})();
