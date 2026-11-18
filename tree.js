// =====================================================================
//  THE TREE
//  A fake-3D camera climbs a giant tree. Scroll down = camera goes up.
//
//  Everything in the tree is a flat sprite placed in 3D. Each frame the
//  sprites are sorted far→near and drawn in ONE WebGL call. Lighting, haze
//  and depth-of-field are computed per pixel in the shader from distance
//  and height, so nothing steps or pops.
//
//  Behind the WebGL canvas, a 2D canvas paints the sky / room / floor.
//
//  World units: tree is 100 tall, ~33 radius at the base. y is up.
//  Tree axis is x=0, z=0.
// =====================================================================
(() => {
'use strict';

// ================================================================ CONFIG
// Every clickable thing. Rename / repoint freely.
const LINKS = {
  gifts:     ['gift-1', 'gift-2', 'gift-3', 'gift-4'],
  ornaments: ['ornament-1', 'ornament-2', 'ornament-3', 'ornament-4'],
  canes:     ['cane-1', 'cane-2'],
  creatures: ['creature-1', 'creature-2'],
  star:      'star',
};

// Camera path. p = scroll progress 0..1, y = altitude, R = distance from
// trunk, hz = where eye level sits on screen (0 top, 1 bottom).
const KEYS = [
  // p     y     R     hz
  [0.00,  1.4,  21,  0.80],   // on the floor among the gifts
  [0.08,  2.6,  20.5,0.78],   // linger
  [0.30, 22,    17,  0.64],   // lower branches, ornaments
  [0.55, 46,    13.5,0.58],   // second level, candy + creatures
  [0.72, 64,    12,  0.56],   // into the cloud layer
  [0.86, 80,    14,  0.62],   // breaking out above the clouds
  [0.93, 87,    27,  0.60],   // pulling back, star rises into frame
  [1.00, 92,    34,  0.52],   // snowy tip, star, sky
];
const PHI0   = 0;              // starting angle around the trunk
const SPIRAL = Math.PI * 0.8;  // how far the camera circles the trunk over the climb
const NEAR   = 0.6;

// Atmosphere by altitude.  haze = colour distant things dissolve into.
// k = haze density.  sky = top/bottom of the backdrop.  light = what the
// needles are lit by at that height.
const ATMOS = [
  // y    haze       k      sky top    sky bottom
  [0,   '#6a3a22', 0.050, '#130805', '#2e150b'],  // room: firelit, dusty amber
  [22,  '#5a3044', 0.055, '#110713', '#2a1222'],  // rosy
  [45,  '#3a3570', 0.055, '#0a0a24', '#1e1c48'],  // violet dusk, room dissolving
  [64,  '#6878a8', 0.060, '#070b26', '#232d5c'],  // inside the cloud layer
  [78,  '#1d2a58', 0.016, '#02040f', '#0c1638'],  // above the clouds
  [120, '#101a40', 0.006, '#010208', '#081030'],  // night sky
].map(([y, h, k, a, b]) => ({ y, haze: hex(h), k, top: hex(a), bot: hex(b) }));
const LIGHT_WARM = [1.15, 0.86, 0.62];
const LIGHT_MID  = [0.85, 0.80, 1.05];
const LIGHT_COOL = [0.80, 0.95, 1.25];

// ================================================================ UTILS
function hex(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); }
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(1225);
const rand   = (a, b) => a + (b - a) * R();
const lerp   = (a, b, t) => a + (b - a) * t;
const clamp  = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = c => `rgb(${c.map(v => Math.round(clamp(v, 0, 1) * 255)).join(',')})`;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function camAt(p) {
  p = clamp(p, 0, 1);
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1][0]) i++;
  const k0 = KEYS[Math.max(0, i - 1)], k1 = KEYS[i], k2 = KEYS[i + 1], k3 = KEYS[Math.min(KEYS.length - 1, i + 2)];
  const t = (p - k1[0]) / (k2[0] - k1[0]);
  return {
    y:  catmull(k0[1], k1[1], k2[1], k3[1], t),
    R:  catmull(k0[2], k1[2], k2[2], k3[2], t),
    hz: catmull(k0[3], k1[3], k2[3], k3[3], t),
    phi: PHI0 + SPIRAL * p,
  };
}
// camera state when it passes a given altitude (table for speed)
const CAM_BY_Y = [];
{
  for (let i = 0; i <= 400; i++) {
    const y = i * 0.25; let lo = 0, hi = 1;
    for (let j = 0; j < 30; j++) { const m = (lo + hi) / 2; if (camAt(m).y < y) lo = m; else hi = m; }
    CAM_BY_Y.push(camAt(lo));
  }
}
const camAtAltitude = y => CAM_BY_Y[clamp(Math.round(y * 4), 0, 400)];
const facing = phi => Math.PI / 2 - phi;   // branch angle that points at a camera at angle phi

function atmosAt(y) {
  let i = 0; while (i < ATMOS.length - 2 && y > ATMOS[i + 1].y) i++;
  const a = ATMOS[i], b = ATMOS[i + 1], t = smooth(a.y, b.y, y);
  return { haze: mix3(a.haze, b.haze, t), k: lerp(a.k, b.k, t), top: mix3(a.top, b.top, t), bot: mix3(a.bot, b.bot, t) };
}

// ================================================================ TREE SHAPE
const TREE_H = 100, BASE_R = 33;
const coneR  = y => BASE_R * Math.pow(clamp(1 - y / TREE_H, 0, 1), 0.65);
const trunkR = y => 2.2 * Math.pow(clamp(1 - y / (TREE_H + 2), 0, 1), 1.4) + 0.06;

// ================================================================ SPRITE ATLAS
// Everything drawn once into one big texture. Sprites are white/neutral
// where they get tinted per-instance.
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ATLAS = 2048, PAD = 28;
const atlas = mk(ATLAS, ATLAS), ag = atlas.getContext('2d');
let shX = 0, shY = 0, shH = 0;
function sprite(w, h, draw) {
  if (shX + w + PAD > ATLAS) { shX = 0; shY += shH + PAD; shH = 0; }
  const x = shX + PAD / 2, y = shY + PAD / 2;
  ag.save(); ag.translate(x, y); ag.beginPath(); ag.rect(0, 0, w, h); ag.clip(); draw(ag, w, h); ag.restore();
  shX += w + PAD; shH = Math.max(shH, h);
  return [x / ATLAS, y / ATLAS, (x + w) / ATLAS, (y + h) / ATLAS];
}
const UV = {};

