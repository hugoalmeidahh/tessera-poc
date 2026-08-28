(() => {
  const COLORS = {
    md: "#1a6fd4",
    txt: "#8e8e93",
    html: "#d1453b",
    db: "#1f8b4c",
    draw: "#7a4dd6",
    pdf: "#b0740f",
    folder: "#a1a1a6",
  };

  let canvas = null;
  let ctx = null;
  let nodes = [];
  let edges = [];
  let frame = 0;
  let alpha = 1;
  let hover = null;
  let dragging = null;
  const view = { x: 0, y: 0, scale: 1 };
  let onOpen = null;
  let observer = null;

  function isDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function ensureCanvas(container) {
    if (canvas && canvas.parentElement === container) return;
    container.innerHTML = "";
    canvas = document.createElement("canvas");
    canvas.className = "graph__canvas";
    container.appendChild(canvas);
    ctx = canvas.getContext("2d");
    wire();
    if (typeof ResizeObserver === "function") {
      observer?.disconnect();
      observer = new ResizeObserver(resize);
      observer.observe(container);
    }
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
  }

  function radius(node) {
    return node.kind === "folder" ? 5 : Math.min(16, 4 + Math.sqrt(node.refs + node.out) * 3);
  }

  function tick() {
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 600;
    const centerX = width / 2;
    const centerY = height / 2;

    for (const node of nodes) {
      node.vx = (node.vx || 0) * 0.86;
      node.vy = (node.vy || 0) * 0.86;
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        if (dist > 320) continue;
        if (dist < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dist = 1;
        }
        const force = (2400 * alpha) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    for (const edge of edges) {
      const a = edge.source;
      const b = edge.target;
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const target = edge.kind === "tree" ? 70 : 110;
      const force = (dist - target) * 0.03 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of nodes) {
      node.vx += (centerX - node.x) * 0.004 * alpha;
      node.vy += (centerY - node.y) * 0.004 * alpha;
      if (node === dragging) continue;
      node.x += Math.max(-12, Math.min(12, node.vx));
      node.y += Math.max(-12, Math.min(12, node.vy));
    }

    alpha *= 0.985;
  }

  function paint() {
    if (!ctx || !canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    for (const edge of edges) {
      const a = edge.source;
      const b = edge.target;
      if (!a || !b) continue;
      const isLink = edge.kind === "link";
      ctx.strokeStyle = isDark()
        ? isLink
          ? "rgba(120,180,255,.55)"
          : "rgba(255,255,255,.12)"
        : isLink
          ? "rgba(26,111,212,.45)"
          : "rgba(0,0,0,.12)";
      ctx.lineWidth = isLink ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const node of nodes) {
      const r = radius(node);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = node === hover ? "#ffb020" : COLORS[node.kind === "folder" ? "folder" : node.format] || "#8e8e93";
      ctx.fill();
      if (node.kind === "folder") {
        ctx.lineWidth = 1;
        ctx.strokeStyle = isDark() ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.3)";
        ctx.stroke();
      }
      const showLabel = node === hover || node.refs + node.out > 0 || view.scale > 1.3 || nodes.length < 40;
      if (showLabel) {
        ctx.fillStyle = isDark() ? "rgba(245,245,247,.85)" : "rgba(29,29,31,.8)";
        ctx.font = `${node === hover ? 12 : 11}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(node.label.slice(0, 28), node.x, node.y - r - 4);
      }
    }
    ctx.restore();
  }

  function loop() {
    tick();
    paint();
    if (alpha > 0.01 || dragging) frame = requestAnimationFrame(loop);
    else frame = 0;
  }

  function kick() {
    alpha = 1;
    if (!frame) frame = requestAnimationFrame(loop);
  }

  function pointFrom(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - view.x) / view.scale,
      y: (event.clientY - rect.top - view.y) / view.scale,
    };
  }

  function nodeAt(point) {
    let best = null;
    let bestDist = Infinity;
    for (const node of nodes) {
      const dx = node.x - point.x;
      const dy = node.y - point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radius(node) + 6 && dist < bestDist) {
        best = node;
        bestDist = dist;
      }
    }
    return best;
  }

  function wire() {
    let panning = null;
    canvas.addEventListener("pointerdown", (event) => {
      const point = pointFrom(event);
      const node = nodeAt(point);
      if (node) {
        dragging = node;
        canvas.setPointerCapture(event.pointerId);
        kick();
      } else {
        panning = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y };
        canvas.setPointerCapture(event.pointerId);
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (dragging) {
        const point = pointFrom(event);
        dragging.x = point.x;
        dragging.y = point.y;
        paint();
        return;
      }
      if (panning) {
        view.x = panning.ox + (event.clientX - panning.x);
        view.y = panning.oy + (event.clientY - panning.y);
        paint();
        return;
      }
      const next = nodeAt(pointFrom(event));
      if (next !== hover) {
        hover = next;
        canvas.style.cursor = hover ? "pointer" : "grab";
        paint();
      }
    });
    canvas.addEventListener("pointerup", (event) => {
      dragging = null;
      panning = null;
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener("click", (event) => {
      const node = nodeAt(pointFrom(event));
      if (node && node.kind === "file") onOpen?.(node.id);
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const factor = event.deltaY < 0 ? 1.12 : 0.89;
        const next = Math.min(3, Math.max(0.25, view.scale * factor));
        view.x = px - ((px - view.x) * next) / view.scale;
        view.y = py - ((py - view.y) * next) / view.scale;
        view.scale = next;
        paint();
      },
      { passive: false }
    );
  }

  function render(container, graph, options = {}) {
    if (!container) return;
    onOpen = options.onOpen;
    ensureCanvas(container);
    const rect = container.getBoundingClientRect();
    const previous = new Map(nodes.map((node) => [node.id, node]));
    nodes = (graph.nodes || []).map((node) => {
      const old = previous.get(node.id);
      return {
        ...node,
        x: old?.x ?? rect.width / 2 + (Math.random() - 0.5) * Math.min(600, rect.width || 600),
        y: old?.y ?? rect.height / 2 + (Math.random() - 0.5) * Math.min(400, rect.height || 400),
        vx: 0,
        vy: 0,
      };
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    edges = (graph.links || [])
      .map((link) => ({ kind: link.kind, source: byId.get(link.from), target: byId.get(link.to) }))
      .filter((edge) => edge.source && edge.target);
    view.x = 0;
    view.y = 0;
    view.scale = 1;
    resize();
    kick();
  }

  window.GraphView = { render };
})();
