import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
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
  "dist",
  "main.py",
  "plugin.json",
]) {
  cpSync(join(root, item), join(stagingDir, item), { recursive: true });
}

writeFileSync(
  join(stagingDir, "package.json"),
  `${JSON.stringify(
    {
      name: "pohrai-ne-hrai",
      version: rootPackage.version,
      description: "Marks Ukrainian and hostile game developers directly in the Steam Deck UI.",
      type: "module",
      main: "dist/index.js",
      license: "MIT",
    },
    null,
    2
  )}\n`
);

execFileSync("zip", ["-r", zipPath, "pohrai-ne-hrai"], {
  cwd: releaseDir,
  stdio: "inherit",
});

console.log(`Created ${zipPath}`);
