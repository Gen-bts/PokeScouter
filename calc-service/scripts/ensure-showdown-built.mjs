import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const showdownDir = resolve(rootDir, "node_modules", "pokemon-showdown");
const showdownEntry = resolve(showdownDir, "dist", "sim", "index.js");

if (!existsSync(showdownDir)) {
  console.error("pokemon-showdown is not installed. Run `npm install` in calc-service first.");
  process.exit(1);
}

if (existsSync(showdownEntry)) {
  process.exit(0);
}

console.log("Building pokemon-showdown runtime assets...");
const result = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["--prefix", showdownDir, "run", "build"],
  {
    cwd: rootDir,
    stdio: "inherit",
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
