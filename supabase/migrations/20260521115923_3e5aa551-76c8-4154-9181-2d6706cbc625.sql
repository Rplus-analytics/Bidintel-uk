
DROP VIEW IF EXISTS public.tenders_cf_full;

CREATE VIEW public.tenders_cf_full AS
WITH cf_ocds AS (
  SELECT DISTINCT ON (left(release_id, 36))
    left(release_id, 36) AS notice_guid,
    ocid,
    published_date,
    payload AS ocds
  FROM raw_contracts_finder
  WHERE release_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  ORDER BY left(release_id, 36), published_date DESC NULLS LAST
),
native_joined AS (
  SELECT
    n.notice_id,
    n.payload AS p,
    n.fetched_at,
    o.ocid,
    o.ocds,
    (SELECT party.value
       FROM jsonb_array_elements(COALESCE(o.ocds->'parties','[]'::jsonb)) party
      WHERE (party.value->'roles') ? 'buyer'
      LIMIT 1) AS buyer_party,
    (o.ocds->'tender')->'documents' AS tender_docs,
    (o.ocds->'tender')->>'description' AS tender_desc
  FROM raw_cf_native n
  LEFT JOIN cf_ocds o ON o.notice_guid = n.notice_id
),
ocds_only AS (
  SELECT
    o.notice_guid AS notice_id,
    o.ocid,
    o.ocds,
    o.published_date AS fetched_at,
    (SELECT party.value
       FROM jsonb_array_elements(COALESCE(o.ocds->'parties','[]'::jsonb)) party
      WHERE (party.value->'roles') ? 'buyer'
      LIMIT 1) AS buyer_party,
    (o.ocds->'tender') AS tender,
    (SELECT a.value
       FROM jsonb_array_elements(COALESCE(o.ocds->'awards','[]'::jsonb)) a
      LIMIT 1) AS award
  FROM cf_ocds o
  WHERE NOT EXISTS (SELECT 1 FROM raw_cf_native n WHERE n.notice_id = o.notice_guid)
)
-- Native CF leg
SELECT
  'cf_native'::text AS source,
  j.notice_id AS external_id,
  j.notice_id,
  j.p->>'noticeType' AS notice_type,
  j.p->>'noticeStatus' AS status,
  j.p->>'organisationName' AS organisation_name,
  j.p->>'title' AS title,
  j.p->>'description' AS description,
  (j.p->>'publishedDate')::timestamptz AS published_date,
  (j.p->>'deadlineDate')::timestamptz AS closing_date,
  (j.p->>'deadlineDate')::timestamptz AS deadline_date,
  (j.p->>'approachMarketDate')::timestamptz AS approach_market_date,
  (j.p->>'awardedDate')::timestamptz AS awarded_date,
  NULLIF(j.p->>'awardedValue','0')::numeric AS awarded_value,
  j.p->>'awardedSupplier' AS supplier_details,
  NULLIF(j.p->>'valueLow','0')::numeric AS value_low,
  NULLIF(j.p->>'valueHigh','0')::numeric AS value_high,
  j.p->>'postcode' AS postcode,
  j.p->>'coordinates' AS coordinates,
  j.p->>'region' AS region,
  j.p->>'regionText' AS region_text,
  CASE WHEN (j.p->>'region') ILIKE 'any region' THEN true ELSE false END AS nationwide,
  j.p->>'cpvCodes' AS cpv_codes,
  j.p->>'cpvCodesExtended' AS cpv_codes_extended,
  j.p->>'cpvDescription' AS cpv_description,
  j.p->>'cpvDescriptionExpanded' AS cpv_description_expanded,
  j.p->>'sector' AS sector,
  (j.p->>'isSubNotice')::boolean AS is_sub_contract,
  (j.p->>'isSuitableForSme')::boolean AS suitable_for_sme,
  (j.p->>'isSuitableForVco')::boolean AS suitable_for_vco,
  j.p->>'start' AS contract_start_date,
  j.p->>'end' AS contract_end_date,
  j.p->>'parentId' AS parent_reference,
  j.p->>'noticeIdentifier' AS notice_identifier,
  (j.p->>'lastNotifableUpdate')::timestamptz AS last_notifiable_update,
  j.ocid,
  (j.buyer_party->'contactPoint')->>'name' AS contact_name,
  (j.buyer_party->'contactPoint')->>'email' AS contact_email,
  (j.buyer_party->'contactPoint')->>'telephone' AS contact_telephone,
  (j.buyer_party->'address')->>'streetAddress' AS contact_address1,
  NULL::text AS contact_address2,
  (j.buyer_party->'address')->>'locality' AS contact_town,
  (j.buyer_party->'address')->>'postalCode' AS contact_postcode,
  (j.buyer_party->'address')->>'countryName' AS contact_country,
  (j.buyer_party->'contactPoint')->>'url' AS contact_website,
  j.tender_docs AS attachments,
  NULL::jsonb AS links,
  j.tender_desc AS additional_text,
  q.supply_chain,
  NULL::text AS ojeu_contract_type,
  q.ojeu_procedure_type,
  q.accelerated_justification,
  q.closing_time,
  j.p AS raw_json,
  j.fetched_at AS created_at
