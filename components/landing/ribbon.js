// Plina hero ribbon — procedural, dependency-free. No WebGL, no image, no network.
// A one-sided band (three half-twists) rasterised into one pixel buffer: depth-tested,
// smooth-shaded and supersampled for clean edges. Extracted from the landing reference
// (reference/index.html); the numbers below are the approved look, change them only with design.
//
// Usage (client only):
//   const ribbon = mountRibbon(canvas, { stage: heroElement, paused: prefersReducedMotion });
//   ribbon.setPaused(true | false);   // "Pausar movimento" and prefers-reduced-motion
//   ribbon.destroy();                 // on unmount
// The canvas must be sized by CSS (width:100%; height:100%; display:block) and aria-hidden.

const TAU = Math.PI * 2;
const N = 192; // segments along the band
const M = 32; // segments across the band
const R = M + 1;
const V = (N + 1) * R;
const FAR = -1e9;
const DONE = 99;

// Entrance, played once: the band is drawn along its own path, fine tip first, then settles.
const START = 0.4; // where the stroke starts (radians along the band): right-hand side
const DELAY = 0.2; // s before the stroke starts
const DRAW = 2.6; // s to draw the whole band
const SETTLE = 3.8; // s for rotation and scale to reach the resting pose
const TIP = 0.26; // length of the tapered tip, as a fraction of the band
export const RIBBON_ENTRANCE_SECONDS = DELAY + SETTLE;

const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const inOut = (x) => { x = clamp(x); return x < 0.5 ? 2 * x * x : 1 - ((2 - 2 * x) * (2 - 2 * x)) / 2; };
const out = (x) => 1 - Math.pow(1 - clamp(x), 3);

/**
 * Pure renderer: no DOM. `resize` allocates the buffer, `render` fills it.
 * state = { time: seconds of idle drift, intro: seconds of entrance (>= 99 means finished),
 *           turn: 0..1 scroll progress while the hero leaves the viewport }
 */
