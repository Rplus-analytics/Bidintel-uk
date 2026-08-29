CREATE TABLE public.tenders_cf_recent AS
SELECT * FROM public.tenders_cf_full WHERE false;

CREATE INDEX tenders_cf_recent_published_date_idx ON public.tenders_cf_recent (published_date);
CREATE INDEX tenders_cf_recent_region_idx ON public.tenders_cf_recent (region);
CREATE INDEX tenders_cf_recent_ocid_idx ON public.tenders_cf_recent (ocid);
CREATE INDEX tenders_cf_recent_sme_idx ON public.tenders_cf_recent (suitable_for_sme);

GRANT SELECT ON public.tenders_cf_recent TO authenticated;
GRANT ALL ON public.tenders_cf_recent TO service_role;

ALTER TABLE public.tenders_cf_recent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read tenders_cf_recent"
  ON public.tenders_cf_recent
  FOR SELECT
  TO authenticated
  USING (true);