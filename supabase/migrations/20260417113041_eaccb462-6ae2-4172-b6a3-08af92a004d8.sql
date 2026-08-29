-- Enums
CREATE TYPE public.org_role AS ENUM ('admin', 'member');
CREATE TYPE public.bid_status AS ENUM ('selected', 'created', 'submitted', 'won', 'lost', 'withdrawn');

-- Organisations
CREATE TABLE public.organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Memberships (one org per user for now)
CREATE TABLE public.memberships (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memberships_org ON public.memberships(organisation_id);

-- Saved bids
CREATE TABLE public.saved_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  saved_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  buyer TEXT,
  value NUMERIC,
  deadline_date TIMESTAMPTZ,
  published_date TIMESTAMPTZ,
  source_url TEXT,
  description TEXT,
  status public.bid_status NOT NULL DEFAULT 'selected',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, external_id, source)
);
CREATE INDEX idx_saved_bids_org ON public.saved_bids(organisation_id);
CREATE INDEX idx_saved_bids_status ON public.saved_bids(status);

-- updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_memberships_updated BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_saved_bids_updated BEFORE UPDATE ON public.saved_bids
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Security definer helpers (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organisation_id FROM public.memberships WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships WHERE user_id = auth.uid() AND role = 'admin')
$$;

-- Enable RLS
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_bids ENABLE ROW LEVEL SECURITY;

-- Organisations
CREATE POLICY "Members view own org" ON public.organisations
  FOR SELECT TO authenticated USING (id = public.current_org_id());
CREATE POLICY "Admins update own org" ON public.organisations
  FOR UPDATE TO authenticated USING (id = public.current_org_id() AND public.is_org_admin());

-- Profiles
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Admins view org profiles" ON public.profiles
  FOR SELECT TO authenticated USING (
    public.is_org_admin() AND id IN (
      SELECT user_id FROM public.memberships WHERE organisation_id = public.current_org_id()
    )
  );
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Memberships
CREATE POLICY "Users view memberships in their org" ON public.memberships
  FOR SELECT TO authenticated USING (organisation_id = public.current_org_id());
CREATE POLICY "Admins insert memberships in their org" ON public.memberships
  FOR INSERT TO authenticated WITH CHECK (organisation_id = public.current_org_id() AND public.is_org_admin());
CREATE POLICY "Admins update memberships in their org" ON public.memberships
  FOR UPDATE TO authenticated USING (organisation_id = public.current_org_id() AND public.is_org_admin());
CREATE POLICY "Admins delete memberships in their org" ON public.memberships
  FOR DELETE TO authenticated USING (organisation_id = public.current_org_id() AND public.is_org_admin());

-- Saved bids
CREATE POLICY "Members view org bids" ON public.saved_bids
  FOR SELECT TO authenticated USING (organisation_id = public.current_org_id());
CREATE POLICY "Members insert org bids" ON public.saved_bids
  FOR INSERT TO authenticated WITH CHECK (organisation_id = public.current_org_id() AND saved_by = auth.uid());
CREATE POLICY "Saver or admin update bids" ON public.saved_bids
  FOR UPDATE TO authenticated USING (
    organisation_id = public.current_org_id() AND (saved_by = auth.uid() OR public.is_org_admin())
  );
CREATE POLICY "Saver or admin delete bids" ON public.saved_bids
  FOR DELETE TO authenticated USING (
    organisation_id = public.current_org_id() AND (saved_by = auth.uid() OR public.is_org_admin())
  );