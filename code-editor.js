(function bootCodeEditor() {
  const hostId = "code-editor";
  let editor = null;
  let monacoApi = null;
  let boundKey = "";
  let onChange = null;
  let suppress = false;
  let visible = false;

  const ready = new Promise((resolve, reject) => {
    const amdRequire = typeof window.require === "function" ? window.require : null;
    if (!amdRequire || typeof amdRequire.config !== "function") {
      reject(new Error("Monaco loader ausente"));
      return;
    }
    const vs = new URL("node_modules/monaco-editor/min/vs", window.location.href).href.replace(/\/$/, "");
    amdRequire.config({ paths: { vs } });
    amdRequire(["vs/editor/editor.main"], () => {
      monacoApi = window.monaco;
      defineThemes(monacoApi);
      defineLanguages(monacoApi);
      resolve(monacoApi);
    }, reject);
  });

  function defineThemes(monaco) {
    monaco.editor.defineTheme("notes-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#1d1d1f",
        "editorLineNumber.foreground": "#8e8e93",
        "editorLineNumber.activeForeground": "#6e6e73",
        "editorCursor.foreground": "#1d1d1f",
        "editor.selectionBackground": "#ffe08c88",
        "editor.inactiveSelectionBackground": "#e6e6eb",
        "editorWidget.background": "#f5f5f7",
        "editorGutter.background": "#ffffff",
      },
    });
    monaco.editor.defineTheme("notes-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#1c1c1e",
        "editor.foreground": "#f5f5f7",
        "editorLineNumber.foreground": "#6e6e73",
        "editorLineNumber.activeForeground": "#a1a1a6",
        "editorCursor.foreground": "#f5f5f7",
        "editor.selectionBackground": "#6b542088",
        "editor.inactiveSelectionBackground": "#2c2c2e",
        "editorWidget.background": "#1e1e20",
        "editorGutter.background": "#1c1c1e",
      },
    });
  }

  function defineLanguages(monaco) {
    monaco.languages.register({ id: "prisma" });
    monaco.languages.setMonarchTokensProvider("prisma", {
      defaultToken: "",
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],
          [/\b(model|enum|datasource|generator|view|type)\b/, "keyword"],
          [/\b(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes|Unsupported)\b/, "type"],
          [/@\w+/, "annotation"],
          [/\b(provider|url|relationMode|previewFeatures|engineType)\b/, "attribute"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/'([^'\\]|\\.)*'/, "string"],
          [/\b\d+(\.\d+)?\b/, "number"],
          [/[{}()[\]]/, "delimiter.bracket"],
        ],
        comment: [
          [/\*\//, "comment", "@pop"],
          [/./, "comment"],
        ],
      },
    });

    monaco.languages.register({ id: "dbms" });
    monaco.languages.setMonarchTokensProvider("dbms", {
      ignoreCase: true,
      tokenizer: {
        root: [
          [/--.*$/, "comment"],
          [/\b(DATABASE|TABLE|CREATE|PRIMARY|KEY|REFERENCES|FOREIGN|NOT|NULL|DEFAULT|UNIQUE)\b/, "keyword"],
          [/\b(TEXT|NUMERIC|DATE|BOOLEAN|INT|INTEGER|FLOAT|VARCHAR|JSON)\b/, "type"],
          [/"([^"]|"")*"/, "string"],
          [/'([^']|'')*'/, "string"],
          [/`[^`]+`/, "string"],
          [/\b\d+(\.\d+)?\b/, "number"],
          [/[{}()[\],;]/, "delimiter"],
        ],
      },
    });

    monaco.languages.register({ id: "mermaid" });
    monaco.languages.setMonarchTokensProvider("mermaid", {
      tokenizer: {
        root: [
          [/%%.*$/, "comment"],
          [/\b(erDiagram|title)\b/, "keyword"],
          [/\b(string|int|float|double|decimal|date|datetime|boolean|bool|text)\b/, "type"],
          [/\b(PK|FK|UK)\b/, "annotation"],
          [/\|{1,2}|o\{|\}o|\}\||--|\.\./, "keyword"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/\b[A-Za-z_][\w]*\b/, "identifier"],
        ],
      },
    });
  }

  function themeName() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "notes-dark" : "notes-light";
  }

  function host() {
    return document.getElementById(hostId);
  }

  async function ensureEditor() {
    const monaco = await ready;
    const el = host();
    if (!el) throw new Error("code-editor missing");
    if (editor) return editor;
    editor = monaco.editor.create(el, {
      value: "",
      language: "markdown",
      theme: themeName(),
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13.5,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      lineHeight: 22,
      padding: { top: 8, bottom: 16 },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      tabSize: 2,
      renderLineHighlight: "line",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      quickSuggestions: false,
      wordBasedSuggestions: "off",
      folding: true,
      contextmenu: true,
      unicodeHighlight: { ambiguousCharacters: false },
    });
    editor.onDidChangeModelContent(() => {
      if (suppress || !onChange) return;
      onChange(editor.getValue());
    });
    editor.onKeyDown((event) => {
      window.CodeEditor?.handleKeyDown?.(event);
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      monaco.editor.setTheme(themeName());
    });
    return editor;
  }

  async function show(opts) {
    const monaco = await ready;
    await ensureEditor();
    const el = host();
    if (!el) return;
    visible = true;
    el.hidden = false;
    onChange = opts.onChange || null;
    const language = opts.language || "plaintext";
    const wrap = language === "markdown" || language === "html";
    editor.updateOptions({
      wordWrap: wrap ? "on" : "off",
      quickSuggestions: language === "markdown" ? false : { other: true, comments: false, strings: false },
    });
    monaco.editor.setTheme(themeName());
    const nextKey = opts.key || `${language}:${opts.value?.length || 0}`;
    const switched = nextKey !== boundKey;
    boundKey = nextKey;
    const model = editor.getModel();
    if (model && model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language);
    }
    if (switched || (!editor.hasTextFocus() && editor.getValue() !== opts.value)) {
      suppress = true;
      editor.setValue(opts.value || "");
      if (model && model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
      suppress = false;
    }
    requestAnimationFrame(() => editor.layout());
  }

  function hide() {
    visible = false;
    onChange = null;
    boundKey = "";
    const el = host();
    if (el) el.hidden = true;
  }

  function isOpen() {
    return Boolean(visible && editor && host() && !host().hidden);
  }

  ready.catch((err) => {
    console.error(err);
    if (window.CodeEditor) window.CodeEditor.failed = true;
  });

  window.CodeEditor = {
    whenReady: () => ready,
    show,
    hide,
    isOpen,
    hasFocus: () => Boolean(editor && editor.hasTextFocus()),
    getValue: () => (editor ? editor.getValue() : ""),
    focus: () => editor?.focus(),
    insert(text) {
      if (!editor) return;
      const selection = editor.getSelection();
      editor.executeEdits("vault", [{ range: selection, text, forceMoveMarkers: true }]);
      editor.focus();
    },
    selectedText() {
      if (!editor) return "";
      const selection = editor.getSelection();
      if (!selection) return "";
      return editor.getModel()?.getValueInRange(selection) || "";
    },
    wrap(before, after, placeholder = "") {
      if (!editor) return;
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (!selection || !model) return;
      const selected = model.getValueInRange(selection) || placeholder;
      const text = `${before}${selected}${after}`;
      editor.executeEdits("vault", [{ range: selection, text, forceMoveMarkers: true }]);
      const start = model.getOffsetAt(selection.getStartPosition());
      const caret = model.getPositionAt(start + before.length + selected.length);
      editor.setSelection(
        monacoApi.Range.fromPositions(model.getPositionAt(start + before.length), caret)
      );
      editor.focus();
    },
    prefixLines(prefix) {
      if (!editor) return;
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (!selection || !model) return;
      const edits = [];
      for (let line = selection.startLineNumber; line <= selection.endLineNumber; line += 1) {
        const content = model.getLineContent(line);
        if (content.startsWith(prefix)) continue;
        edits.push({
          range: new monacoApi.Range(line, 1, line, 1),
          text: prefix,
          forceMoveMarkers: true,
        });
      }
      if (edits.length) editor.executeEdits("vault", edits);
      editor.focus();
    },
    replace(start, end, text, cursor) {
      if (!editor) return;
      const model = editor.getModel();
      const startPos = model.getPositionAt(start);
      const endPos = model.getPositionAt(end);
      editor.executeEdits("notes", [
        { range: monacoApi.Range.fromPositions(startPos, endPos), text, forceMoveMarkers: true },
      ]);
      const next = model.getPositionAt(cursor ?? start + text.length);
      editor.setPosition(next);
      editor.focus();
    },
    slashContext() {
      if (!editor) return null;
      const model = editor.getModel();
      const pos = editor.getPosition();
      if (!model || !pos) return null;
      const line = model.getLineContent(pos.lineNumber);
      const before = line.slice(0, pos.column - 1);
      const match = before.match(/^\/([^\s]*)$/);
      if (!match) return null;
      return {
        start: model.getOffsetAt({ lineNumber: pos.lineNumber, column: 1 }),
        query: match[1],
        caret: model.getOffsetAt(pos),
      };
    },
    caretPoint() {
      if (!editor || !host()) return null;
      const pos = editor.getPosition();
      const coords = editor.getScrolledVisiblePosition(pos);
      if (!coords) return null;
      const rect = host().getBoundingClientRect();
      return { top: rect.top + coords.top + coords.height, left: rect.left + coords.left };
    },
  };
})();
