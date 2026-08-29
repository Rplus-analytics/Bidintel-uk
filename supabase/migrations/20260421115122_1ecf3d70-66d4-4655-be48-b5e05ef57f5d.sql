
-- Org-level match profile drives Signal Score
CREATE TABLE public.org_match_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL UNIQUE,
  keywords text[] NOT NULL DEFAULT '{}',
  sectors text[] NOT NULL DEFAULT '{}',
  regions text[] NOT NULL DEFAULT '{}',
  cpv_prefixes text[] NOT NULL DEFAULT '{}',
  min_value numeric,
  max_value numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_match_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view own org profile"
ON public.org_match_profiles FOR SELECT TO authenticated
USING (organisation_id = current_org_id());

CREATE POLICY "Admins insert org profile"
ON public.org_match_profiles FOR INSERT TO authenticated
WITH CHECK (organisation_id = current_org_id() AND is_org_admin());

CREATE POLICY "Admins update org profile"
ON public.org_match_profiles FOR UPDATE TO authenticated
USING (organisation_id = current_org_id() AND is_org_admin());

CREATE POLICY "Admins delete org profile"
ON public.org_match_profiles FOR DELETE TO authenticated
USING (organisation_id = current_org_id() AND is_org_admin());

CREATE TRIGGER set_org_match_profiles_updated_at
BEFORE UPDATE ON public.org_match_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
