CREATE TABLE IF NOT EXISTS public.ocds_main (
  id text unique,
  tag text,
  date timestamptz,
  ocid text,
  language text,
  initiationType text,
  buyer_id text,
  buyer_name text,
  tender_id text,
  tender_procurementMethodDetails text,
  tender_title text,
  tender_mainProcurementCategory text,
  tender_status text,
  tender_description text,
  tender_value_amount numeric,
  tender_value_currency text,
  tender_suitability_sme text,
  tender_suitability_vcse text,
  tender_tenderPeriod_endDate timestamptz,
  tender_classification_id text,
  tender_classification_scheme text,
  tender_classification_description text,
  tender_contractPeriod_endDate timestamptz,
  tender_contractPeriod_startDate timestamptz,
  tender_procurementMethod text,
  tender_datePublished timestamptz,
  tender_minValue_amount numeric,
  tender_minValue_currency text,
  tender_communication_futureNoticeDate timestamptz,
  title text,
  tender_procedure_isAccelerated text,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS public.ocds_parties (
  id text,
  name text,
  roles text,
  address_locality text,
  address_postalCode text,
  address_countryName text,
  address_streetAddress text,
  identifier_id text,
  identifier_scheme text,
  identifier_legalName text,
  contactPoint_name text,
  contactPoint_email text,
  main_ocid text,
  main_id text,
  details_vcse text,
  details_scale text,
  contactPoint_telephone text,
  details_url text,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS public.ocds_awards (
  id text unique,
  date timestamptz,
  datePublished timestamptz,
  status text,
  value_amount numeric,
  value_currency text,
  contractPeriod_endDate timestamptz,
  contractPeriod_startDate timestamptz,
  main_ocid text,
  main_id text,
  description text,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS public.ocds_award_suppliers (
  award_id text,
  supplier_id text,
  supplier_name text,
  main_ocid text,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS public.ocds_tender_documents (
  id text,
  main_ocid text,
  documentType text,
  title text,
  url text,
  datePublished timestamptz,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS public.ocds_tender_items (
  id text,
  main_ocid text,
  description text,
  classification_id text,
  classification_description text,
  classification_scheme text,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS public.ocds_tender_additional_classifications (
  id text,
  main_ocid text,
  scheme text,
  description text,
  created_at timestamptz default now()
);

ALTER TABLE public.ocds_main ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocds_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocds_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocds_award_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocds_tender_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocds_tender_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocds_tender_additional_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ocds_main read for authed" ON public.ocds_main FOR SELECT TO authenticated USING (true);
CREATE POLICY "ocds_parties read for authed" ON public.ocds_parties FOR SELECT TO authenticated USING (true);
CREATE POLICY "ocds_awards read for authed" ON public.ocds_awards FOR SELECT TO authenticated USING (true);
CREATE POLICY "ocds_award_suppliers read for authed" ON public.ocds_award_suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "ocds_tender_documents read for authed" ON public.ocds_tender_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "ocds_tender_items read for authed" ON public.ocds_tender_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "ocds_tender_additional_classifications read for authed" ON public.ocds_tender_additional_classifications FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_ocds_main_ocid ON public.ocds_main(ocid);
CREATE INDEX IF NOT EXISTS idx_ocds_main_date ON public.ocds_main(date);
CREATE INDEX IF NOT EXISTS idx_ocds_parties_main_ocid ON public.ocds_parties(main_ocid);
CREATE INDEX IF NOT EXISTS idx_ocds_awards_main_ocid ON public.ocds_awards(main_ocid);
CREATE INDEX IF NOT EXISTS idx_ocds_award_suppliers_main_ocid ON public.ocds_award_suppliers(main_ocid);
CREATE INDEX IF NOT EXISTS idx_ocds_award_suppliers_award_id ON public.ocds_award_suppliers(award_id);
CREATE INDEX IF NOT EXISTS idx_ocds_tender_documents_main_ocid ON public.ocds_tender_documents(main_ocid);
CREATE INDEX IF NOT EXISTS idx_ocds_tender_items_main_ocid ON public.ocds_tender_items(main_ocid);
CREATE INDEX IF NOT EXISTS idx_ocds_tender_additional_classifications_main_ocid ON public.ocds_tender_additional_classifications(main_ocid);