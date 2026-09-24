#!/usr/bin/env node
/**
 * Generates the panel icons for the Arena Link plugin (no image library needed):
 * two linked rings, white for dark UI themes, near-black for light ones.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "arena-link", "assets", "icons");
fs.mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** alphaFn(x, y, size) -> 0..1 */
function png(size, rgb, alphaFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y += 1) {
    raw[o] = 0; /* filter: none */
    o += 1;
    for (let x = 0; x < size; x += 1) {
      const a = Math.max(0, Math.min(1, alphaFn(x + 0.5, y + 0.5, size)));
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
      raw[o + 3] = Math.round(a * 255);
      o += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; /* bit depth */
  ihdr[9] = 6; /* RGBA */
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** two linked rings */
function ring(x, y, size) {
  const cx1 = size * 0.37;
  const cx2 = size * 0.63;
  const cy = size * 0.5;
  const outer = size * 0.3;
  const inner = size * 0.16;
  const in1 = Math.hypot(x - cx1, y - cy);
  const in2 = Math.hypot(x - cx2, y - cy);
  return (in1 < outer && in1 > inner) || (in2 < outer && in2 > inner) ? 1 : 0;
}

const white = [255, 255, 255];
const dark = [26, 26, 26];

const files = [
  ["dark@1x.png", 23, white],
  ["dark@2x.png", 46, white],
  ["light@1x.png", 23, dark],
  ["light@2x.png", 46, dark],
];

for (const [name, size, rgb] of files) {
  fs.writeFileSync(path.join(outDir, name), png(size, rgb, ring));
  console.log(`  ${name} (${size}x${size})`);
}

const svg = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <g fill="none" stroke="${color}" stroke-width="5">
    <circle cx="19" cy="24" r="11"/>
    <circle cx="29" cy="24" r="11"/>
  </g>
</svg>
`;
fs.writeFileSync(path.join(outDir, "arena_dark_theme_logo.svg"), svg("#ffffff"));
fs.writeFileSync(path.join(outDir, "arena_light_theme_logo.svg"), svg("#1a1a1a"));
console.log("  arena_dark_theme_logo.svg, arena_light_theme_logo.svg");
