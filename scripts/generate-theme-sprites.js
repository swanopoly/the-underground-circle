#!/usr/bin/env node
// Generate pixel art background PNGs for each office theme environment.
// Uses @napi-rs/canvas (no system deps needed).
// Run: node scripts/generate-theme-sprites.js

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const W = 900, H = 680;
const PX = 4; // pixel grid size for authentic pixel art feel

// ─── Helpers ──────────────────────────────────────────────────────────────────

function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function circle(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function strokeCircle(ctx, cx, cy, r, color, lineWidth = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function line(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// ─── Global Pixel Art Helpers ─────────────────────────────────────────────────

// Multi-step gradient shadow at wall-floor junction
function ambientOcclusion(ctx, wallY, color = '#000000') {
  px(ctx, 0, wallY, W, 6, color + '30');
  px(ctx, 0, wallY + 6, W, 8, color + '18');
  px(ctx, 0, wallY + 14, W, 10, color + '0a');
}

// Scattered dust/particle motes for atmosphere
function dustMotes(ctx, yStart, yEnd, count, color = '#ffffff12') {
  // Deterministic pseudo-random — no Math.random() for reproducible builds
  for (let i = 0; i < count; i++) {
    const dx = ((i * 137 + 47) % (W - 40)) + 20;
    const dy = ((i * 89 + 31) % (yEnd - yStart)) + yStart;
    const r = 0.8 + (i % 3) * 0.4;
    circle(ctx, dx, dy, r, color);
  }
}

// Subtle floor darkening near wall shadow
function floorGradient(ctx, yStart, color = '#000000') {
  px(ctx, 0, yStart, W, 12, color + '0c');
  px(ctx, 0, yStart + 12, W, 14, color + '06');
}

// Radial glow cone cast from light source downward
function lightCone(ctx, x, y, radius, color) {
  ctx.save();
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, color + '18');
  grad.addColorStop(0.5, color + '08');
  grad.addColorStop(1, color + '00');
  ctx.fillStyle = grad;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

// Sparse noise texture overlay for large flat surfaces
function dither(ctx, x, y, w, h, color = '#ffffff04', density = 0.02) {
  const step = Math.max(4, Math.round(1 / density));
  for (let dy = 0; dy < h; dy += step) {
    for (let dx = 0; dx < w; dx += step) {
      // Deterministic pattern with variation
      const hash = ((dx * 7 + dy * 13 + x + y) * 31) & 0xf;
      if (hash < 3) {
        px(ctx, x + dx, y + dy, 1, 1, color);
      }
    }
  }
}

// ─── Theme Palettes ───────────────────────────────────────────────────────────

const PALETTES = {
  ship: {
    floor: '#1a0e06', wall: '#2d1a08', wallDark: '#1e1008', wallBorder: '#3d2c1a',
    accent: '#f59e0b', desk: '#2a1f14', deskBorder: '#3d2b1a',
    sky: '#0a1628', ocean: '#0c2040', oceanMid: '#153050', oceanLight: '#1e3a5f',
    moon: '#f0e68c', metal: '#6b5338', metalLight: '#8b7355', rope: '#a08060',
    chair: '#4a3520', parchment: '#d4c4a0',
  },
  castle: {
    floor: '#0d0818', wall: '#2a2a35', wallDark: '#1a1a25', wallBorder: '#3d3d4a',
    accent: '#7c3aed', desk: '#3a3a48', deskBorder: '#4a4a58',
    sky: '#0a0d18', hills: '#1a1a2e', moon: '#e8e0c0',
    torch: '#ff8c00', torchGlow: '#ff660020', stone: '#333340',
    chair: '#2a1848', banner: '#7c3aed',
  },
  station: {
    floor: '#02020a', wall: '#0a0a14', wallDark: '#050508', wallBorder: '#1a1a30',
    accent: '#3b82f6', desk: '#0d0d1a', deskBorder: '#1a1a2e',
    sky: '#000008', star: '#ffffff', planet: '#3b82f6',
    green: '#22c55e', red: '#ef4444', yellow: '#f59e0b',
    chair: '#0d0d1a', metal: '#1a1a2e',
  },
  submarine: {
    floor: '#05100a', wall: '#1a3028', wallDark: '#0d2018', wallBorder: '#2a4038',
    accent: '#22c55e', desk: '#1a3028', deskBorder: '#2a4038',
    sky: '#001828', water: '#002840', waterDark: '#001020',
    seaweed: '#166534', seaweedLight: '#15803d', fish: '#22d3ee',
    sand: '#8b7355', metal: '#2a4038', bubble: '#ffffff20',
  },
  mansion: {
    floor: '#0d0510', wall: '#1a0e20', wallDark: '#120818', wallBorder: '#2d1b4e',
    accent: '#a855f7', desk: '#2a1020', deskBorder: '#3d1838',
    sky: '#060010', moon: '#c0b0a0', tree: '#120018',
    wood: '#2a1020', woodLight: '#3d1838', gold: '#b8860b',
    chair: '#1a0a2e', candle: '#f5f0d0', flame: '#ff6600',
  },
  lair: {
    floor: '#0f0200', wall: '#1a0800', wallDark: '#0a0000', wallBorder: '#3d1800',
    accent: '#ef4444', desk: '#1a0800', deskBorder: '#3d1800',
    lava: '#ef4444', lavaLight: '#fbbf24', lavaDark: '#b91c1c',
    rock: '#2d1200', rockLight: '#3d1800', crystal: '#a855f7',
    obsidian: '#1a0a00', smoke: '#ffffff08',
  },
  cabin: {
    floor: '#0d0f08', wall: '#2a1f14', wallDark: '#1a1508', wallBorder: '#3d2c1a',
    accent: '#22c55e', desk: '#2a1f14', deskBorder: '#3d2c1a',
    sky: '#0a1220', trees: '#0d2010', treesLight: '#15803d',
    mountain: '#1a2a15', snow: '#ffffff20', log: '#3d2c1a',
    stone: '#4a4040', fire: '#ff6600', fireGlow: '#ff440010',
    chair: '#1a1508',
  },
  office: {
    floor: '#0a0a0f', wall: '#111118', wallDark: '#0a0a10', wallBorder: '#1a1a2e',
    accent: '#6366f1', desk: '#2a1f14', deskBorder: '#3d2b1a',
    sky: '#0a1628', city: '#1a1a2e', star: '#ffffff40',
    chair: '#1a1a2e', plant: '#166534', coffee: '#374151',
    rug: '#1a0a2e',
  },
  temple: {
    floor: '#120c08', wall: '#1e1608', wallDark: '#150e04', wallBorder: '#3d2c14',
    accent: '#d4a017', desk: '#2a1e0a', deskBorder: '#5a4020',
    sky: '#0a0618', divine: '#d4a01730', rune: '#7c3aed',
    torch: '#ff8c00', torchGlow: '#ff660018', stone: '#2d2414',
    stoneLight: '#3d3420', chair: '#1e1608', sand: '#c4a060',
    column: '#3d3018', scroll: '#d4c4a0',
  },
  garden: {
    floor: '#0d1a08', floorPath: '#1a2610', wall: '#0a1a0a', wallBorder: '#4a8a5a',
    accent: '#22c55e', desk: '#2a3d1a', deskBorder: '#4a6a2a',
    sky: '#87ceeb', cloud: '#ffffff40', sun: '#ffd700',
    flower1: '#f9a825', flower2: '#e91e63', flower3: '#9c27b0',
    vine: '#166534', trellis: '#5d4037', fountain: '#0891b2',
    moss: '#22c55e20', leaf: '#15803d', chair: '#1a2a10',
  },
  cyber: {
    floor: '#050008', wall: '#0d0020', wallDark: '#070010', wallBorder: '#ff00ff40',
    accent: '#ff00ff', cyan: '#00ffff', yellow: '#ffff00',
    desk: '#150030', deskBorder: '#ff00ff50', chair: '#0a0020',
    sky: '#000010', city: '#1a0030', rain: '#00ffff10',
    neon1: '#ff00ff', neon2: '#00ffff', neon3: '#ffff00',
    wire: '#ff00ff20', glow: '#ff00ff15', led: '#22c55e',
  },
  arctic: {
    floor: '#08101c', floorFrost: '#101c28', wall: '#0f1c2a', wallDark: '#081018',
    wallBorder: '#2a4060', accent: '#38bdf8', desk: '#1a2c40', deskBorder: '#2a4060',
    sky: '#000814', aurora1: '#22c55e18', aurora2: '#a855f712',
    frost: '#c0e8ff30', frostBright: '#e0f4ff40', ice: '#60a5fa20',
    heating: '#ef4444', heatingGlow: '#ef444418', chair: '#101828',
    warning: '#f59e0b', snow: '#ffffff20', star: '#ffffff60',
  },
};

// ─── Draw Environment: SHIP ──────────────────────────────────────────────────

function drawShip(ctx) {
  const p = PALETTES.ship;

  // Floor — wood planks
  px(ctx, 0, 0, W, H, p.floor);
  for (let y = 190; y < H; y += PX * 5) {
    const offset = ((y - 190) / (PX * 5)) % 2 === 0 ? 0 : PX * 20;
    px(ctx, 14, y, W - 14, 1, p.wallBorder + '40');
    // Grain lines
    px(ctx, 14 + offset + 40, y + PX, 60, 1, p.wallBorder + '18');
    px(ctx, 14 + offset + 200, y + PX * 2, 50, 1, p.wallBorder + '15');
    // Board joints
    px(ctx, 14 + offset + 160, y, 1, PX * 5, p.wallBorder + '20');
    px(ctx, 14 + offset + 400, y, 1, PX * 5, p.wallBorder + '15');
    px(ctx, 14 + offset + 640, y, 1, PX * 5, p.wallBorder + '15');
  }

  // Top wall — wood planks
  for (let y = 0; y < 190; y += PX * 5) {
    px(ctx, 0, y, W, PX * 5 - 1, p.wall);
    px(ctx, 0, y + PX * 5 - 1, W, 1, p.wallBorder);
    // Grain per plank
    px(ctx, (y * 3 + 50) % 300, y + PX, 80, 1, p.wallDark + '30');
    px(ctx, (y * 5 + 200) % 500, y + PX * 2, 60, 1, p.wallBorder + '20');
    px(ctx, (y * 7 + 100) % 600, y + PX * 3, 50, 1, p.wallDark + '25');
    // Highlight top edge
    px(ctx, 0, y, W, 1, '#ffffff06');
    // Knot hole
    if (y % (PX * 15) === 0) {
      roundRect(ctx, 300 + (y * 2) % 400, y + PX, PX * 3, PX * 2, 3, p.wallBorder + '35');
    }
  }
  // Nails
  const nailPositions = [
    [60, 10], [200, 50], [400, 30], [600, 70], [150, 90], [500, 120],
    [300, 150], [700, 100], [100, 130], [350, 70], [550, 150], [800, 50],
    [250, 10], [680, 130], [450, 90], [760, 30], [50, 170], [380, 160],
  ];
  for (const [nx, ny] of nailPositions) {
    circle(ctx, nx, ny, 3, p.metal);
    circle(ctx, nx - 1, ny - 1, 1.5, p.metalLight);
  }
  // Wall bottom shadow
  px(ctx, 0, 186, W, 4, '#00000030');

  // Left railing
  px(ctx, 0, 0, 14, H, p.wall);
  px(ctx, 12, 0, 2, H, p.wallBorder);
  // Rail cap
  px(ctx, 0, 188, 14, 4, p.deskBorder);
  // Railing posts
  for (let y = 196; y < H - 40; y += 60) {
    roundRect(ctx, 3, y, 8, 44, 2, p.desk);
    px(ctx, 3, y, 8, 1, '#ffffff08');
    px(ctx, 5, y + 10, 3, 20, p.deskBorder + '20');
  }

  // Porthole 1 (main)
  const ph1x = W - 220, ph1y = 30;
  // Shadow
  circle(ctx, ph1x + 35, ph1y + 35, 33, '#00000040');
  // Frame
  circle(ctx, ph1x + 32, ph1y + 32, 32, p.metal);
  circle(ctx, ph1x + 32, ph1y + 32, 27, p.sky);
  // Moon
  circle(ctx, ph1x + 44, ph1y + 14, 7, p.moon);
  circle(ctx, ph1x + 42, ph1y + 16, 2, '#e0d67c');
  // Stars
  circle(ctx, ph1x + 12, ph1y + 10, 1.5, '#ffffff60');
  circle(ctx, ph1x + 24, ph1y + 18, 1, '#ffffff40');
  circle(ctx, ph1x + 50, ph1y + 8, 1, '#ffffff30');
  // Ocean
  roundRect(ctx, ph1x + 5, ph1y + 34, 54, 12, [10, 10, 0, 0], p.oceanLight);
  px(ctx, ph1x + 5, ph1y + 40, 54, 20, p.oceanMid);
  px(ctx, ph1x + 5, ph1y + 48, 54, 12, p.ocean);
  // Foam
  px(ctx, ph1x + 10, ph1y + 33, 16, 2, '#ffffff30');
  px(ctx, ph1x + 35, ph1y + 36, 10, 2, '#ffffff20');
  // Glass reflection
  roundRect(ctx, ph1x + 12, ph1y + 10, 18, 8, 6, '#ffffff08');
  // Bolts (8)
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8;
    const bx = ph1x + 32 + Math.cos(a) * 28;
    const by = ph1y + 32 + Math.sin(a) * 28;
    circle(ctx, bx, by, 3.5, '#5a4328');
    circle(ctx, bx - 1, by - 1, 1.5, p.metalLight);
  }

  // Porthole 2 (smaller)
  const ph2x = ph1x - 100, ph2y = 40;
  circle(ctx, ph2x + 20, ph2y + 20, 22, p.metal);
  circle(ctx, ph2x + 20, ph2y + 20, 18, p.sky);
  px(ctx, ph2x + 2, ph2y + 24, 36, 16, p.oceanMid);
  px(ctx, ph2x + 8, ph2y + 23, 10, 2, '#ffffff20');
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI * 2) / 4;
    circle(ctx, ph2x + 20 + Math.cos(a) * 19, ph2y + 20 + Math.sin(a) * 19, 2.5, '#5a4328');
  }

  // Ship wheel
  const swx = W - 80, swy = 220;
  strokeCircle(ctx, swx, swy, 28, p.deskBorder, 4);
  circle(ctx, swx, swy, 8, p.desk);
  circle(ctx, swx, swy, 5, p.deskBorder);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    line(ctx, swx + Math.cos(a) * 8, swy + Math.sin(a) * 8,
      swx + Math.cos(a) * 26, swy + Math.sin(a) * 26, p.deskBorder, 3);
    // Handle nobs
    circle(ctx, swx + Math.cos(a) * 28, swy + Math.sin(a) * 28, 4, p.desk);
  }
  // Wheel stand
  px(ctx, swx - 4, swy + 30, 8, 30, p.deskBorder);

  // Jolly Roger
  px(ctx, W - 160, 200, 4, 90, p.deskBorder);
  px(ctx, W - 156, 200, 50, 35, '#0a0a0a');
  px(ctx, W - 156, 200, 50, 1, '#333');
  px(ctx, W - 156, 234, 50, 1, '#333');
  // Skull
  circle(ctx, W - 132, 212, 6, '#ffffff80');
  px(ctx, W - 136, 220, 8, 2, '#ffffff50');

  // Cannons
  for (const cy of [420, 560]) {
    roundRect(ctx, W - 60, cy, 50, 18, 4, '#333');
    circle(ctx, W - 14, cy + 9, 8, '#222');
    px(ctx, W - 14, cy + 2, 12, 14, '#222');
    // Cannonball
    circle(ctx, W - 8, cy + 9, 5, '#444');
  }

  // Treasure chest
  const tcx = W - 70, tcy = 490;
  roundRect(ctx, tcx, tcy, 44, 24, 3, p.desk);
  px(ctx, tcx, tcy, 44, 1, '#ffffff08');
  roundRect(ctx, tcx, tcy, 44, 10, [8, 8, 0, 0], p.deskBorder);
  roundRect(ctx, tcx + 16, tcy + 8, 12, 8, 2, p.accent);

  // Rope coil
  strokeCircle(ctx, 30, 580, 14, p.rope, 5);
  strokeCircle(ctx, 30, 580, 8, p.rope, 3);

  // Lanterns
  for (const [lx, ly] of [[W - 50, 310], [W - 50, 450]]) {
    px(ctx, lx + 5, ly, 2, 10, '#666');
    roundRect(ctx, lx, ly + 10, 14, 20, 3, p.accent + '30');
    px(ctx, lx, ly + 10, 14, 1, p.accent + '60');
    circle(ctx, lx + 7, ly + 18, 4, p.accent + '60');
  }

  // Captain's table in lounge area
  roundRect(ctx, W - 150, 300, 90, 55, 4, p.desk);
  px(ctx, W - 150, 300, 90, 1, '#ffffff08');
  // Map on table
  roundRect(ctx, W - 142, 308, 74, 40, 2, p.parchment);
  px(ctx, W - 136, 314, 40, 1, '#80604030');
  px(ctx, W - 136, 320, 30, 1, '#80604025');
  px(ctx, W - 136, 326, 50, 1, '#80604020');

  // Rum barrel
  roundRect(ctx, 30, 630, 30, 22, 6, p.desk);
  px(ctx, 30, 636, 30, 2, p.accent + '50');
  px(ctx, 30, 646, 30, 2, p.accent + '50');

  // Ambient occlusion + floor gradient
  ambientOcclusion(ctx, 188, '#000000');
  floorGradient(ctx, 192, '#1a0e06');

  // Dust motes (golden)
  dustMotes(ctx, 10, 185, 8, '#f59e0b08');

  // Anchor on left wall
  const anx = 3, any = 380;
  strokeCircle(ctx, anx + 8, any, 8, p.metal, 2);
  px(ctx, anx + 7, any + 6, 3, 30, p.metal);
  line(ctx, anx + 2, any + 34, anx + 14, any + 34, p.metal, 2);
  px(ctx, anx + 1, any + 30, 3, 6, p.metal);
  px(ctx, anx + 12, any + 30, 3, 6, p.metal);

  // Rope texture improvement on coil
  strokeCircle(ctx, 30, 580, 11, p.rope + '60', 2);
  strokeCircle(ctx, 30, 580, 7, p.rope + '40', 1.5);
  // Rope end detail
  px(ctx, 38, 575, 12, 2, p.rope + '30');

  // ─── Compass rose on floor ───
  const cpx = 500, cpy = 480;
  strokeCircle(ctx, cpx, cpy, 24, p.accent + '12', 1);
  strokeCircle(ctx, cpx, cpy, 22, p.accent + '08', 0.5);
  // Cardinal points
  line(ctx, cpx, cpy - 20, cpx, cpy + 20, p.accent + '10', 1);
  line(ctx, cpx - 20, cpy, cpx + 20, cpy, p.accent + '10', 1);
  // Diagonal lines
  line(ctx, cpx - 14, cpy - 14, cpx + 14, cpy + 14, p.accent + '06', 0.5);
  line(ctx, cpx + 14, cpy - 14, cpx - 14, cpy + 14, p.accent + '06', 0.5);
  // North arrow
  ctx.save(); ctx.beginPath();
  ctx.moveTo(cpx, cpy - 18); ctx.lineTo(cpx - 4, cpy - 8); ctx.lineTo(cpx + 4, cpy - 8);
  ctx.closePath(); ctx.fillStyle = p.accent + '15'; ctx.fill();
  ctx.restore();
  circle(ctx, cpx, cpy, 2, p.accent + '20');

  // ─── Ship's bell ───
  const sbx = W - 30, sby = 280;
  roundRect(ctx, sbx, sby, 14, 4, 2, p.metal);
  ctx.beginPath();
  ctx.moveTo(sbx + 2, sby + 4); ctx.lineTo(sbx + 12, sby + 4);
  ctx.lineTo(sbx + 14, sby + 18); ctx.lineTo(sbx, sby + 18);
  ctx.closePath(); ctx.fillStyle = p.accent + '40'; ctx.fill();
  circle(ctx, sbx + 7, sby + 16, 2, p.accent + '30');
  // Bell mount
  px(ctx, sbx + 5, sby - 4, 4, 4, p.metal);

  // ─── Barnacle texture on hull ───
  for (const [bx, by] of [[6, 450], [4, 520], [8, 600], [3, 350]]) {
    circle(ctx, bx, by, 2.5, p.wallBorder + '30');
    circle(ctx, bx + 1, by - 1, 1, '#ffffff08');
  }

  // ─── Floor stains/wear ───
  roundRect(ctx, 300, 350, 40, 20, 10, p.wallDark + '10');
  roundRect(ctx, 600, 500, 30, 15, 8, p.wallDark + '08');

  // Wall texture dithering
  dither(ctx, 0, 0, W, 190, '#ffffff03', 0.02);
  // Wave pattern along bottom
  for (let x = 0; x < W; x += 20) {
    const wy = H - 8 + Math.sin(x * 0.12) * 3;
    line(ctx, x, wy, x + 14, wy + 2, p.ocean + '10', 1);
  }
  // Second wave layer
  for (let x = 10; x < W; x += 25) {
    const wy = H - 4 + Math.sin(x * 0.08 + 1) * 2;
    line(ctx, x, wy, x + 10, wy + 1, p.oceanLight + '06', 0.5);
  }
}

