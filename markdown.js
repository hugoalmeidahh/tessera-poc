(() => {
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function safeUrl(href) {
    try {
      const url = new URL(href, "https://example.invalid");
      if (["http:", "https:", "mailto:"].includes(url.protocol)) return href;
    } catch {
      return "";
    }
    return "";
  }

  function wikilinks(text) {
    return text.replace(/\[\[([^\][|]+)(?:\|([^\][]+))?\]\]/g, (_, target, alias) => {
      const name = target.trim();
      const label = (alias || name).trim();
      const resolver = window.wikilinkResolver;
      const found = typeof resolver === "function" ? resolver(name) : null;
      const cls = found ? "wikilink" : "wikilink is-missing";
      const title = found ? found.relativePath || name : `Criar “${name}”`;
      return `<a class="${cls}" data-wikilink="${escapeHtml(name)}" title="${escapeHtml(title)}">${label}</a>`;
    });
  }

  function tags(text) {
    return text.replace(
      /(^|[\s(])#([\p{L}\d][\p{L}\d/_-]{1,40})/gu,
      (_, before, tag) => `${before}<a class="tag" data-tag="${escapeHtml(tag)}">#${tag}</a>`
    );
  }

  function inline(text) {
    return tags(wikilinks(escapeHtml(text)))
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^\*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
        const url = safeUrl(href);
        return url ? `<a href="${escapeHtml(url)}">${label}</a>` : label;
      });
  }

  function frontmatterHtml(block) {
    const rows = String(block || "")
      .split("\n")
      .map((line) => line.match(/^([\w.-]+)\s*:\s*(.*)$/))
      .filter(Boolean)
      .map(
        ([, key, value]) =>
          `<div class="frontmatter__row"><span class="frontmatter__key">${escapeHtml(key)}</span>` +
          `<span class="frontmatter__value">${tags(wikilinks(escapeHtml(value)))}</span></div>`
      )
      .join("");
    return rows ? `<div class="frontmatter">${rows}</div>` : "";
  }

  function renderMarkdown(source, depth = 0) {
    if (depth > 8) return "";
    const fences = [];
    let text = String(source || "").replace(/\r\n/g, "\n");
    let matter = "";
    if (depth === 0) {
      const found = text.match(/^---\n([\s\S]*?)\n---\n?/);
      if (found) {
        matter = frontmatterHtml(found[1]);
        text = text.slice(found[0].length);
      }
    }

    text = text.replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => {
      const token = `%%FENCE${fences.length}%%`;
      fences.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
      return `\n${token}\n`;
    });

    const lines = text.split("\n");
    const out = [];
    let i = 0;
    let guard = 0;

    while (i < lines.length) {
      if (++guard > lines.length * 4) break;
      const line = lines[i];

      if (/^%%FENCE\d+%%$/.test(line.trim())) {
        out.push(line.trim());
        i += 1;
        continue;
      }
      if (/^\s*---\s*$/.test(line)) {
        out.push("<hr>");
        i += 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s*(.*)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ""));
          i += 1;
        }
        const inner = quote.join("\n").replace(/^>/gm, "").trim();
        out.push(`<blockquote>${inner ? renderMarkdown(inner, depth + 1) : ""}</blockquote>`);
        continue;
      }

      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          const item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
          const check = item.match(/^\[( |x|X)\]\s+(.+)$/);
          if (check) {
            const checked = check[1].toLowerCase() === "x" ? " checked" : "";
            items.push(
              `<li class="task"><input type="checkbox" disabled${checked}> ${inline(check[2])}</li>`
            );
          } else {
            items.push(`<li>${inline(item)}</li>`);
          }
          i += 1;
        }
        out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
        continue;
      }

      if (!line.trim()) {
        i += 1;
        continue;
      }

      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,6}\s|```|%%FENCE|\s*[-*+]\s|\s*\d+\.\s|\s*>|\s*---\s*$)/.test(lines[i])
      ) {
        para.push(lines[i]);
        i += 1;
      }
      if (!para.length) {
        out.push(`<p>${inline(line)}</p>`);
        i += 1;
        continue;
      }
      out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    }

    return (
      matter +
      out.join("\n").replace(/%%FENCE(\d+)%%/g, (_, index) => fences[Number(index)] || "")
    );
  }

  window.renderMarkdown = renderMarkdown;

  const SLASH_COMMANDS = [
    { id: "h1", keys: ["h1", "titulo", "título"], label: "Título 1", hint: "# Título", snippet: "# ", cursor: 2 },
    { id: "h2", keys: ["h2", "titulo2"], label: "Título 2", hint: "## Título", snippet: "## ", cursor: 3 },
    { id: "h3", keys: ["h3", "titulo3"], label: "Título 3", hint: "### Título", snippet: "### ", cursor: 4 },
    { id: "ul", keys: ["lista", "ul", "bullet"], label: "Lista", hint: "- item", snippet: "- " },
    { id: "ol", keys: ["numerada", "ol", "numero"], label: "Lista numerada", hint: "1. item", snippet: "1. " },
    { id: "todo", keys: ["todo", "check", "tarefa", "checkbox"], label: "Checklist", hint: "- [ ]", snippet: "- [ ] " },
    { id: "quote", keys: ["citacao", "citação", "quote"], label: "Citação", hint: "> texto", snippet: "> " },
    { id: "code", keys: ["codigo", "código", "code"], label: "Bloco de código", hint: "```", snippet: "```\n\n```", cursor: 4 },
    { id: "hr", keys: ["divisoria", "divisória", "linha", "hr"], label: "Divisor", hint: "---", snippet: "---\n" },
    { id: "bold", keys: ["negrito", "bold", "strong"], label: "Negrito", hint: "**texto**", snippet: "****", cursor: 2 },
    { id: "italic", keys: ["italico", "itálico", "em"], label: "Itálico", hint: "*texto*", snippet: "**", cursor: 1 },
    { id: "strike", keys: ["riscado", "strike"], label: "Riscado", hint: "~~texto~~", snippet: "~~~~", cursor: 2 },
    { id: "link", keys: ["link", "url"], label: "Link", hint: "[texto](url)", snippet: "[](url)", cursor: 1 },
    {
      id: "wikilink",
      keys: ["wikilink", "interno", "nota", "arquivo", "[["],
      label: "Link interno",
      hint: "[[arquivo]]",
      snippet: "[[]]",
      cursor: 2,
    },
    {
      id: "frontmatter",
      keys: ["yaml", "frontmatter", "propriedades", "tags"],
      label: "Propriedades (YAML)",
      hint: "--- tags: ---",
      snippet: "---\ntags: \n---\n",
      cursor: 10,
    },
    { id: "image", keys: ["imagem", "image", "img"], label: "Imagem", hint: "![](url)", snippet: "![](url)", cursor: 2 },
    { id: "table", keys: ["tabela", "table"], label: "Tabela", hint: "| |", snippet: "| Coluna 1 | Coluna 2 |\n| --- | --- |\n|  |  |\n" },
  ];

  function matchSlashCommands(query) {
    const q = String(query || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return SLASH_COMMANDS.filter((command) => {
      if (!q) return true;
      const hay = [command.label, command.hint, command.id, ...(command.keys || [])]
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return hay.includes(q);
    });
  }

  window.SLASH_COMMANDS = SLASH_COMMANDS;
  window.matchSlashCommands = matchSlashCommands;
})();
