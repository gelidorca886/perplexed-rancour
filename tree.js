// =====================================================================
//  THE TREE — blockout
//  A fake-3D camera climbs a giant tree. Scroll down = camera goes up.
//  Everything is a flat sprite placed in 3D, projected, sorted far→near.
//
//  World units: tree is 100 tall, ~33 radius at the base. y is up.
//  Tree axis is x=0,z=0.
// =====================================================================
(() => {
'use strict';

// ---------------------------------------------------------------- links
// Every clickable thing. Rename / repoint freely.
const LINKS = {
  gifts:     ['gift-1', 'gift-2', 'gift-3', 'gift-4'],
  ornaments: ['ornament-1', 'ornament-2', 'ornament-3', 'ornament-4'],
  canes:     ['cane-1', 'cane-2'],
  creatures: ['creature-1', 'creature-2'],
  star:      'star',
};

// ---------------------------------------------------------------- camera path
// p = scroll progress 0..1.  y = altitude, R = distance from trunk,
// hz = where eye-level sits on screen (0 top, 1 bottom). Low hz = looking up.
const KEYS = [
  // p     y     R     hz
  [0.00,  1.4,  21,  0.80],   // on the floor among the gifts
  [0.08,  2.6,  20.5,0.78],   // linger
  [0.30, 22,    17,  0.64],   // lower branches, ornaments
  [0.55, 46,    13.5,0.58],   // second level, candy + creatures
  [0.75, 68,    10.5,0.56],   // thinning, snow starting
  [0.87, 82,    13,  0.56],   // breaking out of the branches
  [1.00, 88,    32,  0.56],   // pulled back: snowy tip, star, night sky
];
const PHI0   = 0;              // starting angle around the trunk
const SPIRAL = Math.PI * 0.8;  // how far the camera circles the trunk over the whole climb
const NEAR   = 0.7;

// ---------------------------------------------------------------- utils
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
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;

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
// altitude → camera state at that altitude (for placing things where the camera will see them)
function camAtAltitude(y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (camAt(m).y < y) lo = m; else hi = m; }
  return camAt(lo);
}
// branch-angle that faces the camera when the camera is at angle phi
const facing = phi => Math.PI / 2 - phi;

// ---------------------------------------------------------------- canvas
const cvs = document.getElementById('scene');
const ctx = cvs.getContext('2d');
let W = 0, H = 0, DPR = 1, F = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  W = innerWidth; H = innerHeight;
  cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
  F = Math.min(H, W * 1.3) * 0.95;
}
addEventListener('resize', resize); resize();
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------------------------------------------------------------- tree shape
const TREE_H = 100, BASE_R = 33;
const coneR  = y => BASE_R * Math.pow(clamp(1 - y / TREE_H, 0, 1), 0.65);
const trunkR = y => 2.2 * Math.pow(clamp(1 - y / (TREE_H + 2), 0, 1), 1.4) + 0.06;

// ---------------------------------------------------------------- sprites
const SS = 160; // needle sprite size
const PAL = [
  ['#040a06', '#07110a', '#0a170e', '#0d1d12'],            // 0: silhouette (right in front of camera)
  ['#08160d', '#0c2214', '#112c1a', '#163621'],            // 1: inner (near trunk, shaded)
  ['#123a22', '#1a4b2b', '#235f37', '#2e7744', '#3a8c52'], // 2: outer
];
function needleSprite(pal, snowy, seed) {
  const c = mk(SS, SS), g = c.getContext('2d'), r = rng(seed);
  g.translate(SS / 2, SS / 2); g.lineCap = 'round';
  g.fillStyle = pal[0];
  g.beginPath(); g.ellipse(0, 4, SS * 0.27, SS * 0.15, 0, 0, TAU); g.fill();
  const N = 150;
  for (let i = 0; i < N; i++) {
    const k = i / N;                                // later needles = lighter, more on top
    const a = r() * TAU, rad = Math.pow(r(), 0.55) * SS * 0.34;
    const x = Math.cos(a) * rad * 1.2, y = Math.sin(a) * rad * 0.7 - k * SS * 0.06;
    const ang = Math.atan2(y, x) + (r() - 0.5) * 1.1;
    const len = SS * (0.05 + r() * 0.07);
    g.strokeStyle = pal[Math.min(pal.length - 1, Math.floor(k * pal.length + r() * 0.8))];
    g.lineWidth = SS * 0.016;
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len * 0.6 + len * 0.3);
    g.stroke();
  }
  if (snowy) {
    for (let i = 0; i < 9; i++) {
      const x = (r() - 0.5) * SS * 0.6, y = -SS * 0.08 - r() * SS * 0.07 + Math.abs(x) * 0.25;
      const rx = SS * (0.07 + r() * 0.08), ry = rx * 0.45;
      g.fillStyle = '#9fb3cf'; g.beginPath(); g.ellipse(x, y + ry * 0.5, rx, ry, 0, 0, TAU); g.fill();
      g.fillStyle = '#eef4ff'; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
    }
  }
  return c;
}
const NEEDLES = PAL.map((pal, si) => [0, 1].map(sn => [0, 1, 2].map(v => needleSprite(pal, sn, si * 100 + sn * 10 + v + 1))));

