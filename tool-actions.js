const MAX_ACTIONS = 20;
const MAX_BODY = 200_000;
const MAX_PATH = 240;

function cleanPath(value) {
  const path = String(value || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!path || path.length > MAX_PATH || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Caminho de arquivo inválido");
  }
  if (path.startsWith(".trash/")) throw new Error("A IA não pode gravar na lixeira");
  return path;
}

function cleanBody(value) {
  const body = String(value ?? "");
  if (body.length > MAX_BODY) throw new Error("Conteúdo excede 200 KB");
  return body;
}

function validateActions(input) {
  const actions = input?.actions;
  if (!input || input.version !== 1 || !Array.isArray(actions) || !actions.length || actions.length > MAX_ACTIONS) {
    throw new Error("Plano de ações inválido");
  }
  const paths = new Set();
  return actions.map((action) => {
    if (!action || !["file.create", "file.write"].includes(action.type)) throw new Error("Ação não permitida");
    if (!Object.hasOwn(action, "body")) throw new Error("Toda ação deve incluir o conteúdo completo em body");
    const path = cleanPath(action.path);
    if (paths.has(path)) throw new Error("Um arquivo aparece mais de uma vez no plano");
    paths.add(path);
    return { type: action.type, path, body: cleanBody(action.body) };
  });
}

module.exports = { validateActions };
