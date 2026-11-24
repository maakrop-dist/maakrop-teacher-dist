#!/usr/bin/env node
/**
 * Part 98 — Self-Hosted Thin Repo Standalone Bundle Fetcher & Cross-OS Adapter
 * -----------------------------------------------------------------------------
 * Pure Node.js 20+ (ZERO external npm dependencies).
 *
 * Industry-standard prebuilt artifact distribution:
 *   - Git repo stays ~300 KB (no `node_modules/`, no `.next/`).
 *   - Cloudflare R2 hosts the exact `@vercel/nft`-traced Next.js `output: "standalone"`
 *     tarball (`.next/`, minimal traced `node_modules/`, `server.js`, `drizzle/`,
 *     `public/`, `assets/`, `skills/`).
 *
 * What this script does on ANY host (Vercel, Linux x64/ARM64, Docker, Windows, macOS):
 *   1. Verifies Ed25519 cryptographic signature of `release-manifest.json`.
 *   2. Downloads the standalone `.tar.gz` from R2 CDN (or uses `--file <path>` offline).
 *   3. Verifies SHA-256 digest of the `.tar.gz` before extraction.
 *   4. Extracts the standalone runtime (preserving `.env`, `storage/`, `.git/`).
 *   5. Ensures `.next/node_modules/<pkg>-<16hex>` aliases resolve on Windows as well as POSIX.
 *   6. Automatically installs matching `@img/sharp-*` native binary ONLY when running on
 *      non-Linux-x64 hosts (Windows, macOS, Linux ARM64) — leaving Linux x64 (Vercel,
 *      Ubuntu, Debian, Alpine Docker, Railway, Render) at zero `npm install` overhead!
 *
 * Usage:
 *   node scripts/fetch-release-bundle.mjs [--if-missing] [--force] [--file ./local-bundle.tar.gz]
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

export const EMBEDDED_RELEASE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAvjzoZAD1zLs9nuT/MXRaF02aMwM845WTXDh61Gwc8Ts=
-----END PUBLIC KEY-----`;

export const EMBEDDED_TEACHER_RELEASE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEANsikSCznEckkw686ApPaastzzg5FkUu8wYZiIgxzMuc=
-----END PUBLIC KEY-----`;

const STATE_FILE = ".maakrop-bundle-state.json";

export function resolveReleasePublicKeyPem(override, product) {
  const isTeacher = product === "maakrop-self-hosted-teacher";
  const envKey = isTeacher
    ? process.env.MAAKROP_TEACHER_LICENSE_PUBLIC_KEY || process.env.MAAKROP_LICENSE_PUBLIC_KEY
    : process.env.MAAKROP_LICENSE_PUBLIC_KEY;
  const fallback = isTeacher ? EMBEDDED_TEACHER_RELEASE_PUBLIC_KEY_PEM : EMBEDDED_RELEASE_PUBLIC_KEY_PEM;
  const raw = (override || envKey || fallback).trim();
  return raw.replace(/\\n/g, "\n");
}

export function verifyManifestSignature(manifest, publicKeyPem) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, reason: "Invalid release-manifest.json format." };
  }
  if (!manifest.signature || typeof manifest.signature !== "string") {
    return { ok: false, reason: "release-manifest.json is missing Ed25519 signature." };
  }
  const { signature, ...unsigned } = manifest;
  try {
    const ok = verify(
      null,
      Buffer.from(JSON.stringify(unsigned), "utf8"),
      createPublicKey(resolveReleasePublicKeyPem(publicKeyPem, manifest.product)),
      Buffer.from(signature, "base64url"),
    );
    return ok ? { ok: true } : { ok: false, reason: "Ed25519 signature mismatch — manifest may be tampered." };
  } catch (err) {
    return { ok: false, reason: `Signature verification error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolvePromise);
    stream.on("error", rejectPromise);
  });
  return hash.digest("hex");
}

/**
 * Determine if the current OS/CPU needs a platform-specific `@img/sharp-*` binary
 * beyond the Linux x64 (glibc + musl) binaries already shipped in the standalone bundle.
 */
export function detectRequiredSharpPackages(
  platform = process.platform,
  arch = process.arch,
  sharpVersion = "0.35.3",
  isMusl = false,
) {
  // Standalone bundle already includes both `linux-x64` (glibc) and `linuxmusl-x64` (Alpine)
  if (platform === "linux" && arch === "x64") return [];

  if (platform === "win32" && (arch === "x64" || arch === "ia32" || arch === "arm64")) {
    return [`@img/sharp-win32-${arch}@${sharpVersion}`];
  }
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return [`@img/sharp-darwin-${arch}@${sharpVersion}`, `@img/sharp-libvips-darwin-${arch}`];
  }
  if (platform === "linux" && arch === "arm64") {
    const libc = isMusl ? "linuxmusl" : "linux";
    return [`@img/sharp-${libc}-arm64@${sharpVersion}`, `@img/sharp-libvips-${libc}-arm64`];
  }
  return [];
}

