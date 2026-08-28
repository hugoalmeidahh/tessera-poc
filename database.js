function uid() {
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyRow(columns) {
  const row = { id: uid() };
  for (const col of columns) {
    row[col.id] = col.type === "checkbox" ? false : "";
  }
  return row;
}

function defaultColumns() {
  return [
    { id: "name", name: "Nome", type: "text" },
    { id: "status", name: "Status", type: "select", options: ["A fazer", "Em andamento", "Feito"] },
    { id: "due", name: "Prazo", type: "date" },
    { id: "amount", name: "Valor", type: "number" },
  ];
}

function emptyTable(title = "") {
  const columns = defaultColumns();
  return {
    id: uid(),
    title,
    columns,
    rows: [emptyRow(columns), emptyRow(columns), emptyRow(columns)],
  };
}

function tableFromLegacy(data) {
  const columns = Array.isArray(data.columns)
    ? data.columns.map((col, index) => normalizeColumn(col, index))
    : defaultColumns();
  return {
    id: data.id || uid(),
    title: data.title || "",
    columns,
    rows: Array.isArray(data.rows) ? data.rows : [],
  };
}

function normalizeColumn(col, index = 0) {
  const next = {
    id: col.id || ident(col.name, `coluna${index + 1}`),
    name: col.name || "Coluna",
    type: col.type || "text",
  };
  if (next.type === "select") next.options = Array.isArray(col.options) ? col.options : [];
  if (col.ref && col.ref.table) {
    next.ref = { table: String(col.ref.table), column: String(col.ref.column || "id") };
  }
  return next;
}

function normalizeRelation(rel) {
  if (!rel || !rel.from || !rel.to) return null;
  return {
    from: String(rel.from),
    fromColumn: String(rel.fromColumn || ""),
    to: String(rel.to),
    toColumn: String(rel.toColumn || "id"),
    kind: rel.kind || "n:1",
  };
}

function normalizeDatabase(data) {
  if (!data || data.type !== "database") return emptyDatabase();
  let tables = [];
  if (Array.isArray(data.tables) && data.tables.length) {
    tables = data.tables.map((table) => tableFromLegacy(table));
  } else if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
    tables = [tableFromLegacy(data)];
  } else {
    return emptyDatabase();
  }
  return {
    type: "database",
    tables,
    relations: Array.isArray(data.relations) ? data.relations.map(normalizeRelation).filter(Boolean) : [],
  };
}

function emptyDatabase() {
  return { type: "database", tables: [emptyTable("")] };
}

function sampleDatabase() {
  const pipeline = emptyTable("Pipeline comercial");
  pipeline.rows = [
    { id: uid(), name: "Acme Ltda", status: "Em andamento", due: "2026-09-02", amount: 4800 },
    { id: uid(), name: "Studio Norte", status: "A fazer", due: "2026-09-10", amount: 1200 },
    { id: uid(), name: "Café da Esquina", status: "Feito", due: "2026-08-20", amount: 350 },
  ];
  const next = emptyTable("Próximos passos");
  next.columns = [
    { id: "name", name: "Tarefa", type: "text" },
    { id: "status", name: "Status", type: "select", options: ["A fazer", "Em andamento", "Feito"] },
    { id: "due", name: "Prazo", type: "date" },
  ];
  next.rows = [
    { id: uid(), name: "Enviar proposta Acme", status: "Em andamento", due: "2026-08-28" },
    { id: uid(), name: "Ligar para o Studio Norte", status: "A fazer", due: "2026-09-03" },
  ];
  return { type: "database", tables: [pipeline, next] };
}

function parseDatabase(body) {
  try {
    return normalizeDatabase(JSON.parse(body));
  } catch {
    return emptyDatabase();
  }
}

function serializeDatabase(db) {
  return `${JSON.stringify(normalizeDatabase(db), null, 2)}\n`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ident(name, fallback = "field") {
  const cleaned = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "_")
    .replace(/^(\d)/, "_$1")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return cleaned || fallback;
}