// needles: drawn in a mid green; the shader does all darkening/lighting
const NEEDLE_PAL = ['#1a4a2a', '#22603a', '#2b7446', '#358a52', '#46a062'];
const NEEDLE_K = 1.6; // sprite content is drawn at 1/NEEDLE_K of the cell so blurring never hits the cell edge
function drawNeedles(g, cell, snowy, seed) {
  const r = rng(seed), S = cell / NEEDLE_K;
  g.translate(cell / 2, cell / 2); g.lineCap = 'round';
  g.fillStyle = '#163e24';
  g.beginPath(); g.ellipse(0, 3, S * 0.27, S * 0.16, 0, 0, TAU); g.fill();
  const N = 170;
  for (let i = 0; i < N; i++) {
    const k = i / N;
    const a = r() * TAU, rad = Math.pow(r(), 0.55) * S * 0.36;
    const x = Math.cos(a) * rad * 1.2, y = Math.sin(a) * rad * 0.72 - k * S * 0.06;
    const ang = Math.atan2(y, x) + (r() - 0.5) * 1.1;
    const len = S * (0.05 + r() * 0.075);
    g.strokeStyle = NEEDLE_PAL[Math.min(NEEDLE_PAL.length - 1, Math.floor(k * NEEDLE_PAL.length + r() * 0.8))];
    g.lineWidth = S * 0.017;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len * 0.6 + len * 0.3); g.stroke();
  }
  if (snowy) {
    for (let i = 0; i < 11; i++) {
      const x = (r() - 0.5) * S * 0.66, y = -S * 0.07 - r() * S * 0.08 + Math.abs(x) * 0.25;
      const rx = S * (0.07 + r() * 0.09), ry = rx * 0.45;
      g.fillStyle = '#8fa2c4'; g.beginPath(); g.ellipse(x, y + ry * 0.55, rx, ry, 0, 0, TAU); g.fill();
      g.fillStyle = '#f2f6ff'; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
    }
  }
}
UV.needle = [0, 1].map(sn => [0, 1, 2, 3].map(v => sprite(128, 128, (g, w) => drawNeedles(g, w, sn, 100 + sn * 10 + v))));

function radial(g, cx, cy, r, stops) {
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
}
UV.glow  = sprite(64, 64, (g, w) => radial(g, w / 2, w / 2, w / 2, [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,.75)'], [0.45, 'rgba(255,255,255,.18)'], [1, 'rgba(255,255,255,0)']]));
UV.flake = sprite(64, 64, (g, w) => radial(g, w / 2, w / 2, w * 0.3, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]));
UV.disc  = sprite(32, 32, (g, w) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 1, 0, TAU); g.fill(); });
UV.shadow = sprite(64, 32, (g, w, h) => { g.scale(1, h / w); radial(g, w / 2, w / 2, w / 2, [[0, 'rgba(0,0,0,.9)'], [0.6, 'rgba(0,0,0,.5)'], [1, 'rgba(0,0,0,0)']]); });
UV.shaft = sprite(32, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  const gv = g.createLinearGradient(0, 0, 0, h);
  gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(0.2, 'rgba(0,0,0,1)'); gv.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gv; g.fillRect(0, 0, w, h);
});
UV.puff = [0, 1, 2].map(v => sprite(128, 96, (g, w, h) => {
  const r = rng(500 + v);
  for (let i = 0; i < 14; i++) {
    const x = w * (0.32 + r() * 0.36), y = h * (0.42 + r() * 0.16), rr = w * (0.08 + r() * 0.1);
    radial(g, x, y, rr, [[0, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]);
  }
}));
UV.trunk = sprite(64, 1024, (g, w, h) => {
  const r = rng(77);
  for (let y = 0; y < h; y++) {
    const wy = (1 - y / h) * 101.5;                  // row → world height (top of sprite = tip)
    const hw = trunkR(wy) / trunkR(0) * w / 2;
    const gr = g.createLinearGradient(w / 2 - hw, 0, w / 2 + hw, 0);
    gr.addColorStop(0, '#1a0e07'); gr.addColorStop(0.35, '#5a3a22'); gr.addColorStop(0.6, '#3e2615'); gr.addColorStop(1, '#120904');
    g.fillStyle = gr; g.fillRect(w / 2 - hw, y, hw * 2, 1);
  }
  g.globalAlpha = 0.25; g.strokeStyle = '#000'; g.lineWidth = 1;
  for (let i = 0; i < 90; i++) { const x = w / 2 + (r() - 0.5) * w * 0.7, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y + 10 + r() * 30); g.stroke(); }
});

const ORN_COLORS = ['#b3122e', '#d9a520', '#1d4fb8', '#c9ccd6', '#7a2bb0', '#0f8a6a'];
const BALL_W = 96, BALL_H = 150;
function drawBall(g, col, banded) {
  const W = BALL_W, H = BALL_H, cy = H - W / 2, r = W * 0.46;
  g.strokeStyle = 'rgba(230,210,160,.8)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, cy - r); g.stroke();
  g.fillStyle = '#c2a457'; g.fillRect(W / 2 - r * 0.22, cy - r * 1.1, r * 0.44, r * 0.24);
  const gr = g.createRadialGradient(W * 0.36, cy - r * 0.35, W * 0.03, W / 2, cy, r);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.12, col); gr.addColorStop(0.75, col); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.beginPath(); g.arc(W / 2, cy, r, 0, TAU); g.fill();
  if (banded) {
    g.save(); g.beginPath(); g.arc(W / 2, cy, r, 0, TAU); g.clip();
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(0, cy - r * 0.08, W, r * 0.2);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, cy + r * 0.24, W, r * 0.07); g.fillRect(0, cy - r * 0.36, W, r * 0.07);
    g.restore();
  }
}
UV.ball = [0, 1].map(b => ORN_COLORS.map(c => sprite(BALL_W, BALL_H, g => drawBall(g, c, b))));

UV.cane = sprite(64, 192, (g, w, h) => {
  const hookR = w * 0.26, x0 = w * 0.62, y0 = hookR + 6;
  const path = () => { g.beginPath(); g.arc(x0 - hookR, y0, hookR, 0, Math.PI, true); g.moveTo(x0, y0); g.lineTo(x0, h - 8); };
  g.lineCap = 'round'; g.strokeStyle = '#f4efe6'; g.lineWidth = w * 0.2; path(); g.stroke();
  g.strokeStyle = '#c4142c'; g.setLineDash([w * 0.13, w * 0.13]); g.lineCap = 'butt'; g.lineWidth = w * 0.2; path(); g.stroke();
});

const GIFT_COLS = [['#7d1420', '#e8c25a'], ['#173f7a', '#e9e2d0'], ['#1f5c33', '#c21f2d'], ['#d9c9a8', '#7d1420'], ['#4a2366', '#e8c25a'], ['#c95a1a', '#173f7a']];
UV.box = GIFT_COLS.map(([box, rib]) => sprite(128, 128, (g, w, h) => {
  g.fillStyle = box; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(w * 0.8, 0, w * 0.2, h);
  g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, w, h * 0.08);
  g.fillStyle = rib; g.fillRect(w * 0.43, 0, w * 0.14, h);
}));
UV.lid = GIFT_COLS.map(([box, rib]) => sprite(128, 64, (g, w, h) => {
  g.fillStyle = box; g.fillRect(0, h * 0.6, w, h * 0.4);
  g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, h * 0.86, w, h * 0.14);
  g.fillStyle = rib; g.fillRect(w * 0.43, h * 0.6, w * 0.14, h * 0.4);
  g.beginPath(); g.ellipse(w * 0.36, h * 0.38, w * 0.15, h * 0.2, -0.4, 0, TAU); g.ellipse(w * 0.64, h * 0.38, w * 0.15, h * 0.2, 0.4, 0, TAU); g.fill();
}));

