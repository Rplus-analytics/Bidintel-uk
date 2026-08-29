
-- 1. Add organisation_id to saved_searches
ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES public.organisations(id) ON DELETE CASCADE;

-- Backfill existing rows to the first existing organisation (single-tenant today)
UPDATE public.saved_searches
SET organisation_id = (SELECT id FROM public.organisations ORDER BY created_at ASC NULLS LAST LIMIT 1)
WHERE organisation_id IS NULL;

ALTER TABLE public.saved_searches
  ALTER COLUMN organisation_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_searches_org ON public.saved_searches(organisation_id);

-- 2. Scope is_org_admin() to the current organisation
CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid()
      AND organisation_id = public.current_org_id()
      AND role = 'admin'
  )
$$;

-- 3. Rewrite saved_searches policy to be organisation-scoped
DROP POLICY IF EXISTS "Admins manage saved_searches" ON public.saved_searches;

CREATE POLICY "Admins manage org saved_searches"
ON public.saved_searches
FOR ALL
TO authenticated
USING (
  organisation_id = public.current_org_id()
  AND public.is_org_admin()
)
WITH CHECK (
  organisation_id = public.current_org_id()
  AND public.is_org_admin()
);
