#!/usr/bin/env node
/**
 * Part 98 — Vercel Build Output API v3 Assembler + Auto-Migration Runner
 * -----------------------------------------------------------------------------
 * Runs as `buildCommand` via `vercel.json` when a school deploys their private
 * Fork of `maakrop-school-dist` on Vercel (both Hobby Free and Pro plans).
 *
 * What this script does in ~15 seconds with ZERO source code and ZERO `npm install`:
 * 1. Downloads & cryptographically verifies (Ed25519 + SHA-256) the `@vercel/nft`-traced
 *    Next.js standalone bundle from Cloudflare R2 (`scripts/fetch-release-bundle.mjs`).
 * 2. Runs `scripts/self-hosted-migrate.mjs --optional` so every database table
 *    and new migration is automatically created/updated during Vercel Deploy.
 * 3. Packages the verified standalone `.next/` + traced `node_modules/` into a single
 *    Vercel Build Output API v3 directory (`.vercel/output/`):
 *    - `.vercel/output/static/`            → Edge CDN (`/_next/static/*` + `public/*`)
 *    - `.vercel/output/functions/__maakrop.func/` → 1 Node.js 22 Serverless Function
 *      (100% compatible with Vercel Hobby Free's 12-function limit, streaming-enabled,
 *      and well below AWS Lambda's 250 MB unzipped size cap).
 *    - `.vercel/output/config.json`        → Build Output API v3 routing config.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(process.cwd());

// 1. Fetch & cryptographically verify `@vercel/nft`-traced standalone bundle from R2 CDN
const fetchBundleScript = join(rootDir, "scripts", "fetch-release-bundle.mjs");
if (existsSync(fetchBundleScript)) {
  console.log("[vercel-prebuilt] Step 1/3: Ensuring verified Maakrop standalone bundle is present...");
  const fetchRes = spawnSync(process.execPath, [fetchBundleScript, "--if-missing"], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  if ((fetchRes.status ?? 1) !== 0) {
    console.error("[vercel-prebuilt] Failed to download or verify Maakrop standalone bundle.");
    process.exit(fetchRes.status ?? 1);
  }
}

// 2. Auto-run database migrations when DATABASE_URL* is configured in Vercel Env Vars
const migrateScript = join(rootDir, "scripts", "self-hosted-migrate.mjs");
if (existsSync(migrateScript)) {
  console.log("[vercel-prebuilt] Step 2/3: Running automatic database migrations...");
  const migRes = spawnSync(process.execPath, [migrateScript, "--optional"], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  if ((migRes.status ?? 1) !== 0) {
    console.error("[vercel-prebuilt] Database migration failed. Check DATABASE_URL in Vercel Environment Variables.");
    process.exit(migRes.status ?? 1);
  }
}

// 3. Assemble `.vercel/output` conforming to Vercel Build Output API v3
console.log("[vercel-prebuilt] Step 3/3: Assembling .vercel/output (Build Output API v3)...");

const serverJsPath = join(rootDir, "server.js");
if (!existsSync(serverJsPath)) {
  console.error("[vercel-prebuilt] Missing server.js in release root.");
  process.exit(1);
}

// Extract the baked `nextConfig` JSON object from Next.js standalone `server.js`
const serverJsSource = readFileSync(serverJsPath, "utf8");
const configLine = serverJsSource.split(/\r?\n/).find((line) => line.startsWith("const nextConfig = "));
if (!configLine) {
  console.error("[vercel-prebuilt] Could not locate `const nextConfig = ...` in server.js.");
  process.exit(1);
}
const nextConfigJson = configLine.slice("const nextConfig = ".length).replace(/;\s*$/, "");

const outputDir = join(rootDir, ".vercel", "output");
const staticDir = join(outputDir, "static");
const funcDir = join(outputDir, "functions", "__maakrop.func");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(staticDir, { recursive: true });
mkdirSync(funcDir, { recursive: true });

// 3a. Edge CDN static files: `.next/static` -> `/_next/static` and `public` -> `/`
const nextStaticSrc = join(rootDir, ".next", "static");
if (existsSync(nextStaticSrc)) {
  cpSync(nextStaticSrc, join(staticDir, "_next", "static"), { recursive: true, dereference: true });
}
const publicSrc = join(rootDir, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, staticDir, { recursive: true, dereference: true });
}

// 3b. Runtime files for the single Node.js serverless function (`__maakrop.func`)
// Because `node_modules/` is already `@vercel/nft`-traced by Next.js standalone, we only exclude
// Alpine musl binaries and unused MathJax CHTML browser fonts — zero fragile pruning of Next.js internals!
function shouldIncludeNextFile(srcPath) {
  const normalized = srcPath.replace(/\\/g, "/");
  if (normalized.endsWith(".nft.json")) return false;
  if (normalized.includes("/.next/static/") || normalized.endsWith("/.next/static")) return false;
  if (normalized.includes("/.next/cache/") || normalized.endsWith("/.next/cache")) return false;
  return true;
}

function shouldIncludeNodeModule(srcPath) {
  const normalized = srcPath.replace(/\\/g, "/");
  // Vercel Lambda uses Amazon Linux (glibc x64), never Alpine musl
  if (normalized.includes("/@img/sharp-libvips-linuxmusl-")) return false;
  if (normalized.includes("/@img/sharp-linuxmusl-")) return false;
  // Server-side exam PDF rendering uses MathJax SVG only — exclude unused CHTML & browser UMD bundles
  if (normalized.includes("/@mathjax/mathjax-newcm-font/")) {
    const tail = normalized.split("/@mathjax/mathjax-newcm-font/")[1] ?? "";
    if (
      tail === "chtml" ||
      tail.startsWith("chtml/") ||
      tail === "chtml.js" ||
      tail === "svg" ||
      tail.startsWith("svg/") ||
      tail === "svg.js" ||
      tail === "examples" ||
      tail.startsWith("examples/") ||
      tail === "tsconfig" ||
      tail.startsWith("tsconfig/") ||
      tail.startsWith("tex-mml-") ||
      tail.startsWith("cjs/chtml") ||
      tail.startsWith("mjs/chtml")
    ) {
      return false;
    }
  }
  return true;
}

cpSync(join(rootDir, ".next"), join(funcDir, ".next"), {
  recursive: true,
  dereference: true,
  filter: shouldIncludeNextFile,
});
cpSync(join(rootDir, "node_modules"), join(funcDir, "node_modules"), {
  recursive: true,
  dereference: true,
  filter: shouldIncludeNodeModule,
});
for (const dirName of ["assets", "drizzle", "skills"]) {
  const src = join(rootDir, dirName);
  if (existsSync(src)) {
    cpSync(src, join(funcDir, dirName), { recursive: true, dereference: true });
  }
}
// Keep only small brand SVGs in funcDir/public for server-side PDF/card rendering (`public/brand/*`)
const brandSrc = join(rootDir, "public", "brand");
if (existsSync(brandSrc)) {
  mkdirSync(join(funcDir, "public"), { recursive: true });
  cpSync(brandSrc, join(funcDir, "public", "brand"), { recursive: true, dereference: true });
}

writeFileSync(join(funcDir, "next-config.json"), `${nextConfigJson}\n`, "utf8");
writeFileSync(
  join(funcDir, "package.json"),
  JSON.stringify({ name: "maakrop-vercel-func", private: true, type: "commonjs" }, null, 2) + "\n",
  "utf8",
);

// Detect target edition from release-manifest.json so School & Teacher editions stay isolated
let targetEdition = "self_hosted";
const manifestPath = join(rootDir, "release-manifest.json");
if (existsSync(manifestPath)) {
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (m.edition === "self_hosted_teacher" || m.product === "maakrop-self-hosted-teacher") {
      targetEdition = "self_hosted_teacher";
    }
  } catch {
    // fallback to school edition
  }
}

// 3c. Serverless function entry point (`index.cjs`) wrapping Next.js standalone requestHandler
const handlerCode = `"use strict";
process.env.MAAKROP_EDITION = ${JSON.stringify(targetEdition)};
process.env.NODE_ENV = "production";

const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;
if (process.cwd() !== dir) {
  try {
    process.chdir(dir);
  } catch {
    // ignore chdir errors on read-only environments
  }
}

const nextConfig = JSON.parse(fs.readFileSync(path.join(dir, "next-config.json"), "utf8"));
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

require("next");
const { getRequestHandlers } = require("next/dist/server/lib/start-server");

let handlerPromise = null;

function getHandler() {
  if (!handlerPromise) {
    handlerPromise = getRequestHandlers({
      dir,
      port: 3000,
      isDev: false,
      hostname: "127.0.0.1",
      minimalMode: false,
      quiet: false,
    }).then((initResult) => {
      if (Array.isArray(initResult)) return initResult[0];
      return initResult.requestHandler;
    });
  }
  return handlerPromise;
}

module.exports = async function maakropHandler(req, res) {
  try {
    const requestHandler = await getHandler();
    await requestHandler(req, res);
  } catch (err) {
    console.error("[maakrop-vercel] Request error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }
};
`;
writeFileSync(join(funcDir, "index.cjs"), handlerCode, "utf8");

// 3d. `.vc-config.json` (Node.js 22 serverless function with response streaming enabled + single region for Hobby compatibility)
const vercelRegion = (process.env.MAAKROP_VERCEL_REGION || "sin1").trim() || "sin1";
writeFileSync(
  join(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.cjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 60,
      regions: [vercelRegion],
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

// 3e. `.vercel/output/config.json` (Build Output API v3 routes)
writeFileSync(
  join(outputDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: "^/_next/static/(.*)$",
          headers: { "cache-control": "public, max-age=31536000, immutable" },
          continue: true,
        },
        { handle: "filesystem" },
        { src: "^/(.*)$", dest: "/__maakrop" },
      ],
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

// Measure final unzipped function size so we always verify it stays below AWS Lambda's 250 MB cap
function dirSize(d) {
  let total = 0;
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    const st = lstatSync(p);
    total += st.isDirectory() ? dirSize(p) : st.size;
  }
  return total;
}

const funcMb = (dirSize(funcDir) / 1048576).toFixed(1);
const staticMb = (dirSize(staticDir) / 1048576).toFixed(1);
console.log(`[vercel-prebuilt] ✓ Ready — __maakrop.func: ${funcMb} MB unzipped, static CDN: ${staticMb} MB.`);
if (Number(funcMb) >= 248) {
  console.warn(`[vercel-prebuilt] ⚠ Warning: __maakrop.func (${funcMb} MB) is close to AWS Lambda's 250 MB unzipped limit.`);
}
