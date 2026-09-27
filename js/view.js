// Canvas-2D renderer. Every pixel of the board is drawn from primitives — no image, no sprite
// sheet, no icon font — because the picture has to agree with the algebra cell for cell: one
// lamp per bit, and a press lights exactly the cross that js/core/grid.js describes.
//
// The geometry is part of the public surface, and it is all in one space: CSS pixels *inside
// the canvas box* (origin = the canvas's own top-left, which is what `clientWidth` measures).
// main.js turns a pointerdown into a cell by subtracting getBoundingClientRect() first, and
// tools/playtest.mjs turns a cell index into a click by adding it back — "press cell 7" is then
// the same click for a finger, for a route change, and for a Chrome DevTools Protocol event.

const TAU = Math.PI * 2;

const PALETTE = {
  floor: '#0e1118',
  plate: '#151a23',
  plateEdge: 'rgba(226, 232, 240, 0.10)',
  wire: 'rgba(226, 232, 240, 0.06)',
  lampOn: '#ffd35c',
  lampOnCore: '#fff6d8',
  lampOff: '#232a36',
  lampOffCore: '#2c3542',
  halo: 'rgba(255, 211, 92, 0.28)',
  ink: '#e6e9ef',
  dim: '#8b95a7',
  answer: '#78dcff',
  good: '#6ee7b7',
};

const PULSE_SECONDS = 0.5;

