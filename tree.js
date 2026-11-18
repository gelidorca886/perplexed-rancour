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
//  ART: every drawn object is a named sprite (see ART.md). Drop a PNG at
//  art/<name>.png, add the name to art/manifest.json, and it replaces the
//  placeholder.
//
//  World units: tree is 100 tall, ~33 radius at the base. y is up.
//  Tree axis is x=0, z=0.
// =====================================================================
(async () => {
'use strict';

// ================================================================ CONFIG
// Every clickable thing → the page it opens. Rename / repoint freely.
const LINKS = {
  gifts:     ['gift-1', 'gift-2', 'gift-3', 'gift-4'],
  ornaments: ['ornament-1', 'ornament-2', 'ornament-3', 'ornament-4'],
  canes:     ['cane-1', 'cane-2'],
  creatures: ['creature-1', 'creature-2'],
  star:      'star',
};

// Camera path. p = path progress 0..1, y = altitude, R = distance from
// trunk, hz = where eye level sits on screen (0 top, 1 bottom).
const KEYS = [
  // p     y     R     hz
  [0.00,  1.4,  21,  0.80],   // STOP 1: floor, among the gifts
  [0.12,  5,    20,  0.72],
  [0.34, 22,    17,  0.58],   // STOP 2: ornament hollow
  [0.49, 37,    15,  0.57],
  [0.64, 50,    13.5,0.56],   // STOP 3: creature bough
  [0.75, 64,    12,  0.56],   //   through the cloud layer
  [0.86, 80,    14,  0.62],   //   breaking out above the clouds
  [0.93, 87,    27,  0.60],   //   pulling back, star rises into frame
  [1.00, 92,    34,  0.52],   // STOP 4: snowy tip, star, sky
];
const PHI0   = 0;              // starting angle around the trunk
const SPIRAL = Math.PI * 0.8;  // how far the camera circles the trunk over the climb
const NEAR   = 0.6;

// Detents. The scrollbar is split evenly between the stops; each stop
// holds the camera still for HOLD of the scroll on either side, and the
// travel between stops eases in and out. When scrolling stops between two
// stops, it settles into one (toward the direction you were going).
const STOPS     = [0, 0.34, 0.64, 1];   // path p of each stop (must match KEYS rows)
const HOLD      = 0.055;                 // fraction of total scroll each stop holds for (each side)
const SNAP      = !/nosnap/.test(location.search);  // settle into a stop when scrolling stops (?nosnap to disable)
const SNAP_WAIT = 180;                   // ms of no scrolling before settling
const SNAP_TIME = 900;                   // ms the settle takes
const FOG_AT_STOP = 0.5, FOG_BETWEEN = 1.35;  // haze multiplier: clear at stops, thick between

const SNOW_SWEEP = 0.25;   // how much falling snow slides sideways as the camera circles (1 = physically right)

// Atmosphere by altitude.
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
const smoother = t => t * t * t * (t * (t * 6 - 15) + 10);
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
  const y = catmull(k0[1], k1[1], k2[1], k3[1], t), Rr = catmull(k0[2], k1[2], k2[2], k3[2], t);
  const phi = PHI0 + SPIRAL * p;
  return { y, R: Rr, hz: catmull(k0[3], k1[3], k2[3], k3[3], t), phi,
    sin: Math.sin(phi), cos: Math.cos(phi), x: Rr * Math.sin(phi), z: Rr * Math.cos(phi) };
}
const CAM_BY_Y = [];
for (let i = 0; i <= 400; i++) {
  const y = i * 0.25; let lo = 0, hi = 1;
  for (let j = 0; j < 30; j++) { const m = (lo + hi) / 2; if (camAt(m).y < y) lo = m; else hi = m; }
  CAM_BY_Y.push(camAt(lo));
}
const camAtAltitude = y => CAM_BY_Y[clamp(Math.round(y * 4), 0, 400)];
const facing = phi => Math.PI / 2 - phi;

// scroll s (0..1) → path p, with holds at each stop
const S_STOPS = STOPS.map((_, i) => i / (STOPS.length - 1));
let scrollToPath = function (s) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = S_STOPS[i] + HOLD, b = S_STOPS[i + 1] - HOLD;
    if (s <= a) return STOPS[i];
    if (s < b) return lerp(STOPS[i], STOPS[i + 1], smoother((s - a) / (b - a)));
  }
  return STOPS[STOPS.length - 1];
};
// 0 at a stop, 1 halfway between two stops
function betweenness(p) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (p <= STOPS[i + 1]) return Math.sin(Math.PI * clamp((p - STOPS[i]) / (STOPS[i + 1] - STOPS[i]), 0, 1));
  }
  return 0;
}

function atmosAt(y) {
  let i = 0; while (i < ATMOS.length - 2 && y > ATMOS[i + 1].y) i++;
  const a = ATMOS[i], b = ATMOS[i + 1], t = smooth(a.y, b.y, y);
  return { haze: mix3(a.haze, b.haze, t), k: lerp(a.k, b.k, t), top: mix3(a.top, b.top, t), bot: mix3(a.bot, b.bot, t) };
}

// a point in front of a camera pose: u = sideways, v = up from eye level
// (both in screen-heights at that depth), d = depth
function inView(pose, u, v, d) {
  const lx = u * d / 0.95, ly = v * d / 0.95;
  return [pose.x - pose.sin * d + pose.cos * lx, pose.y + ly, pose.z - pose.cos * d - pose.sin * lx];
}
function toView(pose, x, y, z) {
  const rx = x - pose.x, rz = z - pose.z;
  const d = -(rx * pose.sin + rz * pose.cos);
  return { d, u: (rx * pose.cos - rz * pose.sin) / d * 0.95, v: (y - pose.y) / d * 0.95 };
}

// ================================================================ TREE SHAPE
const TREE_H = 100, BASE_R = 33;
const coneR  = y => BASE_R * Math.pow(clamp(1 - y / TREE_H, 0, 1), 0.65);
const trunkR = y => 2.2 * Math.pow(clamp(1 - y / (TREE_H + 2), 0, 1), 1.4) + 0.06;

// ================================================================ SPRITES
// Each sprite: name, cell size, placeholder drawing, and `inner` — the art
// is drawn at 1/inner of the cell so blur never reaches the cell edge.
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const SPEC = [];
const def = (name, w, h, draw, notes = '', inner = 1) => SPEC.push({ name, w, h, draw, notes, inner });
function radial(g, cx, cy, r, stops) {
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
}