UV.critter = ['#8a8f99', '#6b4a32'].map(fur => sprite(128, 128, (g, w, h) => {
  g.fillStyle = fur; g.strokeStyle = fur; g.lineCap = 'round'; g.lineWidth = w * 0.06;
  g.beginPath(); g.moveTo(w * 0.78, h * 0.8); g.quadraticCurveTo(w * 1.0, h * 0.75, w * 0.92, h * 0.5); g.stroke();
  g.beginPath(); g.ellipse(w * 0.52, h * 0.74, w * 0.3, h * 0.24, 0, 0, TAU); g.fill();
  g.beginPath(); g.arc(w * 0.44, h * 0.42, w * 0.21, 0, TAU); g.fill();
  g.beginPath(); g.arc(w * 0.28, h * 0.22, w * 0.1, 0, TAU); g.arc(w * 0.58, h * 0.2, w * 0.1, 0, TAU); g.fill();
  g.fillStyle = '#e8a0a0'; g.beginPath(); g.arc(w * 0.27, h * 0.5, w * 0.03, 0, TAU); g.fill();
}));
const EYES = [[0.37, 0.4], [0.53, 0.4]]; // eye centres in critter sprite (fractions)

UV.star = sprite(128, 128, (g, w) => {
  g.translate(w / 2, w / 2);
  g.fillStyle = '#ffd56a'; g.strokeStyle = '#fff6d0'; g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? w * 0.19 : w * 0.46; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill(); g.stroke();
});
UV.rays = sprite(256, 256, (g, w) => {
  g.translate(w / 2, w / 2);
  for (let i = 0; i < 16; i++) {
    g.rotate(TAU / 16);
    const L = w * (i % 2 ? 0.3 : 0.5);
    const gr = g.createLinearGradient(0, 0, L, 0);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, -w * 0.012); g.lineTo(L, 0); g.lineTo(0, w * 0.012); g.fill();
  }
});

// ================================================================ BUILD THE WORLD
// kinds: 0 blob, 1 light, 2 ball, 3 cane, 4 critter, 5 gift, 6 star, 7 puff, 8 shaft, 9 trunk, 10 particle
const blobs = [], lights = [], things = [], puffs = [], shafts = [], branches = [];

function nearCameraPath(x, y, z, clear) {
  const c = camAtAltitude(y);
  const cx = c.R * Math.sin(c.phi), cz = c.R * Math.cos(c.phi);
  return (x - cx) ** 2 + (z - cz) ** 2 < clear * clear;
}
function addBlob(x, y, z, size, inner, snowP) {
  if (nearCameraPath(x, y, z, 1.6 + size * 0.35)) return;
  const v = 0.9 + R() * 0.2;
  const b = lerp(0.42, 1.0, inner);
  blobs.push({ kind: 0, x, y, z, size, flip: R() < 0.5 ? -1 : 1,
    uv: UV.needle[R() < snowP ? 1 : 0][(R() * 4) | 0],
    tr: b * v * 0.95, tg: b * v, tb: b * v * 0.95 });
}
{
  let y = 4.8, tier = 0;
  while (y < 98.5) {
    const h = y / TREE_H;
    const n = Math.round(lerp(12, 7, h));
    const off = tier * 2.39996;
    const snowP = smooth(58, 82, y);
    for (let b = 0; b < n; b++) {
      const a = off + (b / n) * TAU + rand(-0.22, 0.22);
      const L = coneR(y) * rand(0.84, 1.04);
      const r0 = trunkR(y);
      const drop = L * rand(0.18, 0.3);
      const sizeK = lerp(1, 0.62, h);
      const ca = Math.cos(a), sa = Math.sin(a), ty = y;
      const pt = t => { const r = r0 + (L - r0) * t; return [r * ca, ty - drop * Math.pow(t, 1.7), r * sa]; };
      branches.push({ y, a, L, pt, sizeK, used: false });

      const step = 1.5 * sizeK + 0.3;
      const count = Math.max(2, Math.round((L - r0) / step));
      for (let i = 0; i < count; i++) {
        const t = Math.min(1, 0.08 + 0.92 * (i + rand(0, 0.6)) / count);
        const p = pt(t), lat = rand(-0.8, 0.8) * sizeK;
        addBlob(p[0] - sa * lat, p[1] + rand(-0.4, 0.4) * sizeK, p[2] + ca * lat, lerp(4.2, 2.8, t) * sizeK * rand(0.85, 1.2), t, snowP);
      }
      // side shoots
      for (let s = 0; s < 2; s++) {
        const t0 = rand(0.35, 0.8), p0 = pt(t0), side = s ? 1 : -1;
        const sl = L * rand(0.18, 0.3), sa2 = a + side * rand(0.6, 1.0);
        for (let j = 1; j <= 3; j++) {
          const f = j / 3;
          addBlob(p0[0] + Math.cos(sa2) * sl * f, p0[1] - f * 0.6 * sizeK, p0[2] + Math.sin(sa2) * sl * f, 2.8 * sizeK * rand(0.85, 1.15), t0, snowP);
        }
      }
      const nl = 2 + ((R() * 4) | 0);
      for (let i = 0; i < nl; i++) {
        const p = pt(rand(0.25, 1));
        const cold = y > 70;
        const col = cold ? [[0.75, 0.88, 1], [1, 1, 1], [0.6, 0.75, 1]][(R() * 3) | 0] : [[1, 0.78, 0.42], [1, 0.52, 0.34], [1, 0.9, 0.62], [1, 0.36, 0.42]][(R() * 4) | 0];
        lights.push({ kind: 1, x: p[0] + rand(-0.4, 0.4), y: p[1] - 0.3 * sizeK, z: p[2] + rand(-0.4, 0.4), col, ph: rand(0, TAU), sp: rand(0.8, 2.6) });
      }
    }
    y += lerp(3.4, 2.0, h) * rand(0.9, 1.1); tier++;
  }
  // the leader — the top shoot the star sits on
  for (let yy = 92; yy < 101.5; yy += 0.55) {
    const k = (101.5 - yy) / 9.5;
    for (let j = 0; j < 4; j++) {
      const a = rand(0, TAU), r = rand(0, 1.6) * k;
      addBlob(Math.cos(a) * r, yy, Math.sin(a) * r, lerp(1.1, 2.3, k) * rand(0.9, 1.2), 1, 0.85);
    }
  }
}