FROM native_joined j
LEFT JOIN cf_scrape_queue q ON q.notice_id = j.notice_id

UNION ALL

-- OCDS-only leg (fills the ~625k gap)
SELECT
  'cf_ocds'::text AS source,
  o.notice_id AS external_id,
  o.notice_id,
  CASE
    WHEN (o.ocds->'tag') ? 'award' THEN 'Award'
    WHEN (o.ocds->'tag') ? 'planning' THEN 'Planning'
    ELSE 'Contract'
  END AS notice_type,
  o.tender->>'status' AS status,
  o.buyer_party->>'name' AS organisation_name,
  o.tender->>'title' AS title,
  o.tender->>'description' AS description,
  o.fetched_at AS published_date,
  ((o.tender->'tenderPeriod')->>'endDate')::timestamptz AS closing_date,
  ((o.tender->'tenderPeriod')->>'endDate')::timestamptz AS deadline_date,
  NULL::timestamptz AS approach_market_date,
  (o.award->>'date')::timestamptz AS awarded_date,
  NULLIF(o.award->'value'->>'amount','0')::numeric AS awarded_value,
  (SELECT string_agg(s.value->>'name', '; ')
     FROM jsonb_array_elements(COALESCE(o.award->'suppliers','[]'::jsonb)) s) AS supplier_details,
  NULLIF(o.tender->'value'->>'amount','0')::numeric AS value_low,
  NULLIF(o.tender->'value'->>'amount','0')::numeric AS value_high,
  (SELECT it.value->'deliveryAddresses'->0->>'postalCode'
     FROM jsonb_array_elements(COALESCE(o.tender->'items','[]'::jsonb)) it
    LIMIT 1) AS postcode,
  NULL::text AS coordinates,
  NULL::text AS region,
  NULL::text AS region_text,
  false AS nationwide,
  o.tender->'classification'->>'id' AS cpv_codes,
  NULL::text AS cpv_codes_extended,
  o.tender->'classification'->>'description' AS cpv_description,
  NULL::text AS cpv_description_expanded,
  o.tender->>'mainProcurementCategory' AS sector,
  NULL::boolean AS is_sub_contract,
  (o.tender->'suitability'->>'sme')::boolean AS suitable_for_sme,
  (o.tender->'suitability'->>'vcse')::boolean AS suitable_for_vco,
  (o.tender->'contractPeriod')->>'startDate' AS contract_start_date,
  (o.tender->'contractPeriod')->>'endDate' AS contract_end_date,
  NULL::text AS parent_reference,
  o.tender->>'id' AS notice_identifier,
  NULL::timestamptz AS last_notifiable_update,
  o.ocid,
  (o.buyer_party->'contactPoint')->>'name' AS contact_name,
  (o.buyer_party->'contactPoint')->>'email' AS contact_email,
  (o.buyer_party->'contactPoint')->>'telephone' AS contact_telephone,
  (o.buyer_party->'address')->>'streetAddress' AS contact_address1,
  NULL::text AS contact_address2,
  (o.buyer_party->'address')->>'locality' AS contact_town,
  (o.buyer_party->'address')->>'postalCode' AS contact_postcode,
  (o.buyer_party->'address')->>'countryName' AS contact_country,
  (o.buyer_party->'contactPoint')->>'url' AS contact_website,
  o.tender->'documents' AS attachments,
  NULL::jsonb AS links,
  o.tender->>'description' AS additional_text,
  NULL::text AS supply_chain,
  NULL::text AS ojeu_contract_type,
  o.tender->>'procurementMethodDetails' AS ojeu_procedure_type,
  NULL::text AS accelerated_justification,
  NULL::text AS closing_time,
  o.ocds AS raw_json,
  o.fetched_at AS created_at
FROM ocds_only o;
