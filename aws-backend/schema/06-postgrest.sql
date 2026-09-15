-- ===========================================================================
-- PostgREST support objects
-- ===========================================================================
--
-- Run against the `bidintel` database as the owner.

-- ---------------------------------------------------------------------------
-- Issuer validation
-- ---------------------------------------------------------------------------
--
-- PostgREST validates a JWT's SIGNATURE (against the JWKS it is configured
-- with), its EXPIRY, and its AUDIENCE (jwt-aud). It has no setting for the
-- ISSUER claim.
--
-- In practice the signature check already ties a token to one issuer: only the
-- Cognito pool holding the private key can mint a token this JWKS verifies. But
-- "in practice" is not the same as "checked", and if the JWKS is ever widened —
-- a second pool, a migration, a copy-paste — nothing else would catch it.
--
-- So the check is done where PostgREST always gives us a hook: db-pre-request,
-- which runs after SET ROLE and before the query, inside the same transaction.
-- A RAISE here aborts the request.
--
-- Enforcing it in the DATABASE rather than the proxy is strictly stronger: it
-- applies to every client of this database that sets request.jwt.claims, not
-- only to traffic that happened to arrive through PostgREST.

CREATE OR REPLACE FUNCTION public.check_jwt_issuer()
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  iss    text;
BEGIN
  BEGIN
    claims := current_setting('request.jwt.claims', true)::jsonb;
  EXCEPTION WHEN others THEN
    -- Unparseable claims are treated as anonymous: the request proceeds as
    -- `anon`, which is revoked from every user table and therefore reaches
    -- nothing. Fails closed without failing loudly.
    RETURN;
  END;

  -- WHAT POSTGREST ACTUALLY SETS, measured rather than assumed:
  --
  --   no token presented  ->  {"role":"anon"}
  --   valid token         ->  the full verified claim set, always incl. `iss`
  --
  -- It is NOT NULL and NOT `{}` for an anonymous request, which is what the
  -- first two versions of this function assumed. Both rejected every
  -- unauthenticated read with 401 "invalid token issuer", because
  -- (NULL IS DISTINCT FROM '<issuer>') is TRUE when `iss` is absent.
  --
  -- That matters: the app issues reads while the session is still being
  -- restored from localStorage, and those must return empty (anon can see
  -- nothing), not raise.
  --
  -- So the presence of `iss` is what distinguishes an authenticated request.
  -- Keying off it is safe because PostgREST has ALREADY verified the signature
  -- against the Cognito JWKS by the time this runs — a token that failed
  -- verification never reaches this function, it is rejected with 401 first.
  -- Anything arriving here without `iss` therefore had no token at all.
  IF claims IS NULL OR NOT (claims ? 'iss') THEN
    RETURN;
  END IF;

  iss := claims ->> 'iss';

  IF iss IS DISTINCT FROM 'https://cognito-idp.eu-north-1.amazonaws.com/eu-north-1_9LKk8RR6t' THEN
    RAISE EXCEPTION 'invalid token issuer'
      USING ERRCODE = '42501',   -- insufficient_privilege -> PostgREST returns 403
            HINT    = 'The token was not issued by the BidIntel user pool.';
  END IF;
END;
$$;

-- Both roles PostgREST can switch to must be able to run it, or every request
-- fails with "permission denied for function check_jwt_issuer".
GRANT EXECUTE ON FUNCTION public.check_jwt_issuer() TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- Schema reload notification
-- ---------------------------------------------------------------------------
-- PostgREST caches the schema on boot. This lets a DDL change be picked up
-- without restarting the service: NOTIFY pgrst, 'reload schema';