// --- tree
const NEEDLE_K = 1.6;
const NEEDLE_PAL = ['#1a4a2a', '#22603a', '#2b7446', '#358a52', '#46a062'];
function needleDome(S) { // the top edge of a needle cluster, so snow can sit on it
  return x => -S * 0.21 * Math.sqrt(Math.max(0, 1 - (x / (S * 0.44)) ** 2)) - S * 0.02;
}
function drawNeedles(g, w, h, seed) {
  const r = rng(seed), S = w / NEEDLE_K;
  g.translate(w / 2, h / 2); g.lineCap = 'round';
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
}
function drawSnowcap(g, w, h, seed) {
  const r = rng(seed), S = w / NEEDLE_K, top = needleDome(S);
  g.translate(w / 2, h / 2);
  const N = 28, X0 = -S * 0.4, X1 = S * 0.4;
  const thick = [];
  for (let i = 0; i <= N; i++) thick.push(S * (0.045 + 0.035 * Math.sin(i * 1.3 + seed) + r() * 0.03));
  const blanket = () => {
    g.beginPath();
    for (let i = 0; i <= N; i++) { const x = lerp(X0, X1, i / N); g.lineTo(x, top(x) - S * 0.03); }
    for (let i = N; i >= 0; i--) {
      const x = lerp(X0, X1, i / N), edge = 1 - Math.pow(Math.abs(x) / (S * 0.42), 3);
      g.lineTo(x, top(x) - S * 0.03 + thick[i] * Math.max(0.15, edge));
    }
    g.closePath();
  };
  // soft blue shadow under the blanket, then the blanket
  g.save(); g.translate(0, S * 0.025); g.fillStyle = 'rgba(70,95,150,.55)'; blanket(); g.fill(); g.restore();
  const gr = g.createLinearGradient(0, -S * 0.27, 0, S * 0.02);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#e9f0fd'); gr.addColorStop(1, '#b4c5e4');
  g.fillStyle = gr; blanket(); g.fill();
  // lumps along the crest
  for (let i = 0; i < 16; i++) {
    const x = (r() - 0.5) * S * 0.72, y = top(x) - S * 0.03, rr = S * (0.025 + r() * 0.03);
    g.fillStyle = '#fbfdff'; g.beginPath(); g.ellipse(x, y, rr * 1.4, rr, 0, 0, TAU); g.fill();
  }
  // a few drips hanging off the lower edge
  for (let i = 0; i < 5; i++) {
    const j = 3 + ((r() * (N - 6)) | 0), x = lerp(X0, X1, j / N), y = top(x) - S * 0.03 + thick[j];
    g.fillStyle = '#d5e1f6'; g.beginPath(); g.ellipse(x, y, S * 0.018, S * (0.02 + r() * 0.025), 0, 0, TAU); g.fill();
  }
  // needle tips poking through the snow
  g.strokeStyle = '#2b6a40'; g.lineWidth = S * 0.014; g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const x = (r() - 0.5) * S * 0.7, y = top(x) - S * 0.02 + r() * S * 0.04;
    const a = -Math.PI / 2 + (r() - 0.5) * 2, L = S * (0.025 + r() * 0.035);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  // glints
  g.fillStyle = '#fff';
  for (let i = 0; i < 6; i++) { const x = (r() - 0.5) * S * 0.6; g.fillRect(x, top(x) - S * 0.03 + r() * S * 0.03, 1.5, 1.5); }
}
for (let v = 0; v < 4; v++) def(`tree/needles-${v}`, 128, 128, (g, w, h) => drawNeedles(g, w, h, 100 + v), 'needle cluster, mid-green, lit/shaded by the shader', NEEDLE_K);
for (let v = 0; v < 4; v++) def(`tree/snowcap-${v}`, 128, 128, (g, w, h) => drawSnowcap(g, w, h, 300 + v), 'snow lying on top of tree/needles-N; drawn over it, same frame', NEEDLE_K);
def('tree/trunk', 64, 1024, (g, w, h) => {
  const r = rng(77);
  for (let y = 0; y < h; y++) {
    const wy = (1 - y / h) * 101.5, hw = trunkR(wy) / trunkR(0) * w / 2;
    const gr = g.createLinearGradient(w / 2 - hw, 0, w / 2 + hw, 0);
    gr.addColorStop(0, '#1a0e07'); gr.addColorStop(0.35, '#5a3a22'); gr.addColorStop(0.6, '#3e2615'); gr.addColorStop(1, '#120904');
    g.fillStyle = gr; g.fillRect(w / 2 - hw, y, hw * 2, 1);
  }
  g.globalAlpha = 0.25; g.strokeStyle = '#000';
  for (let i = 0; i < 90; i++) { const x = w / 2 + (r() - 0.5) * w * 0.7, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y + 10 + r() * 30); g.stroke(); }
}, 'whole trunk, base at bottom, tip at top; tapers to a point');

// --- effects (white; tinted in code)
def('fx/glow', 64, 64, (g, w) => radial(g, w / 2, w / 2, w / 2, [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,.75)'], [0.45, 'rgba(255,255,255,.18)'], [1, 'rgba(255,255,255,0)']]), 'soft light halo, white');
def('fx/flake', 64, 64, (g, w) => radial(g, w / 2, w / 2, w * 0.3, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]), 'snowflake, white');
def('fx/disc', 32, 32, (g, w) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 1, 0, TAU); g.fill(); }, 'hard circle (eyes)');
def('fx/shadow', 64, 32, (g, w, h) => { g.scale(1, h / w); radial(g, w / 2, w / 2, w / 2, [[0, 'rgba(0,0,0,.9)'], [0.6, 'rgba(0,0,0,.5)'], [1, 'rgba(0,0,0,0)']]); }, 'contact shadow under gifts');
def('fx/shaft', 32, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  const gv = g.createLinearGradient(0, 0, 0, h);
  gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(0.2, 'rgba(0,0,0,1)'); gv.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gv; g.fillRect(0, 0, w, h);
}, 'light shaft, white');
for (let v = 0; v < 3; v++) def(`fx/puff-${v}`, 128, 96, (g, w, h) => {
  const r = rng(500 + v);
  for (let i = 0; i < 14; i++) radial(g, w * (0.32 + r() * 0.36), h * (0.42 + r() * 0.16), w * (0.08 + r() * 0.1), [[0, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]);
}, 'mist / cloud puff, white, very soft edges');
def('fx/rays', 256, 256, (g, w) => {
  g.translate(w / 2, w / 2);
  for (let i = 0; i < 16; i++) {
    g.rotate(TAU / 16);
    const L = w * (i % 2 ? 0.3 : 0.5), gr = g.createLinearGradient(0, 0, L, 0);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, -w * 0.012); g.lineTo(L, 0); g.lineTo(0, w * 0.012); g.fill();
  }
}, 'star burst rays, white');

// --- ornaments
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
ORN_COLORS.forEach((c, i) => def(`deco/ball-${i}`, BALL_W, BALL_H, g => drawBall(g, c, 0), 'decorative ornament; hook point = top centre'));
LINKS.ornaments.forEach((page, i) => def(`link/${page}`, BALL_W, BALL_H, g => drawBall(g, ORN_COLORS[i % 6], 1), 'clickable ornament; hook point = top centre'));
function drawCane(g, w, h) {
  const hookR = w * 0.26, x0 = w * 0.62, y0 = hookR + 6;
  const path = () => { g.beginPath(); g.arc(x0 - hookR, y0, hookR, 0, Math.PI, true); g.moveTo(x0, y0); g.lineTo(x0, h - 8); };
  g.lineCap = 'round'; g.strokeStyle = '#f4efe6'; g.lineWidth = w * 0.2; path(); g.stroke();
  g.strokeStyle = '#c4142c'; g.setLineDash([w * 0.13, w * 0.13]); g.lineCap = 'butt'; path(); g.stroke();
}
def('deco/cane', 64, 192, drawCane, 'decorative candy cane; hangs from a point 36% across, 4% down');
LINKS.canes.forEach(page => def(`link/${page}`, 64, 192, drawCane, 'clickable candy cane; hangs from a point 36% across, 4% down'));