function pickBranch(yMin, yMax, side) {
  let best = null, bestScore = 1e9;
  for (const br of branches) {
    if (br.used || br.y < yMin || br.y > yMax) continue;
    const c = camAtAltitude(br.y);
    let diff = br.a - facing(c.phi); diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const score = Math.abs(diff - side) + Math.abs(br.y - (yMin + yMax) / 2) * 0.02;
    if (score < bestScore) { bestScore = score; best = br; }
  }
  best.used = true;
  const c = camAtAltitude(best.y);
  const t = clamp(Math.min(best.L * 0.85, c.R - 7.5) / best.L, 0.3, 0.95);
  return { br: best, p: best.pt(t) };
}
const anim = () => ({ h: 0, act: -1, sw: rand(0, TAU) });

LINKS.ornaments.forEach((page, i) => {
  const { br, p } = pickBranch(11 + i * 8, 18 + i * 8, i % 2 ? 0.3 : -0.3);
  things.push({ kind: 2, x: p[0], y: p[1] - 0.4 * br.sizeK, z: p[2], rad: 0.95 * br.sizeK + 0.2, col: i % ORN_COLORS.length, banded: 1, page, ...anim() });
});
LINKS.canes.forEach((page, i) => {
  const { br, p } = pickBranch(46 + i * 12, 52 + i * 12, i % 2 ? -0.3 : 0.3);
  things.push({ kind: 3, x: p[0], y: p[1] - 0.3 * br.sizeK, z: p[2], len: 2.8 * br.sizeK, page, ...anim() });
});
LINKS.creatures.forEach((page, i) => {
  const { br, p } = pickBranch(52 + i * 14, 58 + i * 14, i % 2 ? 0.28 : -0.28);
  things.push({ kind: 4, x: p[0], y: p[1] + 0.5 * br.sizeK, z: p[2], rad: 1.4 * br.sizeK, fur: i % 2, page, ...anim() });
});
for (const br of branches) {
  if (br.used || br.y < 7 || br.y > 93 || R() > 0.32) continue;
  const p = br.pt(rand(0.55, 0.95));
  if (br.y > 46 && R() < 0.3) things.push({ kind: 3, deco: true, x: p[0], y: p[1] - 0.3 * br.sizeK, z: p[2], len: 2.0 * br.sizeK, ...anim() });
  else things.push({ kind: 2, deco: true, x: p[0], y: p[1] - 0.35 * br.sizeK, z: p[2], rad: (br.y < 45 ? 0.8 : 0.65) * br.sizeK + 0.15, col: (R() * ORN_COLORS.length) | 0, banded: 0, ...anim() });
}
{
  const a0 = facing(camAt(0).phi);
  const slots = [[-0.42, 10.5], [-0.14, 13.5], [0.12, 9], [0.38, 12.5]];
  LINKS.gifts.forEach((page, i) => {
    const [da, r] = slots[i];
    things.push({ kind: 5, x: Math.cos(a0 + da) * r, y: 0, z: Math.sin(a0 + da) * r, w: rand(2.2, 3.2), hh: rand(1.6, 2.6), ci: i, page, ...anim() });
  });
  for (let i = 0; i < 14; i++) {
    const a = a0 + rand(0.7, TAU - 0.7), r = rand(5, 16);
    things.push({ kind: 5, deco: true, x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, w: rand(1.4, 3.4), hh: rand(1.0, 2.8), ci: (R() * GIFT_COLS.length) | 0, ...anim() });
  }
}
things.push({ kind: 6, x: 0, y: 102.5, z: 0, rad: 3.4, page: LINKS.star, ...anim() });

// mist inside the tree + the cloud layer the tree pokes through
for (let i = 0; i < 170; i++) {
  const y = rand(1, 60), a = rand(0, TAU), r = Math.sqrt(R()) * (coneR(y) + 6);
  const warm = 1 - smooth(10, 45, y);
  puffs.push({ kind: 7, x: Math.cos(a) * r, y, z: Math.sin(a) * r, size: rand(6, 14), rot: rand(-0.3, 0.3), v: (R() * 3) | 0,
    col: mix3([0.85, 0.6, 0.42], [0.62, 0.58, 0.85], 1 - warm), a: rand(0.1, 0.2) });
}
for (let i = 0; i < 260; i++) {
  const y = rand(62, 76), a = rand(0, TAU), r = Math.pow(R(), 0.7) * 140;
  puffs.push({ kind: 7, x: Math.cos(a) * r, y, z: Math.sin(a) * r, size: rand(14, 34), rot: rand(-0.15, 0.15), v: (R() * 3) | 0,
    col: [0.72, 0.8, 0.98], a: rand(0.16, 0.32) });
}
// light shafts in the room, slanting in from a high window
for (let i = 0; i < 10; i++) {
  const a = rand(0, TAU), r = rand(4, 26);
  shafts.push({ kind: 8, x: Math.cos(a) * r, y: rand(34, 48), z: Math.sin(a) * r, w: rand(1.5, 4), h: rand(40, 55), a: rand(0.05, 0.11), ph: rand(0, TAU) });
}
const trunk = { kind: 9, x: 0, y: 0, z: 0 };

// particles live in camera space and wrap around it
const DUST = Array.from({ length: 520 }, () => ({ kind: 10, snow: 0, u: R(), v: R(), w: R(), ph: rand(0, TAU), sz: rand(0.05, 0.12) }));
const SNOW = Array.from({ length: 1100 }, () => ({ kind: 10, snow: 1, u: R(), v: R(), w: R(), ph: rand(0, TAU), sz: rand(0.06, 0.15) }));

const world = [...blobs, ...lights, ...things, ...puffs, ...shafts];
const interactive = things.filter(o => !o.deco);

// ================================================================ CANVASES
const skyC = document.getElementById('sky'), sky = skyC.getContext('2d');
const cvs = document.getElementById('scene');
const gl = cvs.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
let W = 0, H = 0, DPR = 1, F = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  W = innerWidth; H = innerHeight;
  for (const c of [skyC, cvs]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  F = Math.min(H, W * 1.3) * 0.95;
  gl.viewport(0, 0, cvs.width, cvs.height);
}