// ─── Draw Environment: CASTLE ─────────────────────────────────────────────────

function drawCastle(ctx) {
  const p = PALETTES.castle;

  // Floor — stone tiles
  px(ctx, 0, 0, W, H, p.floor);
  for (let y = 192; y < H; y += PX * 10) {
    const row = (y - 192) / (PX * 10);
    const offset = row % 2 === 0 ? 0 : PX * 5;
    for (let x = 10 + offset; x < W; x += PX * 10) {
      px(ctx, x, y, PX * 10 - 2, PX * 10 - 2, p.floor);
      // Tile edges
      px(ctx, x, y + PX * 10 - 2, PX * 10 - 2, 1, p.wallBorder + '15');
      px(ctx, x + PX * 10 - 2, y, 1, PX * 10 - 2, p.wallBorder + '12');
      // Highlight
      px(ctx, x, y, PX * 10 - 4, 1, '#ffffff04');
    }
  }

  // Top wall — stone blocks
  for (let row = 0; row < 8; row++) {
    const offset = row % 2 === 0 ? 0 : 45;
    for (let col = 0; col < 12; col++) {
      const bw = 82 + ((row + col) % 3) * 4;
      const bx = offset + col * 90;
      const by = row * 24;
      px(ctx, bx, by, bw, 22, p.wall);
      // Stone borders
      px(ctx, bx, by, bw, 1, '#ffffff08');
      px(ctx, bx, by + 21, bw, 1, p.wallBorder);
      px(ctx, bx + bw - 1, by, 1, 22, p.wallBorder);
      px(ctx, bx, by, 1, 22, '#ffffff04');
      // Texture
      if ((row + col) % 4 === 0) circle(ctx, bx + 30, by + 10, 2, p.wallBorder + '20');
      if ((row + col) % 5 === 1) circle(ctx, bx + 50, by + 14, 1.5, '#ffffff06');
    }
  }
  // Wall bottom shadow
  px(ctx, 0, 186, W, 4, '#00000025');

  // Left wall
  px(ctx, 0, 0, 10, H, p.wall);
  px(ctx, 8, 0, 2, H, p.wallBorder);

  // Torch sconces (3)
  for (const tx of [160, 460, 760]) {
    // Glow aura
    roundRect(ctx, tx - 20, 82, 48, 36, 18, p.torchGlow);
    // Bracket
    roundRect(ctx, tx + 1, 106, 10, 26, 2, '#444');
    px(ctx, tx + 3, 112, 6, 1, '#555');
    // Mount plate
    roundRect(ctx, tx - 2, 130, 16, 5, 2, '#555');
    // Fire
    circle(ctx, tx + 6, 100, 6, p.torch + '80');
    circle(ctx, tx + 6, 96, 4, p.torch);
    circle(ctx, tx + 6, 92, 3, '#ffcc00');
  }

  // Arched window 1 (main)
  const wx = W - 220, wy = 12;
  // Shadow
  roundRect(ctx, wx + 5, wy + 3, 52, 78, [26, 26, 0, 0], '#00000030');
  // Sill
  px(ctx, wx - 2, wy + 78, 62, 6, p.wallBorder);
  px(ctx, wx, wy + 78, 58, 1, '#ffffff08');
  // Window opening
  roundRect(ctx, wx + 2, wy, 52, 76, [26, 26, 0, 0], p.sky);
  // Moon + halo
  circle(ctx, wx + 40, wy + 16, 10, p.moon + '10');
  circle(ctx, wx + 40, wy + 16, 6, p.moon);
  circle(ctx, wx + 38, wy + 18, 2, '#d8d0b0');
  // Stars
  circle(ctx, wx + 12, wy + 10, 1.5, '#ffffff50');
  circle(ctx, wx + 28, wy + 20, 1, '#ffffff35');
  circle(ctx, wx + 20, wy + 14, 1, '#ffffff25');
  circle(ctx, wx + 46, wy + 8, 1, '#ffffff40');
  // Hills
  roundRect(ctx, wx - 2, wy + 52, 60, 24, [20, 14, 0, 0], p.hills + '80');
  roundRect(ctx, wx - 2, wy + 56, 60, 20, [16, 22, 0, 0], p.hills);
  roundRect(ctx, wx + 24, wy + 62, 30, 14, [14, 0, 0, 0], p.hills);
  // Castle silhouette
  px(ctx, wx + 14, wy + 44, 5, 14, p.hills + '90');
  px(ctx, wx + 12, wy + 40, 9, 5, p.hills + '90');
  // Mullion cross
  px(ctx, wx + 27, wy + 24, 2, 54, p.wallBorder);
  px(ctx, wx + 5, wy + 46, 46, 2, p.wallBorder);

  // Arched window 2 (smaller)
  const w2x = wx - 100, w2y = 18;
  roundRect(ctx, w2x + 2, w2y, 30, 52, [15, 15, 0, 0], p.sky);
  roundRect(ctx, w2x - 1, w2y - 1, 36, 54, [16, 16, 0, 0], 'transparent');
  ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(w2x, w2y - 1, 34, 54, [15, 15, 0, 0]); ctx.stroke();
  roundRect(ctx, w2x, w2y + 36, 34, 16, 0, p.hills);
  px(ctx, w2x + 16, w2y + 16, 1, 36, p.wallBorder);

  // Tapestry banner
  px(ctx, 300, 18, 3, 6, p.deskBorder);
  px(ctx, 280, 24, 44, 60, p.banner + '20');
  px(ctx, 280, 24, 44, 1, p.banner + '40');
  px(ctx, 280, 83, 44, 1, p.banner + '40');
  px(ctx, 280, 24, 1, 60, p.banner + '30');
  px(ctx, 323, 24, 1, 60, p.banner + '30');
  // Crest
  strokeCircle(ctx, 302, 48, 10, p.banner + '30', 1);

  // Throne
  const thx = W - 80, thy = 220;
  roundRect(ctx, thx, thy, 46, 60, [12, 12, 2, 2], p.chair);
  px(ctx, thx, thy, 46, 1, '#ffffff08');
  // Crown detail
  roundRect(ctx, thx + 12, thy - 8, 22, 10, [5, 5, 0, 0], p.accent + '40');
  // Armrests
  roundRect(ctx, thx - 8, thy + 38, 10, 22, 3, p.deskBorder);
  roundRect(ctx, thx + 44, thy + 38, 10, 22, 3, p.deskBorder);

  // Candelabras
  for (const [cx2, cy2] of [[W - 50, 490], [30, 580]]) {
    px(ctx, cx2 + 4, cy2, 4, 14, p.candle || '#f5f0d0');
    circle(ctx, cx2 + 6, cy2 - 2, 3, p.torch);
    circle(ctx, cx2 + 6, cy2 - 4, 2, '#ffcc00');
    roundRect(ctx, cx2, cy2 + 14, 12, 4, 2, p.deskBorder);
  }

  // Suit of armor
  const ax = W - 50, ay = 390;
  circle(ctx, ax, ay, 8, '#555'); // helmet
  px(ctx, ax - 1, ay - 5, 3, 4, '#666'); // plume
  px(ctx, ax - 6, ay + 8, 12, 20, '#444'); // body
  px(ctx, ax - 6, ay + 8, 12, 1, '#ffffff08'); // body highlight
  px(ctx, ax - 10, ay + 12, 4, 14, '#444'); // left arm
  px(ctx, ax + 6, ay + 12, 4, 14, '#444'); // right arm
  px(ctx, ax - 4, ay + 28, 3, 12, '#444'); // left leg
  px(ctx, ax + 1, ay + 28, 3, 12, '#444'); // right leg
  // Sword
  px(ctx, ax + 12, ay + 4, 2, 24, '#888');
  px(ctx, ax + 10, ay + 4, 6, 2, '#aaa');
  circle(ctx, ax + 13, ay + 3, 1, '#ffffff30'); // sword glint

  // Ambient occlusion
  ambientOcclusion(ctx, 188, '#000000');
  floorGradient(ctx, 192, '#0d0818');

  // Dust motes (grey)
  dustMotes(ctx, 10, 185, 10, '#ffffff06');

  // Moss patches on lower stones
  circle(ctx, 80, 178, 4, '#22c55e10');
  circle(ctx, 340, 182, 3, '#22c55e08');
  circle(ctx, 600, 176, 5, '#22c55e0c');

  // Torch smoke wisps
  for (const tx of [160, 460, 760]) {
    circle(ctx, tx - 2, 84, 5, '#ffffff05');
    circle(ctx, tx + 3, 78, 4, '#ffffff04');
    circle(ctx, tx - 1, 72, 3, '#ffffff03');
    // Light cones from torches (varied radii for flicker)
    lightCone(ctx, tx + 6, 110, 75 + (tx % 20), p.torch);
  }

  // ─── Shield on wall ───
  const shx = 320, shy = 60;
  // Shield body
  ctx.save(); ctx.beginPath();
  ctx.moveTo(shx, shy); ctx.lineTo(shx + 24, shy); ctx.lineTo(shx + 24, shy + 20);
  ctx.lineTo(shx + 12, shy + 30); ctx.lineTo(shx, shy + 20);
  ctx.closePath(); ctx.fillStyle = p.accent + '35'; ctx.fill();
  ctx.strokeStyle = p.deskBorder; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
  // Shield cross
  px(ctx, shx + 10, shy + 2, 4, 26, '#ffffff10');
  px(ctx, shx + 2, shy + 8, 20, 4, '#ffffff10');
  // Shield highlight
  px(ctx, shx + 2, shy, 20, 1, '#ffffff08');

  // ─── Weapon rack on wall ───
  const wrx = 580, wry = 30;
  px(ctx, wrx, wry, 2, 70, '#3d2b1a');
  px(ctx, wrx + 40, wry, 2, 70, '#3d2b1a');
  // Horizontal bars
  px(ctx, wrx, wry + 10, 42, 2, '#3d2b1a');
  px(ctx, wrx, wry + 50, 42, 2, '#3d2b1a');
  // Weapons hanging
  // Sword
  px(ctx, wrx + 8, wry + 12, 2, 36, '#888');
  px(ctx, wrx + 5, wry + 12, 8, 2, '#aaa');
  circle(ctx, wrx + 9, wry + 13, 1, '#ffffff20');
  // Axe
  px(ctx, wrx + 20, wry + 14, 2, 30, '#5d4037');
  ctx.beginPath();
  ctx.moveTo(wrx + 22, wry + 16); ctx.lineTo(wrx + 30, wry + 20);
  ctx.lineTo(wrx + 22, wry + 26);
  ctx.closePath(); ctx.fillStyle = '#888'; ctx.fill();
  // Mace
  px(ctx, wrx + 32, wry + 16, 2, 26, '#5d4037');
  circle(ctx, wrx + 33, wry + 16, 5, '#666');
  // Spikes on mace
  for (let sp = 0; sp < 6; sp++) {
    const sa = (sp * Math.PI * 2) / 6;
    circle(ctx, wrx + 33 + Math.cos(sa) * 6, wry + 16 + Math.sin(sa) * 6, 1, '#888');
  }

  // ─── Crack detail in stone floor ───
  line(ctx, 200, 300, 240, 340, '#ffffff03', 0.5);
  line(ctx, 240, 340, 260, 330, '#ffffff03', 0.5);
  line(ctx, 500, 450, 520, 480, '#ffffff02', 0.5);
  line(ctx, 520, 480, 540, 490, '#ffffff02', 0.5);

  // ─── Rat / mouse in corner ───
  const rtx = 40, rty = H - 30;
  roundRect(ctx, rtx, rty, 8, 4, 2, '#4a3728');
  circle(ctx, rtx + 8, rty + 1, 2.5, '#4a3728');
  circle(ctx, rtx + 9, rty, 1, '#1a1a1a'); // eye
  px(ctx, rtx - 4, rty + 2, 6, 1, '#4a3728'); // tail
  line(ctx, rtx - 4, rty + 2, rtx - 8, rty + 5, '#4a3728', 0.5);

  // Wall texture dithering
  dither(ctx, 0, 0, W, 186, '#ffffff02', 0.02);
}

// ─── Draw Environment: STATION ────────────────────────────────────────────────

function drawStation(ctx) {
  const p = PALETTES.station;

  // Floor — metal grating
  px(ctx, 0, 0, W, H, p.floor);
  for (let y = 192; y < H; y += 32) {
    px(ctx, 10, y, W - 10, 1, p.accent + '06');
  }
  for (let x = 10; x < W; x += 32) {
    px(ctx, x, 192, 1, H - 192, p.accent + '05');
  }
  // Floor panel borders
  for (let y = 194; y < H; y += 128) {
    for (let x = 12; x < W; x += 128) {
      ctx.strokeStyle = p.accent + '06'; ctx.lineWidth = 1;
      ctx.strokeRect(x, y, 124, 124);
    }
  }

  // Top wall — metal panels
  px(ctx, 0, 0, W, 190, p.wallDark);
  for (let i = 0; i < 6; i++) {
    const px2 = i * 150;
    px(ctx, px2, 0, 148, 188, p.wall);
    px(ctx, px2, 0, 148, 1, '#ffffff06');
    px(ctx, px2, 187, 148, 1, '#00000020');
    px(ctx, px2 + 147, 0, 1, 188, p.wallBorder);
    // Corner rivets
    for (const [rx, ry] of [[px2 + 5, 5], [px2 + 141, 5], [px2 + 5, 181], [px2 + 141, 181], [px2 + 73, 5], [px2 + 73, 181]]) {
      circle(ctx, rx, ry, 2.5, p.wallBorder);
      circle(ctx, rx - 0.5, ry - 0.5, 1, p.accent + '30');
    }
    // Panel ID
    ctx.fillStyle = p.accent + '25'; ctx.font = '6px monospace';
    ctx.fillText(`SEC-${i + 1}`, px2 + 12, 14);
    // Accent stripe
    px(ctx, px2 + 12, 166, 124, 2, p.accent + '30');
    // Conduit (every other panel)
    if (i % 2 === 0) {
      roundRect(ctx, px2 + 12, 82, 124, 8, 2, '#00000020');
      roundRect(ctx, px2 + 16, 84, 24, 4, 2, p.accent + '15');
    }
  }

  // Status lights
  for (let i = 0; i < 14; i++) {
    const col = i % 5 === 0 ? p.red : i % 3 === 0 ? p.green : p.accent + '80';
    circle(ctx, 24 + i * 22, 10, 2.5, col);
  }

  // Hazard stripe at wall bottom
  for (let i = 0; i < 30; i++) {
    if (i % 2 === 0) px(ctx, i * 30, 186, 15, 4, p.yellow + '15');
  }
  px(ctx, 0, 186, W, 4, '#00000040');

  // Vent grate
  px(ctx, 600, 140, 52, 32, '#00000030');
  ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 1;
  ctx.strokeRect(600, 140, 52, 32);
  for (let i = 0; i < 5; i++) {
    roundRect(ctx, 604, 144 + i * 6, 44, 3, 1, '#00000040');
  }

  // Left wall
  px(ctx, 0, 0, 10, H, p.wall);
  px(ctx, 8, 0, 2, H, p.accent + '20');
  // Conduit pipe
  px(ctx, 2, 192, 4, H - 192, p.wallBorder);

  // Wide viewport
  const vx = W - 260, vy = 16;
  px(ctx, vx, vy, 128, 60, '#000008');
  ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 3;
  ctx.strokeRect(vx, vy, 128, 60);
  px(ctx, vx, vy, 128, 1, '#ffffff08');
  // Stars (dense)
  for (let i = 0; i < 40; i++) {
    const sx = vx + 4 + ((i * 13 + i * i * 3) % 120);
    const sy = vy + 3 + ((i * 7 + i * 5) % 52);
    const sr = i % 5 === 0 ? 2 : i % 3 === 0 ? 1.5 : 1;
    const sa = i % 4 === 0 ? '90' : i % 2 === 0 ? '60' : '30';
    circle(ctx, sx, sy, sr, '#ffffff' + sa);
  }
  // Nebula
  roundRect(ctx, vx + 20, vy + 10, 36, 18, 10, p.accent + '06');
  roundRect(ctx, vx + 30, vy + 14, 20, 10, 5, '#a855f708');
  // Planet
  const ppx = vx + 96, ppy = vy + 40;
  circle(ctx, ppx, ppy, 12, p.accent + '08'); // atmosphere
  circle(ctx, ppx, ppy, 10, p.accent + '35');
  // Planet surface
  roundRect(ctx, ppx - 6, ppy - 2, 10, 4, 2, p.accent + '20');
  roundRect(ctx, ppx - 3, ppy + 3, 8, 3, 1.5, p.accent + '15');
  // Terminator
  roundRect(ctx, ppx + 2, ppy - 10, 8, 20, [0, 10, 10, 0], '#00000030');
  // Ring
  roundRect(ctx, ppx - 18, ppy - 1, 36, 4, 2, p.accent + '18');
  // Satellite
  px(ctx, vx + 60, vy + 14, 8, 2, '#ffffff60');
  px(ctx, vx + 63, vy + 11, 2, 8, '#ffffff30');
  // HUD brackets
  ctx.strokeStyle = p.accent + '20'; ctx.lineWidth = 1;
  for (const [hx, hy, hw, hh] of [[vx + 3, vy + 3, 10, 10], [vx + 115, vy + 3, 10, 10], [vx + 3, vy + 47, 10, 10], [vx + 115, vy + 47, 10, 10]]) {
    ctx.beginPath();
    ctx.moveTo(hx, hy + hh); ctx.lineTo(hx, hy); ctx.lineTo(hx + hw, hy);
    ctx.stroke();
  }
  // Scan lines
  for (let i = 0; i < 15; i++) {
    px(ctx, vx, vy + i * 4, 128, 1, p.accent + '04');
  }
  // Sector label
  ctx.fillStyle = p.accent + '30'; ctx.font = '6px monospace';
  ctx.fillText('SECTOR 7-G · ALL SYSTEMS NOMINAL', vx + 10, vy + 70);

  // Control panel
  const cpx = W - 100, cpy = 220;
  roundRect(ctx, cpx, cpy, 80, 50, 3, p.desk);
  px(ctx, cpx, cpy, 80, 1, '#ffffff08');
  // Screen
  px(ctx, cpx + 4, cpy + 4, 72, 26, '#000010');
  ctx.strokeStyle = p.accent + '30'; ctx.lineWidth = 1;
  ctx.strokeRect(cpx + 4, cpy + 4, 72, 26);
  for (let i = 0; i < 4; i++) {
    px(ctx, cpx + 8, cpy + 8 + i * 6, 30 + i * 8, 1, p.accent + '30');
  }
  // Buttons
  for (const [bx, bc] of [[cpx + 10, p.green], [cpx + 20, p.red], [cpx + 30, p.accent], [cpx + 40, p.yellow]]) {
    circle(ctx, bx, cpy + 40, 4, bc);
    circle(ctx, bx - 1, cpy + 39, 1.5, '#ffffff30');
  }

  // Antenna
  px(ctx, W - 50, 200, 2, 50, p.wallBorder);
  px(ctx, W - 57, 200, 16, 3, p.wallBorder);
  circle(ctx, W - 49, 197, 4, p.accent);
  circle(ctx, W - 50, 196, 2, '#ffffff40');

  // Hologram projector
  roundRect(ctx, W - 60, 400, 36, 8, 4, p.desk);
  // Hologram beam
  for (let i = 0; i < 6; i++) {
    px(ctx, W - 54 + i, 370 + i * 5, 24 - i * 2, 1, p.accent + '06');
  }

  // Rest pod
  roundRect(ctx, W - 140, 310, 100, 50, 8, p.chair);
  ctx.strokeStyle = p.accent + '20'; ctx.lineWidth = 1;
  ctx.strokeRect(W - 140, 310, 100, 50);
  ctx.fillStyle = p.accent + '40'; ctx.font = '8px monospace';
  ctx.fillText('REST POD', W - 120, 340);

  // Ambient occlusion
  ambientOcclusion(ctx, 188, '#000008');
  floorGradient(ctx, 192, '#02020a');

  // Floor scan lines (faint blue)
  for (let y = 196; y < H; y += 4) {
    px(ctx, 10, y, W - 10, 1, p.accent + '02');
  }
  // Floor path lighting strips
  px(ctx, 200, 192, 2, H - 192, p.accent + '06');
  px(ctx, 700, 192, 2, H - 192, p.accent + '06');
  // Floor path glow
  roundRect(ctx, 198, 192, 6, H - 192, 0, p.accent + '02');
  roundRect(ctx, 698, 192, 6, H - 192, 0, p.accent + '02');

  // Wall texture dithering
  dither(ctx, 0, 0, W, 190, '#3b82f602', 0.02);
}