// --- gifts
const GIFT_COLS = [['#7d1420', '#e8c25a'], ['#173f7a', '#e9e2d0'], ['#1f5c33', '#c21f2d'], ['#d9c9a8', '#7d1420'], ['#4a2366', '#e8c25a'], ['#c95a1a', '#173f7a']];
const drawBox = ([box, rib]) => (g, w, h) => {
  g.fillStyle = box; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(w * 0.8, 0, w * 0.2, h);
  g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, w, h * 0.08);
  g.fillStyle = rib; g.fillRect(w * 0.43, 0, w * 0.14, h);
};
const drawLid = ([box, rib]) => (g, w, h) => {
  g.fillStyle = box; g.fillRect(0, h * 0.6, w, h * 0.4);
  g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, h * 0.86, w, h * 0.14);
  g.fillStyle = rib; g.fillRect(w * 0.43, h * 0.6, w * 0.14, h * 0.4);
  g.beginPath(); g.ellipse(w * 0.36, h * 0.38, w * 0.15, h * 0.2, -0.4, 0, TAU); g.ellipse(w * 0.64, h * 0.38, w * 0.15, h * 0.2, 0.4, 0, TAU); g.fill();
};
GIFT_COLS.forEach((c, i) => { def(`deco/gift-${i}-box`, 128, 128, drawBox(c), 'box body (stretched to each gift\'s size)'); def(`deco/gift-${i}-lid`, 128, 64, drawLid(c), 'lid + bow; bottom edge sits on the box'); });
LINKS.gifts.forEach((page, i) => { def(`link/${page}-box`, 128, 128, drawBox(GIFT_COLS[i]), 'clickable gift body'); def(`link/${page}-lid`, 128, 64, drawLid(GIFT_COLS[i]), 'clickable gift lid + bow; flies off on click'); });

// --- creatures
const EYES = [[0.37, 0.4], [0.53, 0.4]];   // eye centres in the creature sprite (fractions)
const drawCritter = fur => (g, w, h) => {
  g.fillStyle = fur; g.strokeStyle = fur; g.lineCap = 'round'; g.lineWidth = w * 0.06;
  g.beginPath(); g.moveTo(w * 0.78, h * 0.8); g.quadraticCurveTo(w * 1.0, h * 0.75, w * 0.92, h * 0.5); g.stroke();
  g.beginPath(); g.ellipse(w * 0.52, h * 0.74, w * 0.3, h * 0.24, 0, 0, TAU); g.fill();
  g.beginPath(); g.arc(w * 0.44, h * 0.42, w * 0.21, 0, TAU); g.fill();
  g.beginPath(); g.arc(w * 0.28, h * 0.22, w * 0.1, 0, TAU); g.arc(w * 0.58, h * 0.2, w * 0.1, 0, TAU); g.fill();
  g.fillStyle = '#e8a0a0'; g.beginPath(); g.arc(w * 0.27, h * 0.5, w * 0.03, 0, TAU); g.fill();
};
LINKS.creatures.forEach((page, i) => def(`link/${page}`, 128, 128, drawCritter(['#8a8f99', '#6b4a32'][i % 2]), 'clickable creature, NO eyes (eyes are added and follow the cursor at 37%/53% across, 40% down); sits on its bottom edge'));

// --- star + lantern
def('link/star', 128, 128, (g, w) => {
  g.translate(w / 2, w / 2);
  g.fillStyle = '#ffd56a'; g.strokeStyle = '#fff6d0'; g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? w * 0.19 : w * 0.46; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill(); g.stroke();
}, 'the star on top, centred');
def('deco/lantern', 64, 128, (g, w, h) => {
  g.strokeStyle = '#2a1d10'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h * 0.14); g.stroke();
  g.beginPath(); g.arc(w / 2, h * 0.17, w * 0.08, 0, TAU); g.stroke();
  g.fillStyle = '#3a2814'; g.beginPath(); g.moveTo(w * 0.22, h * 0.32); g.lineTo(w * 0.5, h * 0.2); g.lineTo(w * 0.78, h * 0.32); g.fill();
  const gr = g.createRadialGradient(w / 2, h * 0.55, 2, w / 2, h * 0.55, w * 0.4);
  gr.addColorStop(0, '#fff6d8'); gr.addColorStop(0.4, '#ffc45a'); gr.addColorStop(1, '#d9762a');
  g.fillStyle = gr; g.fillRect(w * 0.26, h * 0.32, w * 0.48, h * 0.44);
  g.fillStyle = '#3a2814';
  for (const x of [0.24, 0.48, 0.72]) g.fillRect(w * x, h * 0.32, w * 0.05, h * 0.44);
  g.fillRect(w * 0.2, h * 0.76, w * 0.6, h * 0.07); g.fillRect(w * 0.2, h * 0.3, w * 0.6, h * 0.04);
}, 'hanging lantern at the middle stops; hangs from top centre; glow is added in code');

// ================================================================ BUILD THE WORLD
// kinds: 0 blob, 1 light, 2 ball, 3 cane, 4 critter, 5 gift, 6 star, 7 puff, 8 shaft, 9 trunk, 10 particle, 11 lantern
const blobs = [], lights = [], things = [], puffs = [], shafts = [], branches = [];
const POSE = STOPS.map(camAt);   // camera at each stop