const ORN_COLORS = ['#b3122e', '#d9a520', '#1d4fb8', '#c9ccd6', '#7a2bb0', '#0f8a6a'];
function ballSprite(col, banded) {
  const S = 96, c = mk(S, S), g = c.getContext('2d');
  const gr = g.createRadialGradient(S * 0.36, S * 0.34, S * 0.04, S / 2, S / 2, S * 0.48);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.12, col); gr.addColorStop(0.75, col); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, S * 0.46, 0, TAU); g.fill();
  if (banded) {
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, S * 0.46, 0, TAU); g.clip();
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(0, S * 0.44, S, S * 0.1);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, S * 0.58, S, S * 0.04); g.fillRect(0, S * 0.34, S, S * 0.04);
    g.restore();
  }
  return c;
}
const BALLS  = ORN_COLORS.map(c => ballSprite(c, false));
const BALLSB = ORN_COLORS.map(c => ballSprite(c, true));

function glowSprite(col) {
  const S = 64, c = mk(S, S), g = c.getContext('2d');
  const [r, gg, b] = hex(col);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, `rgba(255,255,255,1)`); gr.addColorStop(0.12, `rgba(${r},${gg},${b},.9)`);
  gr.addColorStop(0.4, `rgba(${r},${gg},${b},.25)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return c;
}
const GLOW_WARM = ['#ffcf7a', '#ff8a5c', '#ffe9b0', '#ff5f6d'].map(glowSprite);
const GLOW_COLD = ['#bfe3ff', '#ffffff', '#9fc4ff', '#e6f0ff'].map(glowSprite);

// ---------------------------------------------------------------- build the world
const blobs = [], sticks = [], lights = [], hangers = [], branches = [];
{
  let y = 5.2, tier = 0;
  while (y < 98.5) {
    const h = y / TREE_H;
    const n = Math.max(5, Math.round(lerp(10, 6, h)));
    const off = tier * 2.39996; // golden angle — no branch stacks directly on the one below
    for (let b = 0; b < n; b++) {
      const a = off + (b / n) * TAU + rand(-0.25, 0.25);
      const L = coneR(y) * rand(0.82, 1.04);
      const r0 = trunkR(y);
      const drop = L * rand(0.18, 0.32);
      const sizeK = lerp(1, 0.62, h);
      const ca = Math.cos(a), sa = Math.sin(a), ty = y;
      const pt = t => { const r = r0 + (L - r0) * t; return [r * ca, ty - drop * Math.pow(t, 1.7), r * sa]; };
      const br = { y, a, L, pt, sizeK, used: false };
      branches.push(br);
      const A = pt(0), B = pt(0.85);
      sticks.push({ ax: A[0], ay: A[1], az: A[2], bx: B[0], by: B[1], bz: B[2], w: 0.35 * sizeK + 0.1 });

      const step = 2.0 * sizeK + 0.3;
      const count = Math.max(2, Math.round((L - r0) / step));
      for (let i = 0; i < count; i++) {
        const t = Math.min(1, 0.1 + 0.9 * (i + rand(0, 0.6)) / count);
        const p = pt(t);
        const lat = rand(-0.9, 0.9) * sizeK;
        blobs.push({
          type: 0, x: p[0] - sa * lat, y: p[1] + rand(-0.4, 0.4) * sizeK, z: p[2] + ca * lat,
          size: lerp(3.8, 2.4, t) * sizeK * rand(0.85, 1.2),
          shade: t < 0.4 ? 1 : 2,
          snowy: R() < smooth(62, 84, y) ? 1 : 0,
          v: (R() * 3) | 0, flip: R() < 0.5 ? -1 : 1,
        });
      }
      const nl = (R() * 3) | 0;
      for (let i = 0; i < nl; i++) {
        const p = pt(rand(0.3, 1));
        lights.push({ type: 1, x: p[0], y: p[1] - 0.3 * sizeK, z: p[2], c: (R() * 4) | 0, ph: rand(0, TAU), sp: rand(0.8, 2.6), cold: y > 72 });
      }
    }
    y += lerp(4.0, 2.3, h) * rand(0.9, 1.1); tier++;
  }
}

// the leader — the top shoot the star sits on
for (let y = 93; y < 101.5; y += 0.7) {
  const k = (101.5 - y) / 8.5;
  for (let j = 0; j < 3; j++) {
    const a = rand(0, TAU), r = rand(0, 1.4) * k;
    blobs.push({ type: 0, x: Math.cos(a) * r, y, z: Math.sin(a) * r, size: lerp(1.0, 2.0, k) * rand(0.9, 1.2),
      shade: 2, snowy: R() < 0.8 ? 1 : 0, v: (R() * 3) | 0, flip: R() < 0.5 ? -1 : 1 });
  }
}

// pick a branch at altitude yMin..yMax that sits off to one side of the camera's view
function pickBranch(yMin, yMax, side) {
  let best = null, bestScore = 1e9;
  for (const br of branches) {
    if (br.used || br.y < yMin || br.y > yMax) continue;
    const c = camAtAltitude(br.y);
    let diff = br.a - facing(c.phi);
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const score = Math.abs(diff - side) + Math.abs(br.y - (yMin + yMax) / 2) * 0.02;
    if (score < bestScore) { bestScore = score; best = br; }
  }
  best.used = true;
  const c = camAtAltitude(best.y);
  const rWant = Math.min(best.L * 0.85, c.R - 8);
  const t = clamp(rWant / best.L, 0.3, 0.95);
  return { br: best, p: best.pt(t) };
}

// --- interactive ornaments (level 1)
LINKS.ornaments.forEach((id, i) => {
  const { br, p } = pickBranch(11 + i * 8, 18 + i * 8, i % 2 ? 0.32 : -0.32);
  hangers.push({ type: 2, kind: 'ball', x: p[0], y: p[1] - 0.35 * br.sizeK, z: p[2], len: 1.1, rad: 0.95 * br.sizeK + 0.15,
    col: i % ORN_COLORS.length, page: id, h: 0, act: -1, sw: rand(0, TAU) });
});
// --- level 2: candy canes + creatures
LINKS.canes.forEach((id, i) => {
  const { br, p } = pickBranch(48 + i * 12, 54 + i * 12, i % 2 ? -0.3 : 0.3);
  hangers.push({ type: 2, kind: 'cane', x: p[0], y: p[1] - 0.3 * br.sizeK, z: p[2], len: 0.2, rad: 2.6 * br.sizeK,
    page: id, h: 0, act: -1, sw: rand(0, TAU) });
});
LINKS.creatures.forEach((id, i) => {
  const { br, p } = pickBranch(54 + i * 14, 60 + i * 14, i % 2 ? 0.28 : -0.28);
  hangers.push({ type: 3, x: p[0], y: p[1] + 0.9 * br.sizeK, z: p[2], rad: 1.4 * br.sizeK,
    page: id, h: 0, act: -1, sw: rand(0, TAU), fur: i ? '#6b4a32' : '#8a8f99' });
});
// --- decorative ornaments everywhere else
for (const br of branches) {
  if (br.used || br.y < 7 || br.y > 92 || R() > 0.4) continue;
  const p = br.pt(rand(0.55, 0.95));
  const big = br.y < 45;
  hangers.push({ type: 2, kind: br.y > 48 && R() < 0.3 ? 'cane' : 'ball', deco: true,
    x: p[0], y: p[1] - 0.35 * br.sizeK, z: p[2], len: rand(0.6, 1.2), rad: (big ? 0.8 : 0.65) * br.sizeK + 0.15,
    col: (R() * ORN_COLORS.length) | 0, h: 0, act: -1, sw: rand(0, TAU) });
}
// --- gifts on the floor
const gifts = [];
{
  const a0 = facing(camAt(0).phi);
  const GIFT_COLS = [['#7d1420', '#e8c25a'], ['#173f7a', '#e9e2d0'], ['#1f5c33', '#c21f2d'], ['#d9c9a8', '#7d1420'], ['#4a2366', '#e8c25a'], ['#c95a1a', '#173f7a']];
  const slots = [[-0.42, 10.5], [-0.14, 13.5], [0.12, 9], [0.38, 12.5]];
  LINKS.gifts.forEach((id, i) => {
    const [da, r] = slots[i];
    gifts.push({ type: 4, x: Math.cos(a0 + da) * r, y: 0, z: Math.sin(a0 + da) * r,
      w: rand(2.2, 3.2), hh: rand(1.6, 2.6), col: GIFT_COLS[i], page: id, h: 0, act: -1 });
  });
  for (let i = 0; i < 12; i++) {
    const a = a0 + rand(0.7, TAU - 0.7), r = rand(5, 16);
    gifts.push({ type: 4, deco: true, x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r,
      w: rand(1.4, 3.4), hh: rand(1.0, 2.8), col: GIFT_COLS[(R() * GIFT_COLS.length) | 0], h: 0, act: -1 });
  }
}
const star = { type: 5, x: 0, y: 102.5, z: 0, rad: 3.4, page: LINKS.star, h: 0, act: -1 };
const trunk = { type: 6 };

const world = [...blobs, ...lights, ...hangers, ...gifts, star];
const interactive = [...hangers.filter(o => !o.deco), ...gifts.filter(o => !o.deco), star];

// sky stuff (screen-space)
const stars = Array.from({ length: 420 }, () => ({ az: rand(0, TAU), el: rand(0, 1), m: rand(0.3, 1), ph: rand(0, TAU) }));
const snow  = Array.from({ length: 260 }, () => ({ x: R(), y: R(), z: rand(0.25, 1), ph: rand(0, TAU) }));

// ---------------------------------------------------------------- state
const cam = { x: 0, y: 0, z: 0, phi: 0, R: 20, sin: 0, cos: 1, hzPx: 0 };
let pTarget = 0, pNow = 0;
let mx = 0, my = 0, mxS = 0, myS = 0;               // pointer, -1..1, smoothed
let px = -1, py = -1, pointerIn = false;           // pointer in css px
let hovered = null, opening = null;

function scrollP() {
  const max = document.documentElement.scrollHeight - innerHeight;
  return max > 0 ? scrollY / max : 0;
}
addEventListener('scroll', () => { pTarget = scrollP(); }, { passive: true });
addEventListener('pointermove', e => {
  px = e.clientX; py = e.clientY; pointerIn = true;
  mx = (px / W) * 2 - 1; my = (py / H) * 2 - 1;
});
addEventListener('pointerleave', () => { pointerIn = false; });
cvs.addEventListener('click', e => {
  px = e.clientX; py = e.clientY;
  const hit = hitTest();
  if (!hit || opening) return;
  hit.act = 0; opening = hit;
});
const pageEl = document.getElementById('page');
pageEl.addEventListener('click', () => pageEl.classList.remove('open'));
function openPage(id) {
  document.getElementById('page-id').textContent = id;
  pageEl.classList.add('open');
}

// ---------------------------------------------------------------- projection
function project(o, x, y, z) {
  const rx = x - cam.x, rz = z - cam.z;
  const d = -(rx * cam.sin + rz * cam.cos);
  o.d = d;
  if (d < NEAR) return false;
  const lx = rx * cam.cos - rz * cam.sin;
  const s = F / d;
  o.s = s; o.sx = W / 2 + lx * s; o.sy = cam.hzPx - (y - cam.y) * s;
  return true;
}
const tmp = {};

// ---------------------------------------------------------------- background
const BG = [
  [0,   '#120806', '#3a1c11'],  // room: warm, dark
  [30,  '#0e0812', '#2a1420'],
  [55,  '#070a20', '#141a3a'],  // dusk — the room is dissolving
  [80,  '#02030b', '#0b1330'],  // night sky
  [120, '#010208', '#081028'],
].map(([y, a, b]) => [y, hex(a), hex(b)]);
function bgAt(y) {
  let i = 0; while (i < BG.length - 2 && y > BG[i + 1][0]) i++;
  const t = clamp((y - BG[i][0]) / (BG[i + 1][0] - BG[i][0]), 0, 1);
  return [mix(BG[i][1], BG[i + 1][1], t), mix(BG[i][2], BG[i + 1][2], t)];
}
let bgGrad = null;
function drawBackground(t) {
  const [top, bot] = bgAt(cam.y);
  bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, top); bgGrad.addColorStop(1, bot);
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

  // fire glow from somewhere in the room
  const fire = 1 - smooth(4, 40, cam.y);
  if (fire > 0) {
    const fx = W * 0.5 + Math.sin(-cam.phi + 2.2) * W * 0.9;
    const g = ctx.createRadialGradient(fx, H * 0.95, 0, fx, H * 0.95, H * 1.1);
    const flick = 0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
    g.addColorStop(0, `rgba(255,140,60,${0.32 * fire * flick})`); g.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // stars
  const sa = smooth(52, 84, cam.y);
  if (sa > 0) {
    const kx = F * 0.55, span = TAU * kx;
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      let x = ((s.az - cam.phi) * kx) % span; if (x < 0) x += span;
      if (x > W) continue;
      const y = s.el * H * 1.1 - (cam.y - 90) * 1.5;
      const a = sa * s.m * (0.6 + 0.4 * Math.sin(t * 2 + s.ph));
      ctx.globalAlpha = a;
      const z = s.m > 0.93 ? 2.2 : 1.2;
      ctx.fillRect(x, y, z, z);
    }
    ctx.globalAlpha = 1;
  }

  // floor + tree skirt — fades out as the room dissolves
  const fa = 1 - smooth(10, 45, cam.y);
  if (fa > 0) {
    ctx.globalAlpha = fa;
    const fy = cam.hzPx + cam.y * F / 220;
    const g = ctx.createLinearGradient(0, fy, 0, H);
    g.addColorStop(0, '#1c0d07'); g.addColorStop(1, '#2e160b');
    ctx.fillStyle = g; ctx.fillRect(0, fy, W, H - fy);
    ctx.fillStyle = '#4a0d12';
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * TAU, r = 10 + Math.sin(a * 9) * 0.6;
      if (!project(tmp, Math.cos(a) * r, 0.02, Math.sin(a) * r)) continue;
      i ? ctx.lineTo(tmp.sx, tmp.sy) : ctx.moveTo(tmp.sx, tmp.sy);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
function fog(alpha) {
  ctx.globalAlpha = alpha; ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- drawing things
function drawTrunk() {
  const s = F / cam.R;
  const yTop = Math.min(TREE_H, cam.y + cam.hzPx / s + 2);
  const yBot = Math.max(0, cam.y - (H - cam.hzPx) / s - 2);
  if (yTop <= yBot) return;
  const sy = y => cam.hzPx - (y - cam.y) * s;
  const wMax = trunkR(yBot) * s;
  const g = ctx.createLinearGradient(W / 2 - wMax, 0, W / 2 + wMax, 0);
  g.addColorStop(0, '#120a06'); g.addColorStop(0.35, '#3d2414'); g.addColorStop(0.55, '#2c190e'); g.addColorStop(1, '#0a0503');
  ctx.fillStyle = g;
  ctx.beginPath();
  const N = 24;
  for (let i = 0; i <= N; i++) { const y = lerp(yBot, yTop, i / N); ctx.lineTo(W / 2 - trunkR(y) * s, sy(y)); }
  for (let i = N; i >= 0; i--) { const y = lerp(yBot, yTop, i / N); ctx.lineTo(W / 2 + trunkR(y) * s, sy(y)); }
  ctx.fill();
}

function drawSticks() {
  ctx.strokeStyle = '#1e120a'; ctx.lineCap = 'round';
  const A = {}, B = {};
  for (const k of sticks) {
    if (!project(A, k.ax, k.ay, k.az) || !project(B, k.bx, k.by, k.bz)) continue;
    // only sticks behind the trunk here; front ones are cheap enough to skip in the blockout
    if ((A.d + B.d) / 2 < cam.R) continue;
    ctx.lineWidth = k.w * (A.s + B.s) / 2;
    ctx.beginPath(); ctx.moveTo(A.sx, A.sy); ctx.lineTo(B.sx, B.sy); ctx.stroke();
  }
}

const nearFade = d => smooth(NEAR, NEAR * 3.5, d);

function drawBlob(o) {
  const sz = o.size * o.s;
  if (sz > H * 3) return;
  // seen from below = dark underside; right in your face = silhouette
  const elev = (o.y - cam.y) / o.d;
  const shade = o.d < 5 ? 0 : elev > 0.35 ? (elev > 0.8 ? 0 : 1) : o.shade;
  const spr = NEEDLES[shade][o.snowy][o.v];
  ctx.globalAlpha = nearFade(o.d);
  const k = sz / SS;
  ctx.setTransform(DPR * k * o.flip, 0, 0, DPR * k, DPR * o.sx, DPR * o.sy);
  ctx.drawImage(spr, -SS / 2, -SS / 2);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 1;
}

function drawLight(o, t) {
  const tw = 0.55 + 0.45 * Math.sin(t * o.sp + o.ph);
  const sz = (0.9 + tw * 0.7) * o.s;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = nearFade(o.d) * (0.5 + 0.5 * tw);
  const spr = (o.cold ? GLOW_COLD : GLOW_WARM)[o.c];
  ctx.drawImage(spr, o.sx - sz / 2, o.sy - sz / 2, sz, sz);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

function drawHanger(o, t, dt) {
  const s = o.s;
  const act = o.act >= 0 ? o.act : -1;
  // swing: idle sway + hover wobble + click spin
  const swing = Math.sin(t * 1.3 + o.sw) * 0.06 + Math.sin(t * 7) * 0.18 * o.h + (act >= 0 ? Math.sin(act * 14) * 0.5 * (1 - act / 0.7) : 0);
  const L = (o.len + o.rad) * s;
  const cx = o.sx + Math.sin(swing) * L, cy = o.sy + Math.cos(swing) * L;
  const r = o.rad * s * (1 + 0.08 * o.h);
  ctx.globalAlpha = nearFade(o.d);
  // string
  ctx.strokeStyle = 'rgba(220,200,150,.6)'; ctx.lineWidth = Math.max(0.6, 0.04 * s);
  ctx.beginPath(); ctx.moveTo(o.sx, o.sy);
  ctx.lineTo(o.sx + Math.sin(swing) * o.len * s, o.sy + Math.cos(swing) * o.len * s); ctx.stroke();

  if (o.kind === 'ball') {
    const spin = act >= 0 ? Math.cos(act * 30) : 1;
    // cap
    ctx.fillStyle = '#b89b52';
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-swing);
    ctx.fillRect(-r * 0.22, -r * 1.12, r * 0.44, r * 0.25);
    ctx.scale(spin, 1);
    ctx.drawImage((o.deco ? BALLS : BALLSB)[o.col], -r, -r, r * 2, r * 2);
    if (o.h > 0.01) { // hover: a little glint sweeps across
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = o.h * 0.35;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    if (!o.deco) hits.push({ o, x: cx, y: cy, r: r * 1.1 });
  } else { // candy cane, hook at top
    const len = o.rad * s;
    ctx.save(); ctx.translate(o.sx + Math.sin(swing) * o.len * s, o.sy + Math.cos(swing) * o.len * s); ctx.rotate(-swing);
    const hookR = len * 0.18;
    const path = () => { ctx.beginPath(); ctx.arc(-hookR, hookR, hookR, 0, Math.PI, true); ctx.moveTo(0, hookR); ctx.lineTo(0, len); };
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#f4efe6'; ctx.lineWidth = len * 0.11 * (1 + 0.15 * o.h); path(); ctx.stroke();
    ctx.strokeStyle = '#c4142c'; ctx.setLineDash([len * 0.07, len * 0.07]); ctx.lineCap = 'butt'; path(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    if (!o.deco) hits.push({ o, x: o.sx, y: o.sy + len * 0.55, r: len * 0.5 });
  }
  ctx.globalAlpha = 1;
}

function drawCreature(o, t) {
  const r = o.rad * o.s;
  const act = o.act;
  const hop = act >= 0 ? Math.sin(Math.min(1, act / 0.6) * Math.PI) * r * 1.4 : 0;
  const peek = o.h * r * 0.25 + Math.sin(t * 2 + o.sw) * r * 0.03;
  const x = o.sx, y = o.sy - hop - peek;
  ctx.globalAlpha = nearFade(o.d);
  ctx.fillStyle = o.fur;
  // tail
  ctx.strokeStyle = o.fur; ctx.lineWidth = r * 0.12; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + r * 0.7, y + r * 0.3);
  ctx.quadraticCurveTo(x + r * 1.6, y + r * 0.2 + Math.sin(t * 3) * r * 0.2, x + r * 1.3, y - r * 0.5); ctx.stroke();
  // body + head
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.2, r * 0.85, r * 0.65, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.45, r * 0.55, 0, TAU); ctx.fill();
  // ears (pop up on hover)
  const ear = 1 + o.h * 0.3;
  for (const ex of [-0.6, 0.15]) { ctx.beginPath(); ctx.arc(x + ex * r, y - r * 0.95 - o.h * r * 0.1, r * 0.25 * ear, 0, TAU); ctx.fill(); }
  // eyes follow the pointer
  const blink = (Math.sin(t * 0.9 + o.sw * 3) > 0.985) ? 0.15 : 1;
  for (const ex of [-0.42, 0.02]) {
    const ecx = x + ex * r, ecy = y - r * 0.5, er = r * 0.15;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ecx, ecy, er, er * blink, 0, 0, TAU); ctx.fill();
    let dx = px - ecx, dy = py - ecy; const dl = Math.hypot(dx, dy) || 1;
    if (!pointerIn) { dx = 0; dy = 0; }
    ctx.fillStyle = '#000'; ctx.beginPath();
    ctx.ellipse(ecx + dx / dl * er * 0.45, ecy + dy / dl * er * 0.45, er * 0.55, er * 0.55 * blink, 0, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = '#e88'; ctx.beginPath(); ctx.arc(x - r * 0.72, y - r * 0.32, r * 0.08, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  hits.push({ o, x, y: y - r * 0.1, r: r * 1.1 });
}

function drawGift(o, t) {
  const s = o.s, w = o.w * s, h = o.hh * s;
  const act = o.act;
  const jig = o.h * Math.sin(t * 22) * 0.04;
  const hop = act >= 0 ? Math.sin(Math.min(1, act / 0.35) * Math.PI) * h * 0.25 : 0;
  const lid = act >= 0 ? Math.min(1, act / 0.45) : 0;
  ctx.globalAlpha = nearFade(o.d);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath(); ctx.ellipse(o.sx, o.sy, w * 0.62, w * 0.12, 0, 0, TAU); ctx.fill();
  ctx.save();
  ctx.translate(o.sx, o.sy - hop); ctx.rotate(jig);
  const sq = 1 + o.h * 0.05;
  ctx.scale(1 / Math.sqrt(sq), sq);
  const [box, rib] = o.col;
  ctx.fillStyle = box; ctx.fillRect(-w / 2, -h, w, h);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(w * 0.3, -h, w * 0.2, h);            // fake side shading
  if (o.h > 0.01) { ctx.fillStyle = `rgba(255,255,255,${o.h * 0.12})`; ctx.fillRect(-w / 2, -h, w, h); }
  ctx.fillStyle = rib; ctx.fillRect(-w * 0.07, -h, w * 0.14, h);
  // lid
  const lh = h * 0.18, ly = -h - lh - lid * h * 1.2, lr = lid * 0.5;
  ctx.save(); ctx.translate(0, ly + lh / 2); ctx.rotate(-lr);
  ctx.fillStyle = box; ctx.fillRect(-w * 0.54, -lh / 2, w * 1.08, lh);
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-w * 0.54, lh * 0.2, w * 1.08, lh * 0.3);
  ctx.fillStyle = rib; ctx.fillRect(-w * 0.07, -lh / 2, w * 0.14, lh);
  // bow
  ctx.beginPath(); ctx.ellipse(-w * 0.14, -lh / 2 - w * 0.06, w * 0.14, w * 0.08, -0.4, 0, TAU);
  ctx.ellipse(w * 0.14, -lh / 2 - w * 0.06, w * 0.14, w * 0.08, 0.4, 0, TAU); ctx.fill();
  ctx.restore();
  if (lid > 0) { // light spilling out
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, -h, 0, 0, -h, w);
    g.addColorStop(0, `rgba(255,230,160,${lid})`); g.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = g; ctx.fillRect(-w, -h * 2.2, w * 2, h * 1.4);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  if (!o.deco) hits.push({ o, x: o.sx, y: o.sy - h * 0.55, r: Math.max(w, h) * 0.6 });
}

function drawStar(o, t) {
  const r = o.rad * o.s * (1 + 0.06 * o.h + 0.03 * Math.sin(t * 2));
  const burst = o.act >= 0 ? o.act : -1;
  ctx.globalCompositeOperation = 'lighter';
  const gr = (2.6 + o.h * 0.8) * r;
  const g = ctx.createRadialGradient(o.sx, o.sy, 0, o.sx, o.sy, gr);
  g.addColorStop(0, 'rgba(255,240,190,.9)'); g.addColorStop(0.25, 'rgba(255,210,120,.35)'); g.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = g; ctx.fillRect(o.sx - gr, o.sy - gr, gr * 2, gr * 2);
  // rays
  ctx.save(); ctx.translate(o.sx, o.sy); ctx.rotate(t * 0.15);
  for (let i = 0; i < 12; i++) {
    ctx.rotate(TAU / 12);
    const L = r * (i % 2 ? 2.2 : 3.4) * (1 + (burst >= 0 ? burst * 3 : 0));
    ctx.fillStyle = `rgba(255,235,180,${burst >= 0 ? 0.25 * (1 - burst / 0.7) + 0.1 : 0.12})`;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.1); ctx.lineTo(L, 0); ctx.lineTo(0, r * 0.1); ctx.fill();
  }
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  // the star itself
  ctx.save(); ctx.translate(o.sx, o.sy); ctx.rotate(Math.sin(t * 0.7) * 0.05);
  ctx.fillStyle = '#ffd56a'; ctx.strokeStyle = '#fff6d0'; ctx.lineWidth = r * 0.05;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  hits.push({ o, x: o.sx, y: o.sy, r: r * 1.1 });
}

function drawSnow(t) {
  const a = smooth(70, 90, cam.y);
  if (a <= 0) return;
  ctx.fillStyle = '#fff';
  for (const f of snow) {
    let x = (f.x * W + Math.sin(t * 0.6 + f.ph) * 25 * f.z - cam.phi * F * 0.5 * f.z) % W; if (x < 0) x += W;
    let y = (f.y * H + t * 28 * f.z + cam.y * F * 0.04 * f.z) % H; if (y < 0) y += H;
    ctx.globalAlpha = a * f.z * 0.9;
    const sz = 1 + f.z * 2.2;
    ctx.beginPath(); ctx.arc(x, y, sz, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- hit testing
let hits = [];
function hitTest() {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if ((px - h.x) ** 2 + (py - h.y) ** 2 < h.r * h.r) return h.block ? null : h.o;
  }
  return null;
}

// ---------------------------------------------------------------- frame
const FOG = [[38, 0.36], [27, 0.28], [17, 0.18]];
const vis = [];
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;

  pNow += (pTarget - pNow) * (1 - Math.exp(-dt * 5));
  mxS += (mx - mxS) * (1 - Math.exp(-dt * 3));
  myS += (my - myS) * (1 - Math.exp(-dt * 3));

  const c = camAt(pNow);
  cam.phi = c.phi + mxS * 0.05;
  cam.R = c.R; cam.y = c.y - myS * 0.25 * (c.R / 20);
  cam.sin = Math.sin(cam.phi); cam.cos = Math.cos(cam.phi);
  cam.x = cam.R * cam.sin; cam.z = cam.R * cam.cos;
  cam.hzPx = c.hz * H;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawBackground(t);

  // project + cull
  vis.length = 0;
  const yMin = cam.y - 60, yMax = cam.y + 60;
  for (const o of world) {
    if (o.y < yMin || o.y > yMax) continue;
    if (!project(o, o.x, o.y, o.z)) continue;
    const pad = (o.size || o.rad * 3 || 6) * o.s;
    if (o.sx < -pad || o.sx > W + pad || o.sy < -pad || o.sy > H + pad * 1.5) continue;
    vis.push(o);
  }
  trunk.d = cam.R; vis.push(trunk);
  vis.sort((a, b) => b.d - a.d);

  hits = [];
  let fi = 0, anyHit = false;
  drawSticks();
  for (const o of vis) {
    while (fi < FOG.length && o.d < FOG[fi][0]) { fog(FOG[fi][1]); fi++; }
    switch (o.type) {
      case 0: drawBlob(o); if (anyHit && o.d < 30) hits.push({ block: true, x: o.sx, y: o.sy, r: o.size * o.s * 0.22 }); break;
      case 1: drawLight(o, t); break;
      case 2: drawHanger(o, t, dt); break;
      case 3: drawCreature(o, t); break;
      case 4: drawGift(o, t); break;
      case 5: drawStar(o, t); break;
      case 6: drawTrunk(); break;
    }
    if (o.type >= 2 && o.type <= 5) anyHit = hits.length > 0;
  }
  drawSnow(t);

  // hover
  hovered = pointerIn && !opening ? hitTest() : null;
  cvs.style.cursor = hovered ? 'pointer' : '';
  for (const o of interactive) {
    o.h += ((o === hovered ? 1 : 0) - o.h) * (1 - Math.exp(-dt * 12));
    if (o.act >= 0) {
      o.act += dt;
      if (o.act > 0.75) { o.act = -1; if (opening === o) { opening = null; openPage(o.page); } }
    }
  }
  requestAnimationFrame(frame);
}
pTarget = pNow = scrollP();
requestAnimationFrame(frame);
})();
