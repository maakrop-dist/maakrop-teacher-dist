-- Maakrop Self-Hosted School Edition — PostgreSQL Role & Extension Bootstrap
-- Run once as database superuser / owner BEFORE running migrations on a fresh PostgreSQL server.
-- Replace the placeholder passwords below with strong random passwords before executing.

-- 1. Required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Optional for AI semantic search (skip safely if pgvector is not installed on the host)
-- CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Application RLS role (NO BYPASSRLS — enforces Postgres Row-Level Security on every tenant query)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls') THEN
    CREATE ROLE app_rls LOGIN PASSWORD 'CHANGE_ME_APP_RLS_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- 3. Service role (BYPASSRLS — used strictly for auth bootstrap, platform settings, and cron/setup paths)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maakrop_service') THEN
    CREATE ROLE maakrop_service LOGIN PASSWORD 'CHANGE_ME_SERVICE_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END
$$;

-- 4. Base schema grants (table-specific least-privilege grants are enforced by migrations)
GRANT USAGE ON SCHEMA public TO app_rls, maakrop_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rls, maakrop_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rls, maakrop_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rls, maakrop_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_rls, maakrop_service;

-- 5. Verify both roles exist with the expected RLS flags (expected: app_rls = false, maakrop_service = true)
SELECT rolname, rolcanlogin, rolbypassrls
FROM pg_roles
WHERE rolname IN ('app_rls', 'maakrop_service')
ORDER BY rolname;
