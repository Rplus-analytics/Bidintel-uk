export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      award_suppliers: {
        Row: {
          award_id: string | null
          created_at: string | null
          id: string
          is_lead: boolean | null
          supplier_id: string | null
        }
        Insert: {
          award_id?: string | null
          created_at?: string | null
          id?: string
          is_lead?: boolean | null
          supplier_id?: string | null
        }
        Update: {
          award_id?: string | null
          created_at?: string | null
          id?: string
          is_lead?: boolean | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "award_suppliers_award_id_fkey"
            columns: ["award_id"]
            isOneToOne: false
            referencedRelation: "awards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "award_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      awards: {
        Row: {
          award_value: number | null
          awarded_at: string | null
          buyer_id: string | null
          buyer_name: string | null
          buyer_name_canonical: string | null
          contract_end: string | null
          contract_start: string | null
          cpv_code: string | null
          created_at: string
          currency: string | null
          external_id: string | null
          id: string
          notice_id: string | null
          raw: Json | null
          source: string
          supplier_id: string | null
          supplier_name: string | null
          supplier_name_canonical: string | null
        }
        Insert: {
          award_value?: number | null
          awarded_at?: string | null
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          contract_end?: string | null
          contract_start?: string | null
          cpv_code?: string | null
          created_at?: string
          currency?: string | null
          external_id?: string | null
          id?: string
          notice_id?: string | null
          raw?: Json | null
          source: string
          supplier_id?: string | null
          supplier_name?: string | null
          supplier_name_canonical?: string | null
        }
        Update: {
          award_value?: number | null
          awarded_at?: string | null
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          contract_end?: string | null
          contract_start?: string | null
          cpv_code?: string | null
          created_at?: string
          currency?: string | null
          external_id?: string | null
          id?: string
          notice_id?: string | null
          raw?: Json | null
          source?: string
          supplier_id?: string | null
          supplier_name?: string | null
          supplier_name_canonical?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "awards_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "awards_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "awards_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      backfill_state: {
        Row: {
          completed: boolean
          cursor_date: string | null
          day_offset: number
          last_run_at: string | null
          lock_until: string | null
          month0: number
          source: string
          year: number
        }
        Insert: {
          completed?: boolean
          cursor_date?: string | null
          day_offset?: number
          last_run_at?: string | null
          lock_until?: string | null
          month0: number
          source: string
          year: number
        }
        Update: {
          completed?: boolean
          cursor_date?: string | null
          day_offset?: number
          last_run_at?: string | null
          lock_until?: string | null
          month0?: number
          source?: string
          year?: number
        }
        Relationships: []
      }
      buyer_types: {
        Row: {
          code: string
          description: string | null
          id: string
          label: string
        }
        Insert: {
          code: string
          description?: string | null
          id?: string
          label: string
        }
        Update: {
          code?: string
          description?: string | null
          id?: string
          label?: string
        }
        Relationships: []
      }
      buyers: {
        Row: {
          buyer_type_code: string | null
          country: string | null
          created_at: string
          external_id: string | null
          external_ids: Json
          first_seen_at: string | null
          id: string
          last_seen_at: string | null
          name: string
          name_canonical: string | null
          notice_count: number | null
          region: string | null
          total_value: number | null
        }
        Insert: {
          buyer_type_code?: string | null
          country?: string | null
          created_at?: string
          external_id?: string | null
          external_ids?: Json
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          name: string
          name_canonical?: string | null
          notice_count?: number | null
          region?: string | null
          total_value?: number | null
        }
        Update: {
          buyer_type_code?: string | null
          country?: string | null
          created_at?: string
          external_id?: string | null
          external_ids?: Json
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          name?: string
          name_canonical?: string | null
          notice_count?: number | null
          region?: string | null
          total_value?: number | null
        }
        Relationships: []
      }
      cf_bulk_upload: {
        Row: {
          fetched_at: string | null
          id: string
          notice_identifier: string | null
          ocid: string | null
          payload: Json | null
          published_date: string | null
          source: string | null
        }
        Insert: {
          fetched_at?: string | null
          id?: string
          notice_identifier?: string | null
          ocid?: string | null
          payload?: Json | null
          published_date?: string | null
          source?: string | null
        }
        Update: {
          fetched_at?: string | null
          id?: string
          notice_identifier?: string | null
          ocid?: string | null
          payload?: Json | null
          published_date?: string | null
          source?: string | null
        }
        Relationships: []
      }
      cf_scrape_queue: {
        Row: {
          accelerated_justification: string | null
          closing_time: string | null
          created_at: string
          error: string | null
          id: string
          notice_id: string | null
          ojeu_procedure_type: string | null
          scraped: boolean
          scraped_at: string | null
          supply_chain: string | null
        }
        Insert: {
          accelerated_justification?: string | null
          closing_time?: string | null
          created_at?: string
          error?: string | null
          id?: string
          notice_id?: string | null
          ojeu_procedure_type?: string | null
          scraped?: boolean
          scraped_at?: string | null
          supply_chain?: string | null
        }
        Update: {
          accelerated_justification?: string | null
          closing_time?: string | null
          created_at?: string
          error?: string | null
          id?: string
          notice_id?: string | null
          ojeu_procedure_type?: string | null
          scraped?: boolean
          scraped_at?: string | null
          supply_chain?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          capabilities_text: string | null
          created_at: string | null
          description: string | null
          embedding: string | null
          exclusions_text: string | null
          geography_pref: string | null
          id: string
          name: string
          updated_at: string | null
          user_id: string | null
          value_max_pref: number | null
          value_min_pref: number | null
        }
        Insert: {
          capabilities_text?: string | null
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          exclusions_text?: string | null
          geography_pref?: string | null
          id?: string
          name: string
          updated_at?: string | null
          user_id?: string | null
          value_max_pref?: number | null
          value_min_pref?: number | null
        }
        Update: {
          capabilities_text?: string | null
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          exclusions_text?: string | null
          geography_pref?: string | null
          id?: string
          name?: string
          updated_at?: string | null
          user_id?: string | null
          value_max_pref?: number | null
          value_min_pref?: number | null
        }
        Relationships: []
      }
      cpv_codes: {
        Row: {
          code: string
          label: string
          level: number
          parent_code: string | null
        }
        Insert: {
          code: string
          label: string
          level?: number
          parent_code?: string | null
        }
        Update: {
          code?: string
          label?: string
          level?: number
          parent_code?: string | null
        }
        Relationships: []
      }
      frameworks: {
        Row: {
          buyer_name: string | null
          created_at: string
          currency: string | null
          description: string | null
          end_date: string | null
          external_id: string | null
          id: string
          name: string
          raw: Json | null
          reference_number: string | null
          source: string
          source_url: string | null
          start_date: string | null
          status: string | null
          supplier_count: number | null
          total_value: number | null
        }
        Insert: {
          buyer_name?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          end_date?: string | null
          external_id?: string | null
          id?: string
          name: string
          raw?: Json | null
          reference_number?: string | null
          source: string
          source_url?: string | null
          start_date?: string | null
          status?: string | null
          supplier_count?: number | null
          total_value?: number | null
        }
        Update: {
          buyer_name?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          end_date?: string | null
          external_id?: string | null
          id?: string
          name?: string
          raw?: Json | null
          reference_number?: string | null
          source?: string
          source_url?: string | null
          start_date?: string | null
          status?: string | null
          supplier_count?: number | null
          total_value?: number | null
        }
        Relationships: []
      }
      ingest_runs: {
        Row: {
          count: number | null
          duration_ms: number | null
          errors: Json | null
          finished_at: string | null
          id: string
          source: string
          started_at: string | null
        }
        Insert: {
          count?: number | null
          duration_ms?: number | null
          errors?: Json | null
          finished_at?: string | null
          id?: string
          source: string
          started_at?: string | null
        }
        Update: {
          count?: number | null
          duration_ms?: number | null
          errors?: Json | null
          finished_at?: string | null
          id?: string
          source?: string
          started_at?: string | null
        }
        Relationships: []
      }
      matches: {
        Row: {
          company_id: string | null
          created_at: string | null
          explanation: string | null
          id: string
          score: number | null
          tender_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          explanation?: string | null
          id?: string
          score?: number | null
          tender_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          explanation?: string | null
          id?: string
          score?: number | null
          tender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          organisation_id: string
          role: Database["public"]["Enums"]["org_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organisation_id: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organisation_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_cpv: {
        Row: {
          cpv_code: string
          notice_id: string
        }
        Insert: {
          cpv_code: string
          notice_id: string
        }
        Update: {
          cpv_code?: string
          notice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_cpv_cpv_code_fkey"
            columns: ["cpv_code"]
            isOneToOne: false
            referencedRelation: "cpv_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "notice_cpv_cpv_fk"
            columns: ["cpv_code"]
            isOneToOne: false
            referencedRelation: "cpv_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "notice_cpv_notice_fk"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_cpv_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_stats_daily: {
        Row: {
          buyer_count: number | null
          date: string
          notice_count: number
          total_value: number | null
        }
        Insert: {
          buyer_count?: number | null
          date: string
          notice_count?: number
          total_value?: number | null
        }
        Update: {
          buyer_count?: number | null
          date?: string
          notice_count?: number
          total_value?: number | null
        }
        Relationships: []
      }
      notices: {
        Row: {
          buyer: string | null
          buyer_canonical: string | null
          buyer_id: string | null
          country: string | null
          cpv_code: string | null
          created_at: string
          currency: string | null
          deadline_date: string | null
          derived_status: string | null
          description: string | null
          embedding: Json | null
          external_id: string
          id: string
          link: string | null
          notice_type: string | null
          procedure_type: string | null
          published_date: string | null
          raw: Json | null
          region: string | null
          search_vector: unknown
          sector: string | null
          source: string
          source_status: string | null
          source_url: string | null
          status: string | null
          title: string
          updated_at: string
          value: number | null
          value_high: number | null
        }
        Insert: {
          buyer?: string | null
          buyer_canonical?: string | null
          buyer_id?: string | null
          country?: string | null
          cpv_code?: string | null
          created_at?: string
          currency?: string | null
          deadline_date?: string | null
          derived_status?: string | null
          description?: string | null
          embedding?: Json | null
          external_id: string
          id?: string
          link?: string | null
          notice_type?: string | null
          procedure_type?: string | null
          published_date?: string | null
          raw?: Json | null
          region?: string | null
          search_vector?: unknown
          sector?: string | null
          source: string
          source_status?: string | null
          source_url?: string | null
          status?: string | null
          title: string
          updated_at?: string
          value?: number | null
          value_high?: number | null
        }
        Update: {
          buyer?: string | null
          buyer_canonical?: string | null
          buyer_id?: string | null
          country?: string | null
          cpv_code?: string | null
          created_at?: string
          currency?: string | null
          deadline_date?: string | null
          derived_status?: string | null
          description?: string | null
          embedding?: Json | null
          external_id?: string
          id?: string
          link?: string | null
          notice_type?: string | null
          procedure_type?: string | null
          published_date?: string | null
          raw?: Json | null
          region?: string | null
          search_vector?: unknown
          sector?: string | null
          source?: string
          source_status?: string | null
          source_url?: string | null
          status?: string | null
          title?: string
          updated_at?: string
          value?: number | null
          value_high?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "notices_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
        ]
      }
      notices_sync_log: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          inserted: number
          source: string
          started_at: string
          updated: number
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          inserted?: number
          source: string
          started_at?: string
          updated?: number
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          inserted?: number
          source?: string
          started_at?: string
          updated?: number
        }
        Relationships: []
      }
      ocds_award_suppliers: {
        Row: {
          award_id: string | null
          created_at: string | null
          main_ocid: string | null
          supplier_id: string | null
          supplier_name: string | null
          supplier_name_canonical: string | null
        }
        Insert: {
          award_id?: string | null
          created_at?: string | null
          main_ocid?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          supplier_name_canonical?: string | null
        }
        Update: {
          award_id?: string | null
          created_at?: string | null
          main_ocid?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          supplier_name_canonical?: string | null
        }
        Relationships: []
      }
      ocds_awards: {
        Row: {
          contractperiod_enddate: string | null
          contractperiod_startdate: string | null
          created_at: string | null
          date: string | null
          datepublished: string | null
          description: string | null
          id: string | null
          main_id: string | null
          main_ocid: string | null
          status: string | null
          value_amount: number | null
          value_currency: string | null
        }
        Insert: {
          contractperiod_enddate?: string | null
          contractperiod_startdate?: string | null
          created_at?: string | null
          date?: string | null
          datepublished?: string | null
          description?: string | null
          id?: string | null
          main_id?: string | null
          main_ocid?: string | null
          status?: string | null
          value_amount?: number | null
          value_currency?: string | null
        }
        Update: {
          contractperiod_enddate?: string | null
          contractperiod_startdate?: string | null
          created_at?: string | null
          date?: string | null
          datepublished?: string | null
          description?: string | null
          id?: string | null
          main_id?: string | null
          main_ocid?: string | null
          status?: string | null
          value_amount?: number | null
          value_currency?: string | null
        }
        Relationships: []
      }
      ocds_main: {
        Row: {
          buyer_id: string | null
          buyer_name: string | null
          buyer_name_canonical: string | null
          created_at: string | null
          date: string | null
          id: string | null
          initiationtype: string | null
          language: string | null
          ocid: string | null
          tag: string | null
          tender_classification_description: string | null
          tender_classification_id: string | null
          tender_classification_scheme: string | null
          tender_communication_futurenoticedate: string | null
          tender_contractperiod_enddate: string | null
          tender_contractperiod_startdate: string | null
          tender_datepublished: string | null
          tender_description: string | null
          tender_id: string | null
          tender_mainprocurementcategory: string | null
          tender_minvalue_amount: number | null
          tender_minvalue_currency: string | null
          tender_procedure_isaccelerated: string | null
          tender_procurementmethod: string | null
          tender_procurementmethoddetails: string | null
          tender_status: string | null
          tender_suitability_sme: string | null
          tender_suitability_vcse: string | null
          tender_tenderperiod_enddate: string | null
          tender_title: string | null
          tender_value_amount: number | null
          tender_value_currency: string | null
          title: string | null
        }
        Insert: {
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          created_at?: string | null
          date?: string | null
          id?: string | null
          initiationtype?: string | null
          language?: string | null
          ocid?: string | null
          tag?: string | null
          tender_classification_description?: string | null
          tender_classification_id?: string | null
          tender_classification_scheme?: string | null
          tender_communication_futurenoticedate?: string | null
          tender_contractperiod_enddate?: string | null
          tender_contractperiod_startdate?: string | null
          tender_datepublished?: string | null
          tender_description?: string | null
          tender_id?: string | null
          tender_mainprocurementcategory?: string | null
          tender_minvalue_amount?: number | null
          tender_minvalue_currency?: string | null
          tender_procedure_isaccelerated?: string | null
          tender_procurementmethod?: string | null
          tender_procurementmethoddetails?: string | null
          tender_status?: string | null
          tender_suitability_sme?: string | null
          tender_suitability_vcse?: string | null
          tender_tenderperiod_enddate?: string | null
          tender_title?: string | null
          tender_value_amount?: number | null
          tender_value_currency?: string | null
          title?: string | null
        }
        Update: {
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          created_at?: string | null
          date?: string | null
          id?: string | null
          initiationtype?: string | null
          language?: string | null
          ocid?: string | null
          tag?: string | null
          tender_classification_description?: string | null
          tender_classification_id?: string | null
          tender_classification_scheme?: string | null
          tender_communication_futurenoticedate?: string | null
          tender_contractperiod_enddate?: string | null
          tender_contractperiod_startdate?: string | null
          tender_datepublished?: string | null
          tender_description?: string | null
          tender_id?: string | null
          tender_mainprocurementcategory?: string | null
          tender_minvalue_amount?: number | null
          tender_minvalue_currency?: string | null
          tender_procedure_isaccelerated?: string | null
          tender_procurementmethod?: string | null
          tender_procurementmethoddetails?: string | null
          tender_status?: string | null
          tender_suitability_sme?: string | null
          tender_suitability_vcse?: string | null
          tender_tenderperiod_enddate?: string | null
          tender_title?: string | null
          tender_value_amount?: number | null
          tender_value_currency?: string | null
          title?: string | null
        }
        Relationships: []
      }
      ocds_parties: {
        Row: {
          address_countryname: string | null
          address_locality: string | null
          address_postalcode: string | null
          address_region: string | null
          address_streetaddress: string | null
          contactpoint_email: string | null
          contactpoint_name: string | null
          contactpoint_telephone: string | null
          created_at: string | null
          details_scale: string | null
          details_url: string | null
          details_vcse: string | null
          id: string | null
          identifier_id: string | null
          identifier_legalname: string | null
          identifier_scheme: string | null
          main_id: string | null
          main_ocid: string | null
          name: string | null
          name_canonical: string | null
          roles: string | null
        }
        Insert: {
          address_countryname?: string | null
          address_locality?: string | null
          address_postalcode?: string | null
          address_region?: string | null
          address_streetaddress?: string | null
          contactpoint_email?: string | null
          contactpoint_name?: string | null
          contactpoint_telephone?: string | null
          created_at?: string | null
          details_scale?: string | null
          details_url?: string | null
          details_vcse?: string | null
          id?: string | null
          identifier_id?: string | null
          identifier_legalname?: string | null
          identifier_scheme?: string | null
          main_id?: string | null
          main_ocid?: string | null
          name?: string | null
          name_canonical?: string | null
          roles?: string | null
        }
        Update: {
          address_countryname?: string | null
          address_locality?: string | null
          address_postalcode?: string | null
          address_region?: string | null
          address_streetaddress?: string | null
          contactpoint_email?: string | null
          contactpoint_name?: string | null
          contactpoint_telephone?: string | null
          created_at?: string | null
          details_scale?: string | null
          details_url?: string | null
          details_vcse?: string | null
          id?: string | null
          identifier_id?: string | null
          identifier_legalname?: string | null
          identifier_scheme?: string | null
          main_id?: string | null
          main_ocid?: string | null
          name?: string | null
          name_canonical?: string | null
          roles?: string | null
        }
        Relationships: []
      }
      ocds_tender_additional_classifications: {
        Row: {
          created_at: string | null
          description: string | null
          id: string | null
          main_ocid: string | null
          scheme: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string | null
          main_ocid?: string | null
          scheme?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string | null
          main_ocid?: string | null
          scheme?: string | null
        }
        Relationships: []
      }
      ocds_tender_documents: {
        Row: {
          created_at: string | null
          datepublished: string | null
          documenttype: string | null
          id: string | null
          main_ocid: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          datepublished?: string | null
          documenttype?: string | null
          id?: string | null
          main_ocid?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          datepublished?: string | null
          documenttype?: string | null
          id?: string | null
          main_ocid?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      ocds_tender_items: {
        Row: {
          classification_description: string | null
          classification_id: string | null
          classification_scheme: string | null
          created_at: string | null
          description: string | null
          id: string | null
          main_ocid: string | null
        }
        Insert: {
          classification_description?: string | null
          classification_id?: string | null
          classification_scheme?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          main_ocid?: string | null
        }
        Update: {
          classification_description?: string | null
          classification_id?: string | null
          classification_scheme?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          main_ocid?: string | null
        }
        Relationships: []
      }
      org_match_profiles: {
        Row: {
          cpv_prefixes: string[]
          created_at: string
          id: string
          keywords: string[]
          max_value: number | null
          min_value: number | null
          organisation_id: string
          regions: string[]
          sectors: string[]
          updated_at: string
        }
        Insert: {
          cpv_prefixes?: string[]
          created_at?: string
          id?: string
          keywords?: string[]
          max_value?: number | null
          min_value?: number | null
          organisation_id: string
          regions?: string[]
          sectors?: string[]
          updated_at?: string
        }
        Update: {
          cpv_prefixes?: string[]
          created_at?: string
          id?: string
          keywords?: string[]
          max_value?: number | null
          min_value?: number | null
          organisation_id?: string
          regions?: string[]
          sectors?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      org_name_aliases: {
        Row: {
          canonical: string
          created_at: string
          note: string | null
          updated_at: string
          variant_normalized: string
        }
        Insert: {
          canonical: string
          created_at?: string
          note?: string | null
          updated_at?: string
          variant_normalized: string
        }
        Update: {
          canonical?: string
          created_at?: string
          note?: string | null
          updated_at?: string
          variant_normalized?: string
        }
        Relationships: []
      }
      organisations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      raw_ccs_digital_outcomes: {
        Row: {
          fetched_at: string
          id: string
          payload: Json | null
          project_id: string
        }
        Insert: {
          fetched_at?: string
          id?: string
          payload?: Json | null
          project_id: string
        }
        Update: {
          fetched_at?: string
          id?: string
          payload?: Json | null
          project_id?: string
        }
        Relationships: []
      }
      raw_cf_native: {
        Row: {
          fetched_at: string
          id: string
          notice_id: string | null
          payload: Json
        }
        Insert: {
          fetched_at?: string
          id?: string
          notice_id?: string | null
          payload: Json
        }
        Update: {
          fetched_at?: string
          id?: string
          notice_id?: string | null
          payload?: Json
        }
        Relationships: []
      }
      raw_contracts_finder: {
        Row: {
          fetched_at: string
          id: string
          ocid: string
          payload: Json
          published_date: string | null
          release_id: string
        }
        Insert: {
          fetched_at?: string
          id?: string
          ocid: string
          payload: Json
          published_date?: string | null
          release_id: string
        }
        Update: {
          fetched_at?: string
          id?: string
          ocid?: string
          payload?: Json
          published_date?: string | null
          release_id?: string
        }
        Relationships: []
      }
      raw_fts: {
        Row: {
          fetched_at: string
          id: string
          ocid: string | null
          payload: Json
          published_date: string | null
          release_id: string | null
        }
        Insert: {
          fetched_at?: string
          id?: string
          ocid?: string | null
          payload: Json
          published_date?: string | null
          release_id?: string | null
        }
        Update: {
          fetched_at?: string
          id?: string
          ocid?: string | null
          payload?: Json
          published_date?: string | null
          release_id?: string | null
        }
        Relationships: []
      }
      regions: {
        Row: {
          buyer_count: number | null
          first_seen_at: string | null
          id: string
          last_seen_at: string | null
          name: string
          notice_count: number | null
          total_value: number | null
        }
        Insert: {
          buyer_count?: number | null
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          name: string
          notice_count?: number | null
          total_value?: number | null
        }
        Update: {
          buyer_count?: number | null
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          name?: string
          notice_count?: number | null
          total_value?: number | null
        }
        Relationships: []
      }
      saved_bids: {
        Row: {
          buyer: string | null
          created_at: string
          deadline_date: string | null
          description: string | null
          external_id: string
          id: string
          notes: string | null
          organisation_id: string
          published_date: string | null
          saved_by: string
          source: string
          source_url: string | null
          status: Database["public"]["Enums"]["bid_status"]
          title: string
          updated_at: string
          value: number | null
        }
        Insert: {
          buyer?: string | null
          created_at?: string
          deadline_date?: string | null
          description?: string | null
          external_id: string
          id?: string
          notes?: string | null
          organisation_id: string
          published_date?: string | null
          saved_by: string
          source: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["bid_status"]
          title: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          buyer?: string | null
          created_at?: string
          deadline_date?: string | null
          description?: string | null
          external_id?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          published_date?: string | null
          saved_by?: string
          source?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["bid_status"]
          title?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_bids_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_searches: {
        Row: {
          active: boolean | null
          buyer: string | null
          cpv: string | null
          created_at: string | null
          email_recipients: string[]
          filters: Json
          id: string
          last_alerted_at: string | null
          max_value: number | null
          min_value: number | null
          name: string
          notice_type: string | null
          organisation_id: string
          published_from: string | null
          published_to: string | null
          source: string | null
          supplier: string | null
          user_id: string
        }
        Insert: {
          active?: boolean | null
          buyer?: string | null
          cpv?: string | null
          created_at?: string | null
          email_recipients: string[]
          filters: Json
          id?: string
          last_alerted_at?: string | null
          max_value?: number | null
          min_value?: number | null
          name: string
          notice_type?: string | null
          organisation_id: string
          published_from?: string | null
          published_to?: string | null
          source?: string | null
          supplier?: string | null
          user_id: string
        }
        Update: {
          active?: boolean | null
          buyer?: string | null
          cpv?: string | null
          created_at?: string | null
          email_recipients?: string[]
          filters?: Json
          id?: string
          last_alerted_at?: string | null
          max_value?: number | null
          min_value?: number | null
          name?: string
          notice_type?: string | null
          organisation_id?: string
          published_from?: string | null
          published_to?: string | null
          source?: string | null
          supplier?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_searches_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      sectors: {
        Row: {
          buyer_count: number | null
          first_seen_at: string | null
          id: string
          last_seen_at: string | null
          name: string
          notice_count: number | null
          total_value: number | null
        }
        Insert: {
          buyer_count?: number | null
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          name: string
          notice_count?: number | null
          total_value?: number | null
        }
        Update: {
          buyer_count?: number | null
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          name?: string
          notice_count?: number | null
          total_value?: number | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          award_count: number | null
          buyer_count: number | null
          companies_house_id: string | null
          created_at: string
          external_id: string | null
          first_seen_at: string | null
          id: string
          last_seen_at: string | null
          name: string
          name_canonical: string | null
          total_won_value: number | null
        }
        Insert: {
          award_count?: number | null
          buyer_count?: number | null
          companies_house_id?: string | null
          created_at?: string
          external_id?: string | null
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          name: string
          name_canonical?: string | null
          total_won_value?: number | null
        }
        Update: {
          award_count?: number | null
          buyer_count?: number | null
          companies_house_id?: string | null
          created_at?: string
          external_id?: string | null
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          name?: string
          name_canonical?: string | null
          total_won_value?: number | null
        }
        Relationships: []
      }
      tender_cpv: {
        Row: {
          cpv_code: string
          cpv_description: string | null
          created_at: string | null
          id: string
          is_primary: boolean | null
          tender_id: string | null
        }
        Insert: {
          cpv_code: string
          cpv_description?: string | null
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          tender_id?: string | null
        }
        Update: {
          cpv_code?: string
          cpv_description?: string | null
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          tender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_cpv_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_documents: {
        Row: {
          created_at: string | null
          document_type: string | null
          id: string
          language: string | null
          published_at: string | null
          tender_id: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          document_type?: string | null
          id?: string
          language?: string | null
          published_at?: string | null
          tender_id?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          document_type?: string | null
          id?: string
          language?: string | null
          published_at?: string | null
          tender_id?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_documents_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_lots: {
        Row: {
          created_at: string | null
          currency: string | null
          description: string | null
          id: string
          lot_number: string | null
          raw_json: Json | null
          status: string | null
          tender_id: string | null
          title: string | null
          value_high: number | null
          value_low: number | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          lot_number?: string | null
          raw_json?: Json | null
          status?: string | null
          tender_id?: string | null
          title?: string | null
          value_high?: number | null
          value_low?: number | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          lot_number?: string | null
          raw_json?: Json | null
          status?: string | null
          tender_id?: string | null
          title?: string | null
          value_high?: number | null
          value_low?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_lots_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tenders: {
        Row: {
          award_date: string | null
          buyer_id: string | null
          buyer_name: string | null
          buyer_name_canonical: string | null
          buyer_type: string | null
          contract_end: string | null
          contract_start: string | null
          country: string | null
          cpv_codes: string[] | null
          created_at: string | null
          currency: string | null
          deadline_at: string | null
          deadline_date: string | null
          derived_status: string | null
          description: string | null
          embedded_at: string | null
          embedding: string | null
          embedding_attempts: number
          embedding_error: string | null
          embedding_status: string
          external_id: string
          id: string
          notice_type: string | null
          ocid: string | null
          primary_cpv: string | null
          procedure_type: string | null
          published_at: string | null
          published_date: string | null
          raw_json: Json | null
          region: string | null
          search_tsv: unknown
          sector: string | null
          source: string
          source_status: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["tender_status"]
          title: string | null
          updated_at: string | null
          value_high: number | null
          value_low: number | null
          value_max: number | null
          value_min: number | null
        }
        Insert: {
          award_date?: string | null
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          buyer_type?: string | null
          contract_end?: string | null
          contract_start?: string | null
          country?: string | null
          cpv_codes?: string[] | null
          created_at?: string | null
          currency?: string | null
          deadline_at?: string | null
          deadline_date?: string | null
          derived_status?: string | null
          description?: string | null
          embedded_at?: string | null
          embedding?: string | null
          embedding_attempts?: number
          embedding_error?: string | null
          embedding_status?: string
          external_id: string
          id?: string
          notice_type?: string | null
          ocid?: string | null
          primary_cpv?: string | null
          procedure_type?: string | null
          published_at?: string | null
          published_date?: string | null
          raw_json?: Json | null
          region?: string | null
          search_tsv?: unknown
          sector?: string | null
          source: string
          source_status?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["tender_status"]
          title?: string | null
          updated_at?: string | null
          value_high?: number | null
          value_low?: number | null
          value_max?: number | null
          value_min?: number | null
        }
        Update: {
          award_date?: string | null
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          buyer_type?: string | null
          contract_end?: string | null
          contract_start?: string | null
          country?: string | null
          cpv_codes?: string[] | null
          created_at?: string | null
          currency?: string | null
          deadline_at?: string | null
          deadline_date?: string | null
          derived_status?: string | null
          description?: string | null
          embedded_at?: string | null
          embedding?: string | null
          embedding_attempts?: number
          embedding_error?: string | null
          embedding_status?: string
          external_id?: string
          id?: string
          notice_type?: string | null
          ocid?: string | null
          primary_cpv?: string | null
          procedure_type?: string | null
          published_at?: string | null
          published_date?: string | null
          raw_json?: Json | null
          region?: string | null
          search_tsv?: unknown
          sector?: string | null
          source?: string
          source_status?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["tender_status"]
          title?: string | null
          updated_at?: string | null
          value_high?: number | null
          value_low?: number | null
          value_max?: number | null
          value_min?: number | null
        }
        Relationships: []
      }
      tenders_ccs: {
        Row: {
          award_date: string | null
          buyer_name: string | null
          buyer_name_canonical: string | null
          buyer_type: string | null
          contract_end: string | null
          contract_start: string | null
          country: string | null
          cpv_codes: string[] | null
          created_at: string
          currency: string | null
          deadline_at: string | null
          description: string | null
          external_id: string
          framework: string | null
          id: string
          lot: string | null
          notice_type: string | null
          primary_cpv: string | null
          procedure_type: string | null
          published_at: string | null
          raw_json: Json | null
          region: string | null
          sector: string | null
          source: string
          source_url: string | null
          status: string | null
          title: string | null
          updated_at: string
          value_max: number | null
          value_min: number | null
        }
        Insert: {
          award_date?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          buyer_type?: string | null
          contract_end?: string | null
          contract_start?: string | null
          country?: string | null
          cpv_codes?: string[] | null
          created_at?: string
          currency?: string | null
          deadline_at?: string | null
          description?: string | null
          external_id: string
          framework?: string | null
          id?: string
          lot?: string | null
          notice_type?: string | null
          primary_cpv?: string | null
          procedure_type?: string | null
          published_at?: string | null
          raw_json?: Json | null
          region?: string | null
          sector?: string | null
          source?: string
          source_url?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          value_max?: number | null
          value_min?: number | null
        }
        Update: {
          award_date?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          buyer_type?: string | null
          contract_end?: string | null
          contract_start?: string | null
          country?: string | null
          cpv_codes?: string[] | null
          created_at?: string
          currency?: string | null
          deadline_at?: string | null
          description?: string | null
          external_id?: string
          framework?: string | null
          id?: string
          lot?: string | null
          notice_type?: string | null
          primary_cpv?: string | null
          procedure_type?: string | null
          published_at?: string | null
          raw_json?: Json | null
          region?: string | null
          sector?: string | null
          source?: string
          source_url?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          value_max?: number | null
          value_min?: number | null
        }
        Relationships: []
      }
      tenders_cf_recent: {
        Row: {
          accelerated_justification: string | null
          additional_text: string | null
          approach_market_date: string | null
          attachments: Json | null
          awarded_date: string | null
          awarded_value: number | null
          closing_date: string | null
          closing_time: string | null
          contact_address1: string | null
          contact_address2: string | null
          contact_country: string | null
          contact_email: string | null
          contact_name: string | null
          contact_postcode: string | null
          contact_telephone: string | null
          contact_town: string | null
          contact_website: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          coordinates: string | null
          cpv_codes: string | null
          cpv_codes_extended: string | null
          cpv_description: string | null
          cpv_description_expanded: string | null
          created_at: string | null
          deadline_date: string | null
          description: string | null
          external_id: string | null
          is_sub_contract: boolean | null
          last_notifiable_update: string | null
          links: Json | null
          nationwide: boolean | null
          notice_id: string | null
          notice_identifier: string | null
          notice_type: string | null
          ocid: string | null
          ojeu_contract_type: string | null
          ojeu_procedure_type: string | null
          organisation_name: string | null
          organisation_name_canonical: string | null
          parent_reference: string | null
          postcode: string | null
          published_date: string | null
          raw_json: Json | null
          region: string | null
          region_text: string | null
          sector: string | null
          source: string | null
          status: string | null
          suitable_for_sme: boolean | null
          suitable_for_vco: boolean | null
          supplier_details: string | null
          supply_chain: string | null
          title: string | null
          value_high: number | null
          value_low: number | null
        }
        Insert: {
          accelerated_justification?: string | null
          additional_text?: string | null
          approach_market_date?: string | null
          attachments?: Json | null
          awarded_date?: string | null
          awarded_value?: number | null
          closing_date?: string | null
          closing_time?: string | null
          contact_address1?: string | null
          contact_address2?: string | null
          contact_country?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_postcode?: string | null
          contact_telephone?: string | null
          contact_town?: string | null
          contact_website?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          coordinates?: string | null
          cpv_codes?: string | null
          cpv_codes_extended?: string | null
          cpv_description?: string | null
          cpv_description_expanded?: string | null
          created_at?: string | null
          deadline_date?: string | null
          description?: string | null
          external_id?: string | null
          is_sub_contract?: boolean | null
          last_notifiable_update?: string | null
          links?: Json | null
          nationwide?: boolean | null
          notice_id?: string | null
          notice_identifier?: string | null
          notice_type?: string | null
          ocid?: string | null
          ojeu_contract_type?: string | null
          ojeu_procedure_type?: string | null
          organisation_name?: string | null
          organisation_name_canonical?: string | null
          parent_reference?: string | null
          postcode?: string | null
          published_date?: string | null
          raw_json?: Json | null
          region?: string | null
          region_text?: string | null
          sector?: string | null
          source?: string | null
          status?: string | null
          suitable_for_sme?: boolean | null
          suitable_for_vco?: boolean | null
          supplier_details?: string | null
          supply_chain?: string | null
          title?: string | null
          value_high?: number | null
          value_low?: number | null
        }
        Update: {
          accelerated_justification?: string | null
          additional_text?: string | null
          approach_market_date?: string | null
          attachments?: Json | null
          awarded_date?: string | null
          awarded_value?: number | null
          closing_date?: string | null
          closing_time?: string | null
          contact_address1?: string | null
          contact_address2?: string | null
          contact_country?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_postcode?: string | null
          contact_telephone?: string | null
          contact_town?: string | null
          contact_website?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          coordinates?: string | null
          cpv_codes?: string | null
          cpv_codes_extended?: string | null
          cpv_description?: string | null
          cpv_description_expanded?: string | null
          created_at?: string | null
          deadline_date?: string | null
          description?: string | null
          external_id?: string | null
          is_sub_contract?: boolean | null
          last_notifiable_update?: string | null
          links?: Json | null
          nationwide?: boolean | null
          notice_id?: string | null
          notice_identifier?: string | null
          notice_type?: string | null
          ocid?: string | null
          ojeu_contract_type?: string | null
          ojeu_procedure_type?: string | null
          organisation_name?: string | null
          organisation_name_canonical?: string | null
          parent_reference?: string | null
          postcode?: string | null
          published_date?: string | null
          raw_json?: Json | null
          region?: string | null
          region_text?: string | null
          sector?: string | null
          source?: string | null
          status?: string | null
          suitable_for_sme?: boolean | null
          suitable_for_vco?: boolean | null
          supplier_details?: string | null
          supply_chain?: string | null
          title?: string | null
          value_high?: number | null
          value_low?: number | null
        }
        Relationships: []
      }
      tenders_fts: {
        Row: {
          award_date: string | null
          buyer_id: string | null
          buyer_name: string | null
          buyer_name_canonical: string | null
          buyer_type: string | null
          contract_end: string | null
          contract_start: string | null
          country: string | null
          cpv_codes: string[] | null
          created_at: string | null
          currency: string | null
          deadline_at: string | null
          deadline_date: string | null
          description: string | null
          embedding: string | null
          external_id: string
          id: string
          notice_type: string | null
          ocid: string | null
          primary_cpv: string | null
          procedure_type: string | null
          published_at: string | null
          published_date: string | null
          raw_json: Json | null
          region: string | null
          search_tsv: unknown
          sector: string | null
          source: string
          source_url: string | null
          status: Database["public"]["Enums"]["tender_status"]
          title: string | null
          updated_at: string | null
          value_high: number | null
          value_low: number | null
          value_max: number | null
          value_min: number | null
        }
        Insert: {
          award_date?: string | null
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          buyer_type?: string | null
          contract_end?: string | null
          contract_start?: string | null
          country?: string | null
          cpv_codes?: string[] | null
          created_at?: string | null
          currency?: string | null
          deadline_at?: string | null
          deadline_date?: string | null
          description?: string | null
          embedding?: string | null
          external_id: string
          id?: string
          notice_type?: string | null
          ocid?: string | null
          primary_cpv?: string | null
          procedure_type?: string | null
          published_at?: string | null
          published_date?: string | null
          raw_json?: Json | null
          region?: string | null
          search_tsv?: unknown
          sector?: string | null
          source: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["tender_status"]
          title?: string | null
          updated_at?: string | null
          value_high?: number | null
          value_low?: number | null
          value_max?: number | null
          value_min?: number | null
        }
        Update: {
          award_date?: string | null
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          buyer_type?: string | null
          contract_end?: string | null
          contract_start?: string | null
          country?: string | null
          cpv_codes?: string[] | null
          created_at?: string | null
          currency?: string | null
          deadline_at?: string | null
          deadline_date?: string | null
          description?: string | null
          embedding?: string | null
          external_id?: string
          id?: string
          notice_type?: string | null
          ocid?: string | null
          primary_cpv?: string | null
          procedure_type?: string | null
          published_at?: string | null
          published_date?: string | null
          raw_json?: Json | null
          region?: string | null
          search_tsv?: unknown
          sector?: string | null
          source?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["tender_status"]
          title?: string | null
          updated_at?: string | null
          value_high?: number | null
          value_low?: number | null
          value_max?: number | null
          value_min?: number | null
        }
        Relationships: []
      }
      tenders_pcs: {
        Row: {
          award_date: string | null
          buyer_id: string | null
          buyer_name: string | null
          buyer_name_canonical: string | null
          buyer_type: string | null
          contract_end: string | null
          contract_start: string | null
          country: string | null
          cpv_codes: string[] | null
          created_at: string | null
          currency: string | null
          deadline_at: string | null
          deadline_date: string | null
          description: string | null
          embedding: string | null
          external_id: string
          id: string
          notice_type: string | null
          ocid: string | null
          primary_cpv: string | null
          procedure_type: string | null
          published_at: string | null
          published_date: string | null
          raw_json: Json | null
          region: string | null
          search_tsv: unknown
          sector: string | null
          source: string
          source_url: string | null
          status: Database["public"]["Enums"]["tender_status"]
          title: string | null
          updated_at: string | null
          value_high: number | null
          value_low: number | null
          value_max: number | null
          value_min: number | null
        }
        Insert: {
          award_date?: string | null
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          buyer_type?: string | null
          contract_end?: string | null
          contract_start?: string | null
          country?: string | null
          cpv_codes?: string[] | null
          created_at?: string | null
          currency?: string | null
          deadline_at?: string | null
          deadline_date?: string | null
          description?: string | null
          embedding?: string | null
          external_id: string
          id?: string
          notice_type?: string | null
          ocid?: string | null
          primary_cpv?: string | null
          procedure_type?: string | null
          published_at?: string | null
          published_date?: string | null
          raw_json?: Json | null
          region?: string | null
          search_tsv?: unknown
          sector?: string | null
          source: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["tender_status"]
          title?: string | null
          updated_at?: string | null
          value_high?: number | null
          value_low?: number | null
          value_max?: number | null
          value_min?: number | null
        }
        Update: {
          award_date?: string | null
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_name_canonical?: string | null
          buyer_type?: string | null
          contract_end?: string | null
          contract_start?: string | null
          country?: string | null
          cpv_codes?: string[] | null
          created_at?: string | null
          currency?: string | null
          deadline_at?: string | null
          deadline_date?: string | null
          description?: string | null
          embedding?: string | null
          external_id?: string
          id?: string
          notice_type?: string | null
          ocid?: string | null
          primary_cpv?: string | null
          procedure_type?: string | null
          published_at?: string | null
          published_date?: string | null
          raw_json?: Json | null
          region?: string | null
          search_tsv?: unknown
          sector?: string | null
          source?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["tender_status"]
          title?: string | null
          updated_at?: string | null
          value_high?: number | null
          value_low?: number | null
          value_max?: number | null
          value_min?: number | null
        }
        Relationships: []
      }
      user_actions: {
        Row: {
          action: string
          created_at: string | null
          id: string
          tender_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          tender_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          tender_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_actions_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ocds_cf_full: {
        Row: {
          accelerated: string | null
          award_contract_end: string | null
          award_contract_start: string | null
          award_status: string | null
          awarded_date: string | null
          awarded_supplier: string | null
          awarded_value: number | null
          buyer_id: string | null
          closing_date: string | null
          contact_address: string | null
          contact_country: string | null
          contact_email: string | null
          contact_name: string | null
          contact_telephone: string | null
          contact_town: string | null
          contact_website: string | null
          contract_end: string | null
          contract_start: string | null
          contract_type: string | null
          cpv_code: string | null
          cpv_description: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          future_notice_date: string | null
          is_vcse: string | null
          notice_identifier: string | null
          notice_type: string | null
          ocid: string | null
          ojeu_procedure_type: string | null
          organisation_name: string | null
          postcode: string | null
          procedure_type: string | null
          published_date: string | null
          region: string | null
          status: string | null
          suitable_for_sme: string | null
          suitable_for_vco: string | null
          supplier_size: string | null
          title: string | null
          value_high: number | null
          value_low: number | null
        }
        Relationships: []
      }
      tender_embedding_stats: {
        Row: {
          completed: number | null
          completed_last_365d: number | null
          failed: number | null
          pending: number | null
          processing: number | null
          skipped: number | null
          total: number | null
          total_last_365d: number | null
        }
        Relationships: []
      }
      tenders_cf: {
        Row: {
          buyer_name: string | null
          contact_email: string | null
          contact_name: string | null
          contact_telephone: string | null
          contract_end: string | null
          contract_start: string | null
          contract_type: string | null
          country: string | null
          created_at: string | null
          currency: string | null
          deadline_at: string | null
          description: string | null
          external_id: string | null
          ocid: string | null
          ojeu_procedure_type: string | null
          postcode: string | null
          primary_cpv: string | null
          procedure_type: string | null
          published_at: string | null
          raw_json: Json | null
          region: string | null
          source: string | null
          source_url: string | null
          status: string | null
          suitable_for_sme: string | null
          suitable_for_vco: string | null
          title: string | null
          value_max: number | null
          value_min: number | null
        }
        Insert: {
          buyer_name?: never
          contact_email?: never
          contact_name?: never
          contact_telephone?: never
          contract_end?: never
          contract_start?: never
          contract_type?: never
          country?: never
          created_at?: string | null
          currency?: never
          deadline_at?: never
          description?: never
          external_id?: never
          ocid?: never
          ojeu_procedure_type?: never
          postcode?: never
          primary_cpv?: never
          procedure_type?: never
          published_at?: never
          raw_json?: Json | null
          region?: never
          source?: never
          source_url?: never
          status?: never
          suitable_for_sme?: never
          suitable_for_vco?: never
          title?: never
          value_max?: never
          value_min?: never
        }
        Update: {
          buyer_name?: never
          contact_email?: never
          contact_name?: never
          contact_telephone?: never
          contract_end?: never
          contract_start?: never
          contract_type?: never
          country?: never
          created_at?: string | null
          currency?: never
          deadline_at?: never
          description?: never
          external_id?: never
          ocid?: never
          ojeu_procedure_type?: never
          postcode?: never
          primary_cpv?: never
          procedure_type?: never
          published_at?: never
          raw_json?: Json | null
          region?: never
          source?: never
          source_url?: never
          status?: never
          suitable_for_sme?: never
          suitable_for_vco?: never
          title?: never
          value_max?: never
          value_min?: never
        }
        Relationships: []
      }
      tenders_cf_bulk: {
        Row: {
          awarded_date: string | null
          awarded_supplier: string | null
          awarded_to_sme: string | null
          awarded_to_vco: string | null
          awarded_value: number | null
          closing_date: string | null
          contract_end: string | null
          contract_start: string | null
          cpv_codes: string | null
          cpv_description: string | null
          created_at: string | null
          description: string | null
          is_sub_contract: string | null
          nationwide: string | null
          notice_id: string | null
          notice_identifier: string | null
          notice_type: string | null
          ocid: string | null
          organisation_name: string | null
          payload_published_date: string | null
          postcode: string | null
          raw_json: Json | null
          region: string | null
          region_text: string | null
          sector: string | null
          status: string | null
          suitable_for_sme: string | null
          suitable_for_vco: string | null
          title: string | null
          value_high: number | null
          value_low: number | null
        }
        Insert: {
          awarded_date?: never
          awarded_supplier?: never
          awarded_to_sme?: never
          awarded_to_vco?: never
          awarded_value?: never
          closing_date?: never
          contract_end?: never
          contract_start?: never
          cpv_codes?: never
          cpv_description?: never
          created_at?: string | null
          description?: never
          is_sub_contract?: never
          nationwide?: never
          notice_id?: string | null
          notice_identifier?: string | null
          notice_type?: never
          ocid?: string | null
          organisation_name?: never
          payload_published_date?: never
          postcode?: never
          raw_json?: Json | null
          region?: never
          region_text?: never
          sector?: never
          status?: never
          suitable_for_sme?: never
          suitable_for_vco?: never
          title?: never
          value_high?: never
          value_low?: never
        }
        Update: {
          awarded_date?: never
          awarded_supplier?: never
          awarded_to_sme?: never
          awarded_to_vco?: never
          awarded_value?: never
          closing_date?: never
          contract_end?: never
          contract_start?: never
          cpv_codes?: never
          cpv_description?: never
          created_at?: string | null
          description?: never
          is_sub_contract?: never
          nationwide?: never
          notice_id?: string | null
          notice_identifier?: string | null
          notice_type?: never
          ocid?: string | null
          organisation_name?: never
          payload_published_date?: never
          postcode?: never
          raw_json?: Json | null
          region?: never
          region_text?: never
          sector?: never
          status?: never
          suitable_for_sme?: never
          suitable_for_vco?: never
          title?: never
          value_high?: never
          value_low?: never
        }
        Relationships: []
      }
      tenders_cf_full: {
        Row: {
          accelerated_justification: string | null
          additional_text: string | null
          approach_market_date: string | null
          attachments: Json | null
          awarded_date: string | null
          awarded_value: number | null
          closing_date: string | null
          closing_time: string | null
          contact_address1: string | null
          contact_address2: string | null
          contact_country: string | null
          contact_email: string | null
          contact_name: string | null
          contact_postcode: string | null
          contact_telephone: string | null
          contact_town: string | null
          contact_website: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          coordinates: string | null
          cpv_codes: string | null
          cpv_codes_extended: string | null
          cpv_description: string | null
          cpv_description_expanded: string | null
          created_at: string | null
          deadline_date: string | null
          description: string | null
          external_id: string | null
          is_sub_contract: boolean | null
          last_notifiable_update: string | null
          links: Json | null
          nationwide: boolean | null
          notice_id: string | null
          notice_identifier: string | null
          notice_type: string | null
          ocid: string | null
          ojeu_contract_type: string | null
          ojeu_procedure_type: string | null
          organisation_name: string | null
          parent_reference: string | null
          postcode: string | null
          published_date: string | null
          raw_json: Json | null
          region: string | null
          region_text: string | null
          sector: string | null
          source: string | null
          status: string | null
          suitable_for_sme: boolean | null
          suitable_for_vco: boolean | null
          supplier_details: string | null
          supply_chain: string | null
          title: string | null
          value_high: number | null
          value_low: number | null
        }
        Relationships: []
      }
      tenders_cf_full_mat: {
        Row: {
          buyer_name: string | null
          contact_email: string | null
          contact_name: string | null
          country: string | null
          created_at: string | null
          deadline_at: string | null
          description: string | null
          external_id: string | null
          primary_cpv: string | null
          published_at: string | null
          raw_json: Json | null
          source: string | null
          status: string | null
          title: string | null
          value_max: number | null
          value_min: number | null
        }
        Relationships: []
      }
      tenders_cf_native: {
        Row: {
          approach_market_date: string | null
          awarded_date: string | null
          awarded_supplier: string | null
          awarded_to_sme: string | null
          awarded_to_vco: string | null
          awarded_value: number | null
          closing_date: string | null
          contract_end: string | null
          contract_start: string | null
          coordinates: string | null
          cpv_codes: string | null
          cpv_codes_extended: string | null
          cpv_description: string | null
          created_at: string | null
          description: string | null
          is_sub_contract: string | null
          last_notifiable_update: string | null
          nationwide: string | null
          notice_id: string | null
          notice_identifier: string | null
          notice_type: string | null
          organisation_name: string | null
          parent_id: string | null
          postcode: string | null
          published_date: string | null
          raw_json: Json | null
          region: string | null
          region_text: string | null
          sector: string | null
          status: string | null
          suitable_for_sme: string | null
          suitable_for_vco: string | null
          title: string | null
          value_high: number | null
          value_low: number | null
        }
        Insert: {
          approach_market_date?: never
          awarded_date?: never
          awarded_supplier?: never
          awarded_to_sme?: never
          awarded_to_vco?: never
          awarded_value?: never
          closing_date?: never
          contract_end?: never
          contract_start?: never
          coordinates?: never
          cpv_codes?: never
          cpv_codes_extended?: never
          cpv_description?: never
          created_at?: string | null
          description?: never
          is_sub_contract?: never
          last_notifiable_update?: never
          nationwide?: never
          notice_id?: string | null
          notice_identifier?: never
          notice_type?: never
          organisation_name?: never
          parent_id?: never
          postcode?: never
          published_date?: never
          raw_json?: Json | null
          region?: never
          region_text?: never
          sector?: never
          status?: never
          suitable_for_sme?: never
          suitable_for_vco?: never
          title?: never
          value_high?: never
          value_low?: never
        }
        Update: {
          approach_market_date?: never
          awarded_date?: never
          awarded_supplier?: never
          awarded_to_sme?: never
          awarded_to_vco?: never
          awarded_value?: never
          closing_date?: never
          contract_end?: never
          contract_start?: never
          coordinates?: never
          cpv_codes?: never
          cpv_codes_extended?: never
          cpv_description?: never
          created_at?: string | null
          description?: never
          is_sub_contract?: never
          last_notifiable_update?: never
          nationwide?: never
          notice_id?: string | null
          notice_identifier?: never
          notice_type?: never
          organisation_name?: never
          parent_id?: never
          postcode?: never
          published_date?: never
          raw_json?: Json | null
          region?: never
          region_text?: never
          sector?: never
          status?: never
          suitable_for_sme?: never
          suitable_for_vco?: never
          title?: never
          value_high?: never
          value_low?: never
        }
        Relationships: []
      }
      tenders_master: {
        Row: {
          award_date: string | null
          buyer_name: string | null
          buyer_type: string | null
          contract_end: string | null
          contract_start: string | null
          country: string | null
          created_at: string | null
          currency: string | null
          deadline_at: string | null
          description: string | null
          external_id: string | null
          notice_type: string | null
          primary_cpv: string | null
          procedure_type: string | null
          published_at: string | null
          region: string | null
          sector: string | null
          source: string | null
          source_url: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          value_max: number | null
          value_min: number | null
        }
        Relationships: []
      }
      v_status_coverage: {
        Row: {
          total: number | null
          unknown_count: number | null
          with_derived_status: number | null
          with_source_status: number | null
        }
        Relationships: []
      }
      v_status_coverage_by_source: {
        Row: {
          source: string | null
          total: number | null
          unknown_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      backfill_status_all: { Args: { p_limit?: number }; Returns: number }
      backfill_status_cs: { Args: never; Returns: number }
      backfill_status_fts: { Args: { p_limit: number }; Returns: number }
      backfill_status_notices: { Args: { p_limit: number }; Returns: number }
      backfill_status_ted: { Args: { p_limit: number }; Returns: number }
      canonicalize_org_name: { Args: { s: string }; Returns: string }
      compute_derived_status: {
        Args: {
          p_award_date: string
          p_deadline_at: string
          p_notice_type: string
          p_raw_json: Json
          p_source: string
          p_source_status: string
        }
        Returns: string
      }
      current_org_id: { Args: never; Returns: string }
      is_org_admin: { Args: never; Returns: boolean }
      normalize_org_name: { Args: { s: string }; Returns: string }
      normalize_status_string: { Args: { s: string }; Returns: string }
      refresh_tenders_cf_full_mat: { Args: never; Returns: undefined }
      safe_ts: { Args: { t: string }; Returns: string }
      search_tenders_hybrid:
        | {
            Args: {
              cpv_prefix?: string
              match_count?: number
              query_embedding: string
              query_text: string
              since_ts?: string
            }
            Returns: {
              buyer_name: string
              cpv_score: number
              external_id: string
              hybrid_score: number
              id: string
              keyword_score: number
              semantic_score: number
              source: string
              title: string
            }[]
          }
        | {
            Args: {
              cpv_prefix?: string
              cpv_prefixes?: string[]
              expansion_terms?: string[]
              match_count?: number
              query_embedding: string
              query_text: string
              since_ts?: string
              w_cpv?: number
              w_keyword?: number
              w_semantic?: number
            }
            Returns: {
              buyer_name: string
              cpv_score: number
              external_id: string
              hybrid_score: number
              id: string
              keyword_score: number
              matched_cpvs: string[]
              matched_terms: string[]
              semantic_score: number
              source: string
              title: string
            }[]
          }
        | {
            Args: {
              active_only?: boolean
              context_terms?: string[]
              core_terms?: string[]
              cpv_prefix?: string
              cpv_prefixes?: string[]
              expansion_terms?: string[]
              match_count?: number
              query_embedding: string
              query_text: string
              since_ts?: string
              w_cpv?: number
              w_keyword?: number
              w_semantic?: number
            }
            Returns: {
              bonus_score: number
              buyer_name: string
              cpv_score: number
              derived_status: string
              external_id: string
              final_display_status: string
              hybrid_score: number
              id: string
              keyword_score: number
              match_quality: string
              matched_cpvs: string[]
              matched_terms: string[]
              penalty_score: number
              semantic_score: number
              source: string
              source_bonus: number
              status_bonus: number
              title: string
            }[]
          }
        | {
            Args: {
              active_only?: boolean
              context_terms?: string[]
              core_terms?: string[]
              cpv_prefix?: string
              cpv_prefixes?: string[]
              expansion_terms?: string[]
              intent_domain?: string
              match_count?: number
              query_embedding: string
              query_text: string
              since_ts?: string
              w_cpv?: number
              w_keyword?: number
              w_semantic?: number
            }
            Returns: {
              bonus_score: number
              buyer_name: string
              cpv_score: number
              derived_status: string
              external_id: string
              final_display_status: string
              hybrid_score: number
              id: string
              intent_mismatch: boolean
              intent_penalty: number
              keyword_score: number
              match_quality: string
              matched_cpvs: string[]
              matched_terms: string[]
              penalty_score: number
              semantic_score: number
              source: string
              source_bonus: number
              status_bonus: number
              title: string
            }[]
          }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      bid_status:
        | "selected"
        | "created"
        | "submitted"
        | "won"
        | "lost"
        | "withdrawn"
      org_role: "admin" | "member"
      tender_status:
        | "unknown"
        | "active"
        | "cancelled"
        | "complete"
        | "withdrawn"
        | "planned"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      bid_status: [
        "selected",
        "created",
        "submitted",
        "won",
        "lost",
        "withdrawn",
      ],
      org_role: ["admin", "member"],
      tender_status: [
        "unknown",
        "active",
        "cancelled",
        "complete",
        "withdrawn",
        "planned",
      ],
    },
  },
} as const