function pascalCase(name) {
  const parts = ident(name, "table").split("_").filter(Boolean);
  const out = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  return out || "Table";
}

function uniqueNames(items, getName, fallback) {
  const used = new Set();
  return items.map((item, index) => {
    const base = ident(getName(item), `${fallback}${index + 1}`);
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base}_${n}`;
      n += 1;
    }
    used.add(name);
    return { item, ident: name, pascal: pascalCase(name) };
  });
}

function sqlType(col) {
  switch (col.type) {
    case "number":
      return "NUMERIC";
    case "date":
      return "DATE";
    case "checkbox":
      return "BOOLEAN";
    default:
      return "TEXT";
  }
}

function prismaType(col) {
  switch (col.type) {
    case "number":
      return "Float?";
    case "date":
      return "DateTime?";
    case "checkbox":
      return "Boolean @default(false)";
    default:
      return "String?";
  }
}

function mermaidType(col) {
  switch (col.type) {
    case "number":
      return "float";
    case "date":
      return "date";
    case "checkbox":
      return "boolean";
    default:
      return "string";
  }
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function namedTables(db) {
  const data = normalizeDatabase(db);
  return uniqueNames(data.tables, (table) => table.title || "tabela", "tabela");
}

function resolveNamedTable(named, name) {
  const key = ident(name);
  if (!key) return null;
  const singular = key.replace(/s$/, "");
  return (
    named.find((entry) => entry.ident === key || ident(entry.item.title) === key) ||
    named.find((entry) => entry.ident === `${key}s` || ident(entry.item.title) === `${key}s`) ||
    named.find((entry) => entry.ident.replace(/s$/, "") === singular || ident(entry.item.title).replace(/s$/, "") === singular) ||
    null
  );
}

function fkBaseName(name) {
  const key = ident(name);
  if (!key || key === "id") return "";
  if (key.endsWith("_id")) return key.slice(0, -3);
  if (key.endsWith("id") && key.length > 2) return key.slice(0, -2);
  return "";
}

function inferRelations(named) {
  const edges = [];
  for (const { item: table, ident: tableId } of named) {
    for (const col of table.columns || []) {
      if (col.ref?.table) {
        const target = resolveNamedTable(named, col.ref.table);
        if (!target) continue;
        edges.push({
          from: tableId,
          fromColumn: ident(col.name || col.id),
          to: target.ident,
          toColumn: ident(col.ref.column || "id") || "id",
          kind: "n:1",
        });
        continue;
      }
      const base = fkBaseName(col.name || col.id);
      if (!base) continue;
      const target = resolveNamedTable(named, base);
      if (!target || target.ident === tableId) continue;
      edges.push({
        from: tableId,
        fromColumn: ident(col.name || col.id),
        to: target.ident,
        toColumn: "id",
        kind: "n:1",
      });
    }
  }
  return edges;
}

function collectRelations(db) {
  const data = normalizeDatabase(db);
  const named = namedTables(data);
  const seen = new Set();
  const edges = [];
  const add = (edge) => {
    const from = resolveNamedTable(named, edge.from);
    const to = resolveNamedTable(named, edge.to);
    if (!from || !to) return;
    const fromCol = ident(edge.fromColumn || "") || "";
    const toCol = ident(edge.toColumn || "id") || "id";
    const key = `${from.ident}.${fromCol}->${to.ident}.${toCol}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      from: from.ident,
      fromColumn: fromCol,
      to: to.ident,
      toColumn: toCol,
      kind: edge.kind || "n:1",
    });
  };
  for (const rel of data.relations || []) add(rel);
  for (const edge of inferRelations(named)) add(edge);
  return { named, edges };
}