// ---------------------------------------------------------------- GL program
const VS = `#version 300 es
layout(location=0) in vec2 c;
layout(location=1) in vec3 a_pos;
layout(location=2) in float a_rot;
layout(location=3) in vec2 a_size;
layout(location=4) in vec2 a_off;
layout(location=5) in vec4 a_uv;
layout(location=6) in vec4 a_tint;
layout(location=7) in vec4 a_p;     // additive, lit, fogScale, nearOpaqueDist
uniform vec3 u_cam; uniform vec2 u_sc; uniform float u_F, u_hz; uniform vec2 u_vp;
out vec2 v_uv; out vec4 v_tint; out vec3 v_p; out float v_d; out float v_wy; out float v_fade; out float v_dof;
void main(){
  vec3 rel = a_pos - u_cam;
  float d = max(-(rel.x*u_sc.x + rel.z*u_sc.y), 0.05);
  float lx = rel.x*u_sc.y - rel.z*u_sc.x;
  float s = u_F / d;
  vec2 anchor = vec2(u_vp.x*0.5 + lx*s, u_hz - rel.y*s);
  vec2 local = (c - a_off) * a_size * s;
  float cr = cos(a_rot), sr = sin(a_rot);
  local = vec2(local.x*cr - local.y*sr, local.x*sr + local.y*cr);
  vec2 px = anchor + local;
  gl_Position = vec4(px.x/u_vp.x*2.0-1.0, 1.0-px.y/u_vp.y*2.0, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, c);
  v_tint = a_tint; v_p = a_p.xyz; v_d = d; v_dof = a_p.w > 0.0 ? 1.0 : 0.0;
  v_wy = a_pos.y + (a_off.y - c.y) * a_size.y;
  float fade = smoothstep(${NEAR.toFixed(2)}, abs(a_p.w), d);
  float scr = abs(a_size.y) * s / u_vp.y;                 // fraction of screen height covered
  fade *= 1.0 - smoothstep(1.4, 3.2, scr);
  v_fade = fade;
}`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform vec3 u_haze; uniform float u_k, u_camY;
uniform vec3 u_lw, u_lm, u_lc;
in vec2 v_uv; in vec4 v_tint; in vec3 v_p; in float v_d; in float v_wy; in float v_fade; in float v_dof;
out vec4 o;
void main(){
  float d = v_d;
  // depth of field: close = very soft, far = a little soft
  float bias = ((1.0 - smoothstep(0.8, 6.0, d)) * 3.2 + smoothstep(30.0, 90.0, d) * 1.2) * v_dof;
  vec4 t = texture(u_tex, v_uv, bias);
  vec3 col = t.rgb * v_tint.rgb;
  if (v_p.y > 0.0) {
    vec3 lc = mix(mix(u_lw, u_lm, smoothstep(8.0, 45.0, v_wy)), u_lc, smoothstep(55.0, 85.0, v_wy));
    float elev = (v_wy - u_camY) / d;
    float under = smoothstep(0.0, 1.1, elev);              // seen from below → shadowed underside
    float near = 1.0 - smoothstep(1.0, 8.0, d);            // right in your face → silhouette
    float L = mix(1.0, 0.3, under) * mix(1.0, 0.2, near);
    col = mix(col, col * lc * L, v_p.y);
  }
  float fog = (1.0 - exp(-u_k * max(0.0, d - 2.5))) * v_p.z;
  col = mix(col, u_haze * t.a, fog);
  float a = t.a * v_tint.a * v_fade;
  col *= v_tint.a * v_fade;
  o = vec4(col, a * (1.0 - v_p.x));
}`;
function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const U = {};
for (const n of ['u_cam', 'u_sc', 'u_F', 'u_hz', 'u_vp', 'u_tex', 'u_haze', 'u_k', 'u_camY', 'u_lw', 'u_lm', 'u_lc']) U[n] = gl.getUniformLocation(prog, n);

const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

const STRIDE = 20;
let CAP = 16384, inst = new Float32Array(CAP * STRIDE), N = 0;
const ibuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
[[1, 3, 0], [2, 1, 3], [3, 2, 4], [4, 2, 6], [5, 4, 8], [6, 4, 12], [7, 4, 16]].forEach(([loc, size, off]) => {
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
  gl.vertexAttribDivisor(loc, 1);
});

const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
gl.generateMipmap(gl.TEXTURE_2D);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.uniform1i(U.u_tex, 0);
gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
gl.uniform3fv(U.u_lw, LIGHT_WARM); gl.uniform3fv(U.u_lm, LIGHT_MID); gl.uniform3fv(U.u_lc, LIGHT_COOL);

addEventListener('resize', resize); resize();

// push one sprite instance
// pos, rotation, size (world), anchor within sprite (0..1), uv, tint rgba, additive, lit, fogScale, nearOpaque
function push(x, y, z, rot, w, h, ox, oy, uv, r, g, b, a, add, lit, fogS, nearA) {
  if (N >= CAP) {
    CAP *= 2; const n = new Float32Array(CAP * STRIDE); n.set(inst); inst = n;
    gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
  }
  const i = N++ * STRIDE;
  inst[i] = x; inst[i + 1] = y; inst[i + 2] = z; inst[i + 3] = rot;
  inst[i + 4] = w; inst[i + 5] = h; inst[i + 6] = ox; inst[i + 7] = oy;
  inst[i + 8] = uv[0]; inst[i + 9] = uv[1]; inst[i + 10] = uv[2]; inst[i + 11] = uv[3];
  inst[i + 12] = r; inst[i + 13] = g; inst[i + 14] = b; inst[i + 15] = a;
  inst[i + 16] = add; inst[i + 17] = lit; inst[i + 18] = fogS; inst[i + 19] = nearA;
}

// ================================================================ CAMERA + INPUT
const cam = { x: 0, y: 0, z: 0, phi: 0, R: 20, sin: 0, cos: 1, hzPx: 0 };
let pTarget = 0, pNow = 0;
let mx = 0, my = 0, mxS = 0, myS = 0;
let px = -1, py = -1, pointerIn = false;
let hovered = null, opening = null;

function scrollP() { const max = document.documentElement.scrollHeight - innerHeight; return max > 0 ? scrollY / max : 0; }
addEventListener('scroll', () => { pTarget = scrollP(); }, { passive: true });
addEventListener('pointermove', e => { px = e.clientX; py = e.clientY; pointerIn = true; mx = (px / W) * 2 - 1; my = (py / H) * 2 - 1; });
document.addEventListener('pointerleave', () => { pointerIn = false; });
cvs.addEventListener('click', e => {
  px = e.clientX; py = e.clientY;
  const hit = hitTest();
  if (!hit || opening) return;
  hit.act = 0; opening = hit;
});
const pageEl = document.getElementById('page');
pageEl.addEventListener('click', () => pageEl.classList.remove('open'));
function openPage(id) { document.getElementById('page-id').textContent = id; pageEl.classList.add('open'); }

function project(o, x, y, z) {
  const rx = x - cam.x, rz = z - cam.z;
  const d = -(rx * cam.sin + rz * cam.cos);
  o.d = d;
  if (d < NEAR) return false;
  const s = F / d;
  o.s = s; o.sx = W / 2 + (rx * cam.cos - rz * cam.sin) * s; o.sy = cam.hzPx - (y - cam.y) * s;
  return true;
}
// world position of a point offset (dx right, dy down, world units) from an anchor in the billboard plane, rotated
function bOff(x, y, z, dx, dy, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const rx = dx * c - dy * s, ry = dx * s + dy * c;
  return [x + cam.cos * rx, y - ry, z - cam.sin * rx];
}

// ================================================================ SKY (2D canvas)
const PAN_W = 2400, PAN_H = 1200;
const pano = mk(PAN_W, PAN_H);
{
  const g = pano.getContext('2d'), r = rng(99);
  // milky way: a tilted band of haze + dense stars
  g.save(); g.translate(PAN_W / 2, PAN_H * 0.45); g.rotate(-0.28);
  for (let i = 0; i < 260; i++) {
    const x = (r() - 0.5) * PAN_W * 1.3, y = (r() + r() + r() - 1.5) * PAN_H * 0.09, rr = 30 + r() * 120;
    const c = [[120, 80, 200], [60, 140, 190], [190, 90, 160], [160, 160, 220]][(r() * 4) | 0];
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, `rgba(${c},${0.06 + r() * 0.06})`); gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  for (let i = 0; i < 2600; i++) {
    const x = (r() - 0.5) * PAN_W * 1.3, y = (r() + r() + r() + r() - 2) * PAN_H * 0.07;
    g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.6})`; g.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 40; i++) { // dark dust lanes
    const x = (r() - 0.5) * PAN_W * 1.2, y = (r() - 0.5) * PAN_H * 0.05, rr = 40 + r() * 80;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(0,0,8,.35)'); gr.addColorStop(1, 'rgba(0,0,8,0)');
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  g.restore();
  for (let i = 0; i < 1400; i++) {
    const s = r() < 0.04 ? 2 : 1;
    g.fillStyle = `rgba(${r() < 0.2 ? '255,220,200' : r() < 0.3 ? '200,220,255' : '255,255,255'},${0.25 + r() * 0.75})`;
    g.fillRect(r() * PAN_W, r() * PAN_H, s, s);
  }
}
const twinklers = Array.from({ length: 120 }, () => ({ u: R(), v: R(), ph: rand(0, TAU), sp: rand(1, 3) }));
let shooting = null, nextShoot = 4;

