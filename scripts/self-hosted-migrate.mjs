#!/usr/bin/env node
/**
 * Part 98 — Idempotent Self-Hosted PostgreSQL Migration Runner (No Docker Required)
 * -----------------------------------------------------------------------------
 * Works identically on Vercel (`buildCommand`) and School Node.js Servers.
 * Reads `drizzle/meta/_journal.json`, tracks applied tags in `drizzle.__drizzle_migrations`,
 * and executes each pending SQL migration inside a transaction.
 *
 * Env: `DATABASE_URL_UNPOOLED` (preferred for DDL) or `DATABASE_URL_SERVICE` or `DATABASE_URL`.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

const rootDir = resolve(process.cwd());
const drizzleDir = join(rootDir, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");
const isOptional = process.argv.includes("--optional");
const MIGRATION_ADVISORY_LOCK_KEY = 88981109;

const connectionString = (
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL_SERVICE ||
  process.env.DATABASE_URL ||
  ""
).trim();

if (!connectionString) {
  if (isOptional) {
    console.log("[migrate] DATABASE_URL is not set yet — skipping auto-migration (will run automatically when /setup opens).");
    process.exit(0);
  }
  console.error("[migrate] Missing DATABASE_URL / DATABASE_URL_UNPOOLED.");
  process.exit(1);
}

if (!existsSync(journalPath)) {
  console.error(`[migrate] Drizzle journal not found at ${journalPath}`);
  process.exit(1);
}

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const entries = Array.isArray(journal.entries) ? journal.entries : [];

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_ADVISORY_LOCK_KEY]);
  await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  // If public schema was partially wiped (core tables account, auth_user, school are ALL missing),
  // clear stale migration history + orphaned empty enums/tables so 0000..0260 replay cleanly from scratch.
  const coreCheck = await client.query(
    `SELECT to_regclass('public.account') IS NOT NULL AS has_account,
            to_regclass('public.auth_user') IS NOT NULL AS has_auth_user,
            to_regclass('public.school') IS NOT NULL AS has_school`,
  );
  if (!coreCheck.rows[0]?.has_account && !coreCheck.rows[0]?.has_auth_user && !coreCheck.rows[0]?.has_school) {
    console.log("[migrate] Core tables missing — resetting stale migration history & orphaned empty types/tables...");
    await client.query(`TRUNCATE TABLE "drizzle"."__drizzle_migrations"`);
    await client.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
          EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
        END LOOP;
        FOR r IN
          SELECT t.typname
          FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typtype = 'e'
        LOOP
          EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
        END LOOP;
        FOR r IN
          SELECT p.oid::regprocedure::text AS fn
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prokind = 'f' AND pg_get_userbyid(p.proowner) = current_user
        LOOP
          EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.fn);
        END LOOP;
      END $$;
    `);
  }

  const appliedRes = await client.query(`SELECT hash FROM "drizzle"."__drizzle_migrations"`);
  const appliedHashes = new Set(appliedRes.rows.map((r) => String(r.hash)));

  const pendingEntries = entries.filter((entry) => {
    const sqlPath = join(drizzleDir, `${entry.tag}.sql`);
    if (!existsSync(sqlPath)) return false;
    const sqlText = readFileSync(sqlPath, "utf8");
    const contentHash = createHash("sha256").update(sqlText).digest("hex");
    const tagHash = createHash("sha256").update(`tag:${entry.tag}`).digest("hex");
    return !appliedHashes.has(contentHash) && !appliedHashes.has(tagHash);
  });

  // 1. Ensure pre-journal legacy enums exist idempotently before 0000..0263
  const selfHostedSqlDir = join(drizzleDir, "self-hosted");
  const legacyEnumsPath = join(selfHostedSqlDir, "legacy-enums.sql");
  if (pendingEntries.length > 0 && existsSync(legacyEnumsPath)) {
    console.log("[migrate] Applying idempotent legacy enums...");
    await client.query(readFileSync(legacyEnumsPath, "utf8"));
  }

  const legacyTablesPath = join(selfHostedSqlDir, "legacy-tables.sql");
  const rlsPoliciesPath = join(selfHostedSqlDir, "rls-policies.sql");
  let legacyTablesApplied = false;
  let rlsPoliciesApplied = false;

  let appliedCount = 0;
  for (const entry of pendingEntries) {
    // 2. Ensure pre-journal legacy tables exist once base enums (0000..0023) are present
    if (!legacyTablesApplied && entry.tag >= "0024" && existsSync(legacyTablesPath)) {
      console.log("[migrate] Applying idempotent legacy tables...");
      await client.query(readFileSync(legacyTablesPath, "utf8"));
      legacyTablesApplied = true;
    }
    // 3. Ensure base RLS policies (from db/rls/policies.sql) exist before 0212 ALTER POLICY
    if (!rlsPoliciesApplied && entry.tag >= "0212" && existsSync(rlsPoliciesPath)) {
      console.log("[migrate] Applying base RLS policies...");
      await client.query(readFileSync(rlsPoliciesPath, "utf8"));
      rlsPoliciesApplied = true;
    }

    const sqlPath = join(drizzleDir, `${entry.tag}.sql`);
    const sqlText = readFileSync(sqlPath, "utf8");
    const contentHash = createHash("sha256").update(sqlText).digest("hex");
    const tagHash = createHash("sha256").update(`tag:${entry.tag}`).digest("hex");

    console.log(`[migrate] Applying ${entry.tag}...`);
    const cleanSql = sqlText
      .replaceAll("--> statement-breakpoint", "\n")
      .replace(/\bCREATE\s+FUNCTION\b/gi, "CREATE OR REPLACE FUNCTION");
    const needsNoTx = /\bCONCURRENTLY\b/i.test(cleanSql);

    try {
      if (needsNoTx) {
        const statements = sqlText
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const stmt of statements) {
          await client.query(stmt);
        }
        await client.query(`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
          tagHash,
          Number(entry.when) || Date.now(),
        ]);
      } else {
        await client.query("BEGIN");
        try {
          await client.query(cleanSql);
          await client.query(`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
            tagHash,
            Number(entry.when) || Date.now(),
          ]);
          await client.query("COMMIT");
        } catch (innerErr) {
          await client.query("ROLLBACK").catch(() => {});
          throw innerErr;
        }
      }
      appliedHashes.add(tagHash);
      appliedHashes.add(contentHash);
      appliedCount++;
    } catch (err) {
      console.error(`[migrate] Failed on ${entry.tag}:`, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  // Apply idempotent legacy foreign keys & indexes after all tables exist
  const legacyFksPath = join(selfHostedSqlDir, "legacy-fks.sql");
  if (appliedCount > 0 && existsSync(legacyFksPath)) {
    console.log("[migrate] Applying idempotent legacy foreign keys & indexes...");
    await client.query(readFileSync(legacyFksPath, "utf8"));
  }

  // Always reconcile enum/nullability parity + runtime grants (runs even when 0 new migrations)
  console.log("[migrate] Reconciling schema parity & runtime grants for maakrop_service and app_rls...");
  await client.query(`ALTER TYPE "public"."membership_status" ADD VALUE IF NOT EXISTS 'suspended'`);
  await client.query(`ALTER TYPE "public"."enrollment_change_type" ADD VALUE IF NOT EXISTS 'promote'`);
  await client.query(`
    DO $$
    BEGIN
      IF to_regclass('public.combined_group') IS NOT NULL THEN
        ALTER TABLE "public"."combined_group" ALTER COLUMN "workspace_id" DROP NOT NULL;
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    DECLARE r record;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maakrop_service') THEN
        GRANT USAGE ON SCHEMA public TO maakrop_service;
        GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO maakrop_service;
        GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO maakrop_service;
        FOR r IN
          SELECT p.oid::regprocedure::text AS fn
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = current_user
        LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO maakrop_service', r.fn);
        END LOOP;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO maakrop_service;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO maakrop_service;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO maakrop_service;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls') THEN
        GRANT USAGE ON SCHEMA public TO app_rls;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rls;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rls;
        FOR r IN
          SELECT p.oid::regprocedure::text AS fn
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname LIKE 'app\\_%' AND pg_get_userbyid(p.proowner) = current_user
        LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_rls', r.fn);
        END LOOP;
      END IF;
    END $$;
  `);

  console.log(`[migrate] Complete — ${appliedCount} new migration(s) applied (${appliedHashes.size} total).`);
} finally {
  await client.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_ADVISORY_LOCK_KEY]).catch(() => {});
  await client.end();
}
