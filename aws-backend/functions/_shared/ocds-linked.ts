// Shared helpers to populate linked tables from an OCDS release.
//
// PORTED BYTE-IDENTICAL from supabase/functions/_shared/ocds-linked.ts.
// Not one character of the body below differs from the Deno original: the file
// has no imports and takes its database handle as the `supabase` parameter, so
// nothing needed converting. It now receives the stub client from ./db.ts.
// Verified by diff — see aws-backend/README.md.
//
// Shared helpers to populate linked tables from an OCDS release.
// Used by ingest-fts and ingest-cf.

// ---------- TED v3 (flat) extractor ----------
// TED returns a flat document, not an OCDS release. The search response has no
// lots / awards / documents, so we just enrich the tender row itself + seed CPV.
function firstStr(v: any): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = firstStr(x);
      if (s) return s;
    }
    return null;
  }
  if (typeof v === "object") {
    const eng = v.eng ?? v.ENG ?? v.en;
    if (eng) return firstStr(eng);
    for (const x of Object.values(v)) {
      const s = firstStr(x);
      if (s) return s;
    }
  }
  return null;
}

export async function enrichTedTender(
  supabase: any,
  tenderId: string,
  raw: any,
): Promise<{ errors: any[] }> {
  const errors: any[] = [];
  if (!raw || typeof raw !== "object") return { errors };

  const cpvRaw = raw["classification-cpv"];
  const cpvList: string[] = (Array.isArray(cpvRaw) ? cpvRaw : [cpvRaw])
    .filter((x: any) => typeof x === "string");
  const primaryCpv = cpvList[0] ?? null;

  const country = firstStr(raw["CY"]) ?? firstStr(raw["country"]);
  const noticeType = firstStr(raw["notice-type"]);
  const region =
    firstStr(raw["place-of-performance"]) ??
    firstStr(raw["place-performance"]);

  const isAward =
    !!noticeType && /award|cont-award|can|result/i.test(noticeType);
  const status = isAward ? "complete" : "active";

  const update: any = { status };
  if (primaryCpv) update.primary_cpv = primaryCpv;
  if (country) update.country = country;
  if (noticeType) update.notice_type = noticeType;
  if (region) update.region = region;

  const { error } = await supabase
    .from("tenders")
    .update(update)
    .eq("id", tenderId);
  if (error) errors.push({ ted_enrich: error.message });

  if (cpvList.length) {
    const seen = new Set<string>();
    const cpvRows = cpvList
      .filter((c) => (seen.has(c) ? false : (seen.add(c), true)))
      .map((c, i) => ({
        tender_id: tenderId,
        cpv_code: c,
        cpv_description: null,
        is_primary: i === 0,
      }));
    const { error: ce } = await supabase
      .from("tender_cpv")
      .upsert(cpvRows, { onConflict: "tender_id,cpv_code" });
    if (ce) errors.push({ ted_cpv: ce.message });
  }

  return { errors };
}


