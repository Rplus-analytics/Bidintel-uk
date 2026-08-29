
DROP TRIGGER IF EXISTS trg_tenders_derived_status ON public.tenders;
CREATE TRIGGER trg_tenders_derived_status
BEFORE INSERT OR UPDATE OF source_status, raw_json, notice_type, deadline_at, award_date, source
ON public.tenders
FOR EACH ROW EXECUTE FUNCTION public.tenders_set_derived_status();

DROP TRIGGER IF EXISTS trg_notices_derived_status ON public.notices;
CREATE TRIGGER trg_notices_derived_status
BEFORE INSERT OR UPDATE OF source_status, notice_type, deadline_date, source
ON public.notices
FOR EACH ROW EXECUTE FUNCTION public.notices_set_derived_status();
