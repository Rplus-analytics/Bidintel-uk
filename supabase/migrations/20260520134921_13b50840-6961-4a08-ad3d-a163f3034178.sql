
CREATE TABLE IF NOT EXISTS public.raw_cf_native (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id text UNIQUE,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_cf_native_published_idx
  ON public.raw_cf_native ((payload->>'publishedDate'));

ALTER TABLE public.raw_cf_native ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "raw_cf_native read for authed" ON public.raw_cf_native;
CREATE POLICY "raw_cf_native read for authed"
  ON public.raw_cf_native FOR SELECT TO authenticated USING (true);

ALTER TABLE public.backfill_state
  ADD COLUMN IF NOT EXISTS cursor_date date;

CREATE OR REPLACE VIEW public.tenders_cf_full AS
SELECT
  'cf_native'                                          AS source,
  notice_id                                            AS external_id,
  notice_id,
  payload->>'noticeType'                               AS notice_type,
  payload->>'noticeStatus'                             AS status,
  payload->>'organisationName'                         AS organisation_name,
  payload->>'title'                                    AS title,
  payload->>'description'                              AS description,
  (payload->>'publishedDate')::timestamptz             AS published_date,
  (payload->>'deadlineDate')::timestamptz             AS closing_date,
  (payload->>'deadlineDate')::timestamptz             AS deadline_date,
  (payload->>'approachMarketDate')::timestamptz       AS approach_market_date,
  (payload->>'awardedDate')::timestamptz              AS awarded_date,
  NULLIF(payload->>'awardedValue','0')::numeric        AS awarded_value,
  payload->>'awardedSupplier'                          AS supplier_details,
  NULLIF(payload->>'valueLow','0')::numeric            AS value_low,
  NULLIF(payload->>'valueHigh','0')::numeric           AS value_high,
  payload->>'postcode'                                 AS postcode,
  payload->>'coordinates'                              AS coordinates,
  payload->>'region'                                   AS region,
  payload->>'regionText'                               AS region_text,
  -- Nationwide signal: CF marks national notices with region 'Any region'
  CASE WHEN payload->>'region' ILIKE 'any region' THEN true ELSE false END AS nationwide,
  payload->>'cpvCodes'                                 AS cpv_codes,
  payload->>'cpvCodesExtended'                         AS cpv_codes_extended,
  payload->>'cpvDescription'                           AS cpv_description,
  payload->>'cpvDescriptionExpanded'                   AS cpv_description_expanded,
  payload->>'sector'                                   AS sector,
  (payload->>'isSubNotice')::boolean                   AS is_sub_contract,
  (payload->>'isSuitableForSme')::boolean              AS suitable_for_sme,
  (payload->>'isSuitableForVco')::boolean              AS suitable_for_vco,
  payload->>'start'                                    AS contract_start_date,
  payload->>'end'                                      AS contract_end_date,
  payload->>'parentId'                                 AS parent_reference,
  payload->>'noticeIdentifier'                         AS notice_identifier,
  (payload->>'lastNotifableUpdate')::timestamptz       AS last_notifiable_update,
  -- Fields not returned by search_notices (NULL placeholders so consumers can rely on shape)
  NULL::text  AS contact_name,
  NULL::text  AS contact_email,
  NULL::text  AS contact_telephone,
  NULL::text  AS contact_address1,
  NULL::text  AS contact_address2,
  NULL::text  AS contact_town,
  NULL::text  AS contact_postcode,
  NULL::text  AS contact_country,
  NULL::text  AS contact_website,
  NULL::jsonb AS attachments,
  NULL::jsonb AS links,
  NULL::text  AS additional_text,
  NULL::text  AS supply_chain,
  NULL::text  AS ojeu_contract_type,
  NULL::text  AS ojeu_procedure_type,
  NULL::text  AS accelerated_justification,
  NULL::text  AS closing_time,
  payload                                              AS raw_json,
  fetched_at                                           AS created_at
FROM public.raw_cf_native;
