(() => {
  const TYPES = [
    { id: "text", label: "Texto" },
    { id: "number", label: "Número" },
    { id: "select", label: "Seleção" },
    { id: "date", label: "Data" },
    { id: "checkbox", label: "Checkbox" },
  ];

  class TableView {
    constructor() {
      this.el = null;
      this.db = null;
      this.onChange = null;
      this.fileId = null;
      this.selected = { tableId: null, r: 0, c: 0 };
      this.editing = false;
      this.abort = null;
    }

    mount(el, db, onChange, fileId) {
      const next = window.normalizeDatabase(db);
      if (this.el && this.fileId === fileId) {
        this.db = next;
        this.onChange = onChange;
        if (!this.selected.tableId || !this.tableById(this.selected.tableId)) {
          this.selected.tableId = next.tables[0].id;
        }
        if (!this.editing && !this.isTyping()) this.render();
        return;
      }
      this.unmount();
      this.el = el;
      this.db = next;
      this.onChange = onChange;
      this.fileId = fileId;
      this.selected = { tableId: next.tables[0].id, r: 0, c: 0 };
      this.editing = false;
      this.abort = new AbortController();
      const { signal } = this.abort;
      this.el.addEventListener("click", (event) => this.onClick(event), { signal });
      this.el.addEventListener("dblclick", (event) => this.onDblClick(event), { signal });
      this.el.addEventListener("keydown", (event) => this.onKey(event), { signal });
      this.el.addEventListener("change", (event) => this.onField(event), { signal });
      this.el.addEventListener("focusout", (event) => this.onFocusOut(event), { signal });
      this.render();
    }

    unmount() {
      if (this.abort) this.abort.abort();
      this.abort = null;
      this.el = null;
      this.fileId = null;
      this.editing = false;
    }

    isTyping() {
      if (!this.el) return false;
      const active = document.activeElement;
      return Boolean(
        active &&
          this.el.contains(active) &&
          active.matches(".db-title, .sheet__col-name, .sheet__input, .sheet__select")
      );
    }

    emit() {
      if (this.onChange) this.onChange(this.db);
    }

    tableById(id) {
      return this.db.tables.find((table) => table.id === id) || this.db.tables[0];
    }

    activeTable() {
      return this.tableById(this.selected.tableId);
    }

    focusTable(tableId) {
      if (this.selected.tableId !== tableId) {
        this.selected = { tableId, r: 0, c: 0 };
        this.editing = false;
      }
    }

    cell(r, c) {
      const table = this.activeTable();
      const col = table.columns[c];
      const row = table.rows[r];
      if (!col || !row) return "";
      return row[col.id];
    }

    setCell(r, c, value) {
      const table = this.activeTable();
      const col = table.columns[c];
      const row = table.rows[r];
      if (!col || !row) return;
      row[col.id] = value;
      this.emit();
    }

    select(r, c, edit = false, tableId = this.selected.tableId) {
      const table = this.tableById(tableId);
      const maxR = Math.max(0, table.rows.length - 1);
      const maxC = Math.max(0, table.columns.length - 1);
      this.selected = {
        tableId: table.id,
        r: Math.max(0, Math.min(maxR, r)),
        c: Math.max(0, Math.min(maxC, c)),
      };
      this.editing = edit;
      this.render();
      const root = this.blockEl(table.id);
      if (edit) {
        const input = root?.querySelector(".sheet__input, .sheet__select");
        if (input) {
          input.focus();
          if (input.select) input.select();
        }
      } else {
        const td = root?.querySelector("td.is-selected");
        if (td) td.focus();
      }
    }

    blockEl(tableId) {
      return this.el?.querySelector(`[data-table="${tableId}"]`);
    }

    commitEdit(move) {
      const table = this.activeTable();
      const input = this.blockEl(table.id)?.querySelector(".sheet__input, .sheet__select");
      if (input) {
        const col = table.columns[this.selected.c];
        let value = input.value;
        if (col.type === "number") value = value === "" ? "" : Number(value);
        this.setCell(this.selected.r, this.selected.c, value);
        if (col.type === "select" && value && !(col.options || []).includes(value)) {
          col.options = [...(col.options || []), value];
        }
      }
      this.editing = false;
      if (move === "down") this.select(this.selected.r + 1, this.selected.c);
      else if (move === "right") this.select(this.selected.r, this.selected.c + 1);
      else this.select(this.selected.r, this.selected.c);
    }

    onClick(event) {
      if (event.target.closest("[data-add-table]")) {
        this.addTable();
        return;
      }
      const delTable = event.target.closest("[data-del-table]");
      if (delTable) {
        this.removeTable(delTable.dataset.delTable);
        return;
      }
      const block = event.target.closest("[data-table]");
      if (block) this.focusTable(block.dataset.table);

      const addCol = event.target.closest("[data-add-col]");
      if (addCol) {
        this.addColumn();
        return;
      }
      const addRow = event.target.closest("[data-add-row]");
      if (addRow) {
        this.addRow();
        return;
      }
      const delRow = event.target.closest("[data-del-row]");
      if (delRow) {
        this.removeRow(Number(delRow.dataset.delRow));
        return;
      }
      const delCol = event.target.closest("[data-del-col]");
      if (delCol) {
        this.removeColumn(Number(delCol.dataset.delCol));
        return;
      }
      const td = event.target.closest("td[data-r]");
      if (td) {
        const table = this.activeTable();
        const r = Number(td.dataset.r);
        const c = Number(td.dataset.c);
        const col = table.columns[c];
        if (col.type === "checkbox") {
          this.setCell(r, c, !this.cell(r, c));
          this.select(r, c);
          return;
        }
        if (this.selected.r === r && this.selected.c === c && !this.editing && col.type !== "select") {
          this.select(r, c, true);
        } else {
          this.select(r, c, col.type === "select" || col.type === "date");
        }
      }
    }

    onDblClick(event) {
      const td = event.target.closest("td[data-r]");
      if (!td) return;
      const block = event.target.closest("[data-table]");
      if (block) this.focusTable(block.dataset.table);
      this.select(Number(td.dataset.r), Number(td.dataset.c), true);
    }

    onKey(event) {
      if (event.target.closest(".db-title, .sheet__col-name, .sheet__col-type")) return;
      const table = this.activeTable();
      const { r, c } = this.selected;
      if (this.editing) {
        if (event.key === "Enter") {
          event.preventDefault();
          if (r === table.rows.length - 1) this.addRow(false);
          this.commitEdit("down");
        } else if (event.key === "Tab") {
          event.preventDefault();
          const dir = event.shiftKey ? -1 : 1;
          this.commitEdit();
          this.select(this.selected.r, this.selected.c + dir);
        } else if (event.key === "Escape") {
          event.preventDefault();
          this.editing = false;
          this.select(r, c);
        }
        return;
      }

      if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault();
        this.select(r, c, true);
      } else if (event.key === "Tab") {
        event.preventDefault();
        this.select(r, c + (event.shiftKey ? -1 : 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        this.select(r - 1, c);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        this.select(r + 1, c);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.select(r, c - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        this.select(r, c + 1);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const col = table.columns[c];
        this.setCell(r, c, col.type === "checkbox" ? false : "");
        this.select(r, c);
      } else if (event.key === " " && table.columns[c].type === "checkbox") {
        event.preventDefault();
        this.setCell(r, c, !this.cell(r, c));
        this.select(r, c);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const col = table.columns[c];
        if (col.type === "text" || col.type === "number") {
          this.setCell(r, c, event.key);
          this.select(r, c, true);
        }
      }
    }

    onField(event) {
      const typeSel = event.target.closest(".sheet__col-type");
      if (typeSel) {
        const block = event.target.closest("[data-table]");
        if (block) this.focusTable(block.dataset.table);
        const table = this.activeTable();
        const index = Number(typeSel.dataset.col);
        const col = table.columns[index];
        col.type = typeSel.value;
        if (col.type === "select" && !col.options) col.options = ["A fazer", "Feito"];
        for (const row of table.rows) {
          if (col.type === "checkbox") row[col.id] = Boolean(row[col.id]);
          else if (row[col.id] === true || row[col.id] === false) row[col.id] = "";
        }
        this.emit();
        this.render();
      }
    }

    onFocusOut(event) {
      const title = event.target.closest(".db-title");
      if (title) {
        const table = this.tableById(title.dataset.tableTitle);
        const next = title.value;
        if (table.title !== next) {
          table.title = next;
          this.emit();
        }
      }
      const name = event.target.closest(".sheet__col-name");
      if (name) {
        const block = event.target.closest("[data-table]");
        if (block) this.focusTable(block.dataset.table);
        const table = this.activeTable();
        const index = Number(name.dataset.col);
        const next = name.value.trim() || `Coluna ${index + 1}`;
        if (table.columns[index].name !== next) {
          table.columns[index].name = next;
          this.emit();
        }
      }
      if (this.editing && event.target.closest(".sheet__input, .sheet__select")) {
        const related = event.relatedTarget;
        if (related && this.el.contains(related) && related.closest(".sheet__input, .sheet__select")) return;
        this.commitEdit();
      }
    }

    addTable() {
      const table = window.emptyTable("Nova tabela");
      this.db.tables.push(table);
      this.selected = { tableId: table.id, r: 0, c: 0 };
      this.editing = false;
      this.emit();
      this.render();
      const input = this.el.querySelector(`[data-table-title="${table.id}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    }

    removeTable(id) {
      if (this.db.tables.length <= 1) return;
      this.db.tables = this.db.tables.filter((table) => table.id !== id);
      if (this.selected.tableId === id) {
        this.selected = { tableId: this.db.tables[0].id, r: 0, c: 0 };
      }
      this.editing = false;
      this.emit();
      this.render();
    }

    addRow(selectLast = true) {
      const table = this.activeTable();
      table.rows.push(window.emptyRow(table.columns));
      this.emit();
      if (selectLast) this.select(table.rows.length - 1, this.selected.c);
      else this.render();
    }

    addColumn() {
      const table = this.activeTable();
      const col = { id: window.uid(), name: `Coluna ${table.columns.length + 1}`, type: "text" };
      table.columns.push(col);
      for (const row of table.rows) row[col.id] = "";
      this.emit();
      this.select(this.selected.r, table.columns.length - 1);
    }

    removeRow(index) {
      const table = this.activeTable();
      if (table.rows.length <= 1) {
        table.rows[0] = window.emptyRow(table.columns);
        this.emit();
        this.select(0, 0);
        return;
      }
      table.rows.splice(index, 1);
      this.emit();
      this.select(Math.min(index, table.rows.length - 1), this.selected.c);
    }

    removeColumn(index) {
      const table = this.activeTable();
      if (table.columns.length <= 1) return;
      const [removed] = table.columns.splice(index, 1);
      for (const row of table.rows) delete row[removed.id];
      this.emit();
      this.select(this.selected.r, Math.min(index, table.columns.length - 1));
    }

    displayValue(col, value) {
      if (col.type === "checkbox") return "";
      if (value === null || value === undefined || value === "") return "";
      if (col.type === "number") return String(value);
      if (col.type === "date" && value) {
        const [y, m, d] = String(value).split("-");
        if (y && m && d) return `${d}/${m}/${y}`;
      }
      return String(value);
    }

    editorHtml(col, value) {
      if (col.type === "select") {
        const options = col.options || [];
        const items = options
          .map((opt) => `<option${opt === value ? " selected" : ""}>${escape(opt)}</option>`)
          .join("");
        return `<select class="sheet__select"><option value=""></option>${items}</select>`;
      }
      if (col.type === "date") {
        return `<input class="sheet__input" type="date" value="${escape(value || "")}">`;
      }
      if (col.type === "number") {
        return `<input class="sheet__input" type="number" value="${escape(value ?? "")}">`;
      }
      return `<input class="sheet__input" type="text" value="${escape(value ?? "")}">`;
    }

    renderTable(table) {
      const active = table.id === this.selected.tableId;
      const sr = active ? this.selected.r : -1;
      const sc = active ? this.selected.c : -1;
      const head = table.columns
        .map((col, c) => {
          const types = TYPES.map(
            (type) => `<option value="${type.id}"${type.id === col.type ? " selected" : ""}>${type.label}</option>`
          ).join("");
          return `<th>
            <div class="sheet__head">
              <input class="sheet__col-name" data-col="${c}" value="${escape(col.name)}">
              <select class="sheet__col-type" data-col="${c}">${types}</select>
              <button class="sheet__icon" type="button" data-del-col="${c}" title="Apagar coluna">×</button>
            </div>
          </th>`;
        })
        .join("");

      const body = table.rows
        .map((row, r) => {
          const cells = table.columns
            .map((col, c) => {
              const selected = r === sr && c === sc;
              const value = row[col.id];
              let inner;
              if (col.type === "checkbox") {
                inner = `<span class="sheet__check${value ? " is-on" : ""}">${value ? "✓" : ""}</span>`;
              } else if (selected && this.editing) {
                inner = this.editorHtml(col, value);
              } else if (col.type === "select" && value) {
                inner = `<span class="sheet__tag">${escape(String(value))}</span>`;
              } else {
                inner = escape(this.displayValue(col, value));
              }
              const extra = col.type === "number" ? " is-num" : "";
              return `<td class="${selected ? "is-selected" : ""}${extra}" data-r="${r}" data-c="${c}" tabindex="${selected ? 0 : -1}">${inner}</td>`;
            })
            .join("");
          return `<tr>
            <th class="sheet__rownum">
              <span>${r + 1}</span>
              <button class="sheet__icon" type="button" data-del-row="${r}" title="Apagar linha">×</button>
            </th>
            ${cells}
          </tr>`;
        })
        .join("");

      const canDelete = this.db.tables.length > 1
        ? `<button class="sheet__icon db-block__remove" type="button" data-del-table="${table.id}" title="Apagar tabela">×</button>`
        : "";

      return `<section class="db-block" data-table="${table.id}">
        <div class="db-block__head">
          <input class="db-title" data-table-title="${table.id}" placeholder="Sem título" value="${escape(table.title)}">
          <div class="sheet__toolbar">
            <button class="sheet__tool" type="button" data-add-col>+ Coluna</button>
            <button class="sheet__tool" type="button" data-add-row>+ Linha</button>
          </div>
          ${canDelete}
        </div>
        <div class="sheet" tabindex="0">
          <div class="sheet__scroll">
            <table>
              <thead>
                <tr>
                  <th class="sheet__corner"></th>
                  ${head}
                  <th class="sheet__add"><button type="button" data-add-col title="Nova coluna">+</button></th>
                </tr>
              </thead>
              <tbody>${body}</tbody>
            </table>
          </div>
        </div>
      </section>`;
    }

    render() {
      if (!this.el || !this.db) return;
      const blocks = this.db.tables.map((table) => this.renderTable(table)).join("");
      this.el.innerHTML = `
        <div class="db-page">
          ${blocks}
          <button class="db-add-table" type="button" data-add-table>+ Nova tabela</button>
        </div>`;
    }
  }

  function escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  window.TableView = TableView;
})();