function toDbms(db, databaseName = "database") {
  const tables = namedTables(db);
  const header = `DATABASE ${quoteIdent(databaseName)};\n`;
  const blocks = tables.map(({ item: table }) => {
    const cols = uniqueNames(table.columns, (col) => col.name, "coluna");
    const fields = [
      { text: "  id TEXT PRIMARY KEY", comment: "" },
      ...cols.map(({ item: col, ident: colId }) => ({
        text: `  ${quoteIdent(col.name || colId)} ${sqlType(col)}`,
        comment: col.type === "select" && col.options?.length ? ` -- ${col.options.join(" | ")}` : "",
      })),
    ];
    const lines = fields.map((field, index) => {
      const comma = index < fields.length - 1 ? "," : "";
      return `${field.text}${field.comment}${comma}`;
    });
    return `TABLE ${quoteIdent(table.title || "tabela")} (\n${lines.join("\n")}\n);`;
  });
  return `${header}\n${blocks.join("\n\n")}\n`;
}

function toSql(db, databaseName = "database") {
  const { named, edges } = collectRelations(db);
  const lines = [`-- ${databaseName}`, ""];
  for (const { item: table, ident: tableId } of named) {
    const cols = uniqueNames(table.columns, (col) => col.name, "coluna");
    const fields = [
      "  id TEXT PRIMARY KEY",
      ...cols.map(({ item: col, ident: colId }) => {
        const edge = edges.find((item) => item.from === tableId && item.fromColumn === colId);
        const fk = edge ? ` REFERENCES ${quoteIdent(edge.to)} (${quoteIdent(edge.toColumn || "id")})` : "";
        return `  ${quoteIdent(colId)} ${sqlType(col)}${fk}`;
      }),
    ];
    lines.push(`CREATE TABLE ${quoteIdent(tableId)} (`);
    lines.push(`${fields.join(",\n")}`);
    lines.push(");");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function toPrisma(db, databaseName = "database") {
  const { named, edges } = collectRelations(db);
  const models = named.map(({ item: table, ident: tableId, pascal }) => {
    const cols = uniqueNames(table.columns, (col) => col.name, "field");
    const fields = ["  id String @id @default(cuid())"];
    for (const { item: col, ident: colId } of cols) {
      fields.push(`  ${colId} ${prismaType(col)}`);
      const edge = edges.find((item) => item.from === tableId && item.fromColumn === colId);
      if (edge) {
        const target = named.find((entry) => entry.ident === edge.to);
        const relName = ident(target?.item.title || edge.to);
        fields.push(`  ${relName} ${target?.pascal || pascalCase(edge.to)} @relation(fields: [${colId}], references: [${edge.toColumn || "id"}])`);
      }
    }
    const incoming = edges.filter((item) => item.to === tableId);
    for (const edge of incoming) {
      const source = named.find((entry) => entry.ident === edge.from);
      if (!source) continue;
      const listName = ident(source.item.title || edge.from) + "s";
      fields.push(`  ${listName} ${source.pascal}[]`);
    }
    return `model ${pascal} {\n${fields.join("\n")}\n}`;
  });
  return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ${databaseName}
${models.join("\n\n")}
`;
}

function toMermaid(db, databaseName = "database") {
  const { named, edges } = collectRelations(db);
  const blocks = named.map(({ item: table, ident: tableId }) => {
    const cols = uniqueNames(table.columns, (col) => col.name, "coluna");
    const fks = new Set(edges.filter((edge) => edge.from === tableId).map((edge) => edge.fromColumn));
    const fields = [
      "    string id PK",
      ...cols.map(({ item: col, ident: colId }) => {
        const mark = fks.has(colId) ? " FK" : "";
        return `    ${mermaidType(col)} ${colId}${mark}`;
      }),
    ];
    return `  ${tableId} {\n${fields.join("\n")}\n  }`;
  });
  const links = edges.map((edge) => `  ${edge.to} ||--o{ ${edge.from} : "${edge.fromColumn || ""}"`);
  return `---\ntitle: ${databaseName}\n---\nerDiagram\n${links.join("\n")}${links.length ? "\n" : ""}${blocks.join("\n")}\n`;
}

function toDiagramHtml(db) {
  const { named, edges } = collectRelations(db);
  if (!named.length) return `<p class="er-empty">Nenhuma tabela</p>`;
  const cards = named
    .map(({ item: table, ident: tableId }) => {
      const cols = uniqueNames(table.columns || [], (col) => col.name, "coluna");
      const fkByCol = new Map(
        edges.filter((edge) => edge.from === tableId).map((edge) => [edge.fromColumn, edge])
      );
      const rows = [
        `<li data-er-col="id"><span class="er-name er-pk">id</span><span class="er-type">TEXT · PK</span></li>`,
        ...cols.map(({ item: col, ident: colId }) => {
          const fk = fkByCol.get(colId);
          const fkClass = fk ? " er-fk" : "";
          const typeLabel = fk ? `${sqlType(col)} · FK → ${fk.to}` : sqlType(col);
          return `<li data-er-col="${escapeHtml(colId)}" class="${fkClass.trim()}"><span class="er-name${fkClass}">${escapeHtml(
            col.name || col.id
          )}</span><span class="er-type">${escapeHtml(typeLabel)}</span></li>`;
        }),
      ];
      return `<article class="er-card" data-er-table="${escapeHtml(tableId)}"><h3>${escapeHtml(
        table.title || "Tabela"
      )}</h3><ul>${rows.join("")}</ul></article>`;
    })
    .join("");
  return `<div class="er-wrap" data-er-edges="${escapeHtml(JSON.stringify(edges))}"><svg class="er-lines" aria-hidden="true"></svg><div class="er-diagram">${cards}</div></div>`;
}

function layoutErDiagram(root) {
  const wrap = root?.querySelector?.(".er-wrap") || (root?.classList?.contains("er-wrap") ? root : null);
  if (!wrap) return;
  const svg = wrap.querySelector("svg.er-lines");
  const canvas = wrap.querySelector(".er-diagram");
  if (!svg || !canvas) return;
  let edges = [];
  try {
    edges = JSON.parse(wrap.dataset.erEdges || "[]");
  } catch {
    edges = [];
  }
  const wrapRect = wrap.getBoundingClientRect();
  const width = Math.max(wrap.scrollWidth, wrapRect.width, 1);
  const height = Math.max(wrap.scrollHeight, wrapRect.height, 1);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const marker = `<defs><marker id="er-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 Z" fill="currentColor"></path></marker></defs>`;
  const paths = edges
    .map((edge, index) => {
      const fromCard = wrap.querySelector(`[data-er-table="${CSS.escape(edge.from)}"]`);
      const toCard = wrap.querySelector(`[data-er-table="${CSS.escape(edge.to)}"]`);
      if (!fromCard || !toCard) return "";
      const fromEl = (edge.fromColumn && fromCard.querySelector(`[data-er-col="${CSS.escape(edge.fromColumn)}"]`)) || fromCard;
      const toEl = (edge.toColumn && toCard.querySelector(`[data-er-col="${CSS.escape(edge.toColumn)}"]`)) || toCard.querySelector(`[data-er-col="id"]`) || toCard;
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const fromCenter = fromRect.left + fromRect.width / 2;
      const toCenter = toRect.left + toRect.width / 2;
      const goRight = fromCenter <= toCenter;
      const x1 = goRight ? fromRect.right - wrapRect.left + wrap.scrollLeft : fromRect.left - wrapRect.left + wrap.scrollLeft;
      const y1 = fromRect.top + fromRect.height / 2 - wrapRect.top + wrap.scrollTop;
      const x2 = goRight ? toRect.left - wrapRect.left + wrap.scrollLeft : toRect.right - wrapRect.left + wrap.scrollLeft;
      const y2 = toRect.top + toRect.height / 2 - wrapRect.top + wrap.scrollTop;
      const dx = Math.max(48, Math.abs(x2 - x1) * 0.35);
      const c1 = goRight ? x1 + dx : x1 - dx;
      const c2 = goRight ? x2 - dx : x2 + dx;
      const many = edge.kind === "n:n" || edge.kind === "n:1" ? "N" : "1";
      const one = edge.kind === "n:n" ? "N" : "1";
      return `<path d="M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}" marker-end="url(#er-arrow)"></path><text x="${x1 + (goRight ? 10 : -10)}" y="${y1 - 6}" text-anchor="${goRight ? "start" : "end"}">${many}</text><text x="${x2 + (goRight ? -10 : 10)}" y="${y2 - 6}" text-anchor="${goRight ? "end" : "start"}">${one}</text>`;
    })
    .join("");
  svg.innerHTML = `${marker}${paths}`;
}

function unquote(name) {
  const value = String(name || "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith("`") && value.endsWith("`"))
  ) {
    return value.slice(1, -1).replaceAll('""', '"');
  }
  if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1);
  return value;
}

function displayName(raw) {
  const name = unquote(raw);
  if (!name) return "Tabela";
  if (/[ _à-úÀ-Ú]/.test(name) && name !== name.toLowerCase() && name.includes(" ")) return name;
  if (name.includes("_") || name === name.toLowerCase()) {
    return name
      .split("_")
      .filter(Boolean)
      .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part.toLowerCase()))
      .join(" ");
  }
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function mapSqlType(raw) {
  const type = String(raw || "")
    .toLowerCase()
    .replace(/\(.*\)/g, "")
    .replace(/\[\]/g, "")
    .trim();
  if (/enum/.test(type)) return "select";
  if (/int|numeric|decimal|float|double|real|money|serial|number/.test(type)) return "number";
  if (/date|time/.test(type)) return "date";
  if (/bool/.test(type)) return "checkbox";
  return "text";
}

function mapPrismaType(type) {
  if (/^(Int|BigInt|Float|Decimal)$/i.test(type)) return "number";
  if (/^(DateTime|Date)$/i.test(type)) return "date";
  if (/^Boolean$/i.test(type)) return "checkbox";
  return "text";
}

function mapMermaidType(type) {
  return mapSqlType(type);
}

function parseEnumOptions(typeRaw, comment) {
  const fromType = String(typeRaw || "").match(/enum\s*\((.*)\)/i);
  if (fromType) {
    return fromType[1]
      .split(",")
      .map((item) => unquote(item.trim()))
      .filter(Boolean);
  }
  const fromComment = String(comment || "").trim();
  if (fromComment.includes("|")) {
    return fromComment
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function isIdName(name) {
  return ident(name, "id") === "id";
}

function splitSqlColumns(body) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseColumnDef(part) {
  const comment = (part.match(/--\s*([^\n]*)/) || [])[1] || "";
  const code = part.replace(/--[^\n]*/g, "").trim();
  if (!code) return null;
  if (/^(PRIMARY\s+KEY|UNIQUE|CONSTRAINT|FOREIGN|CHECK|INDEX|KEY)\b/i.test(code)) return { constraint: code };
  const match = code.match(/^("[\s\S]*?"|`[^`]+`|\[[^\]]+\]|[^\s]+)\s+(.+)$/s);
  if (!match) return null;
  const name = unquote(match[1]);
  if (!name || isIdName(name)) return null;
  const typeRaw = match[2];
  const options = parseEnumOptions(typeRaw, comment);
  const refMatch = typeRaw.match(/\bREFERENCES\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s(]+)\s*(?:\(([^)]+)\))?/i);
  const ref = refMatch
    ? { table: unquote(refMatch[1]), column: unquote((refMatch[2] || "id").split(",")[0].trim()) || "id" }
    : undefined;
  return {
    name,
    type: options.length ? "select" : mapSqlType(typeRaw),
    options: options.length ? options : undefined,
    ref,
  };
}