// ─── Draw Environment: SUBMARINE ──────────────────────────────────────────────

function drawSubmarine(ctx) {
  const p = PALETTES.submarine;

  // Floor — metal plates
  px(ctx, 0, 0, W, H, p.floor);
  for (let y = 194; y < H; y += 48) {
    for (let x = 14; x < W; x += 80) {
      ctx.strokeStyle = p.wallBorder + '12'; ctx.lineWidth = 1;
      ctx.strokeRect(x, y, 76, 44);
      for (const [rx, ry] of [[x + 3, y + 3], [x + 73, y + 3], [x + 3, y + 41], [x + 73, y + 41]]) {
        circle(ctx, rx, ry, 2, p.wallBorder + '20');
      }
    }
  }

  // Top wall — hull with rivets
  px(ctx, 0, 0, W, 190, p.wall);
  // Horizontal seams
  for (const sy of [60, 120]) {
    px(ctx, 0, sy - 1, W, 1, '#00000020');
    px(ctx, 0, sy, W, 2, p.wallBorder);
    px(ctx, 0, sy + 2, W, 1, '#ffffff06');
  }
  // Rivets
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 20; col++) {
      const rx = 20 + col * 44, ry = 10 + row * 38;
      circle(ctx, rx, ry, 3, p.wallBorder);
      circle(ctx, rx - 0.5, ry - 0.5, 1, '#ffffff10');
    }
  }
  // Hull plate IDs
  ctx.fillStyle = p.wallBorder + '40'; ctx.font = '6px monospace';
  for (const [tx, ty, t] of [[80, 36, 'H-103'], [300, 96, 'H-204'], [520, 36, 'H-305'], [720, 96, 'H-406']]) {
    ctx.fillText(t, tx, ty);
  }
  // Pipe with valve
  px(ctx, 0, 168, W, 12, p.deskBorder);
  px(ctx, 0, 168, W, 1, p.wallBorder);
  px(ctx, 0, 179, W, 1, p.wallBorder);
  px(ctx, 0, 170, W, 2, '#ffffff06');
  // Valve wheel
  strokeCircle(ctx, 400, 174, 12, p.wallBorder, 3);
  line(ctx, 388, 174, 412, 174, p.wallBorder, 2);
  line(ctx, 400, 162, 400, 186, p.wallBorder, 2);
  // Pressure gauge
  circle(ctx, 650, 42, 14, '#001810');
  strokeCircle(ctx, 650, 42, 14, p.wallBorder, 2);
  line(ctx, 650, 42, 660, 36, '#22c55e80', 2);
  ctx.fillStyle = p.accent; ctx.font = '5px monospace';
  ctx.fillText('PSI', 644, 52);
  // Water stain
  px(ctx, 240, 62, 3, 30, '#ffffff04');
  // Bottom shadow
  px(ctx, 0, 186, W, 4, '#00000020');

  // Left wall
  px(ctx, 0, 0, 12, H, p.wall);
  px(ctx, 10, 0, 2, H, p.wallBorder);
  // Vertical pipe
  px(ctx, 3, 192, 4, H - 192, p.deskBorder);
  px(ctx, 3, 192, 1, H - 192, '#ffffff08');

  // Porthole
  const phx = W - 220, phy = 28;
  circle(ctx, phx + 34, phy + 37, 35, '#00000030');
  circle(ctx, phx + 32, phy + 32, 35, p.wallBorder);
  circle(ctx, phx + 32, phy + 32, 30, p.sky);
  // Water layers
  px(ctx, phx + 2, phy + 2, 60, 22, p.water);
  px(ctx, phx + 2, phy + 24, 60, 20, p.sky);
  px(ctx, phx + 2, phy + 44, 60, 20, p.waterDark);
  // Light rays
  ctx.save(); ctx.globalAlpha = 0.04;
  px(ctx, phx + 16, phy + 2, 8, 30, '#ffffff');
  px(ctx, phx + 32, phy + 2, 6, 25, '#ffffff');
  ctx.restore();
  // Seaweed
  roundRect(ctx, phx + 8, phy + 40, 4, 22, [6, 4, 0, 0], p.seaweed);
  roundRect(ctx, phx + 16, phy + 44, 3, 18, [4, 6, 0, 0], p.seaweedLight);
  roundRect(ctx, phx + 46, phy + 48, 3, 14, [4, 0, 0, 0], p.seaweed);
  // Fish
  ctx.fillStyle = '#22d3ee'; ctx.font = '10px serif';
  ctx.fillText('🐟', phx + 40, phy + 22);
  ctx.font = '8px serif';
  ctx.fillText('🐠', phx + 24, phy + 40);
  // Bubbles
  for (const [bx, by, bs] of [[phx + 30, phy + 10, 5], [phx + 36, phy + 18, 3], [phx + 33, phy + 26, 4], [phx + 40, phy + 30, 2]]) {
    strokeCircle(ctx, bx, by, bs, '#ffffff15', 1);
    circle(ctx, bx - 1, by - 1, 1, '#ffffff10');
  }
  // Sandy bottom
  roundRect(ctx, phx + 4, phy + 56, 56, 6, [4, 4, 0, 0], p.sand + '30');
  // Glass reflection
  roundRect(ctx, phx + 12, phy + 8, 20, 8, 6, '#ffffff06');
  // 8 bolts
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8;
    const bx2 = phx + 32 + Math.cos(a) * 31;
    const by2 = phy + 32 + Math.sin(a) * 31;
    circle(ctx, bx2, by2, 3, p.wallBorder);
    circle(ctx, bx2 - 0.5, by2 - 0.5, 1, '#ffffff10');
  }

  // Periscope
  px(ctx, W - 60, 200, 8, 55, p.wallBorder);
  roundRect(ctx, W - 66, 196, 22, 12, 4, p.desk);
  px(ctx, W - 58, 198, 10, 8, '#001a10');

  // Depth gauge
  circle(ctx, W - 110, 230, 18, '#0a1a10');
  strokeCircle(ctx, W - 110, 230, 18, p.wallBorder, 2);
  line(ctx, W - 110, 230, W - 100, 220, p.accent, 2);
  ctx.fillStyle = p.accent; ctx.font = '5px monospace';
  ctx.fillText('DEPTH', W - 120, 244);

  // Torpedo tube
  roundRect(ctx, W - 60, 420, 44, 20, 10, p.desk);
  ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(W - 60, 420, 44, 20, 10); ctx.stroke();
  circle(ctx, W - 20, 430, 6, '#001010');
  strokeCircle(ctx, W - 20, 430, 6, p.wallBorder, 1);

  // Bubble column
  roundRect(ctx, W - 50, 470, 18, 70, 9, p.accent + '08');
  ctx.strokeStyle = p.accent + '15'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(W - 50, 470, 18, 70, 9); ctx.stroke();
  for (const [by3, bx3] of [[480, W - 44], [492, W - 40], [508, W - 43], [520, W - 38], [530, W - 42]]) {
    circle(ctx, bx3, by3, 2.5, '#ffffff10');
  }

  // Pipe across floor
  roundRect(ctx, 100, 650, W - 200, 6, 3, p.deskBorder + '60');
  // Pipe joints
  circle(ctx, 100, 653, 5, p.deskBorder + '70');
  circle(ctx, W - 100, 653, 5, p.deskBorder + '70');

  // Ambient occlusion
  ambientOcclusion(ctx, 188, '#001010');
  floorGradient(ctx, 192, '#001010');

  // Extra bubbles rising from floor
  for (const [bx, by, br] of [[100, 480, 3], [250, 520, 2], [400, 460, 2.5], [550, 510, 2], [700, 470, 3], [800, 530, 1.5]]) {
    circle(ctx, bx, by, br, '#ffffff08');
    circle(ctx, bx - 1, by - 1, br * 0.4, '#ffffff04');
  }

  // Coral formation in corner
  const cox = 30, coy = 450;
  // Main branch
  px(ctx, cox, coy, 4, 30, '#ff636340');
  px(ctx, cox + 6, coy + 5, 3, 25, '#ff949440');
  px(ctx, cox - 4, coy + 10, 3, 20, '#ff636330');
  // Coral tips
  circle(ctx, cox + 1, coy - 2, 4, '#ff636350');
  circle(ctx, cox + 7, coy + 3, 3, '#ff949460');
  circle(ctx, cox - 3, coy + 8, 3, '#ff636340');

  // Sonar ping rings
  strokeCircle(ctx, 200, 400, 30, p.accent + '08', 1);
  strokeCircle(ctx, 200, 400, 20, p.accent + '12', 1);
  strokeCircle(ctx, 200, 400, 10, p.accent + '18', 1);

  // Water caustic pattern on floor
  for (let i = 0; i < 8; i++) {
    const cx2 = 100 + ((i * 97) % 600);
    const cy2 = 250 + ((i * 53) % 350);
    line(ctx, cx2, cy2, cx2 + 20 + (i % 3) * 10, cy2 + 5 - (i % 2) * 10, p.accent + '04', 1);
  }

  // Wall texture dithering
  dither(ctx, 0, 0, W, 190, '#22c55e02', 0.02);
  // Extra bubble columns
  for (let col = 0; col < 4; col++) {
    const bx2 = 150 + col * 180;
    for (let j = 0; j < 5; j++) {
      const by2 = 220 + j * 60 + ((col * 17 + j * 29) % 30);
      circle(ctx, bx2, by2, 1.5 + (j % 2), p.bubble);
    }
  }
}

// ─── Draw Environment: MANSION ────────────────────────────────────────────────

function drawMansion(ctx) {
  const p = PALETTES.mansion;

  // Floor — parquet pattern
  px(ctx, 0, 0, W, H, p.floor);
  for (let y = 194; y < H; y += 24) {
    const row = (y - 194) / 24;
    for (let x = 12; x < W; x += 48) {
      if (row % 2 === 0) {
        px(ctx, x, y, 46, 10, p.floor);
        px(ctx, x, y + 10, 46, 1, p.wallBorder + '08');
        px(ctx, x, y + 12, 46, 10, p.floor);
        px(ctx, x, y + 22, 46, 1, p.wallBorder + '06');
      } else {
        px(ctx, x, y, 22, 22, p.floor);
        px(ctx, x + 22, y, 1, 22, p.wallBorder + '08');
        px(ctx, x + 24, y, 22, 22, p.floor);
        px(ctx, x + 46, y, 1, 22, p.wallBorder + '06');
      }
    }
  }

  // Top wall — dark wood panels
  px(ctx, 0, 0, W, 190, p.wall);
  // Crown molding
  px(ctx, 0, 0, W, 5, p.wood);
  px(ctx, 0, 4, W, 1, '#ffffff08');
  px(ctx, 0, 5, W, 4, p.woodLight);
  px(ctx, 0, 8, W, 1, '#00000020');
  // Upper panels
  for (let i = 0; i < 8; i++) {
    const panx = 12 + i * 112;
    px(ctx, panx, 12, 104, 104, p.wall);
    ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 1;
    ctx.strokeRect(panx, 12, 104, 104);
    // Inner frame
    ctx.strokeStyle = p.wallBorder + '60'; ctx.lineWidth = 1;
    ctx.strokeRect(panx + 8, 20, 88, 88);
    // Wood grain
    px(ctx, panx + 14, 40, 30, 1, p.wallBorder + '15');
    px(ctx, panx + 30, 60, 40, 1, p.wallBorder + '12');
    px(ctx, panx + 20, 80, 25, 1, p.wallBorder + '10');
    // Highlight/shadow
    px(ctx, panx, 12, 104, 1, '#ffffff06');
    px(ctx, panx, 115, 104, 1, '#00000015');
  }
  // Chair rail
  px(ctx, 0, 122, W, 5, p.wood);
  px(ctx, 0, 122, W, 1, '#ffffff06');
  px(ctx, 0, 126, W, 1, '#00000015');
  // Wainscoting lower panels
  for (let i = 0; i < 12; i++) {
    const wpx = 10 + i * 76;
    px(ctx, wpx, 130, 72, 54, p.wall);
    ctx.strokeStyle = p.wallBorder + '50'; ctx.lineWidth = 1;
    ctx.strokeRect(wpx, 130, 72, 54);
    ctx.strokeStyle = p.wallBorder + '30'; ctx.lineWidth = 1;
    ctx.strokeRect(wpx + 5, 135, 62, 44);
  }
  // Damask pattern
  for (let i = 0; i < 6; i++) {
    strokeCircle(ctx, 68 + i * 152, 54, 5, p.wallBorder + '10', 1);
  }
  // Bottom shadow
  px(ctx, 0, 186, W, 4, '#00000020');

  // Left wall
  px(ctx, 0, 0, 10, H, p.wall);
  px(ctx, 8, 0, 2, H, p.wallBorder);

  // Gothic window
  const gwx = W - 222, gwy = 12;
  roundRect(ctx, gwx + 5, gwy + 3, 52, 78, [26, 26, 0, 0], '#00000040');
  px(ctx, gwx - 2, gwy + 78, 62, 6, p.woodLight);
  roundRect(ctx, gwx + 2, gwy, 52, 76, [26, 26, 0, 0], p.sky);
  // Sky gradient
  px(ctx, gwx + 2, gwy, 52, 30, '#0a0020');
  // Moon + halo
  circle(ctx, gwx + 40, gwy + 12, 8, p.moon + '08');
  circle(ctx, gwx + 40, gwy + 12, 5, p.moon + '50');
  // Stars
  circle(ctx, gwx + 10, gwy + 8, 1, '#ffffff30');
  circle(ctx, gwx + 24, gwy + 18, 0.5, '#ffffff20');
  // Dead tree
  px(ctx, gwx + 14, gwy + 30, 3, 40, p.tree);
  ctx.save(); ctx.translate(gwx + 15, gwy + 36); ctx.rotate(-0.5);
  px(ctx, 0, 0, 14, 2, p.tree); ctx.restore();
  ctx.save(); ctx.translate(gwx + 15, gwy + 42); ctx.rotate(0.4);
  px(ctx, 0, 0, 10, 2, p.tree); ctx.restore();
  ctx.save(); ctx.translate(gwx + 12, gwy + 48); ctx.rotate(0.25);
  px(ctx, 0, 0, 8, 1.5, p.tree); ctx.restore();
  // Fence silhouette
  for (let i = 0; i < 8; i++) {
    const fh = 6 + (i % 2) * 3;
    px(ctx, gwx + 6 + i * 6, gwy + 70 - fh, 2, fh, '#0d0010');
    circle(ctx, gwx + 7 + i * 6, gwy + 70 - fh - 1, 2, '#0d0010');
  }
  // Ground + fog
  px(ctx, gwx + 2, gwy + 68, 52, 8, '#0d0010');
  roundRect(ctx, gwx + 2, gwy + 64, 52, 6, 3, '#ffffff04');
  // Bats
  ctx.font = '6px serif';
  ctx.fillText('🦇', gwx + 8, gwy + 24);
  ctx.font = '5px serif';
  ctx.fillText('🦇', gwx + 26, gwy + 20);
  // Mullion
  px(ctx, gwx + 27, gwy + 16, 2, 60, p.wallBorder);

  // Grandfather clock
  const gcx = W - 70, gcy = 210;
  roundRect(ctx, gcx, gcy, 36, 80, [8, 8, 2, 2], p.wood);
  px(ctx, gcx, gcy, 36, 1, '#ffffff08');
  // Clock face
  circle(ctx, gcx + 18, gcy + 16, 12, '#f5f0e0');
  strokeCircle(ctx, gcx + 18, gcy + 16, 12, p.woodLight, 1);
  // Hands
  line(ctx, gcx + 18, gcy + 16, gcx + 18, gcy + 8, '#1a1a1a', 1.5);
  line(ctx, gcx + 18, gcy + 16, gcx + 24, gcy + 14, '#1a1a1a', 1);
  // Pendulum
  circle(ctx, gcx + 18, gcy + 60, 6, p.gold + '60');

  // Portrait
  const prx = W - 140, pry = 210;
  px(ctx, prx, pry, 40, 50, p.wood);
  ctx.strokeStyle = p.accent + '40'; ctx.lineWidth = 2;
  ctx.strokeRect(prx, pry, 40, 50);
  px(ctx, prx + 5, pry + 5, 30, 40, '#1a0a20');
  circle(ctx, prx + 20, pry + 20, 8, '#ffffff10'); // face silhouette

  // Cobwebs
  for (const [cwx, cwy, flip] of [[2, 190, false], [W - 42, 190, true]]) {
    ctx.save(); ctx.globalAlpha = 0.2;
    line(ctx, cwx, cwy, cwx + (flip ? -30 : 30), cwy, '#888', 1);
    line(ctx, cwx, cwy, cwx, cwy + 20, '#888', 1);
    line(ctx, cwx, cwy, cwx + (flip ? -20 : 20), cwy + 14, '#666', 1);
    ctx.restore();
  }

  // Fireplace
  const fpx = W - 140, fpy = 310;
  roundRect(ctx, fpx, fpy, 70, 55, [5, 5, 0, 0], p.wood);
  px(ctx, fpx - 4, fpy - 4, 78, 6, p.woodLight);
  px(ctx, fpx + 14, fpy + 16, 42, 39, '#1a0500');
  roundRect(ctx, fpx + 14, fpy + 16, 42, 30, [20, 20, 0, 0], '#1a0500');
  ctx.font = '16px serif';
  ctx.fillText('🔥', fpx + 26, fpy + 44);

  // Candelabra
  px(ctx, W - 50, 490, 4, 14, p.candle);
  circle(ctx, W - 48, 486, 3, p.flame);
  roundRect(ctx, W - 54, 504, 12, 4, 2, p.woodLight);
  // Candle light cone
  lightCone(ctx, W - 48, 504, 50, p.flame);

  // Ambient occlusion
  ambientOcclusion(ctx, 188, '#0a0008');
  floorGradient(ctx, 192, '#090409');

  // Dust motes (grey)
  dustMotes(ctx, 10, 185, 12, '#ffffff05');

  // Spider on cobweb (left one)
  circle(ctx, 14, 200, 2, '#333');
  px(ctx, 13, 198, 1, 1, '#555'); // leg
  px(ctx, 15, 198, 1, 1, '#555'); // leg

  // Floorboard creak highlights (random brighter boards)
  for (const [fx, fy] of [[80, 220], [300, 340], [500, 420], [200, 530]]) {
    px(ctx, fx, fy, 46, 10, '#ffffff02');
  }

  // Ghost outline (very faint in corner)
  ctx.save(); ctx.globalAlpha = 0.03;
  circle(ctx, 60, 500, 8, '#ffffff');
  roundRect(ctx, 52, 508, 16, 24, [0, 0, 6, 6], '#ffffff');
  ctx.restore();

  // Fireplace light cone
  lightCone(ctx, W - 105, 365, 80, p.flame);

  // Wall texture dithering
  dither(ctx, 0, 0, W, 186, '#ffffff02', 0.02);
}