export function createRibbonRenderer() {
  const X = new Float32Array(V), Y = new Float32Array(V), Z = new Float32Array(V);
  const CR = new Float32Array(V), CG = new Float32Array(V), CB = new Float32Array(V);
  const W = new Float32Array(N + 1);
  let w = 0, h = 0, ss = 1, bw = 0, bh = 0;
  let pixels = null, depth = null, prev = null, cur = [0, 0, -1, -1];

  function build(time, intro, turn) {
    const g = inOut((intro - DELAY) / DRAW), k = 1 - out((intro - DELAY) / SETTLE);
    const head = g * (1 + TIP), tail = TIP * smooth((g - 0.45) / 0.55);
    const A = 0.8 + Math.sin(time * 0.12) * 0.07 + k * 0.16 + turn * 0.12;
    const B = 0.22 - k * 0.3;
    const C = -0.45 + Math.sin(time * 0.08) * 0.1 + k * 0.38 + turn * 0.6;
    const ca = Math.cos(A), sa = Math.sin(A), cb = Math.cos(B), sb = Math.sin(B), cc = Math.cos(C), sc = Math.sin(C);
    // Rotation matrix Rz(C)·Ry(B)·Rx(A), shared by positions and normals.
    const m00 = cc * cb, m01 = cc * sb * sa - sc * ca, m02 = cc * sb * ca + sc * sa;
    const m10 = sc * cb, m11 = sc * sb * sa + cc * ca, m12 = sc * sb * ca - cc * sa;
    const m20 = -sb, m21 = cb * sa, m22 = cb * ca;
    const scale = Math.min(w, h) * 0.35 * (1 - 0.05 * k) * ss, cx = bw * 0.5, cy = bh * 0.49;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const widthAt = (i) => (g >= 1 ? 1 : smooth((head - i / N) / TIP) * smooth((i / N + tail) / TIP));
    for (let i = 0; i <= N; i++) {
      const s = i / N, f = widthAt(i);
      // A row belongs to the dirty box when it or a neighbour is drawn (quads span two rows).
      const drawn = f > 0.004 || (i > 0 && widthAt(i - 1) > 0.004) || (i < N && widthAt(i + 1) > 0.004);
      W[i] = f;
      const u = START + s * TAU, cu = Math.cos(u), su = Math.sin(u), ct = Math.cos(u * 1.5), st = Math.sin(u * 1.5);
      for (let j = 0; j <= M; j++) {
        const v = (-1 + (2 * j) / M) * f, r = 1 + 0.36 * v * ct;
        const px = r * cu, py = r * su, pz = 0.36 * v * st;
        const tx = -r * su - 0.54 * v * st * cu, ty = r * cu - 0.54 * v * st * su, tz = 0.54 * v * ct;
        const bx = ct * cu, by = ct * su, bz = st;
        let nx = ty * bz - tz * by, ny = tz * bx - tx * bz, nz = tx * by - ty * bx;
        const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
        const x = m00 * px + m01 * py + m02 * pz, y = m10 * px + m11 * py + m12 * pz, z = m20 * px + m21 * py + m22 * pz;
        const ax = m00 * nx + m01 * ny + m02 * nz, ay = m10 * nx + m11 * ny + m12 * nz, az = m20 * nx + m21 * ny + m22 * nz;
        const light = Math.abs(ax * -0.4 + ay * -0.55 + az * 0.72), shine = Math.pow(light, 12);
        const bands = 0.5 + 0.5 * Math.cos(ax * 5 + ay * 3); // even in the normal's sign: a one-sided band has no seam
        const l = Math.min(1, (19 + light * 43 + shine * 29 + bands * 3) / 100), sat = (22 + bands * 10 - shine * 20) / 100;
        const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
        const n = i * R + j, d = 3.8 / (3.8 - z), sx = cx + x * scale * d, sy = cy + y * scale * d;
        X[n] = sx; Y[n] = sy; Z[n] = z;
        CR[n] = p * 255; CG[n] = (p + (q - p) * 0.8667) * 255; CB[n] = q * 255; // hsl(188 sat% l%) resolved to RGB
        if (drawn) { if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy; }
      }
    }
    cur = [Math.max(0, Math.floor(x0) - 2), Math.max(0, Math.floor(y0) - 2), Math.min(bw - 1, Math.ceil(x1) + 2), Math.min(bh - 1, Math.ceil(y1) + 2)];
  }

  function tri(a, b, c) {
    const xa = X[a], ya = Y[a], xb = X[b], yb = Y[b], xc = X[c], yc = Y[c];
    const area = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
    if (area > -1e-7 && area < 1e-7) return;
    const minX = Math.max(0, Math.floor(Math.min(xa, xb, xc))), maxX = Math.min(bw - 1, Math.ceil(Math.max(xa, xb, xc)));
    const minY = Math.max(0, Math.floor(Math.min(ya, yb, yc))), maxY = Math.min(bh - 1, Math.ceil(Math.max(ya, yb, yc)));
    const inv = 1 / area, d0 = (yb - yc) * inv, d1 = (yc - ya) * inv, E = -1e-4;
    const za = Z[a], zb = Z[b], zc = Z[c], ra = CR[a], rb = CR[b], rc = CR[c], ga = CG[a], gb = CG[b], gc = CG[c], ba = CB[a], bb = CB[b], bc = CB[c];
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5, px = minX + 0.5;
      let w0 = ((xb - px) * (yc - py) - (xc - px) * (yb - py)) * inv;
      let w1 = ((xc - px) * (ya - py) - (xa - px) * (yc - py)) * inv;
      let o = y * bw + minX;
      for (let x = minX; x <= maxX; x++, o++, w0 += d0, w1 += d1) {
        const w2 = 1 - w0 - w1;
        if (w0 < E || w1 < E || w2 < E) continue;
        const z = w0 * za + w1 * zb + w2 * zc;
        if (z <= depth[o]) continue;
        depth[o] = z;
        // Little-endian RGBA, as every current browser target.
        pixels[o] = 0xff000000 | ((w0 * ba + w1 * bb + w2 * bc) << 16) | ((w0 * ga + w1 * gb + w2 * gc) << 8) | (w0 * ra + w1 * rb + w2 * rc);
      }
    }
  }

  return {
    /** cssWidth/cssHeight in CSS px, scale = buffer px per CSS px, buffer = ArrayBuffer of an ImageData (bw·bh·4). */
    resize(cssWidth, cssHeight, scale, buffer) {
      w = cssWidth; h = cssHeight; ss = scale; bw = Math.round(w * ss); bh = Math.round(h * ss);
      pixels = new Uint32Array(buffer); depth = new Float32Array(bw * bh).fill(FAR); prev = null;
      return { width: bw, height: bh };
    },
    /** Returns the dirty rectangle [x, y, width, height] to pass to putImageData, or null when nothing changed. */
    render(state) {
      if (!pixels) return null;
      if (prev) for (let y = prev[1]; y <= prev[3]; y++) { const from = y * bw + prev[0], to = y * bw + prev[2] + 1; pixels.fill(0, from, to); depth.fill(FAR, from, to); }
      build(state.time, state.intro, state.turn);
      for (let i = 0; i < N; i++) {
        if (W[i] < 0.004 && W[i + 1] < 0.004) continue;
        for (let j = 0; j < M; j++) { const a = i * R + j, b = a + R; tri(a, b, b + 1); tri(a, b + 1, a + 1); }
      }
      const empty = cur[2] < cur[0] || cur[3] < cur[1];
      const box = empty ? prev : prev ? [Math.min(prev[0], cur[0]), Math.min(prev[1], cur[1]), Math.max(prev[2], cur[2]), Math.max(prev[3], cur[3])] : cur;
      prev = empty ? null : cur;
      return box ? [box[0], box[1], box[2] - box[0] + 1, box[3] - box[1] + 1] : null;
    },
  };
}