function drawSky(t, at) {
  sky.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = sky.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, css(at.top)); g.addColorStop(1, css(at.bot));
  sky.fillStyle = g; sky.fillRect(0, 0, W, H);

  const kx = F * 0.55, span = TAU * kx;
  const sa = smooth(55, 82, cam.y);
  const skyY = -H * 0.25 - (cam.y - 90) * 4;
  if (sa > 0) {
    sky.globalAlpha = sa;
    let x0 = (-(cam.phi * kx)) % span; if (x0 > 0) x0 -= span;
    const ph = H * 1.5;
    for (let x = x0; x < W; x += span) sky.drawImage(pano, x, skyY, span, ph);
    sky.fillStyle = '#fff';
    for (const s of twinklers) {
      let x = (s.u * span - cam.phi * kx) % span; if (x < 0) x += span;
      if (x > W) continue;
      const a = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      sky.globalAlpha = sa * a * a;
      sky.fillRect(x - 0.5, skyY + s.v * ph, 2, 2);
    }
    // moon
    const mxp = W * 0.8 + (camAt(1).phi - cam.phi) * kx, myp = H * 0.18 - (cam.y - 90) * 3;
    sky.globalAlpha = sa;
    const mg = sky.createRadialGradient(mxp, myp, 0, mxp, myp, H * 0.45);
    mg.addColorStop(0, 'rgba(200,215,255,.35)'); mg.addColorStop(0.08, 'rgba(170,190,255,.12)'); mg.addColorStop(1, 'rgba(150,170,255,0)');
    sky.fillStyle = mg; sky.fillRect(mxp - H * 0.45, myp - H * 0.45, H * 0.9, H * 0.9);
    sky.fillStyle = '#eef1ff'; sky.beginPath(); sky.arc(mxp, myp, H * 0.035, 0, TAU); sky.fill();
    sky.fillStyle = 'rgba(160,170,200,.35)';
    sky.beginPath(); sky.arc(mxp - H * 0.01, myp - H * 0.006, H * 0.009, 0, TAU); sky.arc(mxp + H * 0.012, myp + H * 0.01, H * 0.006, 0, TAU); sky.fill();
    // shooting stars
    if (sa > 0.6) {
      nextShoot -= 1 / 60;
      if (!shooting && nextShoot < 0) { shooting = { x: rand(0.1, 0.9) * W, y: rand(0.05, 0.35) * H, a: rand(2.5, 2.9), t: 0 }; nextShoot = rand(3, 8); }
    }
    if (shooting) {
      shooting.t += 1 / 60;
      const k = shooting.t / 0.9, L = 160;
      const hx = shooting.x + Math.cos(shooting.a) * k * 500, hy = shooting.y - Math.sin(shooting.a) * k * -260;
      const gr = sky.createLinearGradient(hx, hy, hx - Math.cos(shooting.a) * L, hy - Math.sin(shooting.a) * -L * 0.52);
      gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      sky.globalAlpha = sa * Math.sin(Math.min(1, k) * Math.PI);
      sky.strokeStyle = gr; sky.lineWidth = 1.5;
      sky.beginPath(); sky.moveTo(hx, hy); sky.lineTo(hx - Math.cos(shooting.a) * L, hy - Math.sin(shooting.a) * -L * 0.52); sky.stroke();
      if (k >= 1) shooting = null;
    }
    sky.globalAlpha = 1;
  }

  // fire glow from somewhere in the room
  const fire = 1 - smooth(4, 40, cam.y);
  if (fire > 0) {
    const fx = W * 0.5 + Math.sin(-cam.phi + 2.2) * W * 0.9;
    const flick = 0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
    const fg = sky.createRadialGradient(fx, H * 0.95, 0, fx, H * 0.95, H * 1.2);
    fg.addColorStop(0, `rgba(255,140,60,${0.4 * fire * flick})`); fg.addColorStop(1, 'rgba(255,140,60,0)');
    sky.fillStyle = fg; sky.fillRect(0, 0, W, H);
  }

  // haze over the far distance (backdrop is "infinitely" far)
  const far = 1 - Math.exp(-at.k * 70);
  sky.globalAlpha = far * 0.9; sky.fillStyle = css(at.haze); sky.fillRect(0, 0, W, H); sky.globalAlpha = 1;

  // floor + tree skirt — fades as the room dissolves
  const fa = 1 - smooth(10, 45, cam.y);
  if (fa > 0) {
    const fy = cam.hzPx + cam.y * F / 220;
    const fg = sky.createLinearGradient(0, fy, 0, H);
    fg.addColorStop(0, css(mix3([0.11, 0.05, 0.03], at.haze, 0.55))); fg.addColorStop(1, '#2a1409');
    sky.globalAlpha = fa; sky.fillStyle = fg; sky.fillRect(0, fy, W, H - fy);
    sky.fillStyle = '#4a0d12';
    sky.beginPath();
    const tmp = {};
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * TAU, r = 10 + Math.sin(a * 9) * 0.6;
      if (!project(tmp, Math.cos(a) * r, 0.02, Math.sin(a) * r)) continue;
      i ? sky.lineTo(tmp.sx, tmp.sy) : sky.moveTo(tmp.sx, tmp.sy);
    }
    sky.fill();
    sky.globalAlpha = 1;
  }
}