// ─── Draw Environment: LAIR ──────────────────────────────────────────────────

function drawLair(ctx) {
  const p = PALETTES.lair;

  // Floor — volcanic rock
  px(ctx, 0, 0, W, H, p.floor);
  for (let y = 196; y < H; y += 50) {
    for (let x = 16; x < W; x += 60) {
      ctx.strokeStyle = p.wallBorder + '10'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, y, 55, 45, 4); ctx.stroke();
      // Lava seam
      roundRect(ctx, x + 8, y + 20, 22, 1, 0.5, p.accent + '08');
    }
  }

  // Top wall — obsidian rock
  px(ctx, 0, 0, W, 190, p.wallDark);
  // Rock shapes
  for (let i = 0; i < 24; i++) {
    const rx = (i * 43 + (i % 5) * 28) % 880;
    const ry = (i * 21 + (i % 4) * 16) % 175;
    const rw = 26 + (i % 4) * 16;
    const rh = 14 + (i % 3) * 10;
    roundRect(ctx, rx, ry, rw, rh, 2 + (i % 4), p.wall);
    // Highlight
    px(ctx, rx + 1, ry + 1, rw * 0.5, 1, '#ffffff06');
    // Shadow
    px(ctx, rx + rw * 0.3, ry + rh - 2, rw * 0.5, 1, '#00000020');
  }
  // Lava cracks with glow
  const cracks = [
    [80, 70, 70, -12], [130, 78, 40, 20], [300, 100, 55, -8], [340, 96, 30, 35],
    [520, 60, 80, -5], [570, 55, 25, 40], [700, 110, 60, -15], [740, 105, 35, 25],
    [200, 140, 50, 10], [450, 35, 45, -20],
  ];
  for (const [cx, cy, cw, cr] of cracks) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((cr * Math.PI) / 180);
    // Outer glow
    roundRect(ctx, -2, -3, cw + 4, 8, 4, p.accent + '10');
    // Core
    roundRect(ctx, 0, 0, cw, 2, 1, p.accent + '70');
    // Bright center
    roundRect(ctx, cw * 0.2, 0, cw * 0.3, 2, 1, p.lavaLight + '40');
    ctx.restore();
  }
  // Stalactites
  for (const [sx, sh] of [[50, 16], [180, 22], [340, 18], [500, 24], [660, 20], [820, 14]]) {
    const sw = 4 + (sh % 3) * 2;
    ctx.beginPath();
    ctx.moveTo(sx, 0); ctx.lineTo(sx + sw, 0);
    ctx.lineTo(sx + sw / 2, sh); ctx.closePath();
    ctx.fillStyle = p.wall; ctx.fill();
    ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 1; ctx.stroke();
    // Drip
    if (sh > 18) circle(ctx, sx + sw / 2, sh + 2, 1.5, p.accent + '20');
  }
  // Heat haze at bottom
  px(ctx, 0, 180, W, 10, p.accent + '08');

  // Left wall
  px(ctx, 0, 0, 12, H, p.wall);
  px(ctx, 10, 0, 2, H, p.accent + '25');
  // Lava vein
  roundRect(ctx, 3, 260, 2, 80, 1, p.accent + '30');

  // Lava window (crack in rock)
  const lwx = W - 230, lwy = 28;
  roundRect(ctx, lwx, lwy, 66, 56, 5, '#000');
  // Lava glow layers
  px(ctx, lwx + 2, lwy + 2, 62, 52, p.accent + '15');
  px(ctx, lwx + 2, lwy + 28, 62, 26, p.accent + '25');
  px(ctx, lwx + 2, lwy + 38, 62, 16, p.accent + '40');
  px(ctx, lwx + 2, lwy + 46, 62, 8, p.accent + '60');
  // Hot spots
  roundRect(ctx, lwx + 12, lwy + 48, 14, 4, 2, p.lavaLight + '80');
  roundRect(ctx, lwx + 38, lwy + 50, 10, 3, 1.5, p.lavaLight + '60');
  roundRect(ctx, lwx + 28, lwy + 46, 8, 4, 2, '#ffffff30');
  // Lava bubble
  strokeCircle(ctx, lwx + 22, lwy + 40, 4, p.lavaLight + '40', 1);
  // Rock edges
  roundRect(ctx, lwx, lwy, 10, 22, [5, 0, 8, 0], p.wallDark);
  roundRect(ctx, lwx + 56, lwy, 8, 18, [0, 5, 0, 6], p.wallDark);
  roundRect(ctx, lwx + 50, lwy + 46, 14, 10, [6, 0, 0, 0], p.wallDark);
  // Smoke wisps
  for (const [smx, smy, smr] of [[lwx + 14, lwy + 6, 5], [lwx + 32, lwy + 4, 6], [lwx + 46, lwy + 8, 4]]) {
    circle(ctx, smx, smy, smr, '#ffffff06');
  }
  // Glow cast
  ctx.strokeStyle = p.accent + '06'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(lwx - 6, lwy - 6, 78, 68, 10); ctx.stroke();

  // Lava pool
  const lpx = W - 110, lpy = 220;
  roundRect(ctx, lpx, lpy, 80, 50, 20, p.accent + '20');
  ctx.strokeStyle = p.accent + '40'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(lpx, lpy, 80, 50, 20); ctx.stroke();
  // Bubbles
  circle(ctx, lpx + 20, lpy + 18, 5, p.lavaLight + '60');
  circle(ctx, lpx + 50, lpy + 28, 4, p.lavaLight + '40');
  circle(ctx, lpx + 35, lpy + 14, 3, p.lavaLight + '50');

  // Crystal formations
  for (const [crx, cry, crh, crc] of [[W - 60, 400, 28, p.accent + '30'], [W - 50, 400, 22, '#a855f730'], [W - 44, 400, 32, p.accent + '20']]) {
    ctx.beginPath();
    ctx.moveTo(crx, cry); ctx.lineTo(crx + 5, cry); ctx.lineTo(crx + 2.5, cry - crh);
    ctx.closePath();
    ctx.fillStyle = crc; ctx.fill();
    // Crystal highlight
    px(ctx, crx + 1, cry - crh + 4, 1, crh * 0.5, '#ffffff08');
  }

  // Obsidian pillar
  roundRect(ctx, W - 60, 460, 24, 60, 3, p.obsidian);
  ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(W - 60, 460, 24, 60, 3); ctx.stroke();
  // Lava vein in pillar
  roundRect(ctx, W - 54, 480, 2, 20, 1, p.accent + '20');

  // Smoke vents
  for (const [vx, vy] of [[30, 570], [W - 50, 550]]) {
    roundRect(ctx, vx, vy, 22, 6, 3, '#333');
    for (let i = 0; i < 3; i++) {
      circle(ctx, vx + 6 + i * 4, vy - 6 - i * 5, 3 + i, '#ffffff06');
    }
  }

  // Ambient occlusion (warm red)
  ambientOcclusion(ctx, 188, '#1a0000');
  floorGradient(ctx, 194, '#0f0200');

  // Glowing rune symbols on wall rocks
  ctx.fillStyle = p.accent + '20'; ctx.font = '10px monospace';
  ctx.fillText('ᚱ', 260, 80);
  ctx.fillText('ᛏ', 620, 60);
  // Rune glow
  circle(ctx, 265, 74, 10, p.accent + '06');
  circle(ctx, 625, 54, 10, p.accent + '06');

  // Crystal facets (highlight lines on existing crystals)
  px(ctx, W - 59, 375, 1, 22, '#ffffff06');
  px(ctx, W - 48, 381, 1, 16, '#ffffff08');
  px(ctx, W - 43, 372, 1, 26, '#ffffff05');

  // Ember particles floating
  dustMotes(ctx, 30, 180, 6, '#ff660012');
  // Extra embers near lava
  circle(ctx, W - 80, 260, 1.5, '#fbbf2418');
  circle(ctx, W - 100, 230, 1, '#fbbf2414');
  circle(ctx, W - 50, 250, 1, '#ef444418');

  // Lava glow on floor
  lightCone(ctx, W - 70, 270, 100, p.accent);

  // ─── Skull on floor ───
  const skx = 180, sky = 540;
  circle(ctx, skx, sky, 7, '#d4c4a020');
  circle(ctx, skx, sky, 5, '#d4c4a015');
  // Eye sockets
  circle(ctx, skx - 2, sky - 1, 2, '#0a000020');
  circle(ctx, skx + 2, sky - 1, 2, '#0a000020');
  // Jaw
  roundRect(ctx, skx - 4, sky + 3, 8, 3, [0, 0, 2, 2], '#d4c4a012');

  // ─── Chains hanging from ceiling ───
  for (const cx of [100, 350]) {
    for (let cy = 0; cy < 60; cy += 6) {
      roundRect(ctx, cx, cy, 4, 5, 2, '#6b728015');
      roundRect(ctx, cx + 1, cy + 3, 4, 5, 2, '#6b728010');
    }
  }

  // ─── Lava drips on rock edges ───
  for (const [dx, dy] of [[W - 80, 194], [W - 30, 196], [80, 195]]) {
    roundRect(ctx, dx, dy, 3, 8, [0, 0, 2, 2], p.accent + '18');
    circle(ctx, dx + 1, dy + 8, 2, p.accent + '10');
  }

  // Wall texture dithering (warm)
  dither(ctx, 0, 0, W, 186, '#ff440003', 0.02);
}

// ─── Draw Environment: CABIN ──────────────────────────────────────────────────

