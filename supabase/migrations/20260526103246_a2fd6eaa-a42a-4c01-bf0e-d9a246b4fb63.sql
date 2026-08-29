
ALTER TABLE public.ocds_parties ADD COLUMN IF NOT EXISTS address_region text;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE VIEW public.ocds_cf_full AS
SELECT
  m.id as notice_identifier,
  m.tag as notice_type,
  m.buyer_name as organisation_name,
  m.tender_status as status,
  m.tender_datepublished as published_date,
  m.tender_title as title,
  m.tender_description as description,
  m.tender_minvalue_amount as value_low,
  m.tender_value_amount as value_high,
  m.tender_value_currency as currency,
  m.tender_suitability_sme as suitable_for_sme,
  m.tender_suitability_vcse as suitable_for_vco,
  m.tender_tenderperiod_enddate as closing_date,
  m.tender_classification_id as cpv_code,
  m.tender_classification_description as cpv_description,
  m.tender_procurementmethoddetails as ojeu_procedure_type,
  m.tender_procurementmethod as procedure_type,
  m.tender_mainprocurementcategory as contract_type,
  m.tender_contractperiod_startdate as contract_start,
  m.tender_contractperiod_enddate as contract_end,
  m.tender_procedure_isaccelerated as accelerated,
  m.ocid,
  m.buyer_id,
  p.address_region as region,
  p.address_postalcode as postcode,
  p.address_streetaddress as contact_address,
  p.address_locality as contact_town,
  p.address_countryname as contact_country,
  p.contactpoint_name as contact_name,
  p.contactpoint_email as contact_email,
  p.contactpoint_telephone as contact_telephone,
  p.details_url as contact_website,
  p.details_scale as supplier_size,
  p.details_vcse as is_vcse,
  a.value_amount as awarded_value,
  a.date as awarded_date,
  a.status as award_status,
  a.contractperiod_startdate as award_contract_start,
  a.contractperiod_enddate as award_contract_end,
  s.supplier_name as awarded_supplier,
  m.tender_communication_futurenoticedate as future_notice_date,
  m.created_at
FROM public.ocds_main m
LEFT JOIN public.ocds_parties p ON p.main_ocid = m.ocid AND p.roles LIKE '%buyer%'
LEFT JOIN public.ocds_awards a ON a.main_ocid = m.ocid
LEFT JOIN public.ocds_award_suppliers s ON s.award_id = a.id;