function nearCameraPath(x, y, z, clear) {
  const c = camAtAltitude(y);
  return (x - c.x) ** 2 + (z - c.z) ** 2 < clear * clear;
}
const snowAt = y => smooth(56, 84, y);
function addBlob(x, y, z, size, inner, keep = false) {
  if (!keep && nearCameraPath(x, y, z, 1.6 + size * 0.35)) return;
  const v = 0.9 + R() * 0.2, b = lerp(0.42, 1.0, inner), sv = (R() * 4) | 0;
  blobs.push({ kind: 0, x, y, z, size, flip: R() < 0.5 ? -1 : 1, keep,
    spr: `tree/needles-${sv}`, snowSpr: `tree/snowcap-${sv}`,
    snow: clamp(snowAt(y) * 1.3 - R() * 0.3, 0, 1),
    tr: b * v * 0.95, tg: b * v, tb: b * v * 0.95 });
}
{
  let y = 4.8, tier = 0;
  while (y < 98.5) {
    const h = y / TREE_H;
    const n = Math.round(lerp(12, 7, h));
    const off = tier * 2.39996;
    for (let b = 0; b < n; b++) {
      const a = off + (b / n) * TAU + rand(-0.22, 0.22);
      const L = coneR(y) * rand(0.84, 1.04);
      const r0 = trunkR(y);
      const drop = L * rand(0.18, 0.3);
      const sizeK = lerp(1, 0.62, h);
      const ca = Math.cos(a), sa = Math.sin(a), ty = y;
      const pt = t => { const r = r0 + (L - r0) * t; return [r * ca, ty - drop * Math.pow(t, 1.7), r * sa]; };
      branches.push({ y, a, L, pt, sizeK });
      const step = 1.5 * sizeK + 0.3;
      const count = Math.max(2, Math.round((L - r0) / step));
      for (let i = 0; i < count; i++) {
        const t = Math.min(1, 0.08 + 0.92 * (i + rand(0, 0.6)) / count);
        const p = pt(t), lat = rand(-0.8, 0.8) * sizeK;
        addBlob(p[0] - sa * lat, p[1] + rand(-0.4, 0.4) * sizeK, p[2] + ca * lat, lerp(4.2, 2.8, t) * sizeK * rand(0.85, 1.2), t);
      }
      for (let s = 0; s < 2; s++) { // side shoots
        const t0 = rand(0.35, 0.8), p0 = pt(t0), sa2 = a + (s ? 1 : -1) * rand(0.6, 1.0), sl = L * rand(0.18, 0.3);
        for (let j = 1; j <= 3; j++) {
          const f = j / 3;
          addBlob(p0[0] + Math.cos(sa2) * sl * f, p0[1] - f * 0.6 * sizeK, p0[2] + Math.sin(sa2) * sl * f, 2.8 * sizeK * rand(0.85, 1.15), t0);
        }
      }
      const nl = 2 + ((R() * 4) | 0);
      for (let i = 0; i < nl; i++) {
        const p = pt(rand(0.25, 1)), cold = y > 70;
        const col = cold ? [[0.75, 0.88, 1], [1, 1, 1], [0.6, 0.75, 1]][(R() * 3) | 0] : [[1, 0.78, 0.42], [1, 0.52, 0.34], [1, 0.9, 0.62], [1, 0.36, 0.42]][(R() * 4) | 0];
        lights.push({ kind: 1, x: p[0] + rand(-0.4, 0.4), y: p[1] - 0.3 * sizeK, z: p[2] + rand(-0.4, 0.4), col, ph: rand(0, TAU), sp: rand(0.8, 2.6) });
      }
      if (y > 7 && y < 93 && R() < 0.3) { // decorative hangers
        const p = pt(rand(0.55, 0.95));
        if (y > 46 && R() < 0.3) things.push({ kind: 3, deco: true, x: p[0], y: p[1] - 0.3 * sizeK, z: p[2], len: 2.0 * sizeK, spr: 'deco/cane', h: 0, act: -1, sw: rand(0, TAU) });
        else things.push({ kind: 2, deco: true, x: p[0], y: p[1] - 0.35 * sizeK, z: p[2], rad: (y < 45 ? 0.8 : 0.65) * sizeK + 0.15, spr: `deco/ball-${(R() * 6) | 0}`, h: 0, act: -1, sw: rand(0, TAU) });
      }
    }
    y += lerp(3.4, 2.0, h) * rand(0.9, 1.1); tier++;
  }
  for (let yy = 92; yy < 101.5; yy += 0.55) { // the leader the star sits on
    const k = (101.5 - yy) / 9.5;
    for (let j = 0; j < 4; j++) { const a = rand(0, TAU), r = rand(0, 1.6) * k; addBlob(Math.cos(a) * r, yy, Math.sin(a) * r, lerp(1.1, 2.3, k) * rand(0.9, 1.2), 1); }
  }
}

// ---- the middle stops: clear a hollow in front of the camera, then dress it
function clearHollow(pose, depth, ru, rv) {
  const inside = o => { const q = toView(pose, o.x, o.y, o.z); return q.d > 0 && q.d < depth && (q.u / ru) ** 2 + (q.v / rv) ** 2 < 1; };
  for (const list of [blobs, lights, things]) for (let i = list.length - 1; i >= 0; i--) if (!list[i].keep && inside(list[i])) list.splice(i, 1);
}
function bough(pose, u0, u1, v, d, size = 2.6) { // a run of needle clusters across the view
  const n = Math.max(2, Math.round(Math.abs(u1 - u0) * d / 1.1));
  for (let i = 0; i <= n; i++) {
    const p = inView(pose, lerp(u0, u1, i / n), v + rand(-0.01, 0.01), d + rand(-0.6, 0.6));
    addBlob(p[0], p[1], p[2], size * rand(0.85, 1.15), 0.9, true);
  }
}
const anim = () => ({ h: 0, act: -1, sw: rand(0, TAU) });
const pointLights = [];
function lantern(pose, u, v, d) {
  const p = inView(pose, u, v, d);
  things.push({ kind: 11, x: p[0], y: p[1], z: p[2], len: 1.6, sw: rand(0, TAU), keep: true });
  pointLights.push({ x: p[0], y: p[1] - 1.1, z: p[2], r: 11, col: [1.7, 1.0, 0.45] });
}
{
  // STOP 2 — ornament hollow
  const P = POSE[1];
  clearHollow(P, 15, 0.72, 0.5);
  const spots = [[-0.52, 0.30, 9.5], [-0.18, 0.40, 11.5], [0.17, 0.27, 9], [0.5, 0.38, 11]];
  LINKS.ornaments.forEach((page, i) => {
    const [u, v, d] = spots[i], p = inView(P, u, v, d);
    bough(P, u - 0.14, u + 0.14, v + 0.05, d + 0.5);
    things.push({ kind: 2, x: p[0], y: p[1], z: p[2], rad: 0.9, spr: `link/${page}`, page, keep: true, ...anim() });
  });
  lantern(P, 0.02, 0.3, 13);
  bough(P, -0.22, 0.22, 0.38, 13.5, 3);
}
{
  // STOP 3 — creature bough
  const P = POSE[2];
  clearHollow(P, 14, 0.75, 0.5);
  bough(P, -0.9, 0.9, -0.2, 9, 2.8);                 // the branch they sit on
  LINKS.creatures.forEach((page, i) => {
    const p = inView(P, [-0.26, 0.2][i], -0.2, 9 - 0.6);
    things.push({ kind: 4, x: p[0], y: p[1] + 0.25, z: p[2], rad: 1.1, spr: `link/${page}`, page, keep: true, ...anim() });
  });
  LINKS.canes.forEach((page, i) => {
    const [u, v, d] = [[-0.56, 0.36, 9], [0.55, 0.4, 10]][i], p = inView(P, u, v, d);
    bough(P, u - 0.13, u + 0.13, v + 0.05, d + 0.5);
    things.push({ kind: 3, x: p[0], y: p[1], z: p[2], len: 2.3, spr: `link/${page}`, page, keep: true, ...anim() });
  });
  lantern(P, 0.0, 0.34, 13);
  bough(P, -0.2, 0.22, 0.42, 13.5, 3);
}
{
  // STOP 1 — gifts on the floor
  const a0 = facing(POSE[0].phi);
  const slots = [[-0.42, 10.5], [-0.14, 13.5], [0.12, 9], [0.38, 12.5]];
  LINKS.gifts.forEach((page, i) => {
    const [da, r] = slots[i];
    things.push({ kind: 5, x: Math.cos(a0 + da) * r, y: 0, z: Math.sin(a0 + da) * r, w: rand(2.2, 3.2), hh: rand(1.6, 2.6), spr: `link/${page}`, page, ...anim() });
  });
  for (let i = 0; i < 14; i++) {
    const a = a0 + rand(0.7, TAU - 0.7), r = rand(5, 16);
    things.push({ kind: 5, deco: true, x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, w: rand(1.4, 3.4), hh: rand(1.0, 2.8), spr: `deco/gift-${(R() * 6) | 0}`, ...anim() });
  }
}
// STOP 4 — the star
things.push({ kind: 6, x: 0, y: 102.5, z: 0, rad: 3.4, spr: 'link/star', page: LINKS.star, ...anim() });
pointLights.push({ x: 0, y: 102.5, z: 0, r: 16, col: [1.0, 0.8, 0.45] });

