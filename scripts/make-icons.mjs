import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "assets", "icons");
mkdirSync(outputDir, { recursive: true });

function crcTable() {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function setPixel(pixels, width, x, y, rgba) {
  if (x < 0 || y < 0 || x >= width) {
    return;
  }
  const index = (y * width + x) * 4;
  pixels[index] = rgba[0];
  pixels[index + 1] = rgba[1];
  pixels[index + 2] = rgba[2];
  pixels[index + 3] = rgba[3];
}

function blendPixel(pixels, width, x, y, rgba, alpha = 1) {
  if (x < 0 || y < 0 || x >= width) {
    return;
  }
  const index = (y * width + x) * 4;
  const sourceAlpha = (rgba[3] / 255) * alpha;
  const targetAlpha = pixels[index + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha === 0) {
    return;
  }
  pixels[index] = Math.round((rgba[0] * sourceAlpha + pixels[index] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[index + 1] = Math.round((rgba[1] * sourceAlpha + pixels[index + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[index + 2] = Math.round((rgba[2] * sourceAlpha + pixels[index + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[index + 3] = Math.round(outAlpha * 255);
}

function fillCircle(pixels, width, height, cx, cy, radius, rgba) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= radius) {
        const edge = Math.min(1, radius - distance + 0.5);
        blendPixel(pixels, width, x, y, rgba, edge);
      }
    }
  }
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const bg = [17, 24, 39, 255];
  const blue = [96, 165, 250, 255];
  const cutout = [17, 24, 39, 255];
  const star = [246, 248, 255, 255];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      setPixel(pixels, size, x, y, bg);
    }
  }

  fillCircle(pixels, size, size, size * 0.48, size * 0.48, size * 0.3, blue);
  fillCircle(pixels, size, size, size * 0.58, size * 0.4, size * 0.29, cutout);
  fillCircle(pixels, size, size, size * 0.7, size * 0.68, Math.max(1.2, size * 0.045), star);

  const rawRows = [];
  for (let y = 0; y < size; y += 1) {
    rawRows.push(Buffer.from([0]));
    rawRows.push(pixels.subarray(y * size * 4, (y + 1) * size * 4));
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rawRows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

[16, 32, 48, 128].forEach((size) => {
  writeFileSync(join(outputDir, `icon-${size}.png`), drawIcon(size));
});

console.log(`Wrote icons to ${outputDir}`);