/**
 * Mounts the ribbon on a canvas. Options:
 *   stage  — element whose visibility gates the animation and whose height scales the scroll turn (default: canvas parent)
 *   paused — start paused: the finished ribbon is drawn once, no entrance, no drift (use for prefers-reduced-motion)
 * Returns { setPaused(boolean), destroy() }.
 */
export function mountRibbon(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { setPaused() {}, destroy() {} };
  const stage = options.stage || canvas.parentElement;
  const renderer = createRibbonRenderer();
  const BUDGET = 1.8e6; // buffer pixels
  let paused = !!options.paused, visible = true, raf = 0, last = 0, image = null;
  const state = { time: 0, intro: paused ? DONE : 0, turn: 0 };

  function draw() {
    if (!image) return;
    const box = renderer.render(state);
    if (box) ctx.putImageData(image, 0, 0, box[0], box[1], box[2], box[3]);
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    // Supersample for anti-aliased edges, within a fixed pixel budget.
    const scale = Math.max(1, Math.min(Math.max(2, (window.devicePixelRatio || 1) * 1.5), 3, Math.sqrt(BUDGET / (rect.width * rect.height))));
    canvas.width = Math.round(rect.width * scale); canvas.height = Math.round(rect.height * scale);
    image = ctx.createImageData(canvas.width, canvas.height);
    renderer.resize(rect.width, rect.height, scale, image.data.buffer);
    draw();
  }
  function frame(now) {
    raf = 0;
    if (paused || !visible || document.hidden) return;
    const entering = state.intro < DELAY + SETTLE;
    const goal = clamp(window.scrollY / Math.max(1, stage.offsetHeight)), turning = Math.abs(goal - state.turn) > 0.0005;
    // Every frame while entering or following the scroll; ~30 fps for the idle drift.
    if (entering || turning || now - last > 32) {
      const dt = Math.min((now - last) / 1000, 0.1);
      state.time += dt;
      if (entering) state.intro += dt;
      if (turning) state.turn += (goal - state.turn) * Math.min(1, dt * 8);
      last = now;
      draw();
    }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (!raf && !paused && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const visibilityObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; start(); }, { threshold: 0 })
    : null;
  if (visibilityObserver) visibilityObserver.observe(stage);
  document.addEventListener('visibilitychange', start);
  resize();
  start();

  return {
    setPaused(next) {
      paused = !!next;
      if (paused) {
        cancelAnimationFrame(raf); raf = 0;
        if (state.intro < DONE) state.intro = DONE; // pausing finishes the drawing; a half-drawn band is not a resting state
        draw();
      } else start();
    },
    destroy() {
      cancelAnimationFrame(raf); raf = 0;
      resizeObserver.disconnect();
      if (visibilityObserver) visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', start);
    },
  };
}