// ================================================================ EMITTERS
// Each visible object pushes one or more sprite instances.
let hits = [];
function emit(o, t) {
  switch (o.kind) {
    case 0: push(o.x, o.y, o.z, 0, o.size * o.flip * NEEDLE_K, o.size * NEEDLE_K, 0.5, 0.5, o.uv, o.tr, o.tg, o.tb, 1, 0, 1, 1, 2.2); break;

    case 1: {
      const tw = 0.55 + 0.45 * Math.sin(t * o.sp + o.ph), sz = 0.7 + tw * 0.6;
      push(o.x, o.y, o.z, 0, sz, sz, 0.5, 0.5, UV.glow, o.col[0], o.col[1], o.col[2], 0.55 + 0.45 * tw, 1, 0, 0.4, 1.0);
      break;
    }
    case 2: { // ornament ball: anchor is the hook, sprite hangs below
      const act = o.act;
      const swing = Math.sin(t * 1.3 + o.sw) * 0.06 + Math.sin(t * 7) * 0.2 * o.h + (act >= 0 ? Math.sin(act * 14) * 0.5 * (1 - act / 0.75) : 0);
      const sc = 1 + 0.1 * o.h, spin = act >= 0 ? Math.cos(act * 30) : 1, br = 1 + 0.35 * o.h;
      const w = 2 * o.rad * sc, h = w * BALL_H / BALL_W;
      push(o.x, o.y, o.z, swing, w * spin, h, 0.5, 0, UV.ball[o.banded][o.col], br, br, br, 1, 0, 0.65, 1, 2.2);
      // a glint that twinkles on the ball
      const gl8 = Math.pow(0.5 + 0.5 * Math.sin(t * 2.2 + o.sw * 5), 12) + o.h * 0.6;
      if (gl8 > 0.02) {
        const p = bOff(o.x, o.y, o.z, -w * 0.18, h - w * 0.68, swing);
        push(p[0], p[1], p[2], t, w * 0.7, w * 0.7, 0.5, 0.5, UV.rays, 1, 0.97, 0.9, gl8, 1, 0, 0.5, 2.2);
      }
      if (!o.deco) hits.push({ o, x: o.sx - Math.sin(swing) * (h - w / 2) * o.s, y: o.sy + Math.cos(swing) * (h - w / 2) * o.s, r: w * 0.6 * o.s });
      break;
    }
    case 3: { // candy cane: anchor near the top of the hook
      const act = o.act;
      const swing = Math.sin(t * 1.1 + o.sw) * 0.05 + Math.sin(t * 7) * 0.18 * o.h + (act >= 0 ? Math.sin(act * 14) * 0.5 * (1 - act / 0.75) : 0);
      const h = o.len * (1 + 0.08 * o.h), w = h / 3, br = 1 + 0.3 * o.h;
      push(o.x, o.y, o.z, swing, w, h, 0.36, 0.04, UV.cane, br, br, br, 1, 0, 0.65, 1, 2.2);
      if (!o.deco) hits.push({ o, x: o.sx - Math.sin(swing) * h * 0.5 * o.s, y: o.sy + h * 0.5 * o.s, r: h * 0.45 * o.s });
      break;
    }
    case 4: { // critter sitting on a branch; eyes follow the pointer
      const r = o.rad, act = o.act;
      const hop = act >= 0 ? Math.sin(Math.min(1, act / 0.6) * Math.PI) * r * 1.4 : 0;
      const lift = hop + o.h * r * 0.2 + Math.sin(t * 2 + o.sw) * r * 0.03;
      const w = r * 2.4, sq = 1 + o.h * 0.06;
      const y = o.y + lift;
      push(o.x, y, o.z, 0, w / sq, w * sq, 0.5, 1, UV.critter[o.fur], 1, 1, 1, 1, 0, 0.6, 1, 2.2);
      const blink = Math.sin(t * 0.9 + o.sw * 3) > 0.985 ? 0.15 : 1;
      for (const [fx, fy] of EYES) {
        const dx = (fx - 0.5) * w / sq, dy = (fy - 1) * w * sq;
        const e = [o.x + cam.cos * dx, y - dy, o.z - cam.sin * dx];
        const er = r * 0.26;
        push(e[0], e[1], e[2], 0, er, er * blink, 0.5, 0.5, UV.disc, 1, 1, 1, 1, 0, 0.5, 1, 2.2);
        let ex = 0, ey = 0;
        if (pointerIn) {
          const esx = o.sx + dx * o.s, esy = o.sy - (lift - dy) * o.s;
          const vx = px - esx, vy = py - esy, l = Math.hypot(vx, vy) || 1;
          ex = vx / l * er * 0.22; ey = vy / l * er * 0.22;
        }
        push(e[0] + cam.cos * ex, e[1] - ey, e[2] - cam.sin * ex, 0, er * 0.5, er * 0.5 * blink, 0.5, 0.5, UV.disc, 0, 0, 0, 1, 0, 0, 1, 2.2);
      }
      hits.push({ o, x: o.sx, y: o.sy - (lift + w * 0.45) * o.s, r: w * 0.5 * o.s });
      break;
    }
    case 5: { // gift
      const act = o.act, jig = o.h * Math.sin(t * 22) * 0.04;
      const hop = act >= 0 ? Math.sin(Math.min(1, act / 0.35) * Math.PI) * o.hh * 0.25 : 0;
      const lid = act >= 0 ? Math.min(1, act / 0.45) : 0;
      const sq = 1 + o.h * 0.05, br = 1 + o.h * 0.2;
      const w = o.w / Math.sqrt(sq), h = o.hh * sq;
      push(o.x, 0.01, o.z, 0, o.w * 1.3, o.w * 0.3, 0.5, 0.5, UV.shadow, 1, 1, 1, 0.6, 0, 0, 1, 2.2);
      push(o.x, hop, o.z, jig, w, h, 0.5, 1, UV.box[o.ci], br, br, br, 1, 0, 0.8, 1, 2.2);
      push(o.x, hop + h + lid * h * 1.2, o.z, jig - lid * 0.5, w * 1.08, w * 0.54, 0.5, 1, UV.lid[o.ci], br, br, br, 1, 0, 0.8, 1, 2.2);
      if (lid > 0) push(o.x, h, o.z, 0, w * 3, w * 3, 0.5, 0.6, UV.glow, 1, 0.85, 0.55, lid, 1, 0, 0.3, 1.0);
      if (!o.deco) hits.push({ o, x: o.sx, y: o.sy - h * 0.55 * o.s, r: Math.max(w, h) * 0.6 * o.s });
      break;
    }
    case 6: { // star
      const r = o.rad * (1 + 0.06 * o.h + 0.03 * Math.sin(t * 2));
      const burst = o.act >= 0 ? o.act / 0.75 : 0;
      push(o.x, o.y, o.z, 0, r * 9, r * 9, 0.5, 0.5, UV.glow, 1, 0.85, 0.55, 0.55 + o.h * 0.3, 1, 0, 0.15, 2);
      push(o.x, o.y, o.z, t * 0.12, r * 7 * (1 + burst * 2), r * 7 * (1 + burst * 2), 0.5, 0.5, UV.rays, 1, 0.9, 0.7, 0.5 + o.h * 0.3 + burst * 0.5, 1, 0, 0.15, 2);
      push(o.x, o.y, o.z, -t * 0.07, r * 4.5, r * 4.5, 0.5, 0.5, UV.rays, 1, 0.95, 0.85, 0.5, 1, 0, 0.15, 2);
      push(o.x, o.y, o.z, Math.sin(t * 0.7) * 0.05, r * 2.2, r * 2.2, 0.5, 0.5, UV.star, 1.2, 1.15, 1.05, 1, 0, 0, 0.15, 2);
      hits.push({ o, x: o.sx, y: o.sy, r: r * 1.2 * o.s });
      break;
    }
    case 7: push(o.x + Math.sin(t * 0.05 + o.x) * 1.5, o.y, o.z, o.rot, o.size * 1.6, o.size, 0.5, 0.5, UV.puff[o.v], o.col[0], o.col[1], o.col[2], o.a, 0, 0, 0.45, 8); break;

    case 8: {
      const a = o.a * (1 - smooth(15, 40, cam.y)) * (0.8 + 0.2 * Math.sin(t * 0.4 + o.ph));
      if (a > 0.002) push(o.x, o.y, o.z, 0.38, o.w, o.h, 0.5, 0, UV.shaft, 1, 0.82, 0.55, a, 1, 0, 0.25, 6);
      break;
    }
    case 9: push(0, 0, 0, 0, trunkR(0) * 2, 101.5, 0.5, 1, UV.trunk, 1, 1, 1, 1, 0, 1, 1, 2.2); break;

    case 10: {
      const bk = 1 + Math.max(0, 3.5 - o.d) * 1.3, sz = o.sz * bk, a = o.a / (bk * bk) * (bk > 1 ? 1.6 : 1);
      if (o.snow) push(o.x, o.y, o.z, 0, sz * 1.7, sz * 1.7, 0.5, 0.5, bk > 1.4 ? UV.glow : UV.flake, 0.88, 0.92, 1, Math.min(1, a), 0, 0, 0.55, -1.0);
      else push(o.x, o.y, o.z, 0, sz, sz, 0.5, 0.5, UV.glow, 1, 0.8, 0.5, Math.min(1, a), 1, 0, 0.5, -1.0);
      break;
    }
  }
}