function drawCabin(ctx) {
  const p = PALETTES.cabin;

  // Floor — wide wood planks
  px(ctx, 0, 0, W, H, p.floor);
  for (let y = 192; y < H; y += 28) {
    px(ctx, 14, y + 27, W - 14, 1, p.wallBorder + '20');
    // Grain
    px(ctx, 14 + 40, y + 8, 60, 1, p.wallBorder + '06');
    px(ctx, 14 + 200, y + 18, 50, 1, p.wallBorder + '05');
  }

  // Top wall — horizontal logs
  for (let y = 0; y < 190; y += 19) {
    px(ctx, 0, y, W, 18, p.wall);
    px(ctx, 0, y + 17, W, 1, p.wallBorder);
    px(ctx, 0, y, W, 1, p.wallDark);
    // Log highlight
    px(ctx, 0, y + 1, W, 2, '#ffffff06');
    // Shadow bottom
    px(ctx, 0, y + 15, W, 2, '#00000010');
    // Wood grain (5 lines)
    for (let g = 0; g < 5; g++) {
      const gx = (y * 40 + g * 170 + 50) % 600;
      px(ctx, gx, y + 3 + g * 3, 50 + g * 10, 1, p.wallBorder + '15');
    }
    // Knot hole
    if (y % 57 === 0) {
      roundRect(ctx, 400 + y * 2, y + 4, 10, 8, 5, p.wallBorder + '25');
      strokeCircle(ctx, 405 + y * 2, y + 8, 3, p.wallBorder + '15', 1);
    }
  }
  // Log ends on right side
  for (let y = 0; y < 190; y += 19) {
    circle(ctx, W - 12, y + 9, 8, p.wallBorder + '30');
    strokeCircle(ctx, W - 12, y + 9, 8, p.wallBorder + '50', 1);
    strokeCircle(ctx, W - 12, y + 9, 4, p.wallBorder + '25', 1);
    circle(ctx, W - 12, y + 9, 2, p.wallBorder + '20');
  }
  px(ctx, 0, 186, W, 4, '#00000020');

  // Left wall
  px(ctx, 0, 0, 14, H, p.wall);
  px(ctx, 12, 0, 2, H, p.wallBorder);
  // Corner notches
  for (let y = 0; y < 190; y += 19) {
    roundRect(ctx, 1, y + 2, 12, 14, 2, p.wallBorder + '15');
  }

  // 4-pane window
  const wwx = W - 250, wwy = 22;
  // Shadow
  roundRect(ctx, wwx + 3, wwy + 3, 78, 52, 2, '#00000030');
  // Sill
  roundRect(ctx, wwx - 4, wwy + 50, 86, 6, 2, p.deskBorder);
  px(ctx, wwx - 2, wwy + 50, 82, 1, '#ffffff08');
  // Window content
  px(ctx, wwx + 2, wwy + 2, 74, 46, p.sky);
  // Mountains
  ctx.beginPath();
  ctx.moveTo(wwx - 2, wwy + 36); ctx.lineTo(wwx + 16, wwy + 18); ctx.lineTo(wwx + 34, wwy + 32);
  ctx.lineTo(wwx + 50, wwy + 14); ctx.lineTo(wwx + 78, wwy + 30); ctx.lineTo(wwx + 78, wwy + 48); ctx.lineTo(wwx - 2, wwy + 48);
  ctx.closePath(); ctx.fillStyle = p.mountain + '60'; ctx.fill();
  // Snow caps
  px(ctx, wwx + 13, wwy + 18, 6, 3, p.snow);
  px(ctx, wwx + 47, wwy + 14, 6, 3, p.snow);
  // Trees
  for (const [tx, th] of [[wwx + 4, 24], [wwx + 14, 18], [wwx + 24, 22], [wwx + 36, 16], [wwx + 46, 20], [wwx + 56, 24], [wwx + 66, 15]]) {
    // Trunk
    px(ctx, tx + 3, wwy + 48 - 6, 3, 6, '#3d2210');
    // Pine layers (3 triangles)
    for (let layer = 0; layer < 3; layer++) {
      const lh = th * 0.35;
      const lw = 8 + layer * 2;
      const ly2 = wwy + 48 - 6 - th + layer * (th * 0.3);
      ctx.beginPath();
      ctx.moveTo(tx + 4.5, ly2); ctx.lineTo(tx + 4.5 + lw / 2, ly2 + lh); ctx.lineTo(tx + 4.5 - lw / 2, ly2 + lh);
      ctx.closePath(); ctx.fillStyle = p.trees; ctx.fill();
    }
  }
  // Moon
  circle(ctx, wwx + 68, wwy + 8, 5, '#f0e8d0');
  // Stars
  for (const [sx, sy] of [[wwx + 10, wwy + 6], [wwx + 30, wwy + 10], [wwx + 50, wwy + 4], [wwx + 42, wwy + 12]]) {
    circle(ctx, sx, sy, 1, '#ffffff40');
  }
  // Frame
  ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 3;
  ctx.strokeRect(wwx, wwy, 78, 52);
  // Cross dividers
  px(ctx, wwx + 38, wwy + 2, 2, 48, p.wallBorder);
  px(ctx, wwx + 2, wwy + 24, 74, 2, p.wallBorder);

  // Stone fireplace
  const fxx = W - 100, fxy = 210;
  roundRect(ctx, fxx, fxy, 80, 65, [6, 6, 0, 0], p.stone);
  px(ctx, fxx, fxy, 80, 1, '#ffffff08');
  // Mantel
  roundRect(ctx, fxx - 6, fxy - 6, 92, 8, 2, p.deskBorder);
  px(ctx, fxx - 4, fxy - 6, 88, 1, '#ffffff08');
  // Fire opening
  roundRect(ctx, fxx + 16, fxy + 20, 48, 45, [24, 24, 0, 0], '#0a0400');
  ctx.font = '20px serif';
  ctx.fillText('🔥', fxx + 28, fxy + 56);
  // Stones around opening
  for (let i = 0; i < 4; i++) {
    roundRect(ctx, fxx + 10 + i * 16, fxy + 6, 14, 10, 2, p.stone + 'cc');
  }

  // Animal pelt (lounge)
  roundRect(ctx, W - 160, 320, 100, 50, 24, p.chair + '80');
  ctx.strokeStyle = p.deskBorder + '40'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(W - 160, 320, 100, 50, 24); ctx.stroke();

  // Mounted antlers
  px(ctx, 440, 40, 6, 6, p.deskBorder);
  // Simplified antler shape
  ctx.strokeStyle = '#8b7355'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(430, 46); ctx.lineTo(440, 30); ctx.lineTo(450, 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(460, 46); ctx.lineTo(450, 30); ctx.lineTo(440, 20); ctx.stroke();

  // Lanterns
  for (const [lx, ly] of [[W - 50, 210], [W - 50, 470]]) {
    px(ctx, lx + 5, ly, 2, 8, '#666');
    roundRect(ctx, lx, ly + 8, 14, 20, 4, p.accent + '20');
    ctx.strokeStyle = p.deskBorder; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(lx, ly + 8, 14, 20, 4); ctx.stroke();
    circle(ctx, lx + 7, ly + 16, 3, p.accent + '50');
  }

  // Big plant
  const plx = 30, ply = 570;
  circle(ctx, plx, ply - 6, 7, '#166534');
  circle(ctx, plx - 5, ply - 4, 5, '#15803d');
  circle(ctx, plx + 5, ply - 4, 5, '#22c55e');
  roundRect(ctx, plx - 5, ply + 2, 12, 10, [0, 0, 2, 2], '#78350f');

  // Ambient occlusion
  ambientOcclusion(ctx, 188, '#0d0f08');
  floorGradient(ctx, 192, '#0d0f08');

  // Dust motes (warm golden)
  dustMotes(ctx, 10, 185, 8, '#f59e0b06');

  // Snow on window sill
  const wwx2 = W - 250;
  roundRect(ctx, wwx2 - 6, wwy + 50, 88, 4, 2, '#ffffff18');
  roundRect(ctx, wwx2 - 3, wwy + 49, 30, 3, 2, '#ffffff10');
  roundRect(ctx, wwx2 + 50, wwy + 48, 25, 4, 2, '#ffffff0c');

  // Chimney smoke above fireplace
  circle(ctx, W - 64, 202, 6, '#ffffff04');
  circle(ctx, W - 58, 196, 5, '#ffffff03');
  circle(ctx, W - 62, 190, 4, '#ffffff02');

  // Owl silhouette on wall
  const owx = 500, owy = 50;
  circle(ctx, owx, owy, 6, '#ffffff08'); // head
  roundRect(ctx, owx - 5, owy + 5, 10, 12, [0, 0, 3, 3], '#ffffff06'); // body
  // Eyes
  circle(ctx, owx - 2, owy - 1, 1.5, '#f59e0b15');
  circle(ctx, owx + 2, owy - 1, 1.5, '#f59e0b15');

  // Braided rug detail (pattern on existing pelt)
  for (let i = 0; i < 6; i++) {
    px(ctx, W - 155 + i * 16, 328, 12, 1, p.deskBorder + '15');
    px(ctx, W - 148 + i * 16, 340, 12, 1, p.deskBorder + '12');
  }

  // Fireplace light cone
  lightCone(ctx, W - 60, 275, 80, p.fire);

  // Wall texture dithering
  dither(ctx, 0, 0, W, 186, '#ffffff02', 0.02);
  // Snow outside window (8 dots behind glass at varied sizes)
  for (let s = 0; s < 8; s++) {
    const sx = wwx2 + 5 + ((s * 17) % 70);
    const sy = wwy + 5 + ((s * 11) % 35);
    circle(ctx, sx, sy, 0.8 + (s % 3) * 0.4, '#ffffff15');
  }

  // ─── Rocking chair ───
  const rcx = 200, rcy = 380;
  roundRect(ctx, rcx, rcy, 30, 20, 3, p.desk);
  px(ctx, rcx, rcy, 30, 1, '#ffffff06');
  // Back rest
  roundRect(ctx, rcx + 2, rcy - 24, 26, 24, [4, 4, 0, 0], p.desk);
  // Back slats
  for (let sl = 0; sl < 4; sl++) {
    px(ctx, rcx + 6 + sl * 6, rcy - 20, 2, 18, p.deskBorder + '40');
  }
  // Rockers
  ctx.strokeStyle = p.deskBorder; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(rcx - 4, rcy + 22);
  ctx.quadraticCurveTo(rcx + 15, rcy + 18, rcx + 34, rcy + 22);
  ctx.stroke();
  // Cushion
  roundRect(ctx, rcx + 4, rcy + 2, 22, 10, 3, '#8b4513' + '50');

  // ─── Woodpile next to fireplace ───
  for (let wl = 0; wl < 4; wl++) {
    for (let ws = 0; ws < 3 - (wl % 2); ws++) {
      const wlx = fxx - 30 + ws * 12 + (wl % 2) * 6;
      const wly = fxy + 50 - wl * 8;
      roundRect(ctx, wlx, wly, 10, 6, 2, '#5d4037' + (70 + wl * 10).toString(16));
      // Log rings
      circle(ctx, wlx + 5, wly + 3, 2, '#4a3728' + '40');
      circle(ctx, wlx + 5, wly + 3, 1, '#3d2c1a' + '30');
    }
  }

  // ─── Fishing rod leaning on wall ───
  line(ctx, 90, 200, 90, 30, p.deskBorder + '30', 1.5);
  // Reel
  circle(ctx, 90, 180, 3, '#6b728030');
  // Line
  line(ctx, 90, 30, 95, 20, '#ffffff08', 0.5);
  // Hook
  ctx.strokeStyle = '#6b728020'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.arc(95, 22, 3, 0, Math.PI); ctx.stroke();

  // ─── Hot cocoa mug on mantel ───
  roundRect(ctx, fxx + 60, fxy - 12, 8, 8, [2, 2, 0, 0], '#8b4513');
  circle(ctx, fxx + 64, fxy - 14, 3, '#ffffff04'); // steam
  circle(ctx, fxx + 66, fxy - 17, 2, '#ffffff03');
}

// ─── Draw Environment: OFFICE ─────────────────────────────────────────────────

function drawOffice(ctx) {
  const p = PALETTES.office;

  // Floor — carpet-like texture with dithered grid
  px(ctx, 0, 0, W, H, p.floor);
  for (let x = 10; x < W; x += 16) {
    px(ctx, x, 192, 1, H - 192, p.accent + '03');
  }
  for (let y = 192; y < H; y += 16) {
    px(ctx, 10, y, W - 10, 1, p.accent + '03');
  }
  // Carpet texture (subtle dithering)
  dither(ctx, 10, 194, W - 10, H - 194, p.accent + '04', 0.015);
  // Floor panel borders
  for (let y = 194; y < H; y += 100) {
    px(ctx, 10, y, W - 10, 1, p.wallBorder + '08');
  }
  for (let x = 10; x < W; x += 100) {
    px(ctx, x, 194, 1, H - 194, p.wallBorder + '08');
  }

  // Top wall — drywall panels with molding
  px(ctx, 0, 0, W, 190, p.wall);
  // Crown molding
  px(ctx, 0, 0, W, 3, p.wallBorder + '60');
  px(ctx, 0, 2, W, 1, '#ffffff06');
  px(ctx, 0, 3, W, 2, p.wallBorder + '30');
  // Wall panel seams
  for (let col = 0; col < 5; col++) {
    const sx = 10 + col * 180;
    px(ctx, sx, 6, 1, 178, p.wallBorder + '10');
    // Subtle panel highlight/shadow
    px(ctx, sx + 1, 6, 176, 1, '#ffffff04');
    px(ctx, sx + 1, 183, 176, 1, '#00000008');
  }
  // Baseboard
  px(ctx, 0, 184, W, 3, p.wallBorder + '50');
  px(ctx, 0, 184, W, 1, '#ffffff06');
  px(ctx, 0, 187, W, 3, p.wallBorder + '80');
  // Wall texture dither
  dither(ctx, 0, 6, W, 178, '#ffffff03', 0.01);

  // Left wall with baseboard
  px(ctx, 0, 0, 10, H, p.wall);
  px(ctx, 8, 0, 2, H, p.wallBorder);
  px(ctx, 0, 0, 10, 3, p.wallBorder + '60');
  // Left wall baseboard
  px(ctx, 0, 184, 10, 6, p.wallBorder + '80');

  // Ambient occlusion at wall-floor junction
  ambientOcclusion(ctx, 190, '#000000');
  floorGradient(ctx, 192, '#000000');

  // Ceiling lights — 3 recessed panels with glow cones
  for (const lx of [160, 460, 760]) {
    // Light panel
    roundRect(ctx, lx - 20, 8, 40, 10, 2, '#ffffff10');
    px(ctx, lx - 18, 9, 36, 1, '#ffffff18');
    px(ctx, lx - 16, 12, 32, 4, '#ffffff08');
    // Glow cone onto wall
    lightCone(ctx, lx, 18, 60, p.accent);
    // Light reflection on floor
    roundRect(ctx, lx - 30, 220, 60, 20, 10, p.accent + '04');
  }

  // Window — large multi-pane (100×60)
  const wx = W - 280, wy = 18;
  // Shadow behind window
  roundRect(ctx, wx + 4, wy + 4, 104, 64, 2, '#00000030');
  // Window sill
  roundRect(ctx, wx - 4, wy + 60, 112, 6, 2, p.wallBorder + '80');
  px(ctx, wx - 2, wy + 60, 108, 1, '#ffffff08');
  // Window content
  px(ctx, wx + 2, wy + 2, 100, 56, p.sky);
  // Sky gradient (darker at top)
  px(ctx, wx + 2, wy + 2, 100, 20, '#060d18');
  // Moon crescent
  circle(ctx, wx + 84, wy + 12, 6, '#e8e0c0');
  circle(ctx, wx + 82, wy + 10, 5, p.sky);
  // Stars
  for (const [sx, sy, sr] of [[wx + 12, wy + 8, 1.5], [wx + 30, wy + 14, 1], [wx + 50, wy + 6, 1.2], [wx + 68, wy + 10, 0.8], [wx + 42, wy + 20, 0.8]]) {
    circle(ctx, sx, sy, sr, '#ffffff40');
  }
  // City skyline (8 buildings)
  const blds = [
    [wx + 4, 10, 16], [wx + 16, 8, 22], [wx + 26, 14, 30], [wx + 42, 10, 18],
    [wx + 54, 8, 26], [wx + 64, 12, 14], [wx + 78, 8, 20], [wx + 88, 10, 32],
  ];
  for (const [bx, bw, bh] of blds) {
    px(ctx, bx, wy + 58 - bh, bw, bh, p.city);
    // Rooftop detail
    px(ctx, bx, wy + 58 - bh, bw, 1, '#ffffff08');
    // Window lights (2-3 per building)
    for (let row = 0; row < Math.floor(bh / 7); row++) {
      const litColor = (bx + row) % 3 === 0 ? '#f59e0b30' : p.accent + '25';
      px(ctx, bx + 2, wy + 58 - bh + 4 + row * 7, 2, 2, litColor);
      if (bw > 10) px(ctx, bx + bw - 4, wy + 58 - bh + 6 + row * 7, 2, 2, litColor);
    }
  }
  // Antenna on tallest building
  px(ctx, wx + 92, wy + 22, 2, 6, '#ffffff15');
  circle(ctx, wx + 93, wy + 21, 2, '#ef444430');
  // AC unit on rooftop
  roundRect(ctx, wx + 30, wy + 26, 8, 4, 1, '#ffffff10');
  // Frame
  ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 2.5;
  ctx.strokeRect(wx, wy, 104, 62);
  // Cross dividers
  px(ctx, wx + 51, wy + 2, 2, 56, p.wallBorder);
  px(ctx, wx + 2, wy + 30, 100, 2, p.wallBorder);
  // Curtain panels
  px(ctx, wx - 6, wy, 6, 62, p.wallBorder + '20');
  px(ctx, wx + 104, wy, 6, 62, p.wallBorder + '20');
  px(ctx, wx - 6, wy, 6, 1, '#ffffff06');
  px(ctx, wx + 104, wy, 6, 1, '#ffffff06');

  // Whiteboard on wall
  const wbx = 100, wby = 30;
  roundRect(ctx, wbx, wby, 100, 60, 2, '#e5e7eb');
  px(ctx, wbx, wby, 100, 1, '#ffffff20');
  ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2;
  ctx.strokeRect(wbx, wby, 100, 60);
  // Marker scribbles
  line(ctx, wbx + 10, wby + 14, wbx + 60, wby + 14, '#3b82f620', 2);
  line(ctx, wbx + 10, wby + 24, wbx + 50, wby + 24, '#ef444420', 2);
  line(ctx, wbx + 10, wby + 34, wbx + 70, wby + 34, '#22c55e18', 2);
  line(ctx, wbx + 10, wby + 44, wbx + 40, wby + 44, '#8b5cf618', 2);
  // Eraser tray
  roundRect(ctx, wbx + 10, wby + 58, 80, 5, 2, '#9ca3af40');
  // Eraser + markers
  roundRect(ctx, wbx + 14, wby + 55, 14, 5, 1, '#6b7280');
  roundRect(ctx, wbx + 34, wby + 56, 3, 10, 1, '#3b82f6');
  roundRect(ctx, wbx + 40, wby + 56, 3, 10, 1, '#ef4444');
  roundRect(ctx, wbx + 46, wby + 56, 3, 10, 1, '#22c55e');

  // Poster/Art frames on wall
  // Frame 1 — abstract
  const f1x = 260, f1y = 28;
  roundRect(ctx, f1x, f1y, 40, 50, 1, '#2a1f14');
  ctx.strokeStyle = '#3d2b1a'; ctx.lineWidth = 2;
  ctx.strokeRect(f1x, f1y, 40, 50);
  px(ctx, f1x + 4, f1y + 4, 32, 42, '#0a0a14');
  roundRect(ctx, f1x + 8, f1y + 10, 12, 18, 2, p.accent + '40');
  roundRect(ctx, f1x + 22, f1y + 20, 10, 22, 2, '#f59e0b30');
  circle(ctx, f1x + 16, f1y + 36, 5, '#ef444420');
  // Frame 2 — landscape
  const f2x = 370, f2y = 34;
  roundRect(ctx, f2x, f2y, 50, 36, 1, '#2a1f14');
  ctx.strokeStyle = '#3d2b1a'; ctx.lineWidth = 2;
  ctx.strokeRect(f2x, f2y, 50, 36);
  px(ctx, f2x + 4, f2y + 4, 42, 28, '#0a1828');
  // Mini landscape
  roundRect(ctx, f2x + 4, f2y + 22, 42, 10, 0, '#1a2a15');
  circle(ctx, f2x + 36, f2y + 10, 4, '#e8e0c0');

  // Wall clock (drawn, not emoji)
  const clx = W - 140, cly = 40;
  circle(ctx, clx, cly, 14, '#f5f0e0');
  strokeCircle(ctx, clx, cly, 14, p.wallBorder, 2);
  // Hour marks
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI * 2) / 12;
    const mx = clx + Math.cos(a) * 11;
    const my = cly + Math.sin(a) * 11;
    circle(ctx, mx, my, 1, '#333');
  }
  // Hands
  line(ctx, clx, cly, clx, cly - 8, '#1a1a1a', 1.5);
  line(ctx, clx, cly, clx + 6, cly + 2, '#1a1a1a', 1);
  circle(ctx, clx, cly, 1.5, '#333');

  // ─── HORIZONTAL SERVER INFRASTRUCTURE — spans bottom of office floor ───
  const sry = 610; // top of server rack strip
  const srh = 62;  // rack height
  const srLeft = 14, srRight = W - 14;
  const srW = srRight - srLeft;

  // Raised floor platform under the rack
  roundRect(ctx, srLeft - 4, sry - 6, srW + 8, 4, 2, '#1e1e2e');
  px(ctx, srLeft - 4, sry - 6, srW + 8, 1, '#ffffff06');
  // Platform shadow on floor
  roundRect(ctx, srLeft - 2, sry - 2, srW + 4, 2, 0, '#00000015');

  // Main rack chassis — dark metal housing
  roundRect(ctx, srLeft, sry, srW, srh, 3, '#12121e');
  px(ctx, srLeft, sry, srW, 2, '#ffffff08'); // top highlight
  px(ctx, srLeft, sry + srh - 2, srW, 2, '#000000'); // bottom edge
  ctx.strokeStyle = '#2a2a3d'; ctx.lineWidth = 1.5;
  ctx.strokeRect(srLeft, sry, srW, srh);

  // ─── Section 1: UPS / Power Supply (far left) ───
  const ups_x = srLeft + 4;
  roundRect(ctx, ups_x, sry + 4, 56, srh - 8, 2, '#1a1a28');
  px(ctx, ups_x, sry + 4, 56, 1, '#ffffff05');
  ctx.strokeStyle = '#2d2d40'; ctx.lineWidth = 1;
  ctx.strokeRect(ups_x, sry + 4, 56, srh - 8);
  // UPS label
  px(ctx, ups_x + 4, sry + 8, 20, 3, '#ffffff0a');
  // Battery level bars (4 green segments)
  for (let b = 0; b < 4; b++) {
    px(ctx, ups_x + 4 + b * 8, sry + 16, 6, 10, '#22c55e' + (b < 3 ? '60' : '30'));
    px(ctx, ups_x + 4 + b * 8, sry + 16, 6, 1, '#22c55e20');
  }
  // Power readout display
  roundRect(ctx, ups_x + 38, sry + 10, 14, 18, 1, '#0a0a12');
  px(ctx, ups_x + 40, sry + 13, 10, 2, '#22c55e40'); // voltage line
  px(ctx, ups_x + 40, sry + 17, 6, 2, '#22c55e30'); // wattage
  px(ctx, ups_x + 40, sry + 21, 8, 2, '#f59e0b25'); // load %
  // Power LED
  circle(ctx, ups_x + 48, sry + 8, 2, '#22c55e');
  circle(ctx, ups_x + 48, sry + 8, 4, '#22c55e15');
  // Outlet sockets along bottom
  for (let o = 0; o < 6; o++) {
    roundRect(ctx, ups_x + 4 + o * 8, sry + 32, 6, 8, 1, '#0a0a12');
    // Socket pins
    px(ctx, ups_x + 6 + o * 8, sry + 34, 1, 2, '#ffffff08');
    px(ctx, ups_x + 8 + o * 8, sry + 34, 1, 2, '#ffffff08');
    // Plugged-in indicator (some occupied)
    if (o < 4) circle(ctx, ups_x + 7 + o * 8, sry + 42, 1, '#22c55e30');
  }
  // Section divider
  px(ctx, ups_x + 58, sry + 6, 2, srh - 12, '#2a2a3d');

  // ─── Section 2: Network Switch / Patch Panel ───
  const net_x = srLeft + 66;
  roundRect(ctx, net_x, sry + 4, 120, srh - 8, 2, '#15152a');
  px(ctx, net_x, sry + 4, 120, 1, '#ffffff05');
  ctx.strokeStyle = '#2d2d40'; ctx.lineWidth = 1;
  ctx.strokeRect(net_x, sry + 4, 120, srh - 8);
  // Top row: 24-port patch panel
  for (let port = 0; port < 24; port++) {
    const px2 = net_x + 4 + port * 4.8;
    // RJ45 port
    roundRect(ctx, px2, sry + 8, 3.5, 4, 0.5, '#0a0a14');
    // Link LED — varied states
    const linkColor = port < 16 ? '#22c55e50' : port < 20 ? '#f59e0b40' : '#ef444430';
    circle(ctx, px2 + 1.75, sry + 14, 1, linkColor);
  }
  // Label strip between rows
  px(ctx, net_x + 4, sry + 16, 112, 2, '#ffffff06');
  // Bottom row: managed switch with activity LEDs
  for (let port = 0; port < 24; port++) {
    const px2 = net_x + 4 + port * 4.8;
    roundRect(ctx, px2, sry + 22, 3.5, 4, 0.5, '#0a0a14');
    // Activity LED (blinking pattern)
    const actColor = port % 5 === 0 ? '#22c55e60' : port % 5 === 1 ? p.accent + '50' : port % 5 === 2 ? '#22c55e40' : port % 3 === 0 ? '#f59e0b35' : '#22c55e25';
    circle(ctx, px2 + 1.75, sry + 28, 1, actColor);
  }
  // Uplink ports (2 SFP+ slots on right)
  for (let u = 0; u < 2; u++) {
    roundRect(ctx, net_x + 100 + u * 10, sry + 8, 8, 6, 1, '#0a0a14');
    px(ctx, net_x + 102 + u * 10, sry + 10, 4, 2, '#6366f150');
    circle(ctx, net_x + 104 + u * 10, sry + 16, 1.2, '#6366f160');
  }
  // Switch management display
  roundRect(ctx, net_x + 4, sry + 34, 36, 16, 1, '#0a0a12');
  // Network throughput graph (mini sparkline)
  for (let g = 0; g < 14; g++) {
    const barH = 2 + Math.abs(Math.sin(g * 0.7)) * 8;
    px(ctx, net_x + 6 + g * 2.4, sry + 48 - barH, 1.5, barH, p.accent + '35');
  }
  // Bandwidth text
  px(ctx, net_x + 8, sry + 36, 18, 2, '#22c55e25');
  px(ctx, net_x + 8, sry + 40, 12, 2, '#ffffff0a');
  // Switch status LEDs
  circle(ctx, net_x + 108, sry + 38, 2, '#22c55e');
  circle(ctx, net_x + 108, sry + 38, 4, '#22c55e12');
  circle(ctx, net_x + 114, sry + 38, 2, '#f59e0b80');
  circle(ctx, net_x + 114, sry + 38, 4, '#f59e0b10');
  // Cable bundle coming out bottom
  for (let c = 0; c < 8; c++) {
    px(ctx, net_x + 12 + c * 6, sry + 52, 2, 10, ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1'][c] + '18');
  }
  // Section divider
  px(ctx, net_x + 122, sry + 6, 2, srh - 12, '#2a2a3d');

  // ─── Section 3: Server Units (4 blade servers) ───
  const srv_x = srLeft + 192;
  for (let s = 0; s < 4; s++) {
    const sx = srv_x + s * 100;
    roundRect(ctx, sx, sry + 4, 94, srh - 8, 2, '#111120');
    px(ctx, sx, sry + 4, 94, 1, '#ffffff05');
    ctx.strokeStyle = '#2d2d40'; ctx.lineWidth = 1;
    ctx.strokeRect(sx, sry + 4, 94, srh - 8);

    // Server face plate
    roundRect(ctx, sx + 4, sry + 8, 86, 22, 1, '#0e0e1a');
    // Drive bay indicators (8 drives per server)
    for (let d = 0; d < 8; d++) {
      roundRect(ctx, sx + 6 + d * 10, sry + 10, 8, 8, 0.5, '#0a0a14');
      // Drive activity LED
      const driveColor = d < 6 ? '#22c55e35' : d === 6 ? '#f59e0b30' : '#ef444425';
      circle(ctx, sx + 10 + d * 10, sry + 20, 1, driveColor);
      // Drive label
      px(ctx, sx + 7 + d * 10, sry + 12, 5, 1, '#ffffff06');
    }

    // CPU/RAM status bar
    roundRect(ctx, sx + 4, sry + 32, 40, 6, 1, '#0a0a12');
    // CPU usage bar (varying per server)
    const cpuPct = [0.72, 0.45, 0.88, 0.31][s];
    roundRect(ctx, sx + 5, sry + 33, 38 * cpuPct, 4, 1, cpuPct > 0.8 ? '#ef444450' : cpuPct > 0.6 ? '#f59e0b40' : '#22c55e40');

    // RAM status bar
    roundRect(ctx, sx + 48, sry + 32, 40, 6, 1, '#0a0a12');
    const ramPct = [0.61, 0.82, 0.54, 0.73][s];
    roundRect(ctx, sx + 49, sry + 33, 38 * ramPct, 4, 1, ramPct > 0.8 ? '#ef444450' : ramPct > 0.6 ? '#f59e0b40' : '#22c55e40');

    // Labels for CPU / RAM
    px(ctx, sx + 6, sry + 30, 8, 2, '#ffffff08');   // "CPU"
    px(ctx, sx + 50, sry + 30, 8, 2, '#ffffff08');   // "RAM"

    // Status LEDs (power, fault, network)
    circle(ctx, sx + 8, sry + 46, 2.2, '#22c55e');
    circle(ctx, sx + 8, sry + 46, 4, '#22c55e12');
    circle(ctx, sx + 16, sry + 46, 2, s === 2 ? '#f59e0b80' : '#22c55e60');
    circle(ctx, sx + 24, sry + 46, 2, p.accent + '50');

    // Temperature readout
    roundRect(ctx, sx + 32, sry + 42, 20, 10, 1, '#0a0a12');
    const temps = ['34', '41', '52', '28'];
    px(ctx, sx + 35, sry + 45, 14, 2, s === 2 ? '#ef444430' : '#22c55e30');
    px(ctx, sx + 35, sry + 48, 10, 2, '#ffffff08');

    // Fan exhaust vents (right side)
    for (let f = 0; f < 3; f++) {
      roundRect(ctx, sx + 78, sry + 8 + f * 8, 10, 6, 1, '#0a0a14');
      // Fan blade hint (X pattern)
      line(ctx, sx + 80, sry + 9 + f * 8, sx + 86, sry + 13 + f * 8, '#ffffff06', 0.5);
      line(ctx, sx + 86, sry + 9 + f * 8, sx + 80, sry + 13 + f * 8, '#ffffff06', 0.5);
    }

    // iDRAC / BMC management port
    roundRect(ctx, sx + 56, sry + 42, 12, 10, 1, '#0a0a14');
    circle(ctx, sx + 62, sry + 47, 1.5, '#6366f150');

    // Server number label
    roundRect(ctx, sx + 72, sry + 44, 16, 8, 1, '#ffffff08');
    px(ctx, sx + 74, sry + 46, 12, 2, '#ffffff0c');
  }

  // ─── Section 4: Storage Array (right of servers) ───
  const sto_x = srLeft + 596;
  roundRect(ctx, sto_x, sry + 4, 80, srh - 8, 2, '#14142a');
  px(ctx, sto_x, sry + 4, 80, 1, '#ffffff05');
  ctx.strokeStyle = '#2d2d40'; ctx.lineWidth = 1;
  ctx.strokeRect(sto_x, sry + 4, 80, srh - 8);
  // NAS / SAN label area
  px(ctx, sto_x + 4, sry + 8, 24, 3, '#ffffff0c');
  // Drive slots (12 drives, 2 rows of 6)
  for (let row = 0; row < 2; row++) {
    for (let d = 0; d < 6; d++) {
      const dx = sto_x + 4 + d * 12, dy = sry + 14 + row * 16;
      roundRect(ctx, dx, dy, 10, 12, 1, '#0a0a14');
      // Drive face detail
      px(ctx, dx + 2, dy + 2, 6, 1, '#ffffff06');
      px(ctx, dx + 2, dy + 5, 6, 4, '#111118');
      // Activity LED
      const sColor = (row * 6 + d) < 10 ? '#22c55e35' : '#f59e0b25';
      circle(ctx, dx + 5, dy + 11, 1, sColor);
    }
  }
  // RAID status display
  roundRect(ctx, sto_x + 4, sry + 48, 36, 10, 1, '#0a0a12');
  px(ctx, sto_x + 6, sry + 50, 16, 2, '#22c55e30'); // "RAID 6"
  px(ctx, sto_x + 6, sry + 54, 24, 2, '#ffffff08');  // capacity
  // Storage status LEDs
  circle(ctx, sto_x + 46, sry + 50, 2, '#22c55e');
  circle(ctx, sto_x + 46, sry + 50, 4, '#22c55e12');
  circle(ctx, sto_x + 54, sry + 50, 2, p.accent + '50');
  // Capacity bar
  roundRect(ctx, sto_x + 44, sry + 56, 32, 4, 1, '#0a0a12');
  roundRect(ctx, sto_x + 45, sry + 57, 32 * 0.67, 2, 1, '#f59e0b40');

  // ─── Section 5: Cooling / Environmental Monitor (far right) ───
  const cool_x = srLeft + 680;
  roundRect(ctx, cool_x, sry + 4, 86, srh - 8, 2, '#13132a');
  px(ctx, cool_x, sry + 4, 86, 1, '#ffffff05');
  ctx.strokeStyle = '#2d2d40'; ctx.lineWidth = 1;
  ctx.strokeRect(cool_x, sry + 4, 86, srh - 8);
  // Large fan units (2 intake fans)
  for (let f = 0; f < 2; f++) {
    const fx = cool_x + 6 + f * 38;
    strokeCircle(ctx, fx + 14, sry + 22, 12, '#2d2d40', 1.5);
    // Fan blades (4-spoke)
    for (let b = 0; b < 4; b++) {
      const angle = (b * Math.PI) / 2 + 0.3;
      line(ctx, fx + 14, sry + 22, fx + 14 + Math.cos(angle) * 9, sry + 22 + Math.sin(angle) * 9, '#ffffff08', 1.5);
    }
    // Hub
    circle(ctx, fx + 14, sry + 22, 3, '#1a1a2e');
    circle(ctx, fx + 14, sry + 22, 1.5, '#ffffff08');
    // Spin blur hint
    strokeCircle(ctx, fx + 14, sry + 22, 8, '#ffffff04', 0.5);
    // RPM label
    px(ctx, fx + 6, sry + 36, 16, 2, '#22c55e20');
  }
  // Temperature sensors display
  roundRect(ctx, cool_x + 4, sry + 42, 36, 14, 1, '#0a0a12');
  // Temp readings
  px(ctx, cool_x + 6, sry + 44, 14, 2, '#22c55e30'); // inlet temp
  px(ctx, cool_x + 6, sry + 48, 18, 2, '#f59e0b25'); // outlet temp
  px(ctx, cool_x + 6, sry + 52, 10, 2, '#ffffff08');  // humidity
  // Humidity sensor
  roundRect(ctx, cool_x + 44, sry + 42, 36, 14, 1, '#0a0a12');
  px(ctx, cool_x + 46, sry + 44, 20, 2, '#60a5fa25'); // humidity %
  px(ctx, cool_x + 46, sry + 48, 14, 2, '#ffffff08');  // airflow
  px(ctx, cool_x + 46, sry + 52, 24, 2, '#22c55e20');  // status OK
  // Cooling status LED
  circle(ctx, cool_x + 76, sry + 8, 2.5, '#22c55e');
  circle(ctx, cool_x + 76, sry + 8, 5, '#22c55e12');
  // Alert LED
  circle(ctx, cool_x + 76, sry + 16, 2, '#f59e0b60');

  // ─── Rack-wide details ───
  // Cable management tray running along the top of the rack
  px(ctx, srLeft + 2, sry - 3, srW - 4, 2, '#1e1e30');
  // Cable bundles (color-coded, running left to right)
  for (let cb = 0; cb < 12; cb++) {
    const cableColors = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];
    px(ctx, srLeft + 30 + cb * 70, sry - 2, 40, 1, cableColors[cb % 6] + '15');
  }
  // Rack mounting screws/bolts (along top and bottom edges)
  for (let screw = 0; screw < 20; screw++) {
    const screwX = srLeft + 20 + screw * 44;
    if (screwX < srRight - 10) {
      circle(ctx, screwX, sry + 2, 1.5, '#ffffff0c');
      circle(ctx, screwX, sry + srh - 2, 1.5, '#ffffff0c');
    }
  }
  // Under-rack airflow vents (raised floor)
  for (let v = 0; v < 30; v++) {
    const vx = srLeft + 10 + v * 29;
    if (vx < srRight - 10) {
      px(ctx, vx, sry + srh + 1, 20, 1, '#ffffff04');
      px(ctx, vx + 2, sry + srh + 3, 16, 1, '#ffffff03');
    }
  }
  // Rack glow — subtle ambient light from LEDs reflecting on floor below
  roundRect(ctx, srLeft + 40, sry + srh + 2, srW - 80, 6, 3, '#22c55e04');
  roundRect(ctx, srv_x + 200, sry + srh + 2, 80, 4, 2, '#ef444403'); // warm server glow

  // Plants (detailed — 3 plants with stems and leaves)
  for (const [plx, ply, sc] of [[W - 50, 390, 1], [24, 560, 1.2], [24, 400, 0.9]]) {
    // Pot with rim
    roundRect(ctx, plx - 6 * sc, ply + 2, 12 * sc, 10 * sc, [0, 0, 3, 3], '#78350f');
    roundRect(ctx, plx - 7 * sc, ply, 14 * sc, 4, 2, '#8b4513');
    // Stem
    px(ctx, plx - 1, ply - 10 * sc, 2, 12 * sc, '#166534');
    // Leaves (3-4 per plant)
    circle(ctx, plx, ply - 12 * sc, 6 * sc, '#166534');
    circle(ctx, plx - 5 * sc, ply - 8 * sc, 5 * sc, '#15803d');
    circle(ctx, plx + 5 * sc, ply - 8 * sc, 5 * sc, '#22c55e');
    circle(ctx, plx + 2 * sc, ply - 14 * sc, 4 * sc, '#22c55e80');
    // Leaf highlights
    circle(ctx, plx - 3 * sc, ply - 10 * sc, 2 * sc, '#22c55e40');
  }

  // Coffee station
  const csx = W - 50, csy = 490;
  // Machine
  roundRect(ctx, csx, csy, 24, 30, 2, p.coffee);
  roundRect(ctx, csx - 2, csy - 4, 28, 6, 2, '#4b5563');
  px(ctx, csx, csy, 24, 1, '#ffffff08');
  // Drip tray
  roundRect(ctx, csx + 4, csy + 28, 16, 4, 1, '#374151');
  // Cup
  roundRect(ctx, csx + 6, csy + 18, 8, 10, [0, 0, 3, 3], '#f5f5f4');
  // Steam wisps
  circle(ctx, csx + 10, csy + 12, 3, '#ffffff06');
  circle(ctx, csx + 14, csy + 8, 2.5, '#ffffff04');
  // Second mug
  roundRect(ctx, csx + 20, csy + 22, 6, 8, [0, 0, 2, 2], '#e5e7eb');

  // Lounge area with rug pattern
  // Rug
  ctx.save(); ctx.globalAlpha = 0.4;
  roundRect(ctx, 220, 310, 170, 70, 4, p.rug);
  ctx.restore();
  // Rug border
  ctx.strokeStyle = p.wallBorder + '30'; ctx.lineWidth = 1;
  ctx.strokeRect(222, 312, 166, 66);
  // Rug pattern (inner border + diamond)
  ctx.strokeStyle = p.accent + '15'; ctx.lineWidth = 1;
  ctx.strokeRect(230, 318, 150, 54);
  // Diamond center
  ctx.save(); ctx.translate(305, 345); ctx.rotate(Math.PI / 4);
  roundRect(ctx, -10, -10, 20, 20, 2, p.accent + '08');
  ctx.restore();
  // Couch (left) with cushion detail
  roundRect(ctx, W - 148, 220, 55, 28, 5, p.chair);
  px(ctx, W - 148, 220, 55, 1, '#ffffff06');
  px(ctx, W - 120, 224, 1, 20, p.wallBorder + '15'); // cushion seam
  // Armrest
  roundRect(ctx, W - 150, 222, 5, 24, 2, p.wallBorder + '60');
  // Couch (right) with cushion detail
  roundRect(ctx, W - 68, 220, 55, 28, 5, p.chair);
  px(ctx, W - 68, 220, 55, 1, '#ffffff06');
  px(ctx, W - 40, 224, 1, 20, p.wallBorder + '15');
  roundRect(ctx, W - 15, 222, 5, 24, 2, p.wallBorder + '60');
  // Coffee table
  roundRect(ctx, W - 104, 228, 34, 18, 2, p.desk);
  px(ctx, W - 104, 228, 34, 1, '#ffffff06');
  // Magazine on table
  roundRect(ctx, W - 98, 232, 12, 8, 1, p.accent + '30');

  // ─── Workstation desk with monitor + keyboard + mouse ───
  const dkx = 440, dky = 400;
  // Desk shadow
  roundRect(ctx, dkx + 4, dky + 4, 120, 36, 3, '#00000018');
  // Desk surface
  roundRect(ctx, dkx, dky, 120, 36, 3, p.desk);
  px(ctx, dkx, dky, 120, 2, '#ffffff06');
  ctx.strokeStyle = p.deskBorder; ctx.lineWidth = 1;
  ctx.strokeRect(dkx, dky, 120, 36);
  // Desk legs
  px(ctx, dkx + 4, dky + 36, 4, 14, p.deskBorder);
  px(ctx, dkx + 112, dky + 36, 4, 14, p.deskBorder);
  // Monitor
  roundRect(ctx, dkx + 28, dky - 36, 64, 40, 3, '#111118');
  px(ctx, dkx + 28, dky - 36, 64, 2, '#ffffff08');
  ctx.strokeStyle = '#2d2d3d'; ctx.lineWidth = 1.5;
  ctx.strokeRect(dkx + 28, dky - 36, 64, 40);
  // Screen content — code lines
  px(ctx, dkx + 32, dky - 32, 56, 32, '#0a0a14');
  for (let cl = 0; cl < 7; cl++) {
    const clw = 16 + ((cl * 13) % 30);
    const clColor = cl % 3 === 0 ? p.accent + '30' : cl % 3 === 1 ? '#22c55e20' : '#f59e0b18';
    px(ctx, dkx + 36, dky - 28 + cl * 4, clw, 2, clColor);
  }
  // Screen glow
  circle(ctx, dkx + 60, dky - 16, 30, p.accent + '03');
  // Monitor stand
  px(ctx, dkx + 56, dky + 4, 8, 6, '#2d2d3d');
  roundRect(ctx, dkx + 50, dky + 8, 20, 3, 1, '#2d2d3d');
  // Keyboard
  roundRect(ctx, dkx + 36, dky + 14, 36, 10, 2, '#2d2d3d');
  // Key rows
  for (let kr = 0; kr < 3; kr++) {
    for (let kc = 0; kc < 8; kc++) {
      px(ctx, dkx + 38 + kc * 4, dky + 16 + kr * 3, 3, 2, '#3d3d4d');
    }
  }
  // Mouse
  roundRect(ctx, dkx + 80, dky + 16, 8, 12, 3, '#2d2d3d');
  px(ctx, dkx + 83, dky + 17, 2, 4, '#ffffff06'); // scroll wheel
  // Mouse pad
  roundRect(ctx, dkx + 76, dky + 12, 16, 20, 2, p.wallBorder + '20');

  // ─── Water cooler ───
  const wcx = 100, wcy = 420;
  roundRect(ctx, wcx, wcy, 16, 36, 2, '#e5e7eb');
  px(ctx, wcx, wcy, 16, 1, '#ffffff15');
  // Water jug
  roundRect(ctx, wcx + 2, wcy - 14, 12, 16, [6, 6, 0, 0], '#60a5fa20');
  // Water level
  roundRect(ctx, wcx + 3, wcy - 6, 10, 8, 0, '#60a5fa15');
  // Tap
  px(ctx, wcx + 6, wcy + 14, 4, 3, '#9ca3af');
  circle(ctx, wcx + 8, wcy + 18, 1.5, '#60a5fa20');
  // Cup holder
  roundRect(ctx, wcx + 12, wcy + 8, 6, 6, 1, '#f5f5f4');

  // ─── Fire extinguisher (on left wall) ───
  const fex = 14, fey = 480;
  roundRect(ctx, fex, fey, 10, 24, [3, 3, 1, 1], '#ef4444');
  px(ctx, fex, fey, 10, 2, '#ffffff10');
  // Handle
  roundRect(ctx, fex + 1, fey - 4, 8, 4, 2, '#1a1a1a');
  // Nozzle
  px(ctx, fex + 3, fey - 6, 4, 3, '#6b7280');
  // Label
  roundRect(ctx, fex + 2, fey + 8, 6, 8, 1, '#ffffff30');
  // Pressure gauge
  circle(ctx, fex + 5, fey + 6, 2, '#ffffff20');

  // ─── Coat rack ───
  const crx = 80, cry = 220;
  px(ctx, crx + 3, cry, 2, 80, '#4a3728');
  // Base
  roundRect(ctx, crx - 4, cry + 76, 14, 4, 2, '#4a3728');
  // Hooks
  px(ctx, crx - 2, cry + 8, 3, 2, '#6b7280');
  px(ctx, crx + 7, cry + 8, 3, 2, '#6b7280');
  px(ctx, crx, cry + 20, 3, 2, '#6b7280');
  // Jacket hanging
  roundRect(ctx, crx - 6, cry + 10, 8, 16, 2, '#374151');
  px(ctx, crx - 6, cry + 10, 8, 1, '#ffffff06');

  // ─── Bookshelf on right wall ───
  const bsx = W - 60, bsy = 320;
  roundRect(ctx, bsx, bsy, 48, 60, 2, '#2a1f14');
  px(ctx, bsx, bsy, 48, 1, '#ffffff06');
  ctx.strokeStyle = '#3d2b1a'; ctx.lineWidth = 1;
  ctx.strokeRect(bsx, bsy, 48, 60);
  // Shelves (3)
  for (let sh = 0; sh < 3; sh++) {
    const shy = bsy + 4 + sh * 18;
    px(ctx, bsx + 2, shy + 14, 44, 2, '#3d2b1a');
    // Books (varied colors + sizes)
    const bookColors = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1'];
    for (let b = 0; b < 6; b++) {
      const bw = 3 + (b % 3);
      const bh = 10 + (b % 2) * 3;
      roundRect(ctx, bsx + 4 + b * 7, shy + 14 - bh, bw, bh, [1, 1, 0, 0], bookColors[(sh * 6 + b) % bookColors.length] + '80');
      // Spine highlight
      px(ctx, bsx + 4 + b * 7, shy + 14 - bh, 1, bh, '#ffffff08');
    }
  }
  // Trophy on top shelf
  circle(ctx, bsx + 40, bsy + 2, 4, '#f59e0b30');
  px(ctx, bsx + 38, bsy + 4, 4, 6, '#f59e0b25');

  // ─── Motivational poster on wall ───
  const mpx = 520, mpy = 40;
  roundRect(ctx, mpx, mpy, 60, 40, 1, '#1a1a2e');
  ctx.strokeStyle = p.accent + '30'; ctx.lineWidth = 1;
  ctx.strokeRect(mpx, mpy, 60, 40);
  px(ctx, mpx + 4, mpy + 4, 52, 32, '#0a0a14');
  // Motivational text lines
  px(ctx, mpx + 10, mpy + 12, 40, 2, p.accent + '25');
  px(ctx, mpx + 14, mpy + 18, 32, 2, '#ffffff0a');
  px(ctx, mpx + 12, mpy + 24, 36, 2, '#ffffff08');
  // Star decoration
  circle(ctx, mpx + 30, mpy + 32, 3, p.accent + '15');

  // ─── Floor cable trays (running from wall down to server rack) ───
  // Left cable run
  px(ctx, 90, 192, 2, 420, p.wallBorder + '08');
  px(ctx, 92, 192, 1, 420, '#ffffff03');
  // Right cable run
  px(ctx, 560, 192, 2, 420, p.wallBorder + '06');
  px(ctx, 562, 192, 1, 420, '#ffffff02');
  // Horizontal cable tray connecting to rack
  px(ctx, 90, 604, 470, 2, p.wallBorder + '06');
  px(ctx, 90, 606, 470, 1, '#ffffff02');

  // Dust motes
  dustMotes(ctx, 10, 185, 12, '#ffffff08');

  // Wall texture dithering
  dither(ctx, 0, 0, W, 186, '#ffffff02', 0.02);
  // Desk lamp glow on floor
  lightCone(ctx, dkx + 60, dky - 20, 80, '#f59e0b');
  // Monitor glow reflection on desk
  roundRect(ctx, dkx + 30, dky + 2, 60, 8, 4, p.accent + '03');
}