function parseFkConstraint(code, fromTable) {
  const text = String(code || "").replace(/--[^\n]*/g, "").trim();
  const match = text.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s*(?:\(([^)]+)\))?/i);
  if (!match) return null;
  return {
    from: fromTable,
    fromColumn: unquote(match[1].split(",")[0].trim()),
    to: unquote(match[2]),
    toColumn: unquote((match[3] || "id").split(",")[0].trim()) || "id",
    kind: "n:1",
  };
}

function extractParenBlock(text, openIndex) {
  let depth = 1;
  let quote = "";
  let i = openIndex + 1;
  while (i < text.length && depth) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = "";
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    i += 1;
  }
  return { body: text.slice(openIndex + 1, i - 1), end: i };
}

function parseSql(source) {
  const tables = [];
  const text = String(source || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const openRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi;
  let match;
  while ((match = openRe.exec(text))) {
    let i = match.index + match[0].length;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    const nameStart = i;
    if (text[i] === '"' || text[i] === "`" || text[i] === "[") {
      const close = text[i] === "[" ? "]" : text[i];
      i += 1;
      while (i < text.length && text[i] !== close) i += 1;
      i += 1;
    } else {
      while (i < text.length && !/[\s(]/.test(text[i])) i += 1;
    }
    const name = unquote(text.slice(nameStart, i).trim());
    while (i < text.length && text[i] !== "(") i += 1;
    if (text[i] !== "(") continue;
    const block = extractParenBlock(text, i);
    openRe.lastIndex = block.end;
    const parts = splitSqlColumns(block.body);
    const columns = [];
    const relations = [];
    for (const part of parts) {
      const parsed = parseColumnDef(part);
      if (!parsed) continue;
      if (parsed.constraint) {
        const fk = parseFkConstraint(parsed.constraint, name);
        if (fk) relations.push(fk);
        continue;
      }
      columns.push(parsed);
      if (parsed.ref) {
        relations.push({
          from: name,
          fromColumn: parsed.name,
          to: parsed.ref.table,
          toColumn: parsed.ref.column,
          kind: "n:1",
        });
      }
    }
    tables.push({ title: displayName(name), columns, relations });
  }
  return {
    tables: tables.map(({ title, columns }) => ({ title, columns })),
    relations: tables.flatMap((table) => table.relations || []),
  };
}

function parseDbms(source) {
  const dbMatch = String(source || "").match(/DATABASE\s+("[^"]+"|`[^`]+`|'[^']+'|\S+)/i);
  const databaseName = dbMatch ? unquote(dbMatch[1].replace(/;$/, "")) : null;
  const sqlish = String(source || "")
    .replace(/DATABASE\s+("[^"]+"|`[^`]+`|'[^']+'|\S+)\s*;?/gi, "\n")
    .replace(/(^|[\n;])\s*TABLE\b/gi, "$1CREATE TABLE");
  return { ...parseSql(sqlish), databaseName };
}

function parsePrisma(source) {
  const text = String(source || "");
  const enums = {};
  const enumRe = /enum\s+(\w+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = enumRe.exec(text))) {
    enums[match[1]] = match[2]
      .replace(/\/\/.*$/gm, "")
      .split(/\s+/)
      .map((item) => item.replace(/[,;]$/, "").trim())
      .filter(Boolean);
  }

  const tables = [];
  const relations = [];
  const modelRe = /model\s+(\w+)\s*\{([^}]*)\}/g;
  while ((match = modelRe.exec(text))) {
    const modelName = match[1];
    const columns = [];
    for (const line of match[2].split("\n")) {
      const trimmed = line.replace(/\/\/.*$/, "").trim();
      if (!trimmed || trimmed.startsWith("@@")) continue;
      const field = trimmed.match(/^(\w+)\s+(\w+)(\[\])?/);
      if (!field) continue;
      const [, name, type, isList] = field;
      const relArgs = (trimmed.match(/@relation\s*\(([^)]*)\)/) || [])[1] || "";
      const fieldsArg = (relArgs.match(/fields:\s*\[([^\]]+)\]/) || [])[1];
      const refsArg = (relArgs.match(/references:\s*\[([^\]]+)\]/) || [])[1];
      if (fieldsArg) {
        relations.push({
          from: modelName,
          fromColumn: fieldsArg.split(",")[0].trim(),
          to: type,
          toColumn: (refsArg || "id").split(",")[0].trim(),
          kind: "n:1",
        });
      }
      if (isIdName(name) || isList || trimmed.includes("@relation")) continue;
      if (enums[type]) {
        columns.push({ name, type: "select", options: enums[type] });
        continue;
      }
      if (!/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes|Date)$/i.test(type)) continue;
      columns.push({ name, type: mapPrismaType(type) });
    }
    tables.push({ title: displayName(modelName), columns, modelName });
  }
  for (const rel of relations) {
    const fromTable = tables.find((table) => ident(table.modelName) === ident(rel.from) || ident(table.title) === ident(rel.from));
    const col = fromTable?.columns.find((item) => ident(item.name) === ident(rel.fromColumn));
    if (col) col.ref = { table: rel.to, column: rel.toColumn || "id" };
  }
  return {
    tables: tables.map(({ title, columns }) => ({ title, columns })),
    relations,
  };
}

