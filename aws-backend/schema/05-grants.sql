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