// ─── Draw Environment: TEMPLE ────────────────────────────────────────────────

function drawTemple(ctx) {
  const p = PALETTES.temple;

  // Floor — large stone slabs
  px(ctx, 0, 0, W, H, p.floor);
  for (let row = 0; row < Math.ceil(H / 48); row++) {
    for (let col = 0; col < Math.ceil(W / 60); col++) {
      const ox = (row % 2) * 30;
      const x = col * 60 + ox, y = row * 48 + 190;
      if (y >= H) continue;
      px(ctx, x, y, 58, 46, p.stone + '08');
      px(ctx, x, y, 58, 1, p.stoneLight + '10');
      px(ctx, x, y, 1, 46, p.stoneLight + '10');
      // Crack
      if ((row + col) % 5 === 0) line(ctx, x + 10, y + 8, x + 40, y + 38, p.wallBorder + '15', 1);
    }
  }

  // Top wall — sandstone blocks
  px(ctx, 0, 0, W, 190, p.wall);
  for (let row = 0; row < 8; row++) {
    const bw = 80 + (row % 3) * 8;
    for (let col = 0; col < Math.ceil(W / bw) + 1; col++) {
      const ox = (row % 2) * (bw / 2);
      const x = col * bw + ox;
      px(ctx, x, row * 24, bw - 2, 22, p.wallDark);
      px(ctx, x + 2, row * 24 + 1, bw - 6, 1, p.stoneLight + '15');
      // Hieroglyphic rune marks
      if ((row + col) % 4 === 0 && row > 1 && row < 7) {
        px(ctx, x + bw / 2 - 4, row * 24 + 6, 8, 10, p.rune + '12');
        px(ctx, x + bw / 2 - 2, row * 24 + 8, 4, 6, p.rune + '20');
      }
    }
  }
  // Wall bottom border
  px(ctx, 0, 188, W, 2, p.wallBorder);

  // Left wall
  px(ctx, 0, 0, 8, H, p.wallDark);
  px(ctx, 7, 0, 1, H, p.wallBorder);

  // Torch sconces — 3 across wall
  [160, 460, 760].forEach(tx => {
    // Glow aura
    roundRect(ctx, tx - 16, 40, 32, 40, 8, p.torchGlow);
    roundRect(ctx, tx - 10, 46, 20, 28, 4, p.torchGlow);
    // Iron bracket
    px(ctx, tx - 2, 70, 4, 16, p.wallBorder);
    px(ctx, tx - 4, 68, 8, 4, p.wallBorder);
    // Fire
    circle(ctx, tx, 52, 8, p.torch);
    circle(ctx, tx, 48, 5, '#ffcc00');
    circle(ctx, tx, 45, 3, '#fff8dc');
  });

  // Stained glass window (arched)
  const wx = W - 180, wy = 15;
  roundRect(ctx, wx, wy, 56, 80, [25, 25, 2, 2], p.sky);
  // Divine light rays
  ctx.save(); ctx.globalAlpha = 0.15;
  for (let i = 0; i < 5; i++) {
    const rx = wx + 10 + i * 9;
    px(ctx, rx, wy + 10, 3, 60, p.accent);
  }
  ctx.restore();
  // Colored panes
  px(ctx, wx + 4, wy + 40, 24, 12, '#7c3aed15');
  px(ctx, wx + 28, wy + 40, 24, 12, '#d4a01715');
  px(ctx, wx + 4, wy + 55, 48, 10, '#ef444410');
  // Stars through glass
  circle(ctx, wx + 15, wy + 14, 1.5, '#ffffff60');
  circle(ctx, wx + 35, wy + 20, 1, '#ffffff40');
  circle(ctx, wx + 45, wy + 10, 1.5, '#ffffff50');
  // Mullion cross
  px(ctx, wx + 27, wy + 5, 2, 72, p.wallBorder);
  px(ctx, wx + 4, wy + 38, 48, 2, p.wallBorder);
  // Frame
  ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(wx, wy, 56, 80, [25, 25, 2, 2]); ctx.stroke();

  // Stone altar
  roundRect(ctx, W - 100, 300, 70, 35, 3, p.stone);
  roundRect(ctx, W - 105, 295, 80, 8, 3, p.stoneLight);
  // Glowing rune circle on altar
  strokeCircle(ctx, W - 65, 318, 10, p.accent + '60', 2);
  strokeCircle(ctx, W - 65, 318, 6, p.rune + '40', 1);
  circle(ctx, W - 65, 318, 3, p.accent + '40');

  // Ritual circle on floor
  strokeCircle(ctx, 350, 450, 50, p.accent + '25', 2);
  strokeCircle(ctx, 350, 450, 45, p.rune + '15', 1);
  strokeCircle(ctx, 350, 450, 35, p.accent + '10', 1);
  // Inner glow
  circle(ctx, 350, 450, 8, p.accent + '12');

  // Scroll stack
  roundRect(ctx, W - 50, 500, 30, 8, 3, p.scroll);
  roundRect(ctx, W - 48, 510, 26, 7, 3, p.scroll + 'cc');
  roundRect(ctx, W - 52, 520, 32, 7, 3, p.scroll);

  // Stone columns (left and right of floor area)
  [30, W - 50].forEach(cx => {
    roundRect(ctx, cx, 200, 20, 120, 3, p.column);
    roundRect(ctx, cx - 2, 195, 24, 8, 2, p.stoneLight);
    roundRect(ctx, cx - 2, 318, 24, 8, 2, p.stoneLight);
    // Column detail lines
    for (let i = 0; i < 5; i++) {
      px(ctx, cx + 3, 210 + i * 22, 1, 18, p.stoneLight + '15');
      px(ctx, cx + 16, 210 + i * 22, 1, 18, p.stoneLight + '15');
    }
  });

  // Floor label area glow
  roundRect(ctx, 200, 600, 200, 30, 4, p.divine);

  // Ambient occlusion
  ambientOcclusion(ctx, 188, '#120c08');
  floorGradient(ctx, 192, '#120c08');

  // Dust motes (golden)
  dustMotes(ctx, 10, 185, 10, '#d4a01708');

  // More hieroglyphic rune panels on wall
  for (const [rx, ry] of [[80, 50], [520, 90], [720, 40]]) {
    px(ctx, rx, ry, 12, 16, p.rune + '08');
    px(ctx, rx + 2, ry + 2, 8, 12, p.rune + '14');
    px(ctx, rx + 4, ry + 4, 4, 4, p.rune + '20');
  }

  // Scattered gem offerings on altar
  circle(ctx, W - 80, 310, 2.5, '#ef444440');
  circle(ctx, W - 72, 308, 2, '#22c55e40');
  circle(ctx, W - 60, 312, 2, '#3b82f640');
  // Gem glints
  circle(ctx, W - 81, 309, 1, '#ffffff20');

  // Brazier smoke from torches
  for (const tx of [160, 460, 760]) {
    circle(ctx, tx + 2, 38, 4, '#ffffff04');
    circle(ctx, tx - 1, 32, 3.5, '#ffffff03');
    circle(ctx, tx + 1, 26, 3, '#ffffff02');
    // Light cones from torches
    lightCone(ctx, tx, 70, 80, p.torch);
  }

  // Floor inscription near ritual circle
  ctx.fillStyle = p.accent + '08'; ctx.font = '5px monospace';
  ctx.fillText('☉ ☽ ✧ ⊕', 330, 510);

  // Column shadows on floor
  for (const cx of [30, W - 50]) {
    roundRect(ctx, cx + 10, 320, 30, 6, 2, '#00000008');
  }

  // Wall texture dithering
  dither(ctx, 0, 0, W, 186, '#d4a01703', 0.02);
}