function parseMermaid(source) {
  let text = String(source || "").replace(/^---[\s\S]*?---/, "");
  const start = text.search(/erDiagram/i);
  if (start >= 0) text = text.slice(start + "erDiagram".length);
  const tables = [];
  const blockRe = /([A-Za-z_][\w]*)\s*\{([^}]*)\}/g;
  let match;
  while ((match = blockRe.exec(text))) {
    const columns = [];
    for (const line of match[2].split("\n")) {
      const trimmed = line.replace(/\/\/.*$/, "").trim();
      if (!trimmed) continue;
      const tokens = trimmed.split(/\s+/);
      const known = /^(string|int|float|double|decimal|numeric|number|date|datetime|boolean|bool|text)$/i;
      let type = "string";
      let name = tokens[0];
      if (tokens[1] && known.test(tokens[0])) {
        type = tokens[0];
        name = tokens[1];
      } else if (tokens[1] && known.test(tokens[1])) {
        name = tokens[0];
        type = tokens[1];
      }
      name = name.replace(/[,;]$/, "");
      if (!name || isIdName(name) || /^(PK|FK|UK)$/i.test(name)) continue;
      const isFk = tokens.some((token) => /^FK$/i.test(token));
      columns.push({ name: displayName(name), type: mapMermaidType(type), isFk });
    }
    tables.push({ title: displayName(match[1]), columns, ident: match[1] });
  }
  const relations = [];
  const relRe = /([A-Za-z_][\w]*)\s+([|o}]{1,3}[-.]{2,}[|o{]{1,3})\s+([A-Za-z_][\w]*)/g;
  while ((match = relRe.exec(text))) {
    const left = match[1];
    const right = match[3];
    const [leftCard, rightCard] = match[2].split(/[-.]{2,}/);
    const leftMany = String(leftCard || "").includes("}");
    const rightMany = String(rightCard || "").includes("{");
    let from = right;
    let to = left;
    let kind = "n:1";
    if (leftMany && !rightMany) {
      from = left;
      to = right;
    } else if (leftMany && rightMany) {
      kind = "n:n";
      from = left;
      to = right;
    } else if (!leftMany && !rightMany) {
      kind = "1:1";
    }
    relations.push({ from, fromColumn: "", to, toColumn: "id", kind });
  }
  return {
    tables: tables.map(({ title, columns }) => ({
      title,
      columns: columns.map(({ name, type }) => ({ name, type })),
    })),
    relations,
  };
}