// mist inside the tree + the cloud layer the tree pokes through
for (let i = 0; i < 170; i++) {
  const y = rand(1, 60), a = rand(0, TAU), r = Math.sqrt(R()) * (coneR(y) + 6), warm = 1 - smooth(10, 45, y);
  puffs.push({ kind: 7, x: Math.cos(a) * r, y, z: Math.sin(a) * r, size: rand(6, 14), rot: rand(-0.3, 0.3), spr: `fx/puff-${(R() * 3) | 0}`,
    col: mix3([0.85, 0.6, 0.42], [0.62, 0.58, 0.85], 1 - warm), a: rand(0.1, 0.2) });
}
for (let i = 0; i < 260; i++) {
  const y = rand(62, 76), a = rand(0, TAU), r = Math.pow(R(), 0.7) * 140;
  puffs.push({ kind: 7, x: Math.cos(a) * r, y, z: Math.sin(a) * r, size: rand(14, 34), rot: rand(-0.15, 0.15), spr: `fx/puff-${(R() * 3) | 0}`,
    col: [0.72, 0.8, 0.98], a: rand(0.16, 0.32) });
}
for (let i = 0; i < 10; i++) {
  const a = rand(0, TAU), r = rand(4, 26);
  shafts.push({ kind: 8, x: Math.cos(a) * r, y: rand(34, 48), z: Math.sin(a) * r, w: rand(1.5, 4), h: rand(40, 55), a: rand(0.05, 0.11), ph: rand(0, TAU) });
}
const trunk = { kind: 9, x: 0, y: 0, z: 0 };
const DUST = Array.from({ length: 520 }, () => ({ kind: 10, snow: 0, u: R(), v: R(), w: R(), ph: rand(0, TAU), sz: rand(0.05, 0.12) }));
const SNOW = Array.from({ length: 1100 }, () => ({ kind: 10, snow: 1, u: R(), v: R(), w: R(), ph: rand(0, TAU), sz: rand(0.06, 0.15) }));

const world = [...blobs, ...lights, ...things, ...puffs, ...shafts];
const interactive = things.filter(o => o.page);

// ================================================================ ATLAS (placeholders + your art)
let manifest = [];
try { const r = await fetch('art/manifest.json', { cache: 'no-cache' }); if (r.ok) manifest = await r.json(); } catch (e) { /* no art yet */ }
const artImgs = {};
await Promise.all(manifest.map(name => new Promise(res => {
  const im = new Image(); im.onload = () => { artImgs[name] = im; res(); }; im.onerror = () => { console.warn('art missing:', name); res(); };
  im.src = `art/${name}.png`;
})));

