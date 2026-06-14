import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "store", "screenshots");
mkdirSync(outputDir, { recursive: true });

const svgPath = join(outputDir, "auto-dark-mode-switch-1280x800.svg");
const pngPath = join(outputDir, "auto-dark-mode-switch-1280x800.png");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <rect width="1280" height="800" fill="#0f172a"/>
  <rect x="54" y="54" width="908" height="692" rx="18" fill="#111827" stroke="#334155" stroke-width="2"/>
  <rect x="54" y="54" width="908" height="54" rx="18" fill="#1f2937"/>
  <circle cx="86" cy="81" r="7" fill="#ef4444"/>
  <circle cx="112" cy="81" r="7" fill="#f59e0b"/>
  <circle cx="138" cy="81" r="7" fill="#22c55e"/>
  <rect x="180" y="69" width="580" height="24" rx="12" fill="#0f172a"/>
  <text x="204" y="86" fill="#94a3b8" font-family="Arial, Helvetica, sans-serif" font-size="14">techblog.musinsa.com/the-philosophy-ai-native-hiring</text>

  <rect x="108" y="158" width="760" height="70" rx="10" fill="#1e293b"/>
  <text x="136" y="203" fill="#e5e7eb" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="700">A light article, converted carefully</text>
  <rect x="108" y="260" width="760" height="18" rx="9" fill="#475569"/>
  <rect x="108" y="298" width="720" height="18" rx="9" fill="#334155"/>
  <rect x="108" y="336" width="744" height="18" rx="9" fill="#334155"/>
  <rect x="108" y="374" width="690" height="18" rx="9" fill="#334155"/>
  <rect x="108" y="442" width="760" height="170" rx="12" fill="#172033" stroke="#334155"/>
  <rect x="136" y="478" width="260" height="22" rx="11" fill="#60a5fa"/>
  <rect x="136" y="526" width="690" height="16" rx="8" fill="#475569"/>
  <rect x="136" y="562" width="620" height="16" rx="8" fill="#334155"/>

  <rect x="914" y="156" width="278" height="336" rx="16" fill="#f7f7f5" stroke="#d4d4d4" stroke-width="2"/>
  <text x="940" y="205" fill="#18181b" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">Auto Dark</text>
  <text x="940" y="231" fill="#71717a" font-family="Arial, Helvetica, sans-serif" font-size="16">techblog.musinsa.com</text>
  <rect x="1132" y="188" width="42" height="24" rx="12" fill="#2563eb"/>
  <circle cx="1156" cy="200" r="9" fill="#ffffff"/>

  <rect x="940" y="264" width="226" height="86" rx="10" fill="#ffffff" stroke="#deded8"/>
  <text x="962" y="303" fill="#15803d" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700">Auto dark</text>
  <text x="962" y="328" fill="#71717a" font-family="Arial, Helvetica, sans-serif" font-size="15">Native first. Chrome fallback.</text>

  <rect x="940" y="378" width="226" height="42" rx="8" fill="#ffffff" stroke="#deded8"/>
  <rect x="946" y="384" width="54" height="30" rx="6" fill="#2563eb"/>
  <text x="959" y="405" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700">Auto</text>
  <text x="1015" y="405" fill="#71717a" font-family="Arial, Helvetica, sans-serif" font-size="13">Native</text>
  <text x="1070" y="405" fill="#71717a" font-family="Arial, Helvetica, sans-serif" font-size="13">Force</text>
  <text x="1124" y="405" fill="#71717a" font-family="Arial, Helvetica, sans-serif" font-size="13">Off</text>
  <text x="940" y="458" fill="#71717a" font-family="Arial, Helvetica, sans-serif" font-size="14">Local only. No browsing data is sent.</text>

  <text x="74" y="736" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">Prefers native dark mode. Falls back to Chrome Auto Dark Mode.</text>
</svg>`;

writeFileSync(svgPath, svg);

const result = spawnSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], {
  stdio: "inherit"
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

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

function paeth(left, up, upperLeft) {
  const p = left + up - upperLeft;
  const leftDistance = Math.abs(p - left);
  const upDistance = Math.abs(p - up);
  const upperLeftDistance = Math.abs(p - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function stripAlphaFromPng(filePath) {
  const png = readFileSync(filePath);
  const signature = png.subarray(0, 8);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || colorType !== 6) {
    return;
  }

  const bytesPerPixel = 4;
  const inputStride = width * bytesPerPixel;
  const input = zlib.inflateSync(Buffer.concat(idatChunks));
  const rgba = Buffer.alloc(width * height * bytesPerPixel);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = input[inputOffset];
    inputOffset += 1;
    const row = input.subarray(inputOffset, inputOffset + inputStride);
    inputOffset += inputStride;
    const outOffset = y * inputStride;
    const previousOffset = (y - 1) * inputStride;

    for (let x = 0; x < inputStride; x += 1) {
      const left = x >= bytesPerPixel ? rgba[outOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? rgba[previousOffset + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? rgba[previousOffset + x - bytesPerPixel] : 0;
      let value = row[x];

      if (filter === 1) {
        value = (value + left) & 0xff;
      } else if (filter === 2) {
        value = (value + up) & 0xff;
      } else if (filter === 3) {
        value = (value + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        value = (value + paeth(left, up, upperLeft)) & 0xff;
      }

      rgba[outOffset + x] = value;
    }
  }

  const rgbRows = [];
  for (let y = 0; y < height; y += 1) {
    rgbRows.push(Buffer.from([0]));
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = x * 3;
      row[target] = rgba[source];
      row[target + 1] = rgba[source + 1];
      row[target + 2] = rgba[source + 2];
    }
    rgbRows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  writeFileSync(filePath, Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rgbRows))),
    chunk("IEND", Buffer.alloc(0))
  ]));
}

stripAlphaFromPng(pngPath);

console.log(`Created ${pngPath}`);