// ─── Draw Environment: GARDEN ────────────────────────────────────────────────

function drawGarden(ctx) {
  const p = PALETTES.garden;

  // Floor — flagstone path with moss
  px(ctx, 0, 0, W, H, p.floor);
  for (let row = 0; row < Math.ceil((H - 190) / 36); row++) {
    for (let col = 0; col < Math.ceil(W / 44); col++) {
      const ox = (row % 2) * 22;
      const x = col * 44 + ox, y = row * 36 + 190;
      if (y >= H) continue;
      const size = 36 + ((row + col) % 3) * 4;
      roundRect(ctx, x + 2, y + 2, size, size - 6, 4, p.floorPath);
      // Moss in gaps
      if ((row + col) % 3 === 0) {
        roundRect(ctx, x, y + size - 4, size + 4, 4, 2, p.moss);
      }
    }
  }

  // Top wall — glass panels with iron frame
  px(ctx, 0, 0, W, 190, p.wall + '80');
  // Glass panel grid
  for (let col = 0; col < 7; col++) {
    const gx = col * 130;
    // Vertical frame bars
    px(ctx, gx, 0, 4, 190, p.wallBorder);
    // Horizontal bar
    px(ctx, gx, 95, 130, 3, p.wallBorder);
    // Glass tint
    px(ctx, gx + 4, 2, 124, 91, p.sky + '08');
    px(ctx, gx + 4, 98, 124, 90, p.sky + '05');
  }
  // Top frame
  px(ctx, 0, 0, W, 4, p.wallBorder);
  px(ctx, 0, 187, W, 3, p.wallBorder);

  // Left wall with vines
  px(ctx, 0, 0, 8, H, p.wallBorder + '60');
  for (let vy = 0; vy < H; vy += 40) {
    px(ctx, 2, vy, 3, 30, p.vine + '40');
    circle(ctx, 4, vy + 10, 4, p.leaf + '30');
    circle(ctx, 2, vy + 25, 3, p.leaf + '25');
  }

  // Hanging basket plants (from ceiling)
  [120, 350, 580, 780].forEach((hx, i) => {
    // String
    px(ctx, hx, 0, 1, 30 + i * 5, p.trellis);
    // Basket
    roundRect(ctx, hx - 12, 25 + i * 5, 24, 14, 3, p.trellis);
    // Plant foliage
    circle(ctx, hx, 20 + i * 5, 12, p.leaf + '80');
    circle(ctx, hx - 6, 18 + i * 5, 8, p.vine + '70');
    circle(ctx, hx + 6, 16 + i * 5, 9, p.accent + '50');
    // Flowers
    if (i % 2 === 0) circle(ctx, hx - 4, 14 + i * 5, 3, p.flower1);
    if (i % 2 === 1) circle(ctx, hx + 5, 12 + i * 5, 3, p.flower2);
  });

  // Trellis window with vines
  const wx = W - 170, wy = 20;
  // Frame
  for (let i = 0; i < 5; i++) {
    px(ctx, wx + i * 18, wy, 2, 60, p.trellis);
    px(ctx, wx, wy + i * 15, 72, 2, p.trellis);
  }
  // Vine leaves on trellis
  [wx + 8, wx + 26, wx + 44, wx + 62].forEach((lx, i) => {
    circle(ctx, lx, wy + 10 + (i % 2) * 20, 6, p.leaf + '60');
    circle(ctx, lx + 4, wy + 20 + (i % 2) * 15, 5, p.vine + '50');
  });
  // Sky behind
  px(ctx, wx + 2, wy + 2, 68, 56, p.sky + '15');
  // Sun
  circle(ctx, wx + 55, wy + 15, 8, p.sun + '30');
  // Clouds
  roundRect(ctx, wx + 10, wy + 8, 20, 8, 4, p.cloud);
  roundRect(ctx, wx + 35, wy + 30, 18, 7, 4, p.cloud);

  // Stone fountain
  roundRect(ctx, W - 90, 350, 50, 40, 6, p.wallBorder + '80');
  roundRect(ctx, W - 85, 345, 40, 8, 4, p.wallBorder);
  circle(ctx, W - 65, 365, 12, p.fountain + '40');
  circle(ctx, W - 65, 362, 5, p.fountain + '60');
  // Water splash
  circle(ctx, W - 68, 358, 2, '#ffffff30');
  circle(ctx, W - 62, 356, 2, '#ffffff20');

  // Flower beds along edges
  [[40, 560, 200], [600, 560, 160]].forEach(([fx, fy, fw]) => {
    roundRect(ctx, fx, fy, fw, 30, 4, p.floorPath);
    // Flowers
    for (let i = 0; i < fw / 16; i++) {
      const colors = [p.flower1, p.flower2, p.flower3];
      circle(ctx, fx + 8 + i * 16, fy + 8, 5, p.leaf + '70');
      circle(ctx, fx + 8 + i * 16, fy + 5, 3, colors[i % 3]);
    }
    // Leaves
    for (let i = 0; i < fw / 20; i++) {
      circle(ctx, fx + 14 + i * 20, fy + 18, 6, p.leaf + '40');
    }
  });

  // Butterfly
  ctx.font = '12px serif';
  ctx.fillText('🦋', 500, 320);

  // Watering can
  roundRect(ctx, 50, 510, 22, 16, 3, p.wallBorder);
  px(ctx, 48, 508, 8, 3, p.wallBorder);
  px(ctx, 70, 514, 8, 2, p.wallBorder);
  // Spout
  px(ctx, 72, 510, 10, 2, p.wallBorder + 'cc');

  // Ambient occlusion (green-tinted)
  ambientOcclusion(ctx, 188, '#0a1a08');
  floorGradient(ctx, 192, '#0d1a08');

  // Pollen particles (yellow)
  dustMotes(ctx, 10, 185, 15, '#f9a82510');

  // Dragonfly near fountain
  const dfx = W - 110, dfy = 340;
  px(ctx, dfx - 6, dfy, 12, 1, '#60a5fa20'); // wings
  px(ctx, dfx - 1, dfy - 3, 2, 6, '#0891b230'); // body
  circle(ctx, dfx, dfy - 4, 1.5, '#0891b240'); // head

  // Water ripple rings in fountain
  strokeCircle(ctx, W - 65, 365, 15, p.fountain + '15', 1);
  strokeCircle(ctx, W - 65, 365, 20, p.fountain + '08', 1);

  // Garden path stepping stones
  for (const [sx, sy] of [[300, 400], [340, 430], [380, 410]]) {
    roundRect(ctx, sx, sy, 24, 16, 8, p.floorPath + 'cc');
    px(ctx, sx + 2, sy + 1, 20, 1, '#ffffff06');
  }

  // Ladybug on leaf
  circle(ctx, 56, 555, 3, '#ef4444');
  circle(ctx, 56, 553, 2, '#1a1a1a');
  px(ctx, 55, 554, 1, 3, '#1a1a1a'); // line
  circle(ctx, 54, 556, 0.8, '#1a1a1a'); // spot
  circle(ctx, 58, 556, 0.8, '#1a1a1a'); // spot

  // Sunbeams through glass panels
  ctx.save(); ctx.globalAlpha = 0.03;
  for (let i = 0; i < 3; i++) {
    const bx = 100 + i * 260;
    ctx.beginPath();
    ctx.moveTo(bx, 0); ctx.lineTo(bx + 60, 190); ctx.lineTo(bx + 80, 190); ctx.lineTo(bx + 20, 0);
    ctx.closePath();
    ctx.fillStyle = '#ffd700'; ctx.fill();
  }
  ctx.restore();

  // Wall texture dithering (green)
  dither(ctx, 0, 0, W, 186, '#22c55e02', 0.02);
  // Butterfly near flowers
  const bfx = 180, bfy = 200;
  px(ctx, bfx - 3, bfy, 6, 1, '#e91e6320'); // wings horizontal
  px(ctx, bfx, bfy - 2, 1, 4, '#9c27b020'); // body
}

// ─── Draw Environment: CYBER ─────────────────────────────────────────────────

