// scripts/draw-logo.mjs — draws the make.fun Payday logo as a 512x512 PNG.
// Node standard library only (node:zlib for the PNG data, a small CRC32).
// The design: make.fun pink background, a white ghost, and a gold coin with
// a "$" — the payday. One bold subject, high contrast, readable at
// thumbnail size, which is what the judge sees on pump.fun.
//
// Run from the entry directory: node scripts/draw-logo.mjs
// Writes assets/payday.png (and prints its sha256).

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'payday.png');
const W = 512;
const H = 512;

// ---- palette ----
const PINK = [255, 46, 126]; // make.fun pink
const PINK_DARK = [214, 28, 107]; // framing disc
const WHITE = [255, 255, 255];
const BLACK = [20, 16, 20];
const GOLD = [255, 210, 62];
const GOLD_DARK = [201, 147, 10];
const GOLD_DOLLAR = [122, 74, 0];

// ---- pixel buffer ----
const px = new Uint8Array(W * H * 4);
function set(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
  px[i + 3] = 255;
}
function fillRect(x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
}
function disc(cx, cy, r, c) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, c);
    }
  }
}
function ring(cx, cy, r0, r1, c) {
  for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++) {
    for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 <= r1 * r1 && d2 >= r0 * r0) set(x, y, c);
    }
  }
}
function ellipse(cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(x, y, c);
    }
  }
}
// Four-point sparkle: a plus with tapered arms.
function sparkle(cx, cy, s, c) {
  for (let d = -s; d <= s; d++) {
    const w = Math.max(1, Math.round(2.5 * (1 - Math.abs(d) / s)));
    for (let t = -w; t <= w; t++) {
      set(cx + d, cy + t, c);
      set(cx + t, cy + d, c);
    }
  }
}

// ---- background ----
fillRect(0, 0, W - 1, H - 1, PINK);
disc(256, 256, 228, PINK_DARK);

// ---- ghost ----
// Dome head + straight body + wavy bottom edge (three downward bumps).
const GX0 = 148;
const GX1 = 344;
const GCX = 246;
const HEAD_Y = 190;
const HEAD_R = 98;
function ghostBottom(x) {
  return 344 + 22 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (x - GX0)) / 65.33));
}
for (let y = HEAD_Y - HEAD_R; y <= 380; y++) {
  for (let x = GX0; x <= GX1; x++) {
    const inHead = (x - GCX) ** 2 + (y - HEAD_Y) ** 2 <= HEAD_R * HEAD_R;
    const inBody = y >= HEAD_Y && y <= ghostBottom(x);
    if (inHead || inBody) set(x, y, WHITE);
  }
}
// Eyes (black ovals) with a white glint.
ellipse(210, 182, 14, 20, BLACK);
ellipse(282, 182, 14, 20, BLACK);
disc(214, 176, 4, WHITE);
disc(286, 176, 4, WHITE);
// Smile: lower arc under the eyes.
for (let a = 25; a <= 155; a++) {
  const rad = (a * Math.PI) / 180;
  for (let r = 23; r <= 29; r++) {
    set(Math.round(GCX + r * Math.cos(rad)), Math.round(232 + r * Math.sin(rad)), BLACK);
  }
}

// ---- gold coin (the payday), bottom-right, overlapping the ghost ----
const CCX = 372;
const CCY = 372;
disc(CCX, CCY, 78, GOLD_DARK);
disc(CCX, CCY, 70, GOLD);
ring(CCX, CCY, 56, 60, GOLD_DARK);
// "$" from a 5x7 bitmap, vertical bar through the middle, scaled 9x.
const DOLLAR = ['.###.', '#...#', '#.#..', '.###.', '..#.#', '#...#', '.###.'];
const CELL = 9;
const DX0 = CCX - Math.floor((5 * CELL) / 2);
const DY0 = CCY - Math.floor((7 * CELL) / 2);
for (let r = 0; r < 7; r++) {
  for (let c = 0; c < 5; c++) {
    if (DOLLAR[r][c] === '#' || c === 2) {
      fillRect(DX0 + c * CELL, DY0 + r * CELL, DX0 + c * CELL + CELL - 2, DY0 + r * CELL + CELL - 2, GOLD_DOLLAR);
    }
  }
}

// ---- sparkles ----
sparkle(92, 92, 13, WHITE);
sparkle(428, 108, 11, WHITE);
sparkle(104, 424, 10, WHITE);
sparkle(448, 300, 9, WHITE);

// ---- PNG encode (color type 6, RGBA, filter 0) ----
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  raw.set(px.subarray(y * W * 4, (y + 1) * W * 4), y * (1 + W * 4) + 1);
}
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${png.length} bytes)`);
console.log(`sha256 ${createHash('sha256').update(png).digest('hex')}`);