// Slots grow to fit your drawing's resolution (up to 4×). The atlas grows to 4096 if it has to.
const PAD = 28;
const cellOf = s => {
  const im = artImgs[s.name];
  const k = im ? clamp(Math.min(im.width * s.inner / s.w, im.height * s.inner / s.h), 1, 4) : 1;
  return [Math.round(s.w * k), Math.round(s.h * k)];
};
function packInto(size) {
  let shX = 0, shY = 0, shH = 0; const out = [];
  for (const s of SPEC) {
    const [w, h] = cellOf(s);
    if (shX + w + PAD > size) { shX = 0; shY += shH + PAD; shH = 0; }
    if (shY + h + PAD > size) return null;
    out.push([s, shX + PAD / 2, shY + PAD / 2, w, h]);
    shX += w + PAD; shH = Math.max(shH, h);
  }
  return out;
}
let ATLAS = 2048, layout = packInto(ATLAS);
if (!layout) { ATLAS = 4096; layout = packInto(ATLAS); }
const atlas = mk(ATLAS, ATLAS), ag = atlas.getContext('2d');
const SPR = {};
for (const [s, x, y, w, h] of layout) {
  ag.save(); ag.translate(x, y); ag.beginPath(); ag.rect(0, 0, w, h); ag.clip();
  const im = artImgs[s.name];
  if (im) { // your drawing, fitted inside the art area, centred
    const aw = w / s.inner, ah = h / s.inner, k = Math.min(aw / im.width, ah / im.height);
    const dw = im.width * k, dh = im.height * k;
    ag.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else s.draw(ag, w, h);
  ag.restore();
  SPR[s.name] = [x / ATLAS, y / ATLAS, (x + w) / ATLAS, (y + h) / ATLAS];
}
window.__sprites = SPEC.map(s => ({ name: s.name, w: s.w, h: s.h, notes: s.notes, art: !!artImgs[s.name] }));
for (const o of world) {
  if (o.spr) o.uv = SPR[o.spr];
  if (o.snowSpr) o.snowUv = SPR[o.snowSpr];
  if (o.kind === 5) { o.uvBox = SPR[o.spr + '-box']; o.uvLid = SPR[o.spr + '-lid']; }
}
const UV = { glow: SPR['fx/glow'], flake: SPR['fx/flake'], disc: SPR['fx/disc'], shadow: SPR['fx/shadow'], shaft: SPR['fx/shaft'], rays: SPR['fx/rays'], trunk: SPR['tree/trunk'], lantern: SPR['deco/lantern'] };

// ================================================================ CANVASES + GL
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
const NPL = 3;
const VS = `#version 300 es
layout(location=0) in vec2 c;
layout(location=1) in vec3 a_pos;
layout(location=2) in float a_rot;
layout(location=3) in vec2 a_size;
layout(location=4) in vec2 a_off;
layout(location=5) in vec4 a_uv;
layout(location=6) in vec4 a_tint;
layout(location=7) in vec4 a_p;     // additive, lit, fogScale, nearOpaqueDist (negative = no depth-of-field)
uniform vec3 u_cam; uniform vec2 u_sc; uniform float u_F, u_hz; uniform vec2 u_vp;
out vec2 v_uv; out vec4 v_tint; out vec3 v_p; out float v_d; out vec3 v_wp; out float v_fade; out float v_dof;
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
  v_wp = vec3(a_pos.x, a_pos.y + (a_off.y - c.y) * a_size.y, a_pos.z);
  float fade = smoothstep(${NEAR.toFixed(2)}, abs(a_p.w), d);
  float scr = abs(a_size.y) * s / u_vp.y;
  fade *= 1.0 - smoothstep(1.4, 3.2, scr);
  v_fade = fade;
}`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform vec3 u_haze; uniform float u_k, u_camY;
uniform vec3 u_lw, u_lm, u_lc;
uniform vec4 u_pl[${NPL}]; uniform vec3 u_plc[${NPL}];
in vec2 v_uv; in vec4 v_tint; in vec3 v_p; in float v_d; in vec3 v_wp; in float v_fade; in float v_dof;
out vec4 o;
void main(){
  float d = v_d;
  float bias = ((1.0 - smoothstep(0.8, 6.0, d)) * 3.2 + smoothstep(30.0, 90.0, d) * 1.2) * v_dof;
  vec4 t = texture(u_tex, v_uv, bias);
  vec3 base = t.rgb * v_tint.rgb;
  vec3 col = base;
  if (v_p.y > 0.0) {
    float wy = v_wp.y;
    vec3 lc = mix(mix(u_lw, u_lm, smoothstep(8.0, 45.0, wy)), u_lc, smoothstep(55.0, 85.0, wy));
    float elev = (wy - u_camY) / d;
    float under = smoothstep(0.0, 1.1, elev);
    float near = 1.0 - smoothstep(1.0, 8.0, d);
    float L = mix(1.0, 0.3, under) * mix(1.0, 0.2, near);
    vec3 pl = vec3(0.0);
    for (int i = 0; i < ${NPL}; i++) {
      vec3 dv = v_wp - u_pl[i].xyz;
      float q = dot(dv, dv) / (u_pl[i].w * u_pl[i].w);
      pl += u_plc[i] * (1.0 - smoothstep(0.3, 1.0, q)) / (1.0 + q * 6.0);
    }
    col = mix(col, col * lc * L + base * pl * mix(1.0, 0.5, near), v_p.y);
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
for (const n of ['u_cam', 'u_sc', 'u_F', 'u_hz', 'u_vp', 'u_tex', 'u_haze', 'u_k', 'u_camY', 'u_lw', 'u_lm', 'u_lc', 'u_pl', 'u_plc']) U[n] = gl.getUniformLocation(prog, n);

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
const plPos = new Float32Array(NPL * 4), plCol = new Float32Array(NPL * 3);
pointLights.slice(0, NPL).forEach((l, i) => plPos.set([l.x, l.y, l.z, l.r], i * 4));
addEventListener('resize', resize); resize();

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

const scrollMax = () => document.documentElement.scrollHeight - innerHeight;
function scrollS() { const m = scrollMax(); return m > 0 ? clamp(scrollY / m, 0, 1) : 0; }
let sPrev = 0, lastDir = 1, lastScrollT = 0, userMoved = false, snap = null;
addEventListener('scroll', () => {
  const s = scrollS();
  pTarget = scrollToPath(s);
  if (snap) return;                       // our own settling scroll
  if (s !== sPrev) lastDir = Math.sign(s - sPrev);
  sPrev = s; lastScrollT = performance.now(); userMoved = true;
}, { passive: true });
const cancelSnap = () => { snap = null; };
for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) addEventListener(ev, cancelSnap, { passive: true });

function maybeSnap(now) {
  if (snap) {
    const k = clamp((now - snap.t0) / SNAP_TIME, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    window.scrollTo(0, lerp(snap.from, snap.to, e));
    if (k >= 1) { snap = null; sPrev = scrollS(); }
    return;
  }
  if (!SNAP || !userMoved || now - lastScrollT < SNAP_WAIT) return;
  userMoved = false;
  const s = scrollS();
  let i = 0; while (i < S_STOPS.length - 2 && s > S_STOPS[i + 1]) i++;
  const a = S_STOPS[i] + HOLD, b = S_STOPS[i + 1] - HOLD;
  let target;
  if (s <= a) target = null;                     // already resting in a stop
  else if (s >= b) target = null;
  else { const f = (s - a) / (b - a); target = (lastDir > 0 ? f > 0.15 : f > 0.85) ? i + 1 : i; }
  if (target === null) return;
  const to = S_STOPS[target] * scrollMax();
  if (Math.abs(to - scrollY) > 2) snap = { from: scrollY, to, t0: now };
}

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
  for (let i = 0; i < 40; i++) {
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

function drawSky(t, dt, at) {
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
    const mxp = W * 0.8 + (POSE[3].phi - cam.phi) * kx, myp = H * 0.18 - (cam.y - 90) * 3;
    sky.globalAlpha = sa;
    const mg = sky.createRadialGradient(mxp, myp, 0, mxp, myp, H * 0.45);
    mg.addColorStop(0, 'rgba(200,215,255,.35)'); mg.addColorStop(0.08, 'rgba(170,190,255,.12)'); mg.addColorStop(1, 'rgba(150,170,255,0)');
    sky.fillStyle = mg; sky.fillRect(mxp - H * 0.45, myp - H * 0.45, H * 0.9, H * 0.9);
    sky.fillStyle = '#eef1ff'; sky.beginPath(); sky.arc(mxp, myp, H * 0.035, 0, TAU); sky.fill();
    sky.fillStyle = 'rgba(160,170,200,.35)';
    sky.beginPath(); sky.arc(mxp - H * 0.01, myp - H * 0.006, H * 0.009, 0, TAU); sky.arc(mxp + H * 0.012, myp + H * 0.01, H * 0.006, 0, TAU); sky.fill();
    if (sa > 0.6) {
      nextShoot -= dt;
      if (!shooting && nextShoot < 0) { shooting = { x: rand(0.1, 0.9) * W, y: rand(0.05, 0.35) * H, t: 0 }; nextShoot = rand(3, 8); }
    }
    if (shooting) {
      shooting.t += dt;
      const k = shooting.t / 0.9, hx = shooting.x - k * 420, hy = shooting.y + k * 200;
      const gr = sky.createLinearGradient(hx, hy, hx + 150, hy - 72);
      gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      sky.globalAlpha = sa * Math.sin(Math.min(1, k) * Math.PI);
      sky.strokeStyle = gr; sky.lineWidth = 1.5;
      sky.beginPath(); sky.moveTo(hx, hy); sky.lineTo(hx + 150, hy - 72); sky.stroke();
      if (k >= 1) shooting = null;
    }
    sky.globalAlpha = 1;
  }
  const fire = 1 - smooth(4, 40, cam.y);
  if (fire > 0) {
    const fx = W * 0.5 + Math.sin(-cam.phi + 2.2) * W * 0.9;
    const flick = 0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
    const fg = sky.createRadialGradient(fx, H * 0.95, 0, fx, H * 0.95, H * 1.2);
    fg.addColorStop(0, `rgba(255,140,60,${0.4 * fire * flick})`); fg.addColorStop(1, 'rgba(255,140,60,0)');
    sky.fillStyle = fg; sky.fillRect(0, 0, W, H);
  }
  const far = 1 - Math.exp(-at.k * 70);
  sky.globalAlpha = far * 0.9; sky.fillStyle = css(at.haze); sky.fillRect(0, 0, W, H); sky.globalAlpha = 1;
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
let hits = [];
function emit(o, t) {
  switch (o.kind) {
    case 0: {
      const w = o.size * NEEDLE_K;
      push(o.x, o.y, o.z, 0, w * o.flip, w, 0.5, 0.5, o.uv, o.tr, o.tg, o.tb, 1, 0, 1, 1, 2.2);
      if (o.snow > 0.01) {
        // snow lies on top: you see it from level or above, not from underneath
        const elev = (o.y - cam.y) / o.d;
        const a = o.snow * (1 - smooth(0.15, 0.75, elev));
        if (a > 0.01) push(o.x, o.y, o.z, 0, w * o.flip, w, 0.5, 0.5, o.snowUv, 1, 1, 1, a, 0, 0.45, 1, 2.2);
      }
      break;
    }
    case 1: {
      const tw = 0.55 + 0.45 * Math.sin(t * o.sp + o.ph), sz = 0.7 + tw * 0.6;
      push(o.x, o.y, o.z, 0, sz, sz, 0.5, 0.5, UV.glow, o.col[0], o.col[1], o.col[2], 0.55 + 0.45 * tw, 1, 0, 0.4, 1.0);
      break;
    }
    case 2: {
      const act = o.act;
      const swing = Math.sin(t * 1.3 + o.sw) * 0.06 + Math.sin(t * 7) * 0.2 * o.h + (act >= 0 ? Math.sin(act * 14) * 0.5 * (1 - act / 0.75) : 0);
      const sc = 1 + 0.1 * o.h, spin = act >= 0 ? Math.cos(act * 30) : 1, br = 1 + 0.35 * o.h;
      const w = 2 * o.rad * sc, h = w * BALL_H / BALL_W;
      push(o.x, o.y, o.z, swing, w * spin, h, 0.5, 0, o.uv, br, br, br, 1, 0, 0.65, 1, 2.2);
      const gl8 = Math.pow(0.5 + 0.5 * Math.sin(t * 2.2 + o.sw * 5), 12) + o.h * 0.6;
      if (gl8 > 0.02) {
        const p = bOff(o.x, o.y, o.z, -w * 0.18, h - w * 0.68, swing);
        push(p[0], p[1], p[2], t, w * 0.7, w * 0.7, 0.5, 0.5, UV.rays, 1, 0.97, 0.9, gl8, 1, 0, 0.5, 2.2);
      }
      if (o.page) hits.push({ o, x: o.sx - Math.sin(swing) * (h - w / 2) * o.s, y: o.sy + Math.cos(swing) * (h - w / 2) * o.s, r: w * 0.6 * o.s });
      break;
    }
    case 3: {
      const act = o.act;
      const swing = Math.sin(t * 1.1 + o.sw) * 0.05 + Math.sin(t * 7) * 0.18 * o.h + (act >= 0 ? Math.sin(act * 14) * 0.5 * (1 - act / 0.75) : 0);
      const h = o.len * (1 + 0.08 * o.h), w = h / 3, br = 1 + 0.3 * o.h;
      push(o.x, o.y, o.z, swing, w, h, 0.36, 0.04, o.uv, br, br, br, 1, 0, 0.65, 1, 2.2);
      if (o.page) hits.push({ o, x: o.sx - Math.sin(swing) * h * 0.5 * o.s, y: o.sy + h * 0.5 * o.s, r: h * 0.45 * o.s });
      break;
    }
    case 4: {
      const r = o.rad, act = o.act;
      const hop = act >= 0 ? Math.sin(Math.min(1, act / 0.6) * Math.PI) * r * 1.4 : 0;
      const lift = hop + o.h * r * 0.2 + Math.sin(t * 2 + o.sw) * r * 0.03;
      const w = r * 2.4, sq = 1 + o.h * 0.06, y = o.y + lift;
      push(o.x, y, o.z, 0, w / sq, w * sq, 0.5, 1, o.uv, 1, 1, 1, 1, 0, 0.6, 1, 2.2);
      const blink = Math.sin(t * 0.9 + o.sw * 3) > 0.985 ? 0.15 : 1;
      for (const [fx, fy] of EYES) {
        const dx = (fx - 0.5) * w / sq, dy = (fy - 1) * w * sq;
        const e = [o.x + cam.cos * dx, y - dy, o.z - cam.sin * dx], er = r * 0.26;
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
    case 5: {
      const act = o.act, jig = o.h * Math.sin(t * 22) * 0.04;
      const hop = act >= 0 ? Math.sin(Math.min(1, act / 0.35) * Math.PI) * o.hh * 0.25 : 0;
      const lid = act >= 0 ? Math.min(1, act / 0.45) : 0;
      const sq = 1 + o.h * 0.05, br = 1 + o.h * 0.2;
      const w = o.w / Math.sqrt(sq), h = o.hh * sq;
      push(o.x, 0.01, o.z, 0, o.w * 1.3, o.w * 0.3, 0.5, 0.5, UV.shadow, 1, 1, 1, 0.6, 0, 0, 1, 2.2);
      push(o.x, hop, o.z, jig, w, h, 0.5, 1, o.uvBox, br, br, br, 1, 0, 0.8, 1, 2.2);
      push(o.x, hop + h + lid * h * 1.2, o.z, jig - lid * 0.5, w * 1.08, w * 0.54, 0.5, 1, o.uvLid, br, br, br, 1, 0, 0.8, 1, 2.2);
      if (lid > 0) push(o.x, h, o.z, 0, w * 3, w * 3, 0.5, 0.6, UV.glow, 1, 0.85, 0.55, lid, 1, 0, 0.3, 1.0);
      if (o.page) hits.push({ o, x: o.sx, y: o.sy - h * 0.55 * o.s, r: Math.max(w, h) * 0.6 * o.s });
      break;
    }
    case 6: {
      const r = o.rad * (1 + 0.06 * o.h + 0.03 * Math.sin(t * 2)), burst = o.act >= 0 ? o.act / 0.75 : 0;
      push(o.x, o.y, o.z, 0, r * 9, r * 9, 0.5, 0.5, UV.glow, 1, 0.85, 0.55, 0.55 + o.h * 0.3, 1, 0, 0.15, 2);
      push(o.x, o.y, o.z, t * 0.12, r * 7 * (1 + burst * 2), r * 7 * (1 + burst * 2), 0.5, 0.5, UV.rays, 1, 0.9, 0.7, 0.5 + o.h * 0.3 + burst * 0.5, 1, 0, 0.15, 2);
      push(o.x, o.y, o.z, -t * 0.07, r * 4.5, r * 4.5, 0.5, 0.5, UV.rays, 1, 0.95, 0.85, 0.5, 1, 0, 0.15, 2);
      push(o.x, o.y, o.z, Math.sin(t * 0.7) * 0.05, r * 2.2, r * 2.2, 0.5, 0.5, o.uv, 1.2, 1.15, 1.05, 1, 0, 0, 0.15, 2);
      hits.push({ o, x: o.sx, y: o.sy, r: r * 1.2 * o.s });
      break;
    }
    case 7: push(o.x + Math.sin(t * 0.05 + o.x) * 1.5, o.y, o.z, o.rot, o.size * 1.6, o.size, 0.5, 0.5, o.uv, o.col[0], o.col[1], o.col[2], o.a, 0, 0, 0.45, 8); break;
    case 8: {
      const a = o.a * (1 - smooth(15, 40, cam.y)) * (0.8 + 0.2 * Math.sin(t * 0.4 + o.ph));
      if (a > 0.002) push(o.x, o.y, o.z, 0.38, o.w, o.h, 0.5, 0, UV.shaft, 1, 0.82, 0.55, a, 1, 0, 0.25, 6);
      break;
    }
    case 9: push(0, 0, 0, 0, trunkR(0) * 2, 101.5, 0.5, 1, UV.trunk, 1, 1, 1, 1, 0, 1, 1, 2.2); break;
    case 10: {
      const bk = 1 + Math.max(0, 3.5 - o.d) * 1.3, sz = o.sz * bk, a = Math.min(1, o.a / (bk * bk) * (bk > 1 ? 1.6 : 1));
      if (o.snow) push(o.x, o.y, o.z, 0, sz * 1.7, sz * 1.7, 0.5, 0.5, bk > 1.4 ? UV.glow : UV.flake, 0.88, 0.92, 1, a, 0, 0, 0.55, -1.0);
      else push(o.x, o.y, o.z, 0, sz, sz, 0.5, 0.5, UV.glow, 1, 0.8, 0.5, a, 1, 0, 0.5, -1.0);
      break;
    }
    case 11: { // lantern + its glow
      const swing = Math.sin(t * 0.9 + o.sw) * 0.04, fl = 0.9 + 0.1 * Math.sin(t * 9 + o.sw) * Math.sin(t * 4.3);
      push(o.x, o.y, o.z, 0, 9, 9, 0.5, 0.5 - 1.1 / 9, UV.glow, 1, 0.66, 0.32, 0.5 * fl, 1, 0, 0.3, 3);
      push(o.x, o.y, o.z, swing, 1.1, 2.2, 0.5, 0, UV.lantern, 1, 1, 1, 1, 0, 0, 0.6, 2.2);
      push(o.x, o.y, o.z, 0, 2.6, 2.6, 0.5, 0.5 - 1.25 / 2.6, UV.glow, 1, 0.85, 0.55, 0.9 * fl, 1, 0, 0.3, 2.2);
      break;
    }
  }
}

function updateParticles(list, t, alpha, out) {
  if (alpha < 0.01) return;
  const fx = -cam.sin, fz = -cam.cos, rxv = cam.cos, rzv = -cam.sin;
  for (const p of list) {
    const d = 0.7 + 46 * Math.pow(p.w, 1.7);
    const spanX = d * W / F * 1.2, spanY = d * H / F * 1.4;
    const fall = p.snow ? 1.6 + p.sz * 6 : -0.08;
    const sway = Math.sin(t * (p.snow ? 0.9 : 0.4) + p.ph) * (p.snow ? 0.5 : 0.3);
    // orbiting the trunk moves a flake at depth d sideways by (R - d)·Δφ; SNOW_SWEEP damps it
    const orbit = (cam.R - d) * cam.phi * SNOW_SWEEP;
    const lx = ((p.u * spanX + orbit + sway) % spanX + spanX) % spanX - spanX / 2;
    const ly = ((p.v * spanY - cam.y - t * fall) % spanY + spanY) % spanY - spanY / 2;
    p.x = cam.x + fx * d + rxv * lx; p.y = cam.y + ly; p.z = cam.z + fz * d + rzv * lx;
    p.d = d;
    p.a = alpha * (p.snow ? 0.85 : 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 2 + p.ph * 7), 3));
    out.push(p);
  }
}

function hitTest() {
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

  maybeSnap(now);
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
  at.k *= lerp(FOG_AT_STOP, FOG_BETWEEN, betweenness(pNow));

  drawSky(t, dt, at);

  vis.length = 0;
  const yMin = cam.y - 70, yMax = cam.y + 70;
  for (const o of world) {
    if (o.y < yMin - 40 || o.y > yMax) continue;
    if (!project(o, o.x, o.y, o.z)) continue;
    const ext = (o.size ? o.size * 1.6 : o.kind === 8 ? o.h : 10) * o.s;
    if (o.kind === 0 && ext < 1.5) continue;
    if (o.sx < -ext || o.sx > W + ext || o.sy < -ext - 20 || o.sy > H + ext) continue;
    vis.push(o);
  }
  trunk.d = cam.R; vis.push(trunk);
  updateParticles(DUST, t, 1 - smooth(30, 60, cam.y), vis);
  updateParticles(SNOW, t, smooth(40, 68, cam.y), vis);
  vis.sort((a, b) => b.d - a.d);

  N = 0; hits = [];
  for (const o of vis) {
    emit(o, t);
    if (o.kind === 0 && hits.length && o.d < 25) hits.push({ block: true, x: o.sx, y: o.sy, r: o.size * o.s * 0.2 * smooth(NEAR, 2.2, o.d) });
  }

  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform3f(U.u_cam, cam.x, cam.y, cam.z);
  gl.uniform2f(U.u_sc, cam.sin, cam.cos);
  gl.uniform1f(U.u_F, F); gl.uniform1f(U.u_hz, cam.hzPx);
  gl.uniform2f(U.u_vp, W, H);
  gl.uniform3fv(U.u_haze, at.haze); gl.uniform1f(U.u_k, at.k); gl.uniform1f(U.u_camY, cam.y);
  pointLights.slice(0, NPL).forEach((l, i) => {
    const fl = 0.85 + 0.15 * Math.sin(t * 9 + i) * Math.sin(t * 4.3 + i * 2);
    plCol.set([l.col[0] * fl, l.col[1] * fl, l.col[2] * fl], i * 3);
  });
  gl.uniform4fv(U.u_pl, plPos); gl.uniform3fv(U.u_plc, plCol);
  gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, N * STRIDE);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, N);

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
  window.__stats = { ms: msAvg, instances: N, p: pNow, y: cam.y, R: cam.R };
  requestAnimationFrame(frame);
}
sPrev = scrollS(); pTarget = pNow = scrollToPath(sPrev);
const forceP = new URLSearchParams(location.search).get('p');      // ?p=0.34 pins the camera (for testing)
if (forceP !== null) { pTarget = pNow = +forceP; scrollToPath = () => +forceP; }
requestAnimationFrame(frame);
})();
