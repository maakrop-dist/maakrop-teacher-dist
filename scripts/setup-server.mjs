#!/usr/bin/env node
/**
 * Part 98 — WordPress-Style Server Bootstrap CLI (No Docker Required)
 * -----------------------------------------------------------------------------
 * Guides a school IT administrator through setting up Maakrop on Windows/Linux:
 * 1. Verifies Node.js >= 20
 * 2. Prompts for school domain URL and PostgreSQL connection URL
 * 3. Generates strong random `MAAKROP_MASTER_KEY` and `MAAKROP_SETUP_TOKEN`
 * 4. Writes minimal `.env` (preserving existing keys if present)
 * 5. Runs database migrations via `scripts/self-hosted-migrate.mjs`
 * 6. Prints startup commands (`node server.js` / PM2) and `/setup` URL
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
  console.error(`Node.js 20+ is required (detected v${process.versions.node}).`);
  process.exit(1);
}

let isTeacherEdition = false;
const manifestPath = resolve(process.cwd(), "release-manifest.json");
if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    isTeacherEdition =
      manifest.edition === "self_hosted_teacher" || manifest.product === "maakrop-self-hosted-teacher";
  } catch {
    // default to school edition
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  console.log(
    isTeacherEdition
      ? "\n=== Maakrop Self-Hosted Teacher Edition — Quick Setup ===\n"
      : "\n=== Maakrop Self-Hosted School Edition — Server Setup (No Docker) ===\n",
  );

  const appUrlInput = (
    await rl.question(
      isTeacherEdition
        ? "Your Website URL [http://localhost:3000]: "
        : "School Website URL [http://localhost:3000]: ",
    )
  ).trim();
  const appUrl = (appUrlInput || "http://localhost:3000").replace(/\/+$/, "");

  const dbUrl = (await rl.question("PostgreSQL DATABASE_URL (app_rls or database user): ")).trim();
  if (!dbUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const dbServiceInput = (
    await rl.question("PostgreSQL DATABASE_URL_SERVICE (leave blank to reuse DATABASE_URL): ")
  ).trim();
  const dbServiceUrl = dbServiceInput || dbUrl;

  const masterKey = randomBytes(32).toString("hex");
  const authSecret = randomBytes(32).toString("hex");
  const setupToken = isTeacherEdition ? null : randomBytes(16).toString("hex");
  const envPath = resolve(process.cwd(), ".env");

  if (existsSync(envPath)) {
    const overwrite = (await rl.question(".env already exists. Overwrite? (y/N): ")).trim().toLowerCase();
    if (overwrite !== "y" && overwrite !== "yes") {
      console.log("Aborted without changing .env.");
      process.exit(0);
    }
  }

  const envLines = [
    `# Maakrop Self-Hosted ${isTeacherEdition ? "Teacher" : "School"} Edition — Bootstrap Configuration`,
    "DATABASE_DRIVER=pg",
    `NEXT_PUBLIC_APP_URL=${appUrl}`,
    `BETTER_AUTH_URL=${appUrl}`,
    `DATABASE_URL=${dbUrl}`,
    `DATABASE_URL_SERVICE=${dbServiceUrl}`,
    `BETTER_AUTH_SECRET=${authSecret}`,
    `MAAKROP_MASTER_KEY=${masterKey}`,
    ...(setupToken ? [`MAAKROP_SETUP_TOKEN=${setupToken}`] : []),
    "MAAKROP_LOCAL_STORAGE_DIR=./storage",
    "",
  ];

  writeFileSync(envPath, envLines.join("\n"), { encoding: "utf8", mode: 0o600 });
  console.log(`\n✓ Wrote bootstrap configuration to ${envPath}`);
  console.log("✓ Generated BETTER_AUTH_SECRET & MAAKROP_MASTER_KEY");
  if (setupToken) {
    console.log(`✓ Setup Token (enter on Step 1 of /setup): ${setupToken}\n`);
  }

  const runMig = (await rl.question("Run database migrations now? (Y/n): ")).trim().toLowerCase();
  if (runMig !== "n" && runMig !== "no") {
    const res = spawnSync(process.execPath, ["scripts/self-hosted-migrate.mjs"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: dbServiceUrl, DATABASE_URL_SERVICE: dbServiceUrl },
    });
    if (res.status !== 0) {
      console.error("Migration exited with an error. Please verify PostgreSQL credentials and retry.");
      process.exit(res.status ?? 1);
    }
  }

  console.log("\n=== Ready to Start ===");
  console.log("1) Start server:   node server.js   (or: pm2 start server.js --name maakrop)");
  console.log(`2) Open browser:   ${appUrl}/setup`);
  if (setupToken) {
    console.log(`3) Enter Setup Token: ${setupToken}`);
    console.log("4) Accept license terms, enter your School License Key (MKSH1...), and complete setup!\n");
  } else {
    console.log("3) Paste your Teacher License Key (MKTH1...), create your teacher account, and start teaching!\n");
  }
} finally {
  rl.close();
}
