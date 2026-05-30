import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const rollupBin = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "rollup.cmd" : "rollup"
);

if (!existsSync(rollupBin)) {
  console.error("Rollup is not installed. Run npm install first.");
  process.exit(1);
}

let completed = false;
let child;

function finish(code) {
  if (completed) return;
  completed = true;
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
  process.exit(code);
}

child = spawn(rollupBin, ["-c"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});

function pipeAndWatch(stream, target) {
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    target.write(text);
    if (text.includes("created dist")) {
      setTimeout(() => finish(0), 250);
    }
  });
}

pipeAndWatch(child.stdout, process.stdout);
pipeAndWatch(child.stderr, process.stderr);

child.on("close", (code, signal) => {
  if (completed) return;
  if (code === 0) finish(0);
  console.error(`Rollup exited with ${signal || code}`);
  finish(code || 1);
});
