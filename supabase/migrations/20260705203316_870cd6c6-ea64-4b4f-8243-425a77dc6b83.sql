-- Strip synthetic published dates from CCS Digital Outcomes rows.
-- The source page does not expose a real publication date, and earlier ingests
-- populated published_at/published_date with the insertion timestamp (equal to
-- created_at), which inflated Contracts-page counts under any published-date
-- filter. Set the field to NULL wherever it matches created_at so filtering is
-- based solely on genuine published dates.

UPDATE public.tenders
   SET published_at = NULL
 WHERE source = 'ccs_digital_outcomes'
   AND published_at IS NOT NULL
   AND published_at = created_at;

UPDATE public.notices
   SET published_date = NULL
 WHERE source = 'ccs_digital_outcomes'
   AND published_date IS NOT NULL
   AND published_date = created_at;