/**
 * @smogon/calc の Champions 対応ビルドを node_modules/@smogon/calc にオーバーレイする.
 *
 * npm published @smogon/calc 0.11.0 (2026-03-11) は Champions をまだ含まないため、
 * smogon/damage-calc master (Champions サポート追加済み) を git clone して
 * calc/ サブディレクトリをコンパイルし、dist/ を上書きする。
 *
 * マーカーファイル (.champions-commit) で冪等性を保証する。
 * damage-calc リポジトリ自体の postinstall (subpkg install) は PATH 依存で
 * 環境によって失敗するため、npm 依存として取り込まず直接 git で管理する。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const PINNED_COMMIT = "187514b0a89851c31c1ce754773a9a3a83f1344f";
const REPO_URL = "https://github.com/smogon/damage-calc.git";

const cacheDir = resolve(rootDir, "node_modules", ".cache", "damage-calc");
const calcSrcDir = resolve(cacheDir, "calc");
const targetDir = resolve(rootDir, "node_modules", "@smogon", "calc");
const markerFile = resolve(targetDir, ".champions-commit");

if (!existsSync(targetDir)) {
  console.error(
    "@smogon/calc is missing — run `npm install` in calc-service first.",
  );
  process.exit(1);
}

if (existsSync(markerFile)) {
  const installed = readFileSync(markerFile, "utf8").trim();
  if (installed === PINNED_COMMIT) {
    process.exit(0);
  }
}

const isWin = process.platform === "win32";
const git = isWin ? "git.exe" : "git";
const npm = isWin ? "npm.cmd" : "npm";

function run(cmd, args, opts = {}) {
  // Windows の .cmd (npm.cmd) は shell 経由でないと起動できない場合がある.
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: isWin,
    ...opts,
  });
  if (result.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

// 1. リポジトリを取得 (キャッシュが無い場合は clone、あれば checkout のみ).
if (!existsSync(resolve(cacheDir, ".git"))) {
  mkdirSync(dirname(cacheDir), { recursive: true });
  rmSync(cacheDir, { recursive: true, force: true });
  console.log(`Cloning smogon/damage-calc to ${cacheDir}...`);
  run(git, ["clone", "--no-checkout", REPO_URL, cacheDir]);
}
console.log(`Checking out ${PINNED_COMMIT}...`);
run(git, ["-C", cacheDir, "fetch", "origin"]);
run(git, ["-C", cacheDir, "checkout", PINNED_COMMIT]);

// 2. calc/ の devDeps (typescript など) をインストール.
//    ルートの prepare は bundle 段階で上位ディレクトリの依存を要求するため --ignore-scripts で回避。
//    --prefix は挙動がブレるため cwd を切り替えて実行する。
console.log("Installing @smogon/calc build dependencies...");
run(
  npm,
  ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"],
  { cwd: calcSrcDir },
);

// 3. TypeScript コンパイルのみ実行 (bundle 段階はスキップ).
console.log("Compiling @smogon/calc...");
const tscBin = resolve(
  calcSrcDir,
  "node_modules",
  ".bin",
  isWin ? "tsc.cmd" : "tsc",
);
run(tscBin, ["-p", "."], { cwd: calcSrcDir });

const builtDist = resolve(calcSrcDir, "dist");
if (!existsSync(resolve(builtDist, "index.js"))) {
  console.error("Champions-enabled dist was not produced.");
  process.exit(1);
}

// 4. dist/ を @smogon/calc にオーバーレイ.
console.log("Overlaying Champions dist onto @smogon/calc...");
const targetDistDir = resolve(targetDir, "dist");
rmSync(targetDistDir, { recursive: true, force: true });
cpSync(builtDist, targetDistDir, { recursive: true });

// 5. マーカーを書き込む.
writeFileSync(markerFile, PINNED_COMMIT, "utf8");
console.log(`@smogon/calc: Champions build installed (${PINNED_COMMIT}).`);
