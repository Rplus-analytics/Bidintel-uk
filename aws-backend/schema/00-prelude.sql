-- ============================================================================
-- 00-prelude.sql — Supabase furniture that the migrations assume exists.
-- Target: database `bidintel` on bidintel-1 (plain RDS PostgreSQL 18.3).
-- Run as the master user. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions. Neither pgvector nor pg_trgm needs shared_preload_libraries,
-- so NO parameter group change and NO reboot are required.
-- ---------------------------------------------------------------------------
-- schema.sql installs its own extensions with explicit target schemas
-- (vector+pg_trgm -> public, pgcrypto+uuid-ossp+pg_stat_statements -> extensions).
-- The prelude only creates the schemas they need, so the dump applies unchanged.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS vault;

-- ---------------------------------------------------------------------------
-- Supabase role stubs. NOLOGIN: they exist only so GRANT/ALTER OWNER
-- statements in the migrations resolve. None can be used to connect.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','authenticator',
                           'supabase_admin','supabase_auth_admin',
                           'supabase_storage_admin','dashboard_user','pgbouncer']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- auth schema + a minimal auth.users.
--
-- The migrations declare FKs to auth.users(id) on profiles.id,
-- memberships.user_id and saved_bids.saved_by. Rather than strip those FKs
-- during replay, auth.users is created as a real table and populated from the
-- export's auth.users id+email. Identity then still lives in `profiles`, and
-- auth.users becomes a thin compatibility shell that can be dropped after the
-- FKs are re-pointed at profiles post-launch.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- auth.uid() / auth.role() / auth.jwt() — GUC-backed shims.
--
-- PostgREST sets request.jwt.claims from the verified JWT. The Cognito
-- pre-token-generation trigger puts the user's EXISTING profiles.id into the
-- `app_user_id` claim, so auth.uid() returns the same value it did on Lovable
-- Cloud and no foreign key has to be rewritten.
--
-- Reads `app_user_id` first, falling back to `sub` so a plain Cognito token
-- (or a direct psql session setting app.user_id) still resolves.
--
-- Deliberately NOT SECURITY DEFINER: these read settings rather than querying
-- memberships, so the RLS recursion the Supabase originals worked around does
-- not arise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb,
                    '{}'::jsonb)
  $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(
             nullif(auth.jwt() ->> 'app_user_id', ''),
             nullif(auth.jwt() ->> 'sub', ''),
             nullif(current_setting('app.user_id', true), '')
           )::uuid
  $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(
             nullif(auth.jwt() ->> 'role', ''),
             nullif(current_setting('app.role', true), ''),
             'anon'
           )
  $$;

-- ---------------------------------------------------------------------------
-- cron stub.
--
-- Several migrations call cron.schedule(). pg_cron is NOT installed (it needs
-- shared_preload_libraries, and the only SQL-only job — the
-- tenders_cf_full_mat refresh — is read by nothing). These no-op stubs let the
-- migrations replay unchanged instead of being edited.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS cron;

CREATE OR REPLACE FUNCTION cron.schedule(text, text, text) RETURNS bigint
  LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE OR REPLACE FUNCTION cron.unschedule(text) RETURNS boolean
  LANGUAGE sql AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION cron.unschedule(bigint) RETURNS boolean
  LANGUAGE sql AS $$ SELECT true $$;

-- ---------------------------------------------------------------------------
-- net stub — pg_net is unavailable on RDS. The cron jobs used net.http_post to
-- invoke edge functions; EventBridge replaces that entirely.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS net;

CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb,
                                         params jsonb DEFAULT '{}'::jsonb,
                                         headers jsonb DEFAULT '{}'::jsonb,
                                         timeout_milliseconds int DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