function detectSchemaKind(text, filename = "") {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".prisma")) return "prisma";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".mmd") || lower.endsWith(".mermaid")) return "mermaid";
  if (lower.endsWith(".dbms")) return "dbms";
  const source = String(text || "");
  if (/^\s*model\s+\w+/m.test(source) || /datasource\s+db/i.test(source) || /generator\s+client/i.test(source)) {
    return "prisma";
  }
  if (/erDiagram/i.test(source)) return "mermaid";
  if (/CREATE\s+TABLE/i.test(source)) return "sql";
  if (/\bTABLE\s+/i.test(source) || /^\s*DATABASE\s+/i.test(source)) return "dbms";
  return "sql";
}

function fromSchema(kind, text) {
  const source = String(text || "").trim();
  if (!source) return { ok: false, error: "Schema vazio" };
  const parsers = { sql: parseSql, dbms: parseDbms, prisma: parsePrisma, mermaid: parseMermaid };
  const parse = parsers[kind] || parseSql;
  try {
    const parsed = parse(source);
    if (!parsed.tables?.length) return { ok: false, error: "Nenhuma tabela encontrada no schema" };
    return { ok: true, kind, ...parsed };
  } catch (err) {
    return { ok: false, error: err.message || "Não deu para ler o schema" };
  }
}