// particles: positions are generated in camera space so they always surround you
function updateParticles(list, t, alpha, out) {
  if (alpha < 0.01) return;
  const fx = -cam.sin, fz = -cam.cos;          // forward
  const rxv = cam.cos, rzv = -cam.sin;         // right
  for (const p of list) {
    const d = 0.7 + 46 * Math.pow(p.w, 1.7);
    const spanX = d * W / F * 1.2, spanY = d * H / F * 1.4;
    const fall = p.snow ? 1.6 + p.sz * 6 : -0.08;
    const sway = Math.sin(t * (p.snow ? 0.9 : 0.4) + p.ph) * (p.snow ? 0.5 : 0.3);
    let lx = ((p.u * spanX - cam.phi * cam.R * 0.9 + sway) % spanX + spanX) % spanX - spanX / 2;
    let ly = ((p.v * spanY - cam.y - t * fall) % spanY + spanY) % spanY - spanY / 2;
    p.x = cam.x + fx * d + rxv * lx; p.y = cam.y + ly; p.z = cam.z + fz * d + rzv * lx;
    p.d = d;
    p.a = alpha * (p.snow ? 0.85 : 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 2 + p.ph * 7), 3));
    out.push(p);
  }
}

// ================================================================ HIT TEST
function hitTest() {
  // nearest first: a dense needle clump in front blocks what's behind it
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if ((px - h.x) ** 2 + (py - h.y) ** 2 < h.r * h.r) return h.block ? null : h.o;
  }
  return null;
}

// ================================================================ FRAME
const vis = [];
let last = performance.now(), msAvg = 0;
function frame(now) {
  const t0 = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;

  pNow += (pTarget - pNow) * (1 - Math.exp(-dt * 4.5));
  mxS += (mx - mxS) * (1 - Math.exp(-dt * 3));
  myS += (my - myS) * (1 - Math.exp(-dt * 3));

  const c = camAt(pNow);
  cam.phi = c.phi + mxS * 0.05;
  cam.R = c.R; cam.y = c.y - myS * 0.25 * (c.R / 20);
  cam.sin = Math.sin(cam.phi); cam.cos = Math.cos(cam.phi);
  cam.x = cam.R * cam.sin; cam.z = cam.R * cam.cos;
  cam.hzPx = c.hz * H;
  const at = atmosAt(cam.y);

  drawSky(t, at);

  // ---- cull + sort
  vis.length = 0;
  const yMin = cam.y - 70, yMax = cam.y + 70;
  for (const o of world) {
    if (o.y < yMin - 40 || o.y > yMax) continue;
    if (!project(o, o.x, o.y, o.z)) continue;
    const ext = (o.size ? o.size * 1.6 : o.h && o.kind === 8 ? o.h : 8) * o.s;
    if (o.kind === 0 && ext < 1.5) continue;
    if (o.sx < -ext || o.sx > W + ext || o.sy < -ext - 20 || o.sy > H + ext) continue;
    vis.push(o);
  }
  trunk.d = cam.R; vis.push(trunk);
  const snowA = smooth(40, 68, cam.y);
  updateParticles(DUST, t, 1 - smooth(30, 60, cam.y), vis);
  updateParticles(SNOW, t, snowA, vis);
  vis.sort((a, b) => b.d - a.d);

  // ---- build instances
  N = 0; hits = [];
  for (const o of vis) {
    emit(o, t);
    if (o.kind === 0 && hits.length && o.d < 25) hits.push({ block: true, x: o.sx, y: o.sy, r: o.size * o.s * 0.2 * smooth(NEAR, 2.2, o.d) });
  }

  // ---- draw
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform3f(U.u_cam, cam.x, cam.y, cam.z);
  gl.uniform2f(U.u_sc, cam.sin, cam.cos);
  gl.uniform1f(U.u_F, F); gl.uniform1f(U.u_hz, cam.hzPx);
  gl.uniform2f(U.u_vp, W, H);
  gl.uniform3fv(U.u_haze, at.haze); gl.uniform1f(U.u_k, at.k); gl.uniform1f(U.u_camY, cam.y);
  gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, N * STRIDE);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, N);

  // ---- hover / click animation
  hovered = pointerIn && !opening ? hitTest() : null;
  cvs.style.cursor = hovered ? 'pointer' : '';
  for (const o of interactive) {
    o.h += ((o === hovered ? 1 : 0) - o.h) * (1 - Math.exp(-dt * 12));
    if (o.act >= 0) {
      o.act += dt;
      if (o.act > 0.75) { o.act = -1; if (opening === o) { opening = null; openPage(o.page); } }
    }
  }
  msAvg = msAvg * 0.95 + (performance.now() - t0) * 0.05;
  window.__stats = { ms: msAvg, instances: N, p: pNow, y: cam.y, R: cam.R, hz: cam.hzPx / H };
  requestAnimationFrame(frame);
}
pTarget = pNow = scrollP();
requestAnimationFrame(frame);
})();
