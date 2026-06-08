import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const distDir = join(root, "dist");
const zipName = `auto-dark-mode-v${manifest.version}.zip`;
const zipPath = join(distDir, zipName);

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const result = spawnSync("zip", [
  "-r",
  zipPath,
  "manifest.json",
  "src",
  "assets/icons",
  "-x",
  "*.DS_Store"
], {
  cwd: root,
  stdio: "inherit"
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`Created ${zipPath}`);