function isPlaceholderDb(db) {
  const tables = db?.tables || [];
  if (tables.length !== 1) return false;
  const table = tables[0];
  if (table.title) return false;
  return table.rows.every((row) =>
    table.columns.every((col) => {
      const value = row[col.id];
      return value === "" || value === false || value == null;
    })
  );
}

function mergeDatabase(prev, nextTables, extraRelations = []) {
  const previous = isPlaceholderDb(prev) ? { type: "database", tables: [] } : normalizeDatabase(prev);
  const prevByKey = new Map();
  for (const table of previous.tables) {
    prevByKey.set(ident(table.title || "tabela"), table);
  }

  const tables = (nextTables || []).map((spec) => {
    const title = spec.title || "Tabela";
    const old = prevByKey.get(ident(title));
    const columns = (spec.columns || []).map((col, index) => {
      const key = ident(col.name, `coluna${index + 1}`);
      const oldCol =
        old?.columns.find((item) => item.id === key) ||
        old?.columns.find((item) => ident(item.name) === key);
      const type = col.type || "text";
      const next = {
        id: oldCol?.id || key,
        name: col.name || displayName(key),
        type,
        options: type === "select" ? col.options || oldCol?.options || [] : undefined,
      };
      const ref = col.ref || oldCol?.ref;
      if (ref?.table) next.ref = { table: ref.table, column: ref.column || "id" };
      return next;
    });

    const rows = (old?.rows || []).map((row) => {
      const next = { id: row.id };
      for (const col of columns) {
        const oldCol =
          old.columns.find((item) => item.id === col.id) ||
          old.columns.find((item) => ident(item.name) === ident(col.name));
        if (oldCol && row[oldCol.id] !== undefined) next[col.id] = row[oldCol.id];
        else next[col.id] = col.type === "checkbox" ? false : "";
      }
      return next;
    });

    return {
      id: old?.id || uid(),
      title,
      columns,
      rows: rows.length ? rows : [emptyRow(columns), emptyRow(columns), emptyRow(columns)],
    };
  });

  const relations = (extraRelations || []).map(normalizeRelation).filter(Boolean);
  return { type: "database", tables: tables.length ? tables : [emptyTable("")], relations };
}

function schemaTextFor(kind, db, title) {
  if (kind === "dbms") return toDbms(db, title);
  if (kind === "sql") return toSql(db, title);
  if (kind === "mermaid") return toMermaid(db, title);
  if (kind === "prisma") return toPrisma(db, title);
  return "";
}

const databaseApi = {
  uid,
  emptyRow,
  emptyTable,
  emptyDatabase,
  sampleDatabase,
  parseDatabase,
  serializeDatabase,
  normalizeDatabase,
  toDbms,
  toSql,
  toPrisma,
  toMermaid,
  toDiagramHtml,
  layoutErDiagram,
  fromSchema,
  detectSchemaKind,
  mergeDatabase,
  schemaTextFor,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = databaseApi;
}

if (typeof window !== "undefined") {
  Object.assign(window, databaseApi);
}
