
CREATE OR REPLACE FUNCTION public.safe_ts(t text)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN t ~ '^[12][0-9]{3}-[0-9]{2}-[0-9]{2}' THEN t::timestamptz END
$$;

CREATE OR REPLACE VIEW public.tenders_cf_full AS
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
cf_bulk AS (
  SELECT DISTINCT ON (left(notice_identifier, 36))
    left(notice_identifier, 36) AS notice_guid,
    ocid AS bulk_ocid,
    (payload->'releases'->0) AS rel
  FROM cf_bulk_upload
  WHERE notice_identifier IS NOT NULL
  ORDER BY left(notice_identifier, 36), published_date DESC NULLS LAST
),
native_joined AS (
  SELECT n.notice_id,
    n.payload AS p,
    n.fetched_at,
    o.ocid,
    o.ocds,
    b.rel AS brel,
    (SELECT party.value
       FROM jsonb_array_elements(COALESCE(o.ocds->'parties', '[]'::jsonb)) party(value)
       WHERE (party.value->'roles') ? 'buyer' LIMIT 1) AS buyer_party,
    (o.ocds->'tender')->'documents' AS tender_docs,
    (o.ocds->'tender')->>'description' AS tender_desc
  FROM raw_cf_native n
  LEFT JOIN cf_ocds o ON o.notice_guid = n.notice_id
  LEFT JOIN cf_bulk b ON b.notice_guid = n.notice_id OR (o.ocid IS NOT NULL AND b.bulk_ocid = o.ocid)
),
ocds_only AS (
  SELECT o.notice_guid AS notice_id,
    o.ocid,
    o.ocds,
    o.published_date AS fetched_at,
    b.rel AS brel,
    (SELECT party.value
       FROM jsonb_array_elements(COALESCE(o.ocds->'parties', '[]'::jsonb)) party(value)
       WHERE (party.value->'roles') ? 'buyer' LIMIT 1) AS buyer_party,
    o.ocds->'tender' AS tender,
    (SELECT a.value FROM jsonb_array_elements(COALESCE(o.ocds->'awards', '[]'::jsonb)) a(value) LIMIT 1) AS award
  FROM cf_ocds o
  LEFT JOIN cf_bulk b ON b.notice_guid = o.notice_guid OR b.bulk_ocid = o.ocid
  WHERE NOT EXISTS (SELECT 1 FROM raw_cf_native n WHERE n.notice_id = o.notice_guid)
)
SELECT 'cf_native'::text AS source,
  j.notice_id AS external_id,
  j.notice_id,
  COALESCE(j.p->>'noticeType',
    CASE
      WHEN (j.brel->'tag') ? 'award' THEN 'Award'
      WHEN (j.brel->'tag') ? 'planning' THEN 'Planning'
      WHEN j.brel IS NOT NULL THEN 'Contract'
    END) AS notice_type,
  COALESCE(j.p->>'noticeStatus', (j.brel->'tender')->>'status') AS status,
  j.p->>'organisationName' AS organisation_name,
  j.p->>'title' AS title,
  j.p->>'description' AS description,
  safe_ts(j.p->>'publishedDate') AS published_date,
  safe_ts(j.p->>'deadlineDate') AS closing_date,
  safe_ts(j.p->>'deadlineDate') AS deadline_date,
  safe_ts(j.p->>'approachMarketDate') AS approach_market_date,
  COALESCE(safe_ts(j.p->>'awardedDate'),
           safe_ts((j.brel->'awards'->0)->>'date')) AS awarded_date,
  COALESCE(NULLIF(j.p->>'awardedValue','0')::numeric,
           NULLIF(((j.brel->'awards'->0)->'value')->>'amount','0')::numeric) AS awarded_value,
  COALESCE(j.p->>'awardedSupplier',
    (SELECT string_agg(s.value->>'name', '; ')
       FROM jsonb_array_elements(COALESCE(j.brel->'awards'->0->'suppliers','[]'::jsonb)) s(value))
  ) AS supplier_details,
  NULLIF(j.p->>'valueLow','0')::numeric AS value_low,
  NULLIF(j.p->>'valueHigh','0')::numeric AS value_high,
  j.p->>'postcode' AS postcode,
  j.p->>'coordinates' AS coordinates,
  COALESCE(j.p->>'region',
    (SELECT (it.value->'deliveryAddresses'->0)->>'region'
       FROM jsonb_array_elements(COALESCE(j.brel->'tender'->'items','[]'::jsonb)) it(value)
       WHERE (it.value->'deliveryAddresses'->0)->>'region' IS NOT NULL LIMIT 1)
  ) AS region,
  j.p->>'regionText' AS region_text,
  CASE
    WHEN (j.p->>'region') ILIKE 'any region' THEN true
    WHEN COALESCE(j.p->>'region',
      (SELECT (it.value->'deliveryAddresses'->0)->>'region'
         FROM jsonb_array_elements(COALESCE(j.brel->'tender'->'items','[]'::jsonb)) it(value)
         WHERE (it.value->'deliveryAddresses'->0)->>'region' IS NOT NULL LIMIT 1)
    ) ILIKE 'any region' THEN true
    ELSE false
  END AS nationwide,
  j.p->>'cpvCodes' AS cpv_codes,
  j.p->>'cpvCodesExtended' AS cpv_codes_extended,
  j.p->>'cpvDescription' AS cpv_description,
  j.p->>'cpvDescriptionExpanded' AS cpv_description_expanded,
  COALESCE(j.p->>'sector', (j.brel->'tender')->>'mainProcurementCategory') AS sector,
  (j.p->>'isSubNotice')::boolean AS is_sub_contract,
  COALESCE((j.p->>'isSuitableForSme')::boolean,
           ((j.brel->'tender'->'suitability')->>'sme')::boolean) AS suitable_for_sme,
  COALESCE((j.p->>'isSuitableForVco')::boolean,
           ((j.brel->'tender'->'suitability')->>'vcse')::boolean) AS suitable_for_vco,
  j.p->>'start' AS contract_start_date,
  j.p->>'end' AS contract_end_date,
  j.p->>'parentId' AS parent_reference,
  j.p->>'noticeIdentifier' AS notice_identifier,
  safe_ts(j.p->>'lastNotifableUpdate') AS last_notifiable_update,
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

