-- ============================================================================
-- 05-grants.sql — least-privilege lock-down. Run before PostgREST is reachable.
-- ============================================================================

-- auth shims must be callable by the roles RLS policies run as, or every policy
-- errors with "permission denied for schema auth" rather than filtering.
GRANT USAGE ON SCHEMA auth TO authenticated, anon, bidintel_api, bidintel_authenticator;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO authenticated, anon;

GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- Table access. RLS decides the rows; these decide the verbs.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Functions: default is EXECUTE to PUBLIC, which would expose every helper --
-- including SECURITY DEFINER ones -- to unauthenticated callers. Revoke, then
-- grant back only what the app needs.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_tenders_hybrid(vector,text,integer,timestamptz,text,text[],text[],double precision,double precision,double precision,text[],text[],boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_id(), public.is_org_admin() TO authenticated;

-- anon is pre-login only: it must never reach user data.
REVOKE ALL ON public.profiles, public.memberships, public.organisations,
              public.org_match_profiles, public.saved_bids, public.saved_searches,
              public.companies, public.user_actions FROM anon;

-- ---------------------------------------------------------------------------
-- Restore EXECUTE on EXTENSION-OWNED functions
-- ---------------------------------------------------------------------------
--
-- FOUND BY A FAILING SEARCH, not by review:
--
--   semantic-search -> search_tenders_hybrid -> ERROR: permission denied for
--   function cosine_distance
--
-- `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC` above is
-- indiscriminate, and pgvector (118 functions) and pg_trgm (31) are both
-- installed into `public` on this database rather than into `extensions`. The
-- revoke therefore stripped the operator support functions behind `<=>`,
-- `cosine_distance` and `similarity`.
--
-- Re-granting them to PUBLIC is the correct scope, not a concession. These are
-- pure functions over values the caller already holds: they read no table and
-- cannot leak a row. Withholding them does not protect any data — it only
-- breaks every index scan and operator that uses them, which is exactly what
-- happened.
--
-- Generated from pg_depend so it stays correct if an extension is upgraded and
-- adds functions.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_depend d
    JOIN pg_extension e ON e.oid = d.refobjid AND d.refclassid = 'pg_extension'::regclass
    JOIN pg_proc p      ON p.oid = d.objid     AND d.classid    = 'pg_proc'::regclass
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', r.sig);
  END LOOP;
END
$$;
