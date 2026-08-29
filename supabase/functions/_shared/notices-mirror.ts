// Mirrors tender rows into the notices table so the legacy notices feed stays
// in sync with new ingest. Mapping matches the one-off backfill SQL.
//
// Schema notes:
//   notices.title is NOT NULL — rows without a title are skipped.
//   Unique key (source, external_id) used for upsert.

export interface TenderRowLike {
  source: string;
  external_id: string;
  title?: string | null;
  description?: string | null;
  buyer_name?: string | null;
  value_min?: number | null;
  value_max?: number | null;
  currency?: string | null;
  status?: string | null;
  published_at?: string | null;
  deadline_at?: string | null;
  primary_cpv?: string | null;
  notice_type?: string | null;
  source_url?: string | null;
  raw_json?: any;
  country?: string | null;
  region?: string | null;
  procedure_type?: string | null;
}

export async function mirrorTendersToNotices(
  supabase: any,
  rows: TenderRowLike[],
): Promise<{ count: number; error?: string }> {
  if (!rows?.length) return { count: 0 };
  const noticeRows = rows
    .filter((t) => t.title)
    .map((t) => ({
      source: t.source,
      external_id: t.external_id,
      title: t.title,
      buyer: t.buyer_name ?? null,
      description: t.description ?? null,
      value: t.value_min ?? null,
      value_high: t.value_max ?? null,
      currency: t.currency ?? null,
      status: t.status ?? null,
      published_date: t.published_at ?? null,
      deadline_date: t.deadline_at ?? null,
      cpv_code: t.primary_cpv ?? null,
      notice_type: t.notice_type ?? null,
      link: t.source_url ?? null,
      raw: t.raw_json ?? null,
      country: t.country ?? null,
      region: t.region ?? null,
      procedure_type: t.procedure_type ?? null,
      source_url: t.source_url ?? null,
      updated_at: new Date().toISOString(),
    }));
  if (!noticeRows.length) return { count: 0 };
  const { error } = await supabase
    .from("notices")
    .upsert(noticeRows, { onConflict: "source,external_id" });
  if (error) return { count: 0, error: error.message };
  return { count: noticeRows.length };
}
