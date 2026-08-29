CREATE TABLE IF NOT EXISTS public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  filters jsonb not null,
  email_recipients text[] not null,
  active boolean default true,
  created_at timestamptz default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_searches TO authenticated;
GRANT ALL ON public.saved_searches TO service_role;
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read saved_searches" ON public.saved_searches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage saved_searches" ON public.saved_searches FOR ALL TO authenticated USING (public.is_org_admin()) WITH CHECK (public.is_org_admin());