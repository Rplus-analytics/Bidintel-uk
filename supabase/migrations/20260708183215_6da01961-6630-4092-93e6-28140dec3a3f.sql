
CREATE OR REPLACE FUNCTION public.trg_canon_ocds_main()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.buyer_name_canonical := public.canonicalize_org_name(NEW.buyer_name); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.trg_canon_ocds_parties()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.name_canonical := public.canonicalize_org_name(NEW.name); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.trg_canon_ocds_award_suppliers()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.supplier_name_canonical := public.canonicalize_org_name(NEW.supplier_name); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.trg_canon_buyer_name()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.buyer_name_canonical := public.canonicalize_org_name(NEW.buyer_name); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.trg_canon_cf_recent()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.organisation_name_canonical := public.canonicalize_org_name(NEW.organisation_name); RETURN NEW; END; $$;

ALTER TABLE public.ocds_main ADD COLUMN IF NOT EXISTS buyer_name_canonical text;
ALTER TABLE public.ocds_parties ADD COLUMN IF NOT EXISTS name_canonical text;
ALTER TABLE public.ocds_award_suppliers ADD COLUMN IF NOT EXISTS supplier_name_canonical text;
ALTER TABLE public.tenders ADD COLUMN IF NOT EXISTS buyer_name_canonical text;
ALTER TABLE public.tenders_ccs ADD COLUMN IF NOT EXISTS buyer_name_canonical text;
ALTER TABLE public.tenders_fts ADD COLUMN IF NOT EXISTS buyer_name_canonical text;
ALTER TABLE public.tenders_pcs ADD COLUMN IF NOT EXISTS buyer_name_canonical text;
ALTER TABLE public.tenders_cf_recent ADD COLUMN IF NOT EXISTS organisation_name_canonical text;

DROP TRIGGER IF EXISTS canon_ocds_main ON public.ocds_main;
CREATE TRIGGER canon_ocds_main BEFORE INSERT OR UPDATE OF buyer_name ON public.ocds_main
  FOR EACH ROW EXECUTE FUNCTION public.trg_canon_ocds_main();
DROP TRIGGER IF EXISTS canon_ocds_parties ON public.ocds_parties;
CREATE TRIGGER canon_ocds_parties BEFORE INSERT OR UPDATE OF name ON public.ocds_parties
  FOR EACH ROW EXECUTE FUNCTION public.trg_canon_ocds_parties();
DROP TRIGGER IF EXISTS canon_ocds_award_suppliers ON public.ocds_award_suppliers;
CREATE TRIGGER canon_ocds_award_suppliers BEFORE INSERT OR UPDATE OF supplier_name ON public.ocds_award_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.trg_canon_ocds_award_suppliers();
DROP TRIGGER IF EXISTS canon_tenders ON public.tenders;
CREATE TRIGGER canon_tenders BEFORE INSERT OR UPDATE OF buyer_name ON public.tenders
  FOR EACH ROW EXECUTE FUNCTION public.trg_canon_buyer_name();
DROP TRIGGER IF EXISTS canon_tenders_ccs ON public.tenders_ccs;
CREATE TRIGGER canon_tenders_ccs BEFORE INSERT OR UPDATE OF buyer_name ON public.tenders_ccs
  FOR EACH ROW EXECUTE FUNCTION public.trg_canon_buyer_name();
DROP TRIGGER IF EXISTS canon_tenders_fts ON public.tenders_fts;
CREATE TRIGGER canon_tenders_fts BEFORE INSERT OR UPDATE OF buyer_name ON public.tenders_fts
  FOR EACH ROW EXECUTE FUNCTION public.trg_canon_buyer_name();
DROP TRIGGER IF EXISTS canon_tenders_pcs ON public.tenders_pcs;
CREATE TRIGGER canon_tenders_pcs BEFORE INSERT OR UPDATE OF buyer_name ON public.tenders_pcs
  FOR EACH ROW EXECUTE FUNCTION public.trg_canon_buyer_name();
DROP TRIGGER IF EXISTS canon_tenders_cf_recent ON public.tenders_cf_recent;
CREATE TRIGGER canon_tenders_cf_recent BEFORE INSERT OR UPDATE OF organisation_name ON public.tenders_cf_recent
  FOR EACH ROW EXECUTE FUNCTION public.trg_canon_cf_recent();

CREATE INDEX IF NOT EXISTS idx_ocds_main_buyer_canon ON public.ocds_main(buyer_name_canonical);
CREATE INDEX IF NOT EXISTS idx_ocds_parties_name_canon ON public.ocds_parties(name_canonical);
CREATE INDEX IF NOT EXISTS idx_ocds_award_suppliers_canon ON public.ocds_award_suppliers(supplier_name_canonical);
CREATE INDEX IF NOT EXISTS idx_tenders_buyer_canon ON public.tenders(buyer_name_canonical);
CREATE INDEX IF NOT EXISTS idx_tenders_ccs_buyer_canon ON public.tenders_ccs(buyer_name_canonical);
CREATE INDEX IF NOT EXISTS idx_tenders_fts_buyer_canon ON public.tenders_fts(buyer_name_canonical);
CREATE INDEX IF NOT EXISTS idx_tenders_pcs_buyer_canon ON public.tenders_pcs(buyer_name_canonical);
CREATE INDEX IF NOT EXISTS idx_tenders_cf_recent_org_canon ON public.tenders_cf_recent(organisation_name_canonical);
