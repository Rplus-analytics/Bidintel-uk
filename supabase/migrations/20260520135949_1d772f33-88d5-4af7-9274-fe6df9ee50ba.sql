
CREATE TABLE IF NOT EXISTS public.cf_scrape_queue (
  id uuid primary key default gen_random_uuid(),
  notice_id text unique,
  scraped boolean not null default false,
  scraped_at timestamptz,
  supply_chain text,
  ojeu_procedure_type text,
  accelerated_justification text,
  closing_time text,
  error text,
  created_at timestamptz not null default now()
);

ALTER TABLE public.cf_scrape_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cf_scrape_queue read for authed"
ON public.cf_scrape_queue FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS cf_scrape_queue_unscraped_idx
  ON public.cf_scrape_queue (created_at) WHERE scraped = false;

CREATE OR REPLACE VIEW public.tenders_cf_full AS
WITH cf_ocds AS (
  SELECT DISTINCT ON (left(release_id, 36))
    left(release_id, 36) AS notice_guid,
    ocid,
    payload AS ocds
  FROM raw_contracts_finder
  WHERE release_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  ORDER BY left(release_id, 36), published_date DESC NULLS LAST
), joined AS (
  SELECT n.notice_id, n.payload AS p, n.fetched_at, o.ocid, o.ocds,
    (SELECT party.value FROM jsonb_array_elements(COALESCE(o.ocds->'parties','[]'::jsonb)) party
     WHERE (party.value->'roles') ? 'buyer' LIMIT 1) AS buyer_party,
    (o.ocds->'tender')->'documents' AS tender_docs,
    (o.ocds->'tender')->>'description' AS tender_desc
  FROM raw_cf_native n
  LEFT JOIN cf_ocds o ON o.notice_guid = n.notice_id
)
SELECT 'cf_native'::text AS source,
  j.notice_id AS external_id,
  j.notice_id,
  p->>'noticeType' AS notice_type,
  p->>'noticeStatus' AS status,
  p->>'organisationName' AS organisation_name,
  p->>'title' AS title,
  p->>'description' AS description,
  (p->>'publishedDate')::timestamptz AS published_date,
  (p->>'deadlineDate')::timestamptz AS closing_date,
  (p->>'deadlineDate')::timestamptz AS deadline_date,
  (p->>'approachMarketDate')::timestamptz AS approach_market_date,
  (p->>'awardedDate')::timestamptz AS awarded_date,
  NULLIF(p->>'awardedValue','0')::numeric AS awarded_value,
  p->>'awardedSupplier' AS supplier_details,
  NULLIF(p->>'valueLow','0')::numeric AS value_low,
  NULLIF(p->>'valueHigh','0')::numeric AS value_high,
  p->>'postcode' AS postcode,
  p->>'coordinates' AS coordinates,
  p->>'region' AS region,
  p->>'regionText' AS region_text,
  CASE WHEN p->>'region' ILIKE 'any region' THEN true ELSE false END AS nationwide,
  p->>'cpvCodes' AS cpv_codes,
  p->>'cpvCodesExtended' AS cpv_codes_extended,
  p->>'cpvDescription' AS cpv_description,
  p->>'cpvDescriptionExpanded' AS cpv_description_expanded,
  p->>'sector' AS sector,
  (p->>'isSubNotice')::boolean AS is_sub_contract,
  (p->>'isSuitableForSme')::boolean AS suitable_for_sme,
  (p->>'isSuitableForVco')::boolean AS suitable_for_vco,
  p->>'start' AS contract_start_date,
  p->>'end' AS contract_end_date,
  p->>'parentId' AS parent_reference,
  p->>'noticeIdentifier' AS notice_identifier,
  (p->>'lastNotifableUpdate')::timestamptz AS last_notifiable_update,
  j.ocid,
  (buyer_party->'contactPoint')->>'name' AS contact_name,
  (buyer_party->'contactPoint')->>'email' AS contact_email,
  (buyer_party->'contactPoint')->>'telephone' AS contact_telephone,
  (buyer_party->'address')->>'streetAddress' AS contact_address1,
  NULL::text AS contact_address2,
  (buyer_party->'address')->>'locality' AS contact_town,
  (buyer_party->'address')->>'postalCode' AS contact_postcode,
  (buyer_party->'address')->>'countryName' AS contact_country,
  (buyer_party->'contactPoint')->>'url' AS contact_website,
  tender_docs AS attachments,
  NULL::jsonb AS links,
  tender_desc AS additional_text,
  q.supply_chain,
  NULL::text AS ojeu_contract_type,
  q.ojeu_procedure_type,
  q.accelerated_justification,
  q.closing_time,
  p AS raw_json,
  fetched_at AS created_at
FROM joined j
LEFT JOIN public.cf_scrape_queue q ON q.notice_id = j.notice_id;
