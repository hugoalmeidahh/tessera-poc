(() => {
  const STROKES = ["#1d1d1f", "#2f80ed", "#0f9d58", "#e2b203", "#e8590c", "#d1453b", "#8b5cf6"];
  const FILLS = ["transparent", "#dbeafe", "#dcfce7", "#fef3c7", "#ffedd5", "#fee2e2", "#ede9fe"];
  const WIDTHS = [2, 3.5, 6];
  const FONTS = [16, 22, 30];
  const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, system-ui, sans-serif';

  const SHAPE_TOOLS = new Set(["rect", "ellipse", "diamond", "line", "arrow", "draw", "text"]);
  const LABELED = new Set(["rect", "ellipse", "diamond"]);
  const SEGMENTS = new Set(["line", "arrow"]);

  const HANDLE = 9;
  const ROTATE_GAP = 24;
  const SNAP = 6;
  const HIT_PAD = 8;

  const view = { x: 0, y: 0, scale: 1 };
  const style = { stroke: STROKES[0], fill: "transparent", strokeWidth: WIDTHS[1], fontSize: FONTS[1] };

  let canvas = null;
  let ctx = null;
  let toolsEl = null;
  let styleEl = null;
  let historyEl = null;
  let zoomEl = null;
  let onChange = null;
  let mountKey = "";
  let doc = { type: "draw", version: 1, grid: true, elements: [] };
  let tool = "select";
  let selection = new Set();
  let drag = null;
  let editing = null;
  let guides = [];
  let observer = null;
  let undoStack = [];
  let redoStack = [];
  let baseline = null;
  let wired = false;

  function uid() {
    return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function selected() {
    return doc.elements.filter((el) => selection.has(el.id));
  }

  // O histórico guarda o estado ANTERIOR à mudança, por isso a baseline.
  function emit({ history = true } = {}) {
    if (history) {
      undoStack.push(baseline || clone(doc));
      if (undoStack.length > 80) undoStack.shift();
      redoStack = [];
    }
    baseline = clone(doc);
    syncHistoryButtons();
    onChange?.(clone(doc));
  }

  // Troca o conteúdo sem trocar o objeto: quem tem referência ao doc continua válido.
  function replaceDoc(next) {
    doc.grid = next.grid !== false;
    doc.elements = next.elements || [];
    doc.type = next.type || "draw";
    doc.version = next.version || 1;
    baseline = clone(doc);
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(clone(doc));
    replaceDoc(undoStack.pop());
    selection.clear();
    syncHistoryButtons();
    draw();
    onChange?.(clone(doc));
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(clone(doc));
    replaceDoc(redoStack.pop());
    selection.clear();
    syncHistoryButtons();
    draw();
    onChange?.(clone(doc));
  }

  function syncHistoryButtons() {
    if (!historyEl) return;
    const undoBtn = historyEl.querySelector('[data-draw-action="undo"]');
    const redoBtn = historyEl.querySelector('[data-draw-action="redo"]');
    if (undoBtn) undoBtn.disabled = !undoStack.length;
    if (redoBtn) redoBtn.disabled = !redoStack.length;
  }

  /* ------------------------------------------------------------- geometria */

  function toScene(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - view.x) / view.scale,
      y: (event.clientY - rect.top - view.y) / view.scale,
    };
  }

  function toScreen(point) {
    return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
  }

  // Caixa do elemento em coordenadas não rotacionadas, sempre com w/h positivos.
  function box(el) {
    if (el.type === "draw" && el.points?.length) {
      const xs = el.points.map((point) => el.x + point[0]);
      const ys = el.points.map((point) => el.y + point[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    if (el.type === "text") {
      const size = el.fontSize || style.fontSize;
      const lines = String(el.text || "").split("\n");
      const width = Math.max(...lines.map((line) => measure(line, size)), size * 0.6);
      return { x: el.x, y: el.y, w: width, h: lines.length * size * 1.25 };
    }
    return {
      x: Math.min(el.x, el.x + el.w),
      y: Math.min(el.y, el.y + el.h),
      w: Math.abs(el.w),
      h: Math.abs(el.h),
    };
  }

  function center(el) {
    const b = box(el);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  function rotate(point, origin, angle) {
    if (!angle) return { x: point.x, y: point.y };
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
  }

  function toLocal(point, el, origin) {
    return rotate(point, origin || center(el), -(el.angle || 0));
  }

  function corners(el) {
    const b = box(el);
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const angle = el.angle || 0;
    return [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x, y: b.y + b.h },
    ].map((point) => rotate(point, c, angle));
  }

  function aabb(el) {
    const points = corners(el);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function unionBox(boxes) {
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return {
      x,
      y,
      w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
      h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
    };
  }

  function distanceToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (!lengthSq) return Math.hypot(point.x - a.x, point.y - a.y);
    let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
  }

  function hits(el, point) {
    const pad = HIT_PAD / view.scale;
    const local = toLocal(point, el);
    if (el.type === "draw") {
      const points = el.points || [];
      for (let i = 1; i < points.length; i += 1) {
        const a = { x: el.x + points[i - 1][0], y: el.y + points[i - 1][1] };
        const b = { x: el.x + points[i][0], y: el.y + points[i][1] };
        if (distanceToSegment(local, a, b) <= pad) return true;
      }
      if (points.length === 1) {
        return Math.hypot(local.x - el.x - points[0][0], local.y - el.y - points[0][1]) <= pad;
      }
      return false;
    }
    if (SEGMENTS.has(el.type)) {
      return (
        distanceToSegment(local, { x: el.x, y: el.y }, { x: el.x + el.w, y: el.y + el.h }) <= pad
      );
    }
    const b = box(el);
    return (
      local.x >= b.x - pad &&
      local.x <= b.x + b.w + pad &&
      local.y >= b.y - pad &&
      local.y <= b.y + b.h + pad
    );
  }

  function hitTest(point) {
    for (let i = doc.elements.length - 1; i >= 0; i -= 1) {
      if (hits(doc.elements[i], point)) return doc.elements[i];
    }
    return null;
  }

  // Moldura da seleção: acompanha a rotação quando é um único elemento.
  function frame() {
    const items = selected();
    if (!items.length) return null;
    if (items.length === 1) {
      const el = items[0];
      const b = box(el);
      return { ...b, angle: el.angle || 0, cx: b.x + b.w / 2, cy: b.y + b.h / 2, single: el };
    }
    const b = unionBox(items.map(aabb));
    return { ...b, angle: 0, cx: b.x + b.w / 2, cy: b.y + b.h / 2, single: null };
  }

  function framePoints(box2) {
    const origin = { x: box2.cx, y: box2.cy };
    const spots = {
      nw: { x: box2.x, y: box2.y },
      n: { x: box2.x + box2.w / 2, y: box2.y },
      ne: { x: box2.x + box2.w, y: box2.y },
      e: { x: box2.x + box2.w, y: box2.y + box2.h / 2 },
      se: { x: box2.x + box2.w, y: box2.y + box2.h },
      s: { x: box2.x + box2.w / 2, y: box2.y + box2.h },
      sw: { x: box2.x, y: box2.y + box2.h },
      w: { x: box2.x, y: box2.y + box2.h / 2 },
    };
    const out = {};
    for (const [name, point] of Object.entries(spots)) out[name] = rotate(point, origin, box2.angle);
    out.rotate = rotate(
      { x: box2.x + box2.w / 2, y: box2.y - ROTATE_GAP / view.scale },
      origin,
      box2.angle
    );
    return out;
  }

  function handleAt(point) {
    const box2 = frame();
    if (!box2) return null;
    const reach = (HANDLE + 2) / view.scale;
    const points = framePoints(box2);
    if (box2.single && Math.hypot(point.x - points.rotate.x, point.y - points.rotate.y) <= reach) {
      return { name: "rotate", frame: box2 };
    }
    for (const name of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const spot = points[name];
      if (Math.abs(point.x - spot.x) <= reach && Math.abs(point.y - spot.y) <= reach) {
        return { name, frame: box2 };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ snap */

  function snapTargets() {
    const xs = [];
    const ys = [];
    for (const el of doc.elements) {
      if (selection.has(el.id)) continue;
      const b = aabb(el);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { xs, ys };
  }

  function snapDelta(moving, targets) {
    const threshold = SNAP / view.scale;
    const mine = {
      xs: [moving.x, moving.x + moving.w / 2, moving.x + moving.w],
      ys: [moving.y, moving.y + moving.h / 2, moving.y + moving.h],
    };
    let best = { dx: 0, dy: 0 };
    let bestX = threshold;
    let bestY = threshold;
    const lines = [];
    for (const mineX of mine.xs) {
      for (const targetX of targets.xs) {
        const delta = targetX - mineX;
        if (Math.abs(delta) < bestX) {
          bestX = Math.abs(delta);
          best.dx = delta;
        }
      }
    }
    for (const mineY of mine.ys) {
      for (const targetY of targets.ys) {
        const delta = targetY - mineY;
        if (Math.abs(delta) < bestY) {
          bestY = Math.abs(delta);
          best.dy = delta;
        }
      }
    }
    const moved = { x: moving.x + best.dx, y: moving.y + best.dy, w: moving.w, h: moving.h };
    for (const value of [moved.x, moved.x + moved.w / 2, moved.x + moved.w]) {
      if (targets.xs.some((target) => Math.abs(target - value) < 0.01)) {
        lines.push({ axis: "x", at: value });
      }
    }
    for (const value of [moved.y, moved.y + moved.h / 2, moved.y + moved.h]) {
      if (targets.ys.some((target) => Math.abs(target - value) < 0.01)) {
        lines.push({ axis: "y", at: value });
      }
    }
    return { ...best, lines };
  }

  /* -------------------------------------------------------------- desenho */

  let scratch = null;

  function measure(text, size) {
    if (!scratch) scratch = document.createElement("canvas").getContext("2d");
    scratch.font = `${size}px ${FONT_STACK}`;
    return scratch.measureText(text).width;
  }

  function wrapText(text, maxWidth, size) {
    const out = [];
    for (const paragraph of String(text || "").split("\n")) {
      if (!paragraph) {
        out.push("");
        continue;
      }
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next, size) > maxWidth) {
          out.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      out.push(line);
    }
    return out;
  }

  function resize() {
    if (!canvas?.parentElement) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function isDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function drawGrid(width, height) {
    if (!doc.grid) return;
    const step = 20 * view.scale;
    if (step < 7) return;
    const startX = ((view.x % step) + step) % step;
    const startY = ((view.y % step) + step) % step;
    ctx.fillStyle = isDark() ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.15)";
    const radius = view.scale >= 1 ? 1.1 : 0.9;
    for (let x = startX; x < width; x += step) {
      for (let y = startY; y < height; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function paintLabel(el) {
    const text = String(el.label || "");
    if (!text.trim()) return;
    const b = box(el);
    const size = el.labelSize || Math.min(el.fontSize || style.fontSize, 22);
    const lines = wrapText(text, Math.max(24, b.w - 16), size);
    ctx.fillStyle = el.stroke || style.stroke;
    ctx.font = `${size}px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lineHeight = size * 1.25;
    const top = b.y + b.h / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, b.x + b.w / 2, top + i * lineHeight));
    ctx.textAlign = "left";
  }

  function paintElement(el) {
    const c = center(el);
    ctx.save();
    if (el.angle) {
      ctx.translate(c.x, c.y);
      ctx.rotate(el.angle);
      ctx.translate(-c.x, -c.y);
    }
    ctx.lineWidth = el.strokeWidth || style.strokeWidth;
    ctx.strokeStyle = el.stroke || style.stroke;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const filled = el.fill && el.fill !== "transparent";
    if (filled) ctx.fillStyle = el.fill;
    const b = box(el);

    if (el.type === "rect") {
      roundRect(b.x, b.y, b.w, b.h, 10);
      if (filled) ctx.fill();
      ctx.stroke();
      paintLabel(el);
    } else if (el.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      if (filled) ctx.fill();
      ctx.stroke();
      paintLabel(el);
    } else if (el.type === "diamond") {
      ctx.beginPath();
      ctx.moveTo(b.x + b.w / 2, b.y);
      ctx.lineTo(b.x + b.w, b.y + b.h / 2);
      ctx.lineTo(b.x + b.w / 2, b.y + b.h);
      ctx.lineTo(b.x, b.y + b.h / 2);
      ctx.closePath();
      if (filled) ctx.fill();
      ctx.stroke();
      paintLabel(el);
    } else if (SEGMENTS.has(el.type)) {
      ctx.beginPath();
      ctx.moveTo(el.x, el.y);
      ctx.lineTo(el.x + el.w, el.y + el.h);
      ctx.stroke();
      if (el.type === "arrow") {
        const angle = Math.atan2(el.h, el.w);
        const size = 9 + (el.strokeWidth || style.strokeWidth) * 2.2;
        const tipX = el.x + el.w;
        const tipY = el.y + el.h;
        ctx.beginPath();
        ctx.moveTo(tipX - size * Math.cos(angle - 0.42), tipY - size * Math.sin(angle - 0.42));
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(tipX - size * Math.cos(angle + 0.42), tipY - size * Math.sin(angle + 0.42));
        ctx.stroke();
      }
    } else if (el.type === "draw") {
      const points = el.points || [];
      if (points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(el.x + points[0][0], el.y + points[0][1]);
        for (let i = 1; i < points.length; i += 1) {
          const prev = points[i - 1];
          const point = points[i];
          const midX = el.x + (prev[0] + point[0]) / 2;
          const midY = el.y + (prev[1] + point[1]) / 2;
          ctx.quadraticCurveTo(el.x + prev[0], el.y + prev[1], midX, midY);
        }
        ctx.stroke();
      } else if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(el.x + points[0][0], el.y + points[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = el.stroke || style.stroke;
        ctx.fill();
      }
    } else if (el.type === "text") {
      const size = el.fontSize || style.fontSize;
      ctx.fillStyle = el.stroke || style.stroke;
      ctx.font = `${size}px ${FONT_STACK}`;
      ctx.textBaseline = "top";
      String(el.text || "")
        .split("\n")
        .forEach((line, i) => ctx.fillText(line, el.x, el.y + i * size * 1.25));
    }
    ctx.restore();
  }

  function paintChrome() {
    const accent = isDark() ? "#4a94f8" : "#2f80ed";

    if (guides.length) {
      ctx.save();
      ctx.strokeStyle = "#e857c8";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      for (const guide of guides) {
        const at = toScreen({ x: guide.at, y: guide.at });
        ctx.beginPath();
        if (guide.axis === "x") {
          ctx.moveTo(at.x, 0);
          ctx.lineTo(at.x, canvas.clientHeight);
        } else {
          ctx.moveTo(0, at.y);
          ctx.lineTo(canvas.clientWidth, at.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    if (drag?.marquee) {
      const a = toScreen(drag.marquee);
      ctx.save();
      ctx.fillStyle = isDark() ? "rgba(74,148,248,.14)" : "rgba(47,128,237,.1)";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.fillRect(a.x, a.y, drag.marquee.w * view.scale, drag.marquee.h * view.scale);
      ctx.strokeRect(a.x, a.y, drag.marquee.w * view.scale, drag.marquee.h * view.scale);
      ctx.restore();
    }

    const box2 = frame();
    if (!box2 || editing) return;
    const points = framePoints(box2);
    const outline = [points.nw, points.ne, points.se, points.sw].map(toScreen);

    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(outline[0].x, outline[0].y);
    for (let i = 1; i < outline.length; i += 1) ctx.lineTo(outline[i].x, outline[i].y);
    ctx.closePath();
    ctx.stroke();

    if (box2.single) {
      const rotateAt = toScreen(points.rotate);
      const top = toScreen(points.n);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(rotateAt.x, rotateAt.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rotateAt.x, rotateAt.y, HANDLE / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = "#ffffff";
    for (const name of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const spot = toScreen(points[name]);
      ctx.beginPath();
      ctx.rect(spot.x - HANDLE / 2, spot.y - HANDLE / 2, HANDLE, HANDLE);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    if (!ctx || !canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    drawGrid(width, height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    for (const el of doc.elements) paintElement(el);
    if (drag?.preview) paintElement(drag.preview);
    ctx.restore();
    paintChrome();
    renderStylePanel();
    syncZoomLabel();
  }

  /* -------------------------------------------------------------- ponteiro */

  function onPointerDown(event) {
    if (editing) stopTextEdit({ commit: true });

    if (event.button === 1 || tool === "hand" || event.altKey) {
      drag = {
        kind: "pan",
        startX: event.clientX,
        startY: event.clientY,
        originX: view.x,
        originY: view.y,
      };
      canvas.classList.add("is-panning");
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    const point = toScene(event);

    if (tool === "eraser") {
      drag = { kind: "erase", removed: false };
      canvas.setPointerCapture(event.pointerId);
      eraseAt(point);
      return;
    }

    if (tool === "select") {
      const handle = handleAt(point);
      if (handle) {
        drag = {
          kind: handle.name === "rotate" ? "rotate" : "resize",
          handle: handle.name,
          frame: handle.frame,
          before: clone(selected()),
          startAngle: Math.atan2(point.y - handle.frame.cy, point.x - handle.frame.cx),
        };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      const hit = hitTest(point);
      if (hit) {
        if (event.shiftKey) {
          if (selection.has(hit.id)) selection.delete(hit.id);
          else selection.add(hit.id);
        } else if (!selection.has(hit.id)) {
          selection = new Set([hit.id]);
        }
        drag = {
          kind: "move",
          start: point,
          origin: point,
          before: clone(selected()),
          targets: snapTargets(),
          moved: false,
        };
        canvas.setPointerCapture(event.pointerId);
        draw();
        return;
      }
      selection.clear();
      drag = { kind: "marquee", start: point, marquee: { x: point.x, y: point.y, w: 0, h: 0 } };
      canvas.setPointerCapture(event.pointerId);
      draw();
      return;
    }

    if (tool === "text") {
      // Sem isto o foco do textarea volta para o canvas na ação padrão do mousedown.
      event.preventDefault();
      const el = {
        id: uid(),
        type: "text",
        x: point.x,
        y: point.y,
        w: 0,
        h: 0,
        angle: 0,
        text: "",
        fontSize: style.fontSize,
        stroke: style.stroke,
      };
      doc.elements.push(el);
      selection = new Set([el.id]);
      setTool("select");
      startTextEdit(el, "text", { created: true });
      return;
    }

    const el = {
      id: uid(),
      type: tool,
      x: point.x,
      y: point.y,
      w: 0,
      h: 0,
      angle: 0,
      stroke: style.stroke,
      fill: style.fill,
      strokeWidth: style.strokeWidth,
    };
    if (tool === "draw") el.points = [[0, 0]];
    drag = { kind: "create", preview: el, start: point, targets: snapTargets() };
    canvas.setPointerCapture(event.pointerId);
  }

  function eraseAt(point) {
    const hit = hitTest(point);
    if (!hit) return;
    doc.elements = doc.elements.filter((el) => el.id !== hit.id);
    selection.delete(hit.id);
    if (drag) drag.removed = true;
    draw();
  }

  function applyResize(point, event) {
    const base = drag.frame;
    const origin = { x: base.cx, y: base.cy };
    const local = rotate(point, origin, -base.angle);
    const handle = drag.handle;
    const west = handle.includes("w");
    const east = handle.includes("e");
    const north = handle.includes("n");
    const south = handle.includes("s");

    let left = base.x;
    let right = base.x + base.w;
    let top = base.y;
    let bottom = base.y + base.h;
    if (west) left = Math.min(local.x, right - 1);
    if (east) right = Math.max(local.x, left + 1);
    if (north) top = Math.min(local.y, bottom - 1);
    if (south) bottom = Math.max(local.y, top + 1);

    if (event.shiftKey && base.w && base.h && (west || east) && (north || south)) {
      const ratio = base.h / base.w;
      const width = right - left;
      const height = width * ratio;
      if (north) top = bottom - height;
      else bottom = top + height;
    }

    const nextW = right - left;
    const nextH = bottom - top;
    const scaleX = base.w ? nextW / base.w : 1;
    const scaleY = base.h ? nextH / base.h : 1;

    for (const el of doc.elements) {
      if (!selection.has(el.id)) continue;
      const before = drag.before.find((item) => item.id === el.id);
      if (!before) continue;
      const beforeBox = box(before);
      // posição relativa dentro da moldura antiga, preservada na nova
      const relX = base.w ? (beforeBox.x - base.x) / base.w : 0;
      const relY = base.h ? (beforeBox.y - base.y) / base.h : 0;
      const nextBoxX = left + relX * nextW;
      const nextBoxY = top + relY * nextH;
      const nextBoxW = beforeBox.w * scaleX;
      const nextBoxH = beforeBox.h * scaleY;

      if (SEGMENTS.has(el.type)) {
        const flipX = Math.sign(before.w || 1);
        const flipY = Math.sign(before.h || 1);
        el.w = Math.abs(before.w) * scaleX * flipX;
        el.h = Math.abs(before.h) * scaleY * flipY;
        el.x = before.w >= 0 ? nextBoxX : nextBoxX + nextBoxW;
        el.y = before.h >= 0 ? nextBoxY : nextBoxY + nextBoxH;
      } else if (el.type === "draw") {
        el.points = before.points.map(([px, py]) => [px * scaleX, py * scaleY]);
        const shiftedX = Math.min(...el.points.map(([px]) => px));
        const shiftedY = Math.min(...el.points.map(([, py]) => py));
        el.x = nextBoxX - shiftedX;
        el.y = nextBoxY - shiftedY;
      } else if (el.type === "text") {
        el.fontSize = Math.max(8, (before.fontSize || style.fontSize) * Math.max(scaleX, scaleY));
        el.x = nextBoxX;
        el.y = nextBoxY;
      } else {
        el.x = nextBoxX;
        el.y = nextBoxY;
        el.w = nextBoxW;
        el.h = nextBoxH;
      }

      // Com rotação, mexer na caixa move o pivô: compensa para a alça oposta ficar parada.
      if (el.angle) {
        const oldCenter = { x: beforeBox.x + beforeBox.w / 2, y: beforeBox.y + beforeBox.h / 2 };
        const nextBox = box(el);
        const newCenter = { x: nextBox.x + nextBox.w / 2, y: nextBox.y + nextBox.h / 2 };
        const shift = { x: newCenter.x - oldCenter.x, y: newCenter.y - oldCenter.y };
        const spun = rotate(shift, { x: 0, y: 0 }, el.angle);
        el.x += spun.x - shift.x;
        el.y += spun.y - shift.y;
      }
    }
    draw();
  }

  function onPointerMove(event) {
    if (!drag) return;
    if (drag.kind === "pan") {
      view.x = drag.originX + (event.clientX - drag.startX);
      view.y = drag.originY + (event.clientY - drag.startY);
      draw();
      return;
    }
    const point = toScene(event);

    if (drag.kind === "erase") {
      eraseAt(point);
      return;
    }

    if (drag.kind === "create") {
      const el = drag.preview;
      if (el.type === "draw") {
        el.points.push([point.x - el.x, point.y - el.y]);
      } else {
        el.w = point.x - drag.start.x;
        el.h = point.y - drag.start.y;
        if (event.shiftKey) {
          if (SEGMENTS.has(el.type)) {
            if (Math.abs(el.w) > Math.abs(el.h)) el.h = 0;
            else el.w = 0;
          } else {
            const side = Math.max(Math.abs(el.w), Math.abs(el.h));
            el.w = Math.sign(el.w || 1) * side;
            el.h = Math.sign(el.h || 1) * side;
          }
        }
        if (!event.metaKey && !event.ctrlKey && !SEGMENTS.has(el.type)) {
          const snap = snapDelta(box(el), drag.targets);
          guides = snap.lines;
        }
      }
      draw();
      return;
    }

    if (drag.kind === "move") {
      let dx = point.x - drag.origin.x;
      let dy = point.y - drag.origin.y;
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      for (const el of doc.elements) {
        if (!selection.has(el.id)) continue;
        const before = drag.before.find((item) => item.id === el.id);
        if (!before) continue;
        el.x = before.x + dx;
        el.y = before.y + dy;
      }
      if (!event.metaKey && !event.ctrlKey) {
        const moving = unionBox(selected().map(aabb));
        const snap = snapDelta(moving, drag.targets);
        if (snap.dx || snap.dy) {
          for (const el of selected()) {
            el.x += snap.dx;
            el.y += snap.dy;
          }
        }
        guides = snap.lines;
      } else {
        guides = [];
      }
      drag.moved = Boolean(dx || dy);
      draw();
      return;
    }

    if (drag.kind === "resize") {
      applyResize(point, event);
      return;
    }

    if (drag.kind === "rotate") {
      const base = drag.frame;
      const now = Math.atan2(point.y - base.cy, point.x - base.cx);
      let delta = now - drag.startAngle;
      const el = doc.elements.find((item) => selection.has(item.id));
      const before = drag.before[0];
      if (!el || !before) return;
      let next = (before.angle || 0) + delta;
      if (event.shiftKey) {
        const step = Math.PI / 12;
        next = Math.round(next / step) * step;
      }
      el.angle = next;
      draw();
      return;
    }

    if (drag.kind === "marquee") {
      drag.marquee = {
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        w: Math.abs(point.x - drag.start.x),
        h: Math.abs(point.y - drag.start.y),
      };
      const area = drag.marquee;
      selection = new Set(
        doc.elements
          .filter((el) => {
            const b = aabb(el);
            return (
              b.x + b.w >= area.x &&
              b.x <= area.x + area.w &&
              b.y + b.h >= area.y &&
              b.y <= area.y + area.h
            );
          })
          .map((el) => el.id)
      );
      draw();
    }
  }

  function onPointerUp(event) {
    if (!drag) return;
    const finished = drag;
    drag = null;
    guides = [];
    canvas.classList.remove("is-panning");
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);

    if (finished.kind === "create") {
      const el = finished.preview;
      const b = box(el);
      if (el.type === "draw" && (el.points?.length || 0) < 2 && b.w < 2 && b.h < 2) {
        draw();
        return;
      }
      if (b.w < 4 && b.h < 4 && el.type !== "draw") {
        if (SEGMENTS.has(el.type)) {
          el.w = 110;
          el.h = 0;
        } else {
          el.w = 140;
          el.h = 90;
        }
      }
      doc.elements.push(el);
      selection = new Set([el.id]);
      setTool("select");
      emit();
      draw();
      return;
    }
    if (finished.kind === "move" && finished.moved) emit();
    if (finished.kind === "resize" || finished.kind === "rotate") emit();
    if (finished.kind === "erase" && finished.removed) emit();
    draw();
  }

  function onWheel(event) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 0.89);
      return;
    }
    view.x -= event.deltaX;
    view.y -= event.deltaY;
    draw();
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const next = Math.min(8, Math.max(0.1, view.scale * factor));
    view.x = px - ((px - view.x) * next) / view.scale;
    view.y = py - ((py - view.y) * next) / view.scale;
    view.scale = next;
    draw();
  }

  function zoomToFit() {
    if (!doc.elements.length) {
      view.x = 0;
      view.y = 0;
      view.scale = 1;
      draw();
      return;
    }
    const content = unionBox(doc.elements.map(aabb));
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const padding = 80;
    const scale = Math.min(
      2,
      Math.max(0.1, Math.min((width - padding) / (content.w || 1), (height - padding) / (content.h || 1)))
    );
    view.scale = scale;
    view.x = width / 2 - (content.x + content.w / 2) * scale;
    view.y = height / 2 - (content.y + content.h / 2) * scale;
    draw();
  }

  function syncZoomLabel() {
    const label = zoomEl?.querySelector('[data-draw-action="zoom-reset"]');
    if (label) label.textContent = `${Math.round(view.scale * 100)}%`;
  }

  /* ---------------------------------------------------------- edição texto */

  function startTextEdit(el, field, { created = false } = {}) {
    if (!canvas?.parentElement) return;
    const host = canvas.parentElement;
    const input = document.createElement("textarea");
    input.className = field === "label" ? "draw-text-input draw-text-input--label" : "draw-text-input";
    input.value = String(el[field] || "");
    input.spellcheck = false;
    editing = { el, field, input, created, initial: input.value };

    const place = () => {
      const b = box(el);
      const size =
        field === "label"
          ? el.labelSize || Math.min(el.fontSize || style.fontSize, 22)
          : el.fontSize || style.fontSize;
      const scaled = size * view.scale;
      input.style.fontSize = `${scaled}px`;
      input.style.color = el.stroke || style.stroke;
      if (field === "label") {
        const at = toScreen({ x: b.x, y: b.y });
        input.style.left = `${at.x + 8 * view.scale}px`;
        input.style.width = `${Math.max(24, b.w * view.scale - 16 * view.scale)}px`;
        const lines = Math.max(1, input.value.split("\n").length);
        const height = lines * scaled * 1.25;
        input.style.height = `${height}px`;
        input.style.top = `${at.y + (b.h * view.scale - height) / 2}px`;
      } else {
        const at = toScreen({ x: el.x, y: el.y });
        input.style.left = `${at.x}px`;
        input.style.top = `${at.y}px`;
        const lines = input.value.split("\n");
        const width = Math.max(...lines.map((line) => measure(line, size)), size * 0.6);
        input.style.width = `${width * view.scale + scaled}px`;
        input.style.height = `${lines.length * scaled * 1.25}px`;
      }
    };

    place();
    host.appendChild(input);
    // O foco tem de esperar um frame: a ação padrão do pointerdown ainda vai mexer no foco.
    requestAnimationFrame(() => {
      if (editing?.input !== input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });

    input.addEventListener("blur", () => stopTextEdit({ commit: true }));
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        stopTextEdit({ commit: false });
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        stopTextEdit({ commit: true });
      }
    });
    input.addEventListener("input", () => {
      el[field] = input.value;
      place();
      draw();
    });
    draw();
  }

  function stopTextEdit({ commit = true } = {}) {
    if (!editing) return;
    const { el, field, input, created, initial } = editing;
    editing = null;
    input.remove();
    if (!commit) el[field] = initial;
    const empty = !String(el[field] || "").trim();
    if (field === "text" && empty) {
      doc.elements = doc.elements.filter((item) => item.id !== el.id);
      selection.delete(el.id);
      if (!created) emit();
      draw();
      return;
    }
    if (String(el[field] || "") !== initial || (created && !empty)) emit();
    draw();
  }

  function editSelection() {
    const items = selected();
    if (items.length !== 1) return;
    const el = items[0];
    if (el.type === "text") startTextEdit(el, "text");
    else if (LABELED.has(el.type)) startTextEdit(el, "label");
  }

  /* -------------------------------------------------------------- toolbar */

  function setTool(next) {
    tool = next;
    toolsEl?.querySelectorAll("[data-tool]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tool === tool);
    });
    if (canvas) canvas.dataset.tool = tool;
    renderStylePanel();
  }

  function renderStylePanel() {
    if (!styleEl) return;
    const items = selected();
    const showing = items.length > 0 || SHAPE_TOOLS.has(tool);
    styleEl.hidden = !showing;
    if (!showing) return;

    const strokeBox = styleEl.querySelector("#draw-stroke");
    if (strokeBox && !strokeBox.dataset.ready) {
      strokeBox.dataset.ready = "1";
      strokeBox.innerHTML = STROKES.map(
        (color) => `<button type="button" data-stroke="${color}" style="background:${color}"></button>`
      ).join("");
      const fillBox = styleEl.querySelector("#draw-fill");
      fillBox.innerHTML = FILLS.map(
        (color) =>
          `<button type="button" data-fill="${color}" class="${
            color === "transparent" ? "is-empty" : ""
          }" style="background:${color === "transparent" ? "transparent" : color}"></button>`
      ).join("");
      const widthBox = styleEl.querySelector("#draw-width");
      widthBox.innerHTML = WIDTHS.map(
        (width) => `<button type="button" data-width="${width}"><span style="height:${width}px"></span></button>`
      ).join("");
      const fontBox = styleEl.querySelector("#draw-font");
      fontBox.innerHTML = FONTS.map(
        (size, i) => `<button type="button" data-font="${size}">${["P", "M", "G"][i]}</button>`
      ).join("");
    }

    const textish = items.length
      ? items.some((el) => el.type === "text" || LABELED.has(el.type))
      : tool === "text" || LABELED.has(tool);
    const fontRow = styleEl.querySelector("#draw-font-row");
    if (fontRow) fontRow.hidden = !textish;

    styleEl.querySelectorAll("[data-stroke]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.stroke === style.stroke);
    });
    styleEl.querySelectorAll("[data-fill]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.fill === style.fill);
    });
    styleEl.querySelectorAll("[data-width]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.width) === style.strokeWidth);
    });
    styleEl.querySelectorAll("[data-font]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.font) === style.fontSize);
    });
  }

  function applyStyle(patch) {
    Object.assign(style, patch);
    const items = selected();
    if (items.length) {
      for (const el of items) {
        if (patch.stroke !== undefined) el.stroke = patch.stroke;
        if (patch.fill !== undefined) el.fill = patch.fill;
        if (patch.strokeWidth !== undefined) el.strokeWidth = patch.strokeWidth;
        if (patch.fontSize !== undefined) {
          if (el.type === "text") el.fontSize = patch.fontSize;
          else if (LABELED.has(el.type)) el.labelSize = patch.fontSize;
        }
      }
      emit();
    }
    draw();
  }

  function duplicateSelection() {
    const copies = selected().map((el) => ({ ...clone(el), id: uid(), x: el.x + 16, y: el.y + 16 }));
    if (!copies.length) return;
    doc.elements.push(...copies);
    selection = new Set(copies.map((el) => el.id));
    emit();
    draw();
  }

  function deleteSelection() {
    if (!selection.size) return;
    doc.elements = doc.elements.filter((el) => !selection.has(el.id));
    selection.clear();
    emit();
    draw();
  }

  function reorder(toFront) {
    const items = selected();
    if (!items.length) return;
    const rest = doc.elements.filter((el) => !selection.has(el.id));
    doc.elements = toFront ? [...rest, ...items] : [...items, ...rest];
    emit();
    draw();
  }

  function nudge(dx, dy) {
    const items = selected();
    if (!items.length) return;
    for (const el of items) {
      el.x += dx;
      el.y += dy;
    }
    emit();
    draw();
  }

  function action(name) {
    if (name === "grid") {
      doc.grid = !doc.grid;
      historyEl?.querySelector('[data-draw-action="grid"]')?.classList.toggle("is-active", doc.grid);
      emit();
      draw();
      return;
    }
    if (name === "undo") undo();
    if (name === "redo") redo();
    if (name === "zoom-in") zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.15);
    if (name === "zoom-out") zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 0.87);
    if (name === "zoom-reset") {
      view.scale = 1;
      draw();
    }
    if (name === "zoom-fit") zoomToFit();
    if (name === "duplicate") duplicateSelection();
    if (name === "delete") deleteSelection();
    if (name === "front") reorder(true);
    if (name === "back") reorder(false);
  }

  function onKeyDown(event) {
    if (!canvas || canvas.parentElement.hidden || editing) return;
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;

    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === "d") {
      event.preventDefault();
      duplicateSelection();
      return;
    }
    if (mod && key === "a") {
      event.preventDefault();
      selection = new Set(doc.elements.map((el) => el.id));
      draw();
      return;
    }
    if (mod) return;

    if (event.key === "Delete" || event.key === "Backspace") {
      if (!selection.size) return;
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (event.key === "Enter") {
      if (!selection.size) return;
      event.preventDefault();
      editSelection();
      return;
    }
    if (event.key.startsWith("Arrow")) {
      if (!selection.size) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowLeft") nudge(-step, 0);
      if (event.key === "ArrowRight") nudge(step, 0);
      if (event.key === "ArrowUp") nudge(0, -step);
      if (event.key === "ArrowDown") nudge(0, step);
      return;
    }
    if (event.key === "Escape") {
      selection.clear();
      draw();
      return;
    }
    if (event.shiftKey && event.key === "!") {
      event.preventDefault();
      zoomToFit();
      return;
    }

    const byLetter = {
      v: "select",
      h: "hand",
      r: "rect",
      o: "ellipse",
      d: "diamond",
      a: "arrow",
      l: "line",
      p: "draw",
      t: "text",
      e: "eraser",
    };
    const byNumber = ["select", "hand", "rect", "ellipse", "diamond", "arrow", "line", "draw", "text", "eraser"];
    if (byLetter[key]) {
      setTool(byLetter[key]);
      return;
    }
    const digit = Number(event.key);
    if (digit >= 1 && digit <= byNumber.length) setTool(byNumber[digit - 1]);
  }

  function wire() {
    if (wired) return;
    wired = true;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", (event) => {
      event.preventDefault();
      const hit = hitTest(toScene(event));
      if (!hit) return;
      selection = new Set([hit.id]);
      if (hit.type === "text") startTextEdit(hit, "text");
      else if (LABELED.has(hit.type)) startTextEdit(hit, "label");
      else draw();
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    const onPanelClick = (event) => {
      const toolButton = event.target.closest("[data-tool]");
      if (toolButton) {
        setTool(toolButton.dataset.tool);
        return;
      }
      const stroke = event.target.closest("[data-stroke]");
      if (stroke) return applyStyle({ stroke: stroke.dataset.stroke });
      const fill = event.target.closest("[data-fill]");
      if (fill) return applyStyle({ fill: fill.dataset.fill });
      const width = event.target.closest("[data-width]");
      if (width) return applyStyle({ strokeWidth: Number(width.dataset.width) });
      const font = event.target.closest("[data-font]");
      if (font) return applyStyle({ fontSize: Number(font.dataset.font) });
      const actionButton = event.target.closest("[data-draw-action]");
      if (actionButton) action(actionButton.dataset.drawAction);
      return undefined;
    };
    for (const panel of [toolsEl, styleEl, historyEl, zoomEl]) {
      panel?.addEventListener("click", onPanelClick);
      // Impede que o clique nos painéis derrube o foco/seleção do canvas.
      panel?.addEventListener("pointerdown", (event) => event.stopPropagation());
    }

    document.addEventListener("keydown", onKeyDown);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  }

  function mount(options) {
    canvas = options.canvas;
    toolsEl = options.toolsEl;
    styleEl = options.styleEl;
    historyEl = options.historyEl;
    zoomEl = options.zoomEl;
    onChange = options.onChange;
    wire();
    if (mountKey !== options.key) {
      mountKey = options.key;
      doc = options.doc;
      if (!Array.isArray(doc.elements)) doc.elements = [];
      selection = new Set();
      undoStack = [];
      redoStack = [];
      baseline = clone(doc);
      view.x = 0;
      view.y = 0;
      view.scale = 1;
      setTool("select");
      historyEl
        ?.querySelector('[data-draw-action="grid"]')
        ?.classList.toggle("is-active", doc.grid !== false);
      syncHistoryButtons();
    }
    if (!observer && typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => resize());
      observer.observe(canvas.parentElement);
    }
    resize();
  }

  function unmount() {
    stopTextEdit({ commit: true });
    mountKey = "";
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  window.DrawEditor = {
    mount,
    unmount,
    setTool,
    action,
    isMounted: () => Boolean(mountKey),
  };
})();