function drawCyber(ctx) {
  const p = PALETTES.cyber;

  // Floor — metal grating with RGB underglow
  px(ctx, 0, 0, W, H, p.floor);
  // Grating grid
  for (let row = 0; row < Math.ceil((H - 190) / 40); row++) {
    for (let col = 0; col < Math.ceil(W / 40); col++) {
      const x = col * 40, y = row * 40 + 190;
      if (y >= H) continue;
      px(ctx, x, y, 40, 1, p.accent + '08');
      px(ctx, x, y, 1, 40, p.accent + '08');
      // RGB underglow strips every 3rd panel
      if ((row + col) % 3 === 0) {
        const colors = [p.neon1 + '08', p.neon2 + '06', p.neon3 + '05'];
        roundRect(ctx, x + 4, y + 4, 32, 32, 2, colors[(row + col) % 3]);
      }
    }
  }
  // Panel borders
  for (let y = 190; y < H; y += 120) {
    px(ctx, 0, y, W, 2, p.wallBorder + '20');
  }
  for (let x = 0; x < W; x += 120) {
    px(ctx, x, 190, 2, H - 190, p.wallBorder + '20');
  }

  // Top wall — dark panels with neon strips
  px(ctx, 0, 0, W, 190, p.wall);
  // Panel divisions
  for (let col = 0; col < 6; col++) {
    const px2 = col * 150;
    px(ctx, px2, 0, 2, 190, p.wallBorder + '30');
    // Inner panel detail
    roundRect(ctx, px2 + 8, 8, 134, 88, 2, p.wallDark);
    roundRect(ctx, px2 + 8, 102, 134, 82, 2, p.wallDark);
  }
  // Neon accent strip at wall bottom
  px(ctx, 0, 184, W, 2, p.accent + '80');
  px(ctx, 0, 186, W, 4, p.glow);
  // Secondary cyan strip
  px(ctx, 0, 180, W, 1, p.cyan + '30');

  // Left wall with wiring
  px(ctx, 0, 0, 8, H, p.wallDark);
  px(ctx, 7, 0, 1, H, p.accent + '40');
  // Exposed wires
  [100, 280, 400, 550].forEach(wy => {
    px(ctx, 2, wy, 4, 60, p.wire);
    circle(ctx, 4, wy + 30, 2, p.accent + '30');
  });

  // Digital graffiti tags
  [{ x: 60, y: 30 }, { x: 400, y: 60 }, { x: 700, y: 20 }].forEach(pos => {
    roundRect(ctx, pos.x, pos.y, 60, 20, 2, p.glow);
    px(ctx, pos.x + 4, pos.y + 4, 52, 2, p.accent + '40');
    px(ctx, pos.x + 8, pos.y + 10, 40, 2, p.cyan + '30');
    px(ctx, pos.x + 12, pos.y + 14, 30, 2, p.yellow + '20');
  });

  // City skyline window with rain
  const wx = W - 190, wy = 12;
  roundRect(ctx, wx, wy, 130, 65, 3, p.sky);
  // Buildings
  const buildings = [
    { x: wx + 5, h: 45, w: 14 }, { x: wx + 22, h: 55, w: 12 },
    { x: wx + 38, h: 35, w: 16 }, { x: wx + 58, h: 50, w: 10 },
    { x: wx + 72, h: 40, w: 14 }, { x: wx + 90, h: 58, w: 12 },
    { x: wx + 106, h: 30, w: 16 },
  ];
  buildings.forEach(b => {
    px(ctx, b.x, wy + 65 - b.h, b.w, b.h, p.city);
    // Neon window lights
    for (let row = 0; row < Math.floor(b.h / 8); row++) {
      const color = [p.neon1, p.neon2, p.neon3][(b.x + row) % 3];
      if ((b.x + row) % 2 === 0) {
        px(ctx, b.x + 2, wy + 65 - b.h + 3 + row * 8, 3, 2, color + '60');
        px(ctx, b.x + b.w - 5, wy + 65 - b.h + 5 + row * 8, 3, 2, color + '40');
      }
    }
  });
  // Holographic ad
  roundRect(ctx, wx + 40, wy + 10, 20, 12, 1, p.accent + '30');
  px(ctx, wx + 43, wy + 13, 14, 2, p.cyan + '50');
  px(ctx, wx + 45, wy + 17, 10, 2, p.yellow + '40');
  // Rain streaks
  for (let i = 0; i < 12; i++) {
    const rx = wx + 5 + Math.random() * 120;
    const ry = wy + 2 + Math.random() * 55;
    px(ctx, rx, ry, 1, 4 + Math.random() * 6, p.rain);
  }
  // Frame
  ctx.strokeStyle = p.accent + '60'; ctx.lineWidth = 2;
  ctx.strokeRect(wx, wy, 130, 65);

  // Holographic display (floor decor)
  roundRect(ctx, W - 80, 260, 50, 60, 4, p.glow);
  px(ctx, W - 74, 268, 38, 2, p.cyan + '40');
  px(ctx, W - 70, 276, 30, 2, p.accent + '30');
  px(ctx, W - 74, 284, 38, 2, p.cyan + '20');
  px(ctx, W - 68, 292, 26, 2, p.yellow + '25');
  // Base
  roundRect(ctx, W - 70, 318, 30, 6, 2, p.deskBorder);

  // Server rack with LEDs
  roundRect(ctx, W - 60, 400, 40, 70, 3, p.wall);
  for (let i = 0; i < 6; i++) {
    px(ctx, W - 54, 408 + i * 10, 28, 7, p.wallDark);
    circle(ctx, W - 50, 412 + i * 10, 2, i % 2 === 0 ? p.led : p.accent + '80');
    px(ctx, W - 44, 410 + i * 10, 14, 3, p.wallBorder + '40');
  }

  // Neon sign
  roundRect(ctx, 100, 100, 80, 28, 3, p.floor);
  ctx.strokeStyle = p.accent + '80'; ctx.lineWidth = 2;
  ctx.strokeRect(100, 100, 80, 28);
  px(ctx, 108, 108, 64, 3, p.accent + '60');
  px(ctx, 115, 116, 50, 3, p.cyan + '50');

  // Energy drink cans
  [W - 40, W - 30].forEach((cx, i) => {
    roundRect(ctx, cx, 530 + i * 4, 8, 14, 2, i === 0 ? p.accent + '60' : p.cyan + '60');
  });

  // Ambient occlusion (magenta-tinted)
  ambientOcclusion(ctx, 186, '#0d0020');
  floorGradient(ctx, 190, '#050008');

  // Matrix rain data particles on wall
  for (let i = 0; i < 20; i++) {
    const mx = 20 + ((i * 43 + 17) % 860);
    const my = 8 + ((i * 31 + 7) % 170);
    const mh = 3 + (i % 4) * 2;
    px(ctx, mx, my, 1, mh, p.cyan + '08');
  }

  // Vending machine
  const vmx = 30, vmy = 400;
  roundRect(ctx, vmx, vmy, 30, 55, 3, p.wall);
  ctx.strokeStyle = p.accent + '40'; ctx.lineWidth = 1;
  ctx.strokeRect(vmx, vmy, 30, 55);
  // Display
  px(ctx, vmx + 3, vmy + 3, 24, 10, p.wallDark);
  px(ctx, vmx + 5, vmy + 5, 20, 2, p.cyan + '30');
  px(ctx, vmx + 5, vmy + 9, 16, 2, p.accent + '25');
  // Drink slots
  for (let i = 0; i < 3; i++) {
    roundRect(ctx, vmx + 4 + i * 9, vmy + 16, 7, 20, 1, p.wallDark);
    roundRect(ctx, vmx + 5 + i * 9, vmy + 18, 5, 14, 1, [p.accent, p.cyan, p.yellow][i] + '15');
  }
  // Neon trim
  px(ctx, vmx, vmy, 30, 1, p.accent + '50');
  px(ctx, vmx, vmy + 54, 30, 1, p.accent + '50');

  // Floor cable runs
  line(ctx, 200, 350, 200, 550, p.wallBorder + '10', 2);
  line(ctx, 600, 300, 600, 500, p.wallBorder + '10', 2);
  line(ctx, 200, 350, 600, 350, p.wallBorder + '08', 1);

  // Screen glare reflections on floor
  roundRect(ctx, 350, 250, 40, 20, 10, p.accent + '03');
  roundRect(ctx, 500, 350, 30, 15, 8, p.cyan + '03');
  roundRect(ctx, 200, 450, 35, 18, 8, p.accent + '02');

  // More neon sign detail
  px(ctx, 104, 122, 72, 2, p.cyan + '40');
  // Neon glow around sign
  roundRect(ctx, 96, 96, 88, 36, 6, p.accent + '04');

  // Wall texture dithering (magenta)
  dither(ctx, 0, 0, W, 186, '#ff00ff02', 0.02);
  // Holographic scan beam
  for (let sx = 0; sx < W; sx += 4) {
    const sAlpha = Math.max(0, 1 - Math.abs(sx - 450) / 300) * 0.04;
    if (sAlpha > 0.005) px(ctx, sx, 140, 4, 1, `rgba(0,255,255,${sAlpha})`);
  }
}

// ─── Draw Environment: ARCTIC ────────────────────────────────────────────────

function drawArctic(ctx) {
  const p = PALETTES.arctic;

  // Floor — metal plates with frost
  px(ctx, 0, 0, W, H, p.floor);
  for (let row = 0; row < Math.ceil((H - 190) / 50); row++) {
    for (let col = 0; col < Math.ceil(W / 80); col++) {
      const x = col * 80, y = row * 50 + 190;
      if (y >= H) continue;
      px(ctx, x, y, 78, 48, p.floorFrost + '40');
      px(ctx, x, y, 78, 1, p.wallBorder + '20');
      px(ctx, x, y, 1, 48, p.wallBorder + '20');
      // Rivets
      circle(ctx, x + 4, y + 4, 2, p.wallBorder + '30');
      circle(ctx, x + 74, y + 4, 2, p.wallBorder + '30');
      circle(ctx, x + 4, y + 44, 2, p.wallBorder + '30');
      circle(ctx, x + 74, y + 44, 2, p.wallBorder + '30');
      // Frost patches
      if ((row + col) % 4 === 0) {
        roundRect(ctx, x + 15, y + 15, 20, 12, 6, p.frost);
      }
      if ((row + col) % 5 === 2) {
        roundRect(ctx, x + 40, y + 25, 15, 10, 5, p.frostBright);
      }
    }
  }

  // Top wall — insulated panels
  px(ctx, 0, 0, W, 190, p.wall);
  for (let col = 0; col < 6; col++) {
    const px2 = col * 150;
    // Panel
    roundRect(ctx, px2 + 4, 4, 142, 180, 3, p.wallDark);
    // Seam lines
    px(ctx, px2 + 4, 95, 142, 2, p.wallBorder + '30');
    // Frost streaks
    if (col % 2 === 0) {
      roundRect(ctx, px2 + 20, 12, 40, 6, 3, p.frost);
      roundRect(ctx, px2 + 80, 30, 30, 5, 3, p.frostBright);
    }
    // Condensation drips
    if (col % 3 === 1) {
      px(ctx, px2 + 50, 40, 2, 20, p.frost);
      px(ctx, px2 + 90, 60, 2, 15, p.frost);
    }
    // Warning label
    if (col === 1 || col === 4) {
      roundRect(ctx, px2 + 60, 150, 40, 18, 2, p.warning + '20');
      px(ctx, px2 + 64, 154, 32, 2, p.warning + '40');
      px(ctx, px2 + 68, 160, 24, 2, p.warning + '30');
    }
  }
  // Wall bottom insulation strip
  px(ctx, 0, 184, W, 3, p.wallBorder + '60');
  px(ctx, 0, 187, W, 3, p.accent + '20');

  // Left wall
  px(ctx, 0, 0, 8, H, p.wallDark);
  px(ctx, 7, 0, 1, H, p.wallBorder + '40');
  // Ice on left wall
  for (let y = 200; y < H; y += 80) {
    roundRect(ctx, 1, y, 5, 20, 2, p.frost);
  }

  // Aurora borealis window
  const wx = W - 180, wy = 15;
  roundRect(ctx, wx, wy, 120, 65, 3, p.sky);
  // Aurora bands
  ctx.save();
  for (let i = 0; i < 6; i++) {
    const ay = wy + 8 + i * 8;
    const acolor = i % 2 === 0 ? p.aurora1 : p.aurora2;
    roundRect(ctx, wx + 5, ay, 110, 6, 3, acolor);
  }
  ctx.restore();
  // Stars
  [wx + 15, wx + 40, wx + 65, wx + 90, wx + 105].forEach((sx, i) => {
    circle(ctx, sx, wy + 10 + (i % 3) * 12, 1.5, p.star);
  });
  // Snow-covered ground
  roundRect(ctx, wx + 2, wy + 52, 116, 11, [0, 0, 2, 2], '#0a1828');
  roundRect(ctx, wx + 2, wy + 50, 116, 6, 2, p.snow);
  // Mountain silhouette
  ctx.fillStyle = '#0f1c2a';
  ctx.beginPath();
  ctx.moveTo(wx + 2, wy + 52);
  ctx.lineTo(wx + 20, wy + 30);
  ctx.lineTo(wx + 35, wy + 42);
  ctx.lineTo(wx + 55, wy + 25);
  ctx.lineTo(wx + 70, wy + 38);
  ctx.lineTo(wx + 90, wy + 22);
  ctx.lineTo(wx + 118, wy + 52);
  ctx.closePath();
  ctx.fill();
  // Snow caps
  px(ctx, wx + 17, wy + 30, 6, 3, p.snow);
  px(ctx, wx + 52, wy + 25, 6, 3, p.snow);
  px(ctx, wx + 87, wy + 22, 6, 3, p.snow);
  // Frame with frost
  ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 3;
  ctx.strokeRect(wx, wy, 120, 65);
  roundRect(ctx, wx - 2, wy - 2, 20, 8, 3, p.frost);
  roundRect(ctx, wx + 100, wy + 60, 22, 8, 3, p.frost);

  // Ice crystal formations
  [{ x: 700, y: 400 }, { x: 720, y: 380 }, { x: 740, y: 410 }].forEach((pos, i) => {
    const h = 20 + i * 8;
    ctx.fillStyle = p.ice;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x - 6, pos.y + h);
    ctx.lineTo(pos.x + 6, pos.y + h);
    ctx.closePath();
    ctx.fill();
    // Highlight
    px(ctx, pos.x - 1, pos.y + 4, 2, h - 8, p.frostBright);
  });

  // Heating vent with red glow
  roundRect(ctx, W - 70, 500, 40, 25, 3, p.wallBorder + '80');
  // Grate lines
  for (let i = 0; i < 4; i++) {
    px(ctx, W - 64, 505 + i * 5, 28, 2, p.wallDark);
  }
  // Red glow
  roundRect(ctx, W - 68, 498, 36, 4, 2, p.heatingGlow);
  roundRect(ctx, W - 66, 496, 32, 3, 2, p.heating + '25');

  // Weather instruments
  // Thermometer
  roundRect(ctx, 40, 400, 8, 40, 4, '#ffffff10');
  px(ctx, 42, 410, 4, 25, p.heating + '40');
  circle(ctx, 44, 438, 5, p.heating + '50');
  // Barometer
  strokeCircle(ctx, 70, 420, 14, p.wallBorder + '60', 2);
  line(ctx, 70, 420, 78, 412, p.accent + '60', 1.5);
  circle(ctx, 70, 420, 2, p.accent + '40');

  // Ice core sample rack
  roundRect(ctx, W - 110, 240, 60, 50, 3, p.wallBorder + '60');
  for (let i = 0; i < 4; i++) {
    roundRect(ctx, W - 104 + i * 14, 248, 10, 36, 2, p.ice);
    px(ctx, W - 102 + i * 14, 250, 6, 32, p.frost);
  }

  // Ambient occlusion (blue-tinted)
  ambientOcclusion(ctx, 188, '#081018');
  floorGradient(ctx, 192, '#08101c');

  // Icicles hanging from wall bottom
  for (const [ix, ih] of [[80, 14], [200, 18], [350, 12], [500, 16], [650, 20], [800, 10]]) {
    ctx.fillStyle = p.frost;
    ctx.beginPath();
    ctx.moveTo(ix - 3, 186); ctx.lineTo(ix + 3, 186); ctx.lineTo(ix, 186 + ih);
    ctx.closePath(); ctx.fill();
    // Icicle highlight
    px(ctx, ix - 1, 187, 1, ih - 3, p.frostBright);
  }

  // Snow particle drift
  dustMotes(ctx, 195, H - 20, 15, '#ffffff0a');

  // Better aurora (wider bands, more colors)
  ctx.save();
  // Extra aurora band (blue-green)
  roundRect(ctx, wx + 3, wy + 14, 114, 8, 4, '#22c55e10');
  roundRect(ctx, wx + 10, wy + 6, 100, 5, 3, '#a855f708');
  // Aurora shimmer
  roundRect(ctx, wx + 30, wy + 20, 60, 4, 2, '#60a5fa08');
  ctx.restore();

  // Equipment locker
  const elx = 30, ely = 350;
  roundRect(ctx, elx, ely, 28, 50, 3, p.wallBorder + '70');
  ctx.strokeStyle = p.wallBorder; ctx.lineWidth = 1;
  ctx.strokeRect(elx, ely, 28, 50);
  // Handle
  roundRect(ctx, elx + 20, ely + 20, 4, 10, 2, '#ffffff15');
  // Label
  px(ctx, elx + 4, ely + 4, 20, 8, p.wallDark);
  px(ctx, elx + 6, ely + 6, 16, 2, p.warning + '30');

  // Radio/comms equipment
  const rcx = 30, rcy = 500;
  roundRect(ctx, rcx, rcy, 24, 20, 2, p.wallBorder + '60');
  px(ctx, rcx + 2, rcy + 2, 20, 10, p.wallDark);
  px(ctx, rcx + 4, rcy + 4, 16, 2, p.accent + '30');
  px(ctx, rcx + 4, rcy + 8, 12, 2, '#22c55e30');
  // Antenna
  px(ctx, rcx + 20, rcy - 14, 2, 16, p.wallBorder + '80');
  circle(ctx, rcx + 21, rcy - 15, 2, p.heating + '40');

  // Footprint marks in frost
  for (const [fx, fy] of [[300, 400], [320, 430], [340, 410]]) {
    roundRect(ctx, fx, fy, 8, 12, 3, p.frost);
    roundRect(ctx, fx + 2, fy + 12, 4, 3, 1, p.frost);
  }

  // Breath condensation near desk area
  circle(ctx, 450, 350, 6, '#ffffff04');
  circle(ctx, 456, 346, 4, '#ffffff03');

  // Heating vent light cone
  lightCone(ctx, W - 50, 525, 50, p.heating);

  // Wall texture dithering (blue)
  dither(ctx, 0, 0, W, 186, '#38bdf802', 0.02);
  // Blowing snow streaks
  for (let s = 0; s < 10; s++) {
    const sx = 50 + ((s * 83) % (W - 100));
    const sy = 200 + ((s * 53) % (H - 250));
    line(ctx, sx, sy, sx + 12 + (s % 5) * 3, sy - 2, '#ffffff0a', 1);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function generate() {
  const outDir = path.join(__dirname, '..', 'assets', 'themes');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const environments = {
    ship: drawShip,
    castle: drawCastle,
    station: drawStation,
    submarine: drawSubmarine,
    mansion: drawMansion,
    lair: drawLair,
    cabin: drawCabin,
    office: drawOffice,
    temple: drawTemple,
    garden: drawGarden,
    cyber: drawCyber,
    arctic: drawArctic,
  };

  for (const [name, drawFn] of Object.entries(environments)) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Anti-alias off for pixel art feel
    ctx.imageSmoothingEnabled = false;

    drawFn(ctx);

    const buffer = canvas.toBuffer('image/png');
    const outPath = path.join(outDir, `${name}-bg.png`);
    fs.writeFileSync(outPath, buffer);
    const sizeKB = (buffer.length / 1024).toFixed(1);
    console.log(`✅ ${name}-bg.png (${sizeKB} KB)`);
  }

  console.log(`\nDone! Generated ${Object.keys(environments).length} sprites in ${outDir}`);
}

generate();
