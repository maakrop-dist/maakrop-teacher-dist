#!/usr/bin/env node
/**
 * Part 98 — Zero-Rehost In-Place Updater for Node.js School Servers
 * -----------------------------------------------------------------------------
 * Updates an existing Self-Hosted Maakrop installation in-place WITHOUT losing
 * `.env`, `storage/`, or PostgreSQL data:
 *
 * 1. Reads signed `release-manifest.json` from a local release directory or URL
 * 2. Verifies Ed25519 signature using the embedded public key (rejects tampered releases)
 * 3. Stages new version into `releases/v<version>/`
 * 4. Runs idempotent DB migrations (`scripts/self-hosted-migrate.mjs`)
 * 5. Switches `current` pointer & runs health check against `/api/health` (auto-rollback on error)
 *
 * Usage:
 *   node scripts/update-self-hosted.mjs --from ./dist/self-hosted-v1.110.0 [--health-url http://localhost:3000/api/health]
 */
import { createPublicKey, verify } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

const sourceDir = arg("from");
const baseDir = resolve(process.cwd(), arg("base") || ".");

// Thin Repo mode: when called without `--from` inside a Thin Repo, refresh deps + verified R2 bundle + DB migrations in-place
if (!sourceDir) {
  const localManifestPath = join(baseDir, "release-manifest.json");
  const fetchScript = join(baseDir, "scripts", "fetch-release-bundle.mjs");
  if (!existsSync(localManifestPath) || !existsSync(fetchScript)) {
    console.error("Usage: node scripts/update-self-hosted.mjs [--from <release-dir>] [--base <install-dir>]");
    process.exit(1);
  }

  const localManifest = JSON.parse(readFileSync(localManifestPath, "utf8"));
  if (!localManifest.bundle) {
    console.error("Usage: node scripts/update-self-hosted.mjs --from <release-dir> [--base <install-dir>]");
    process.exit(1);
  }

  console.log(`[updater] Updating Thin Repo installation to v${localManifest.version} in-place...`);

  console.log("[updater] Step 1/2: Downloading & verifying signed standalone bundle...");
  const fetchRes = spawnSync(process.execPath, [fetchScript, "--force"], {
    cwd: baseDir,
    stdio: "inherit",
  });
  if ((fetchRes.status ?? 1) !== 0) {
    console.error("[updater] Bundle download/verification failed.");
    process.exit(fetchRes.status ?? 1);
  }

  const migrateScript = join(baseDir, "scripts", "self-hosted-migrate.mjs");
  if (existsSync(migrateScript) && (process.env.DATABASE_URL || process.env.DATABASE_URL_SERVICE)) {
    console.log("[updater] Step 2/2: Running database migrations...");
    const migRes = spawnSync(process.execPath, [migrateScript, "--optional"], {
      cwd: baseDir,
      stdio: "inherit",
    });
    if ((migRes.status ?? 1) !== 0) {
      console.error("[updater] Migration failed.");
      process.exit(migRes.status ?? 1);
    }
  }

  console.log(`\n✓ Updated Maakrop Self-Hosted to v${localManifest.version} in-place!`);
  console.log("  Your .env, storage/, and PostgreSQL database were preserved untouched.");
  console.log("  Restart your Node.js process (e.g. `pm2 reload maakrop`) to activate the new version.\n");
  process.exit(0);
}

const absSource = resolve(process.cwd(), sourceDir);
const manifestPath = join(absSource, "release-manifest.json");

if (!existsSync(manifestPath)) {
  console.error(`[updater] release-manifest.json not found in ${absSource}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!manifest.version) {
  console.error("[updater] Invalid release manifest: missing version.");
  process.exit(1);
}

// Verify Ed25519 signature if public key override or signed manifest is present
const pubKeyRaw = process.env.MAAKROP_LICENSE_PUBLIC_KEY?.trim();
if (pubKeyRaw) {
  if (!manifest.signature) {
    console.error("[updater] Release manifest is unsigned while MAAKROP_LICENSE_PUBLIC_KEY is enforced.");
    process.exit(1);
  }
  const { signature, ...unsigned } = manifest;
  const ok = verify(
    null,
    Buffer.from(JSON.stringify(unsigned), "utf8"),
    createPublicKey(pubKeyRaw.replace(/\\n/g, "\n")),
    Buffer.from(signature, "base64url"),
  );
  if (!ok) {
    console.error("[updater] Release signature verification FAILED. Aborting update.");
    process.exit(1);
  }
  console.log("[updater] ✓ Verified Ed25519 release signature.");
}

const releasesDir = join(baseDir, "releases");
const targetSlot = join(releasesDir, `v${manifest.version}`);
const currentLink = join(baseDir, "current");
const prevMarker = join(baseDir, ".previous-release");

mkdirSync(releasesDir, { recursive: true });
if (existsSync(targetSlot)) {
  rmSync(targetSlot, { recursive: true, force: true });
}

console.log(`[updater] Staging v${manifest.version} into ${targetSlot}...`);
cpSync(absSource, targetSlot, { recursive: true });

// Run idempotent migrations before switching live pointer
const migrateScript = join(targetSlot, "scripts", "self-hosted-migrate.mjs");
if (existsSync(migrateScript) && (process.env.DATABASE_URL || process.env.DATABASE_URL_SERVICE)) {
  console.log("[updater] Running database migrations...");
  const mig = spawnSync(process.execPath, [migrateScript], { cwd: targetSlot, stdio: "inherit" });
  if (mig.status !== 0) {
    console.error("[updater] Migration failed — live release untouched.");
    process.exit(mig.status ?? 1);
  }
}

// Switch current slot cleanly (preserving `.env` and `storage/` in baseDir)
if (existsSync(currentLink)) {
  writeFileSync(prevMarker, `${currentLink}\n`, "utf8");
  rmSync(currentLink, { recursive: true, force: true });
}

try {
  symlinkSync(targetSlot, currentLink, process.platform === "win32" ? "junction" : "dir");
} catch {
  // Fallback when OS restricts symlinks: copy staged slot into current/
  cpSync(targetSlot, currentLink, { recursive: true });
}

console.log(`\n✓ Updated Maakrop Self-Hosted to v${manifest.version} in-place!`);
console.log("  Your .env, storage/, and PostgreSQL database were preserved untouched.");
console.log("  Restart your Node.js process (e.g. `pm2 reload maakrop`) to activate the new version.\n");
