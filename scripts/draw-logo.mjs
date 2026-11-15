// draw-logo.mjs — draws the make.fun Payday logo, assets/payday.png.
//
// Node stdlib only: a tiny rasterizer plus a raw PNG encoder, no image
// library. The picture is one bold subject that reads at thumbnail size:
// the white make.fun ghost on a pink background, holding up a gold coin
// stamped with a "$" — the payday.
//
// Usage: node scripts/draw-logo.mjs [output-path]
// With no argument it writes <repo>/assets/payday.png.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 512;
const PINK = [255, 92, 138]; // make.fun pink background
const WHITE = [255, 255, 255]; // the ghost
const INK = [30, 30, 46]; // ghost eyes and mouth
const GOLD = [255, 197, 61]; // the payday coin
const GOLD_RIM = [217, 154, 0]; // coin rim and inner ring
const GOLD_DEEP = [122, 82, 0]; // the $ stamped on the coin

// The ghost: head circle at (256, 190) r 105, body down to y 370, and a
// wavy hem cut from the bottom edge by three scoops.
const GHOST_HEAD = { x: 256, y: 190, r: 105 };
const GHOST_BODY = { x0: 151, x1: 361, y0: 190, y1: 370 };
const GHOST_HEM = [
  { x: 186, y: 370, r: 35 },
  { x: 256, y: 370, r: 35 },
  { x: 326, y: 370, r: 35 },
];
// The coin: centre (375, 375), r 72, overlapping the ghost's lower right.
const COIN = { x: 375, y: 375, r: 72, rim: 68, ringLo: 56, ringHi: 60 };
// A 5x7 "$": an S with a vertical stroke through it.
const DOLLAR = [
  "01110",
  "10101",
  "10100",
  "01110",
  "00101",
  "10101",
  "01110",
];
const DOLLAR_SCALE = 9;

const px = new Uint8Array(SIZE * SIZE * 3);

function setPixel(x, y, color) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 3;
  px[i] = color[0];
  px[i + 1] = color[1];
  px[i + 2] = color[2];
}

function fillRect(x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPixel(x, y, color);
  }
}

function inCircle(x, y, circle) {
  const dx = x - circle.x;
  const dy = y - circle.y;
  return dx * dx + dy * dy <= circle.r * circle.r;
}

function inEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function inGhost(x, y) {
  if (inCircle(x, y, GHOST_HEAD)) return true;
  if (
    x >= GHOST_BODY.x0 &&
    x <= GHOST_BODY.x1 &&
    y >= GHOST_BODY.y0 &&
    y <= GHOST_BODY.y1
  ) {
    for (const scoop of GHOST_HEM) {
      if (inCircle(x, y, scoop)) return false;
    }
    return true;
  }
  return false;
}

function paintBackground() {
  for (let i = 0; i < px.length; i += 3) {
    px[i] = PINK[0];
    px[i + 1] = PINK[1];
    px[i + 2] = PINK[2];
  }
}

function paintGhost() {
  for (let y = 80; y <= 385; y++) {
    for (let x = 140; x <= 375; x++) {
      if (inGhost(x, y)) setPixel(x, y, WHITE);
    }
  }
  // Face: two tall eyes and a small open mouth.
  for (let y = 175; y <= 230; y++) {
    for (let x = 195; x <= 320; x++) {
      if (inEllipse(x, y, 215, 200, 15, 21)) setPixel(x, y, INK);
      if (inEllipse(x, y, 297, 200, 15, 21)) setPixel(x, y, INK);
      if (inEllipse(x, y, 256, 258, 13, 17)) setPixel(x, y, INK);
    }
  }
}

function paintCoin() {
  for (let y = COIN.y - COIN.r; y <= COIN.y + COIN.r; y++) {
    for (let x = COIN.x - COIN.r; x <= COIN.x + COIN.r; x++) {
      const dx = x - COIN.x;
      const dy = y - COIN.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > COIN.r) continue;
      if (d > COIN.rim || (d >= COIN.ringLo && d < COIN.ringHi)) {
        setPixel(x, y, GOLD_RIM);
      } else {
        setPixel(x, y, GOLD);
      }
    }
  }
  // Stamp the $ in the middle of the coin.
  const glyphW = DOLLAR[0].length * DOLLAR_SCALE;
  const glyphH = DOLLAR.length * DOLLAR_SCALE;
  const x0 = COIN.x - Math.floor(glyphW / 2);
  const y0 = COIN.y - Math.floor(glyphH / 2);
  for (let r = 0; r < DOLLAR.length; r++) {
    for (let c = 0; c < DOLLAR[r].length; c++) {
      if (DOLLAR[r][c] === "1") {
        fillRect(
          x0 + c * DOLLAR_SCALE,
          y0 + r * DOLLAR_SCALE,
          DOLLAR_SCALE,
          DOLLAR_SCALE,
          GOLD_DEEP,
        );
      }
    }
  }
}

// --- Minimal PNG encoder (8-bit RGB, one IDAT, filter 0 per row) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0;
    rgb.copy(
      raw,
      y * (1 + width * 3) + 1,
      y * width * 3,
      (y + 1) * width * 3,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(repoRoot, "assets", "payday.png");

paintBackground();
paintGhost();
paintCoin();

const png = encodePng(SIZE, SIZE, Buffer.from(px));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
const sha = createHash("sha256").update(png).digest("hex");
console.log(`wrote ${outPath} (${png.length} bytes, sha256 ${sha})`);