SELECT 'cf_ocds'::text AS source,
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
  safe_ts((o.tender->'tenderPeriod')->>'endDate') AS closing_date,
  safe_ts((o.tender->'tenderPeriod')->>'endDate') AS deadline_date,
  NULL::timestamptz AS approach_market_date,
  COALESCE(safe_ts(o.award->>'date'),
           safe_ts((o.brel->'awards'->0)->>'date')) AS awarded_date,
  COALESCE(NULLIF((o.award->'value')->>'amount','0')::numeric,
           NULLIF(((o.brel->'awards'->0)->'value')->>'amount','0')::numeric) AS awarded_value,
  COALESCE(
    (SELECT string_agg(s.value->>'name','; ')
       FROM jsonb_array_elements(COALESCE(o.award->'suppliers','[]'::jsonb)) s(value)),
    (SELECT string_agg(s.value->>'name','; ')
       FROM jsonb_array_elements(COALESCE(o.brel->'awards'->0->'suppliers','[]'::jsonb)) s(value))
  ) AS supplier_details,
  NULLIF((o.tender->'value')->>'amount','0')::numeric AS value_low,
  NULLIF((o.tender->'value')->>'amount','0')::numeric AS value_high,
  (SELECT ((it.value->'deliveryAddresses'->0)->>'postalCode')
     FROM jsonb_array_elements(COALESCE(o.tender->'items','[]'::jsonb)) it(value) LIMIT 1) AS postcode,
  NULL::text AS coordinates,
  (SELECT (it.value->'deliveryAddresses'->0)->>'region'
     FROM jsonb_array_elements(COALESCE(o.tender->'items','[]'::jsonb)) it(value)
     WHERE (it.value->'deliveryAddresses'->0)->>'region' IS NOT NULL LIMIT 1) AS region,
  NULL::text AS region_text,
  CASE
    WHEN (SELECT (it.value->'deliveryAddresses'->0)->>'region'
            FROM jsonb_array_elements(COALESCE(o.tender->'items','[]'::jsonb)) it(value)
            WHERE (it.value->'deliveryAddresses'->0)->>'region' IS NOT NULL LIMIT 1) ILIKE 'any region' THEN true
    ELSE false
  END AS nationwide,
  (o.tender->'classification')->>'id' AS cpv_codes,
  NULL::text AS cpv_codes_extended,
  (o.tender->'classification')->>'description' AS cpv_description,
  NULL::text AS cpv_description_expanded,
  o.tender->>'mainProcurementCategory' AS sector,
  NULL::boolean AS is_sub_contract,
  ((o.tender->'suitability')->>'sme')::boolean AS suitable_for_sme,
  ((o.tender->'suitability')->>'vcse')::boolean AS suitable_for_vco,
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
