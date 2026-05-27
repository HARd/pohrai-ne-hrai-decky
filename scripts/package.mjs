import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDir = join(root, "release");
const stagingDir = join(releaseDir, "pohrai-ne-hrai");
const zipPath = join(releaseDir, "pohrai-ne-hrai.zip");

if (existsSync(releaseDir)) {
  rmSync(releaseDir, { recursive: true, force: true });
}

mkdirSync(stagingDir, { recursive: true });

for (const item of [
  "LICENSE",
  "README.md",
  "data",
  "dist",
  "main.py",
  "package.json",
  "plugin.json",
]) {
  cpSync(join(root, item), join(stagingDir, item), { recursive: true });
}

execFileSync("zip", ["-r", zipPath, "pohrai-ne-hrai"], {
  cwd: releaseDir,
  stdio: "inherit",
});

console.log(`Created ${zipPath}`);