export async function upsertLinkedFromRelease(
  supabase: any,
  source: string,
  release: any,
  tenderId: string,
  buyerCountryDefault = "GB",
): Promise<{ errors: any[] }> {
  const errors: any[] = [];
  const t = release?.tender ?? {};
  const parties: any[] = release?.parties ?? [];

  // ---- Buyer ----
  let buyerId: string | null = null;
  const buyerName: string | undefined = release?.buyer?.name;
  if (buyerName) {
    const buyerParty = parties.find((p) => p?.id === release?.buyer?.id) ?? {};
    const addr = buyerParty?.address ?? {};
    const buyerExtId: string | null = release?.buyer?.id
      ? `${source}:${release.buyer.id}`
      : null;
    const externalIds: any = {};
    if (release?.buyer?.id) externalIds[source] = release.buyer.id;
    const row: any = {
      name: buyerName,
      country: addr.countryName ?? buyerCountryDefault,
      region: addr.region ?? addr.locality ?? null,
      external_ids: externalIds,
      last_seen_at: new Date().toISOString(),
    };
    if (buyerExtId) row.external_id = buyerExtId;
    const { data: bu, error: be } = await supabase
      .from("buyers")
      .upsert(row, { onConflict: buyerExtId ? "external_id" : "name" })
      .select("id")
      .single();
    if (be) errors.push({ buyer: be.message });
    else {
      buyerId = bu.id;
      await supabase.from("tenders").update({ buyer_id: buyerId }).eq("id", tenderId);
    }
  }

  // ---- CPV codes ----
  const cpvSet = new Map<string, string | null>();
  const addCpv = (c: any) => {
    if (c?.scheme === "CPV" && c?.id) {
      const code = String(c.id);
      if (!cpvSet.has(code)) cpvSet.set(code, c.description ?? null);
    }
  };
  addCpv(t?.classification);
  for (const ac of t?.additionalClassifications ?? []) addCpv(ac);
  for (const item of t?.items ?? []) {
    addCpv(item?.classification);
    for (const ac of item?.additionalClassifications ?? []) addCpv(ac);
  }
  const cpvRows = Array.from(cpvSet.entries()).map(([code, desc], i) => ({
    tender_id: tenderId,
    cpv_code: code,
    cpv_description: desc,
    is_primary: i === 0,
  }));
  if (cpvRows.length) {
    const { error } = await supabase
      .from("tender_cpv")
      .upsert(cpvRows, { onConflict: "tender_id,cpv_code" });
    if (error) errors.push({ tender_cpv: error.message });
  }

  // ---- Lots ----
  const lots: any[] = t?.lots ?? [];
  if (lots.length) {
    const lotRows = lots.map((l: any) => {
      const minV = l.value?.minimumValue?.amount;
      const maxV = l.value?.maximumValue?.amount;
      const flatV = l.value?.amount;
      return {
        tender_id: tenderId,
        lot_number: String(l.id ?? ""),
        title: l.title ?? null,
        description: l.description ?? null,
        value_low: typeof minV === "number" ? minV : (typeof flatV === "number" ? flatV : null),
        value_high: typeof maxV === "number" ? maxV : (typeof flatV === "number" ? flatV : null),
        currency: l.value?.currency ?? "GBP",
        status: l.status ?? null,
        raw_json: l,
      };
    }).filter((r) => r.lot_number);
    if (lotRows.length) {
      const { error } = await supabase
        .from("tender_lots")
        .upsert(lotRows, { onConflict: "tender_id,lot_number" });
      if (error) errors.push({ tender_lots: error.message });
    }
  }

  // ---- Documents ----
  const docs: any[] = [
    ...(t?.documents ?? []),
    ...((release?.awards ?? []).flatMap((a: any) => a?.documents ?? [])),
  ];
  if (docs.length) {
    // No unique constraint; clear then insert to keep idempotent.
    await supabase.from("tender_documents").delete().eq("tender_id", tenderId);
    const docRows = docs
      .filter((d) => d?.url)
      .map((d) => ({
        tender_id: tenderId,
        title: d.title ?? null,
        url: d.url,
        document_type: d.documentType ?? null,
        language: d.language ?? "en",
        published_at: d.datePublished ? new Date(d.datePublished).toISOString() : null,
      }));
    if (docRows.length) {
      const { error } = await supabase.from("tender_documents").insert(docRows);
      if (error) errors.push({ tender_documents: error.message });
    }
  }

  // ---- Awards + suppliers ----
  const awards: any[] = release?.awards ?? [];

  // Propagate contract period from first award (or tender) onto the tender row.
  const cpStart =
    awards?.[0]?.contractPeriod?.startDate ?? t?.contractPeriod?.startDate ?? null;
  const cpEnd =
    awards?.[0]?.contractPeriod?.endDate ?? t?.contractPeriod?.endDate ?? null;
  if (cpStart || cpEnd) {
    const upd: any = {};
    if (cpStart) upd.contract_start = new Date(cpStart).toISOString();
    if (cpEnd) upd.contract_end = new Date(cpEnd).toISOString();
    const { error: cpe } = await supabase.from("tenders").update(upd).eq("id", tenderId);
    if (cpe) errors.push({ contract_period: cpe.message });
  }

  for (const a of awards) {
    const ext = a?.id ? `${release.ocid ?? release.id}:${a.id}` : null;
    if (!ext) continue;
    const { data: aw, error: ae } = await supabase
      .from("awards")
      .upsert(
        {
          source,
          external_id: ext,
          notice_id: null,
          buyer_id: buyerId,
          buyer_name: buyerName ?? null,
          supplier_name: a?.suppliers?.[0]?.name ?? null,
          award_value: typeof a?.value?.amount === "number" ? a.value.amount : null,
          currency: a?.value?.currency ?? "GBP",
          awarded_at: a?.date ? new Date(a.date).toISOString() : null,
          contract_start: a?.contractPeriod?.startDate
            ? new Date(a.contractPeriod.startDate).toISOString()
            : null,
          contract_end: a?.contractPeriod?.endDate
            ? new Date(a.contractPeriod.endDate).toISOString()
            : null,
          cpv_code: t?.classification?.id ?? null,
          raw: a,
        },
        { onConflict: "source,external_id" },
      )
      .select("id")
      .single();
    if (ae) {
      errors.push({ awards: ae.message });
      continue;
    }
    const awardId = aw.id;

    for (const s of a?.suppliers ?? []) {
      if (!s?.name) continue;
      const supExtId: string | null = s?.id ? `${source}:${s.id}` : null;
      const supRow: any = { name: s.name, last_seen_at: new Date().toISOString() };
      if (supExtId) supRow.external_id = supExtId;
      const { data: sup, error: se } = await supabase
        .from("suppliers")
        .upsert(supRow, { onConflict: supExtId ? "external_id" : "name" })
        .select("id")
        .single();
      if (se) {
        errors.push({ supplier: se.message });
        continue;
      }
      const { error: linkErr } = await supabase
        .from("award_suppliers")
        .upsert(
          { award_id: awardId, supplier_id: sup.id, is_lead: true },
          { onConflict: "award_id,supplier_id" },
        );
      if (linkErr) errors.push({ award_suppliers: linkErr.message });
    }
  }

  return { errors };
}