export function createView(canvas) {
  const ctx = canvas.getContext('2d');
  let n = 4;
  let cells = new Array(16).fill(0);
  let answer = new Set();
  let held = new Set();
  let showAnswer = false;
  let solved = false;
  let pulse = new Map();
  let raf = null;
  let lastTime = 0;
  const reduceMotion = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // ---- geometry ------------------------------------------------------------

  function metrics() {
    const w = canvas.clientWidth || canvas.width || 320;
    const h = canvas.clientHeight || canvas.height || 320;
    const size = Math.max(120, Math.min(w, h));
    const pad = Math.round(size * 0.055);
    const gap = Math.max(3, Math.round(size * 0.016));
    const cell = (size - pad * 2 - gap * (n - 1)) / n;
    return {
      w, h, size, pad, gap, cell,
      extent: n * cell + (n - 1) * gap,
      left: (w - size) / 2 + pad,
      top: (h - size) / 2 + pad,
    };
  }

  function cellRect(i) {
    const m = metrics();
    const r = Math.floor(i / n);
    const c = i % n;
    return {
      i,
      r,
      c,
      x: m.left + c * (m.cell + m.gap),
      y: m.top + r * (m.cell + m.gap),
      s: m.cell,
    };
  }

  function cellCenter(i) {
    const q = cellRect(i);
    return { x: q.x + q.s / 2, y: q.y + q.s / 2 };
  }

  // Which lamp owns this point? Canvas-box CSS pixels, same space as cellRect/cellCenter.
  // -1 for the gaps and the margin: a click between two lamps presses nothing, which is what
  // main.js and the @pointer assertions both assume.
  function cellAt(x, y) {
    const m = metrics();
    if (x < m.left || y < m.top || x > m.left + m.extent || y > m.top + m.extent) return -1;
    const c = Math.floor((x - m.left) / (m.cell + m.gap));
    const r = Math.floor((y - m.top) / (m.cell + m.gap));
    if (c < 0 || r < 0 || c >= n || r >= n) return -1;
    const q = cellRect(r * n + c);
    if (x < q.x || x > q.x + q.s || y < q.y || y > q.y + q.s) return -1;
    return r * n + c;
  }

  // ---- drawing -------------------------------------------------------------

  function roundRect(x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawRoom(m) {
    const g = ctx.createLinearGradient(0, 0, 0, m.h);
    g.addColorStop(0, '#12151d');
    g.addColorStop(1, PALETTE.floor);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, m.w, m.h);

    // The plate the switches sit on, plus the wires that tie neighbours together — the visual
    // statement of "pressing here also flips there".
    const x = m.left - m.pad;
    const y = m.top - m.pad;
    const side = m.extent + m.pad * 2;
    ctx.save();
    ctx.fillStyle = PALETTE.plate;
    ctx.strokeStyle = PALETTE.plateEdge;
    ctx.lineWidth = 1;
    roundRect(x + 0.5, y + 0.5, side - 1, side - 1, 18);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = PALETTE.wire;
    ctx.lineWidth = 1;
    for (let i = 0; i < n * n; i++) {
      const a = cellCenter(i);
      if (i % n + 1 < n) {
        const b = cellCenter(i + 1);
        ctx.beginPath();
        ctx.moveTo(a.x + 2, a.y);
        ctx.lineTo(b.x - 2, b.y);
        ctx.stroke();
      }
      if (Math.floor(i / n) + 1 < n) {
        const b = cellCenter(i + n);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y + 2);
        ctx.lineTo(b.x, b.y - 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawLamp(i, now) {
    const q = cellRect(i);
    const lit = !!cells[i];
    const r = reduceMotion ? 0 : pulse.get(i) || 0;
    const age = r ? (now - r) / 1000 : 1;
    const flash = age < PULSE_SECONDS ? 1 - age / PULSE_SECONDS : 0;
    const inset = q.s * 0.1;
    const box = { x: q.x + inset, y: q.y + inset, s: q.s - inset * 2 };

    if (lit) {
      const glow = q.s * (0.5 + flash * 0.22);
      const halo = ctx.createRadialGradient(
        box.x + box.s / 2, box.y + box.s / 2, box.s * 0.15,
        box.x + box.s / 2, box.y + box.s / 2, glow
      );
      halo.addColorStop(0, PALETTE.halo);
      halo.addColorStop(1, 'rgba(255, 211, 92, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(q.x - glow / 2, q.y - glow / 2, q.s + glow, q.s + glow);
    }

    ctx.save();
    roundRect(box.x, box.y, box.s, box.s, box.s * 0.26);
    const face = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.s);
    if (lit) {
      face.addColorStop(0, PALETTE.lampOnCore);
      face.addColorStop(0.45, PALETTE.lampOn);
      face.addColorStop(1, '#c9932a');
    } else {
      face.addColorStop(0, PALETTE.lampOffCore);
      face.addColorStop(1, PALETTE.lampOff);
    }
    ctx.fillStyle = face;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = lit ? 'rgba(255, 246, 216, 0.55)' : 'rgba(226, 232, 240, 0.08)';
    ctx.stroke();
    ctx.restore();

    // A filament in the middle: the lamp reads as a lamp even in a greyscale screenshot.
    ctx.save();
    ctx.beginPath();
    ctx.arc(box.x + box.s / 2, box.y + box.s / 2, box.s * (lit ? 0.16 : 0.1), 0, TAU);
    ctx.fillStyle = lit ? 'rgba(255, 255, 255, 0.9)' : 'rgba(226, 232, 240, 0.12)';
    ctx.fill();
    ctx.restore();

    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * 0.8;
      ctx.strokeStyle = lit ? PALETTE.lampOnCore : PALETTE.dim;
      ctx.lineWidth = 2;
      roundRect(q.x, q.y, q.s, q.s, q.s * 0.28);
      ctx.stroke();
      ctx.restore();
    }

    if (held.has(i)) {
      // Four corner ticks: "this switch is held". Pressing it again takes them away, which is
      // the same parity fact the maths rests on.
      ctx.save();
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = 2;
      const t = box.s * 0.22;
      const corners = [
        [box.x, box.y, 1, 1], [box.x + box.s, box.y, -1, 1],
        [box.x, box.y + box.s, 1, -1], [box.x + box.s, box.y + box.s, -1, -1],
      ];
      for (const [cx, cy, sx, sy] of corners) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + sy * t);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + sx * t, cy);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (showAnswer && answer.has(i)) {
      ctx.save();
      ctx.strokeStyle = solved ? PALETTE.good : PALETTE.answer;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      roundRect(box.x + 2, box.y + 2, box.s - 4, box.s - 4, box.s * 0.22);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(box.x + box.s / 2, box.y + box.s / 2, box.s * 0.06, 0, TAU);
      ctx.fillStyle = solved ? PALETTE.good : PALETTE.answer;
      ctx.fill();
      ctx.restore();
    }
  }

  function drawFrame(now) {
    const m = metrics();
    drawRoom(m);
    for (let i = 0; i < n * n; i++) drawLamp(i, now);
  }

  function needsFrame() {
    if (reduceMotion) return false;
    const now = performance.now();
    for (const t of pulse.values()) if (now - t < PULSE_SECONDS * 1000) return true;
    return false;
  }

  function tick(now) {
    raf = null;
    drawFrame(now);
    lastTime = now;
    if (needsFrame()) raf = requestAnimationFrame(tick);
  }

  function invalidate() {
    if (raf === null) raf = requestAnimationFrame(tick);
  }

  function resize() {
    const dpr = Math.max(1, Math.min(3, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1));
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 320;
    const wantW = Math.round(w * dpr);
    const wantH = Math.round(h * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    invalidate();
  }

  return {
    // The whole picture is a function of one object: n, which bits are lit, which keys the
    // certified answer presses, and whether the player is still working or already done.
    setBoard(next) {
      if (next.n && next.n !== n) {
        n = next.n;
        pulse = new Map();
      }
      if (next.cells) cells = next.cells.slice();
      if (next.answer) answer = new Set(next.answer);
      if (next.pressed) held = new Set(next.pressed.map((v, i) => (v ? i : -1)).filter((i) => i >= 0));
      if (typeof next.showAnswer === 'boolean') showAnswer = next.showAnswer;
      if (typeof next.solved === 'boolean') solved = next.solved;
      invalidate();
    },
    // Which lamps just changed. The pulse is decoration only: the lit/unlit state itself is
    // drawn from `cells`, so a player with reduced motion still sees the true board.
    flash(indices) {
      if (reduceMotion || !indices || !indices.length) return;
      const now = performance.now();
      for (const i of indices) pulse.set(i, now);
      if (now - lastTime > 32) invalidate();
    },
    resize,
    cellRect,
    cellCenter,
    cellAt,
    start() {
      resize();
      invalidate();
    },
    stop() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    },
    // Exposed for the shell and the browser test alike, in canvas-box CSS pixels: `cellRect(i)`
    // is the authoritative answer to "where inside the canvas is lamp i". Add the canvas's own
    // bounding-rect origin to get viewport pixels for a synthetic mouse event.
    layout() {
      const m = metrics();
      return {
        n,
        width: m.w,
        height: m.h,
        size: m.size,
        pad: m.pad,
        gap: m.gap,
        cell: m.cell,
        extent: m.extent,
        left: m.left,
        top: m.top,
        dpr: (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1,
      };
    },
  };
}
