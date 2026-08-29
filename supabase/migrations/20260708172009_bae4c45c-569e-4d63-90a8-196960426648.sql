
CREATE OR REPLACE FUNCTION public.normalize_org_name(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH x AS (SELECT lower(coalesce(s, '')) AS v),
  a AS (SELECT replace(v, '&', ' and ') AS v FROM x),
  b AS (SELECT regexp_replace(v, '[.,''`"()\[\]/\\]', ' ', 'g') AS v FROM a),
  c AS (SELECT regexp_replace(v, '\s+', ' ', 'g') AS v FROM b),
  d AS (SELECT btrim(v) AS v FROM c),
  e AS (
    SELECT regexp_replace(
      v,
      '\s+(ltd|limited|plc|llp|llc|inc|incorporated|corp|corporation|co|company|gmbh|sa|ag|bv|nv|pty|pte)\.?$',
      '',
      'i'
    ) AS v FROM d
  )
  SELECT NULLIF(btrim(v), '') FROM e;
$$;

CREATE TABLE IF NOT EXISTS public.org_name_aliases (
  variant_normalized text PRIMARY KEY,
  canonical text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.org_name_aliases TO authenticated;
GRANT SELECT ON public.org_name_aliases TO anon;
GRANT ALL ON public.org_name_aliases TO service_role;

ALTER TABLE public.org_name_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aliases_read_all" ON public.org_name_aliases;
CREATE POLICY "aliases_read_all" ON public.org_name_aliases FOR SELECT USING (true);

DROP TRIGGER IF EXISTS trg_org_name_aliases_updated_at ON public.org_name_aliases;
CREATE TRIGGER trg_org_name_aliases_updated_at
  BEFORE UPDATE ON public.org_name_aliases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.canonicalize_org_name(s text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH n AS (SELECT public.normalize_org_name(s) AS v)
  SELECT COALESCE(
    (SELECT a.canonical FROM public.org_name_aliases a, n WHERE a.variant_normalized = n.v),
    (SELECT v FROM n)
  );
$$;

INSERT INTO public.org_name_aliases (variant_normalized, canonical, note) VALUES
  ('dwp', 'department for work and pensions', 'DWP acronym'),
  ('department of work and pensions', 'department for work and pensions', 'of -> for'),
  ('dept for work and pensions', 'department for work and pensions', 'dept abbreviation'),
  ('dept of work and pensions', 'department for work and pensions', 'dept abbreviation'),
  ('the department for work and pensions', 'department for work and pensions', 'leading the'),
  ('department for work pensions', 'department for work and pensions', 'missing and')
ON CONFLICT (variant_normalized) DO UPDATE SET canonical = EXCLUDED.canonical;

ALTER TABLE public.buyers    ADD COLUMN IF NOT EXISTS name_canonical text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS name_canonical text;
ALTER TABLE public.notices   ADD COLUMN IF NOT EXISTS buyer_canonical text;
ALTER TABLE public.awards    ADD COLUMN IF NOT EXISTS buyer_name_canonical text;
ALTER TABLE public.awards    ADD COLUMN IF NOT EXISTS supplier_name_canonical text;

CREATE OR REPLACE FUNCTION public.buyers_set_canonical()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN NEW.name_canonical := public.canonicalize_org_name(NEW.name); RETURN NEW; END $fn$;

CREATE OR REPLACE FUNCTION public.suppliers_set_canonical()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN NEW.name_canonical := public.canonicalize_org_name(NEW.name); RETURN NEW; END $fn$;

CREATE OR REPLACE FUNCTION public.notices_set_buyer_canonical()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN NEW.buyer_canonical := public.canonicalize_org_name(NEW.buyer); RETURN NEW; END $fn$;

CREATE OR REPLACE FUNCTION public.awards_set_canonicals()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  NEW.buyer_name_canonical    := public.canonicalize_org_name(NEW.buyer_name);
  NEW.supplier_name_canonical := public.canonicalize_org_name(NEW.supplier_name);
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_buyers_canonical ON public.buyers;
CREATE TRIGGER trg_buyers_canonical BEFORE INSERT OR UPDATE OF name ON public.buyers
  FOR EACH ROW EXECUTE FUNCTION public.buyers_set_canonical();

DROP TRIGGER IF EXISTS trg_suppliers_canonical ON public.suppliers;
CREATE TRIGGER trg_suppliers_canonical BEFORE INSERT OR UPDATE OF name ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.suppliers_set_canonical();

DROP TRIGGER IF EXISTS trg_notices_buyer_canonical ON public.notices;
CREATE TRIGGER trg_notices_buyer_canonical BEFORE INSERT OR UPDATE OF buyer ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public.notices_set_buyer_canonical();

DROP TRIGGER IF EXISTS trg_awards_canonicals ON public.awards;
CREATE TRIGGER trg_awards_canonicals BEFORE INSERT OR UPDATE OF buyer_name, supplier_name ON public.awards
  FOR EACH ROW EXECUTE FUNCTION public.awards_set_canonicals();

UPDATE public.buyers    SET name_canonical = public.canonicalize_org_name(name)
  WHERE name_canonical IS DISTINCT FROM public.canonicalize_org_name(name);
UPDATE public.suppliers SET name_canonical = public.canonicalize_org_name(name)
  WHERE name_canonical IS DISTINCT FROM public.canonicalize_org_name(name);
UPDATE public.notices   SET buyer_canonical = public.canonicalize_org_name(buyer)
  WHERE buyer_canonical IS DISTINCT FROM public.canonicalize_org_name(buyer);
UPDATE public.awards    SET buyer_name_canonical    = public.canonicalize_org_name(buyer_name),
                            supplier_name_canonical = public.canonicalize_org_name(supplier_name)
  WHERE buyer_name_canonical    IS DISTINCT FROM public.canonicalize_org_name(buyer_name)
     OR supplier_name_canonical IS DISTINCT FROM public.canonicalize_org_name(supplier_name);

CREATE INDEX IF NOT EXISTS idx_buyers_name_canonical    ON public.buyers    (name_canonical);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_canonical ON public.suppliers (name_canonical);
CREATE INDEX IF NOT EXISTS idx_notices_buyer_canonical  ON public.notices   (buyer_canonical);
CREATE INDEX IF NOT EXISTS idx_awards_buyer_canonical    ON public.awards    (buyer_name_canonical);
CREATE INDEX IF NOT EXISTS idx_awards_supplier_canonical ON public.awards    (supplier_name_canonical);

CREATE INDEX IF NOT EXISTS idx_buyers_name_canonical_trgm    ON public.buyers    USING gin (name_canonical gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_canonical_trgm ON public.suppliers USING gin (name_canonical gin_trgm_ops);