function detectLinuxMusl() {
  if (process.platform !== "linux") return false;
  try {
    const report = process.report?.getReport?.();
    if (report && typeof report === "object" && "header" in report) {
      const glibc = report.header?.glibcVersionRuntime;
      if (glibc) return false;
      return true;
    }
  } catch {
    // ignore
  }
  return existsSync("/etc/alpine-release");
}

function ensurePlatformSharpBinary(rootDir, sharpVersion) {
  const pkgs = detectRequiredSharpPackages(process.platform, process.arch, sharpVersion || "0.35.3", detectLinuxMusl());
  if (pkgs.length === 0) return;

  const primaryName = pkgs[0].replace(/@[^@]+$/, "");
  if (existsSync(join(rootDir, "node_modules", ...primaryName.split("/")))) {
    return;
  }

  console.log(`[bundle] Adapting native image binary for ${process.platform}-${process.arch} (${pkgs.join(", ")})...`);
  const stage = mkdtempSync(join(tmpdir(), "maakrop-sharp-"));
  try {
    writeFileSync(join(stage, "package.json"), JSON.stringify({ name: "sharp-adapter", private: true }) + "\n", "utf8");
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const res = spawnSync(
      npmCmd,
      ["install", "--no-save", "--no-audit", "--no-fund", "--force", ...pkgs],
      { cwd: stage, stdio: "inherit", shell: process.platform === "win32" },
    );
    if ((res.status ?? 1) !== 0) {
      console.warn(
        `[bundle] Warning: could not auto-install ${pkgs.join(", ")} (image processing may be limited on this host).`,
      );
      return;
    }
    const imgSrc = join(stage, "node_modules", "@img");
    if (existsSync(imgSrc)) {
      const imgDest = join(rootDir, "node_modules", "@img");
      mkdirSync(imgDest, { recursive: true });
      for (const entry of readdirSync(imgSrc)) {
        cpSync(join(imgSrc, entry), join(imgDest, entry), { recursive: true });
      }
      console.log(`[bundle] ✓ Installed native sharp binary for ${process.platform}-${process.arch}.`);
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function linkTurbopackExternals(rootDir, turbopackExternals) {
  if (!Array.isArray(turbopackExternals) || turbopackExternals.length === 0) return 0;

  let linked = 0;
  for (const hashedRel of turbopackExternals) {
    if (typeof hashedRel !== "string" || !hashedRel.trim()) continue;
    const parts = hashedRel.split("/").filter(Boolean);
    const destDir = join(rootDir, ".next", "node_modules", ...parts);
    // If tar already extracted a valid symlink/folder on Linux/macOS, keep it untouched
    if (existsSync(destDir)) continue;

    const basePkg = hashedRel.replace(/-[0-9a-f]{16}$/i, "");
    const srcDir = join(rootDir, "node_modules", ...basePkg.split("/"));
    if (!existsSync(srcDir)) continue;

    // Remove any dangling symlink left over from tar extraction on a different build path
    rmSync(destDir, { recursive: true, force: true });
    mkdirSync(dirname(destDir), { recursive: true });
    try {
      const linkType = process.platform === "win32" ? "junction" : "dir";
      symlinkSync(srcDir, destDir, linkType);
    } catch {
      cpSync(srcDir, destDir, { recursive: true, dereference: true });
    }
    linked++;
  }
  return linked;
}

function isBundleExtractedAndCurrent(rootDir, expectedSha256) {
  const statePath = join(rootDir, STATE_FILE);
  if (!existsSync(statePath)) return false;
  if (!existsSync(join(rootDir, "server.js")) || !existsSync(join(rootDir, ".next")) || !existsSync(join(rootDir, "node_modules", "next"))) {
    return false;
  }
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    return Boolean(expectedSha256 && state.sha256 === expectedSha256);
  } catch {
    return false;
  }
}

async function downloadToFile(url, destPath) {
  const headers = { "user-agent": "maakrop-self-hosted-fetcher/2.0" };
  if (process.env.MAAKROP_RELEASE_AUTH_HEADER?.trim()) {
    headers.authorization = process.env.MAAKROP_RELEASE_AUTH_HEADER.trim();
  }

  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText} while downloading ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

async function main() {
  const args = process.argv.slice(2);
  const ifMissing = args.includes("--if-missing");
  const force = args.includes("--force");
  const fileIdx = args.indexOf("--file");
  const localFileArg = fileIdx !== -1 && args[fileIdx + 1] ? resolve(process.cwd(), args[fileIdx + 1]) : null;
  const allowUnsigned = process.env.MAAKROP_ALLOW_UNSIGNED_BUNDLE === "1";

  const rootDir = resolve(process.cwd());
  const manifestPath = join(rootDir, "release-manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`[bundle] release-manifest.json not found in ${rootDir}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  // Legacy full-repo compatibility
  if (!manifest.bundle) {
    if (existsSync(join(rootDir, "server.js")) && existsSync(join(rootDir, ".next"))) {
      linkTurbopackExternals(rootDir, manifest.turbopackExternals);
      return;
    }
    console.error("[bundle] release-manifest.json has no `bundle` metadata and server.js is missing.");
    process.exit(1);
  }

  // 1. Verify Ed25519 signature of release-manifest.json
  const sigCheck = verifyManifestSignature(manifest);
  if (!sigCheck.ok) {
    if (allowUnsigned) {
      console.warn(`[bundle] Warning: ${sigCheck.reason} (bypassed via MAAKROP_ALLOW_UNSIGNED_BUNDLE=1)`);
    } else {
      console.error(`[bundle] Security check FAILED: ${sigCheck.reason}`);
      process.exit(1);
    }
  } else {
    console.log(`[bundle] ✓ Verified Ed25519 signature for Maakrop v${manifest.version}`);
  }

  const expectedSha = String(manifest.bundle.sha256 || "").trim().toLowerCase();
  if (!expectedSha || expectedSha.length !== 64) {
    console.error("[bundle] release-manifest.json is missing a valid bundle.sha256 digest.");
    process.exit(1);
  }

  // 2. Skip download if already extracted and matching SHA-256
  if (!force && ifMissing && isBundleExtractedAndCurrent(rootDir, expectedSha)) {
    linkTurbopackExternals(rootDir, manifest.turbopackExternals);
    ensurePlatformSharpBinary(rootDir, manifest.sharpVersion);
    console.log(`[bundle] ✓ Standalone bundle v${manifest.version} (${expectedSha.slice(0, 12)}) already present — skipped download.`);
    return;
  }

  // 3. Acquire standalone bundle archive (local --file override OR download from R2/CDN URL)
  const tmpArchive = join(rootDir, `.maakrop-bundle-download-${process.pid}.tar.gz`);
  const bundleUrl = process.env.MAAKROP_RELEASE_BUNDLE_URL?.trim() || manifest.bundle.url;
  let archiveToExtract = localFileArg;

  try {
    if (archiveToExtract) {
      if (!existsSync(archiveToExtract)) {
        console.error(`[bundle] Local bundle file not found: ${archiveToExtract}`);
        process.exit(1);
      }
      console.log(`[bundle] Using local bundle archive: ${archiveToExtract}`);
    } else {
      if (!bundleUrl) {
        console.error("[bundle] No bundle URL configured in release-manifest.json or MAAKROP_RELEASE_BUNDLE_URL.");
        process.exit(1);
      }
      console.log(`[bundle] Downloading Maakrop v${manifest.version} standalone bundle from ${bundleUrl}...`);
      const t0 = Date.now();
      await downloadToFile(bundleUrl, tmpArchive);
      const sizeMb = (statSync(tmpArchive).size / 1048576).toFixed(1);
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[bundle] Downloaded ${sizeMb} MB in ${sec}s.`);
      archiveToExtract = tmpArchive;
    }

    // 4. Verify SHA-256 digest before extracting
    const actualSha = await sha256File(archiveToExtract);
    if (actualSha !== expectedSha) {
      console.error(
        `[bundle] SHA-256 verification FAILED!\n  Expected: ${expectedSha}\n  Actual:   ${actualSha}\n  Aborting extraction.`,
      );
      process.exit(1);
    }
    console.log(`[bundle] ✓ Verified SHA-256 (${actualSha.slice(0, 16)}...)`);

    // 5. Clean previous extracted runtime directories (never touches .env, storage/, .git/)
    for (const rel of [".next", "node_modules", "drizzle", "public", "assets", "skills", "server.js"]) {
      rmSync(join(rootDir, rel), { recursive: true, force: true });
    }

    // 6. Extract archive using system `tar` (built into Linux, macOS, and Windows 10/11)
    console.log("[bundle] Extracting verified Next.js standalone bundle...");
    const tarRes = spawnSync("tar", ["-xzf", archiveToExtract, "-C", rootDir], { stdio: "inherit" });
    // Note: on Windows, `tar.exe` may exit non-zero only because it skips POSIX symlinks in `.next/node_modules`;
    // verify `server.js` and `node_modules/next` exist before failing.
    if ((tarRes.status ?? 1) !== 0 && (!existsSync(join(rootDir, "server.js")) || !existsSync(join(rootDir, "node_modules", "next")))) {
      console.error(`[bundle] tar extraction failed with exit code ${tarRes.status ?? 1}.`);
      process.exit(tarRes.status ?? 1);
    }

    // 7. Materialize any Windows-skipped Turbopack symlinks + adapt `sharp` on non-Linux-x64 hosts
    const linked = linkTurbopackExternals(rootDir, manifest.turbopackExternals);
    if (linked > 0) {
      console.log(`[bundle] ✓ Linked ${linked} Windows-compatible Turbopack external package(s).`);
    }
    ensurePlatformSharpBinary(rootDir, manifest.sharpVersion);

    // 8. Record extracted state for fast subsequent startups/deploys
    writeFileSync(
      join(rootDir, STATE_FILE),
      JSON.stringify(
        {
          version: manifest.version,
          sha256: expectedSha,
          platform: `${process.platform}-${process.arch}`,
          extractedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    console.log(`[bundle] ✓ Maakrop v${manifest.version} standalone runtime ready.`);
  } finally {
    if (existsSync(tmpArchive)) {
      rmSync(tmpArchive, { force: true });
    }
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch((err) => {
    console.error("[bundle] Fatal error:", err);
    process.exit(1);
  });
}
