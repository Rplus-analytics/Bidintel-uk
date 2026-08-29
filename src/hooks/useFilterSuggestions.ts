import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lightweight debounced suggestion fetchers backed by Supabase.
 * All queries are limited and aimed at typeahead use only.
 */

function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useBuyerSuggestions(query: string, enabled = true) {
  const q = useDebounced(query.trim(), 200);
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled || q.length < 2) { setItems([]); return; }
    let cancelled = false;
    (async () => {
      // Search on canonical field so "DWP" matches "Department for Work and Pensions"
      const { data } = await supabase
        .from("buyers")
        .select("name, name_canonical")
        .or(`name_canonical.ilike.%${q.toLowerCase()}%,name.ilike.%${q}%`)
        .order("name")
        .limit(30);
      if (cancelled) return;
      // Dedupe by canonical: one entity = one suggestion
      const seen = new Set<string>();
      const out: string[] = [];
      for (const r of (data || []) as any[]) {
        const key = r.name_canonical || (r.name || "").toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (r.name) out.push(r.name);
        if (out.length >= 8) break;
      }
      setItems(out);
    })();
    return () => { cancelled = true; };
  }, [q, enabled]);
  return items;
}

export function useSupplierSuggestions(query: string, enabled = true) {
  const q = useDebounced(query.trim(), 200);
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled || q.length < 2) { setItems([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("name, name_canonical")
        .or(`name_canonical.ilike.%${q.toLowerCase()}%,name.ilike.%${q}%`)
        .order("name")
        .limit(30);
      if (cancelled) return;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const r of (data || []) as any[]) {
        const key = r.name_canonical || (r.name || "").toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (r.name) out.push(r.name);
        if (out.length >= 8) break;
      }
      setItems(out);
    })();
    return () => { cancelled = true; };
  }, [q, enabled]);
  return items;
}

export function useFrameworkSuggestions(query: string, enabled = true) {
  const q = useDebounced(query.trim(), 200);
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled || q.length < 2) { setItems([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("frameworks")
        .select("name, reference")
        .or(`name.ilike.%${q}%,reference.ilike.%${q}%`)
        .limit(8);
      if (cancelled) return;
      const labels = Array.from(new Set(
        (data || []).flatMap((r: any) => [r.reference, r.name]).filter(Boolean)
      )) as string[];
      setItems(labels.slice(0, 8));
    })();
    return () => { cancelled = true; };
  }, [q, enabled]);
  return items;
}

export interface CpvSuggestion { code: string; label: string }
export function useCpvSuggestions(query: string, enabled = true) {
  const q = useDebounced(query.trim(), 200);
  const [items, setItems] = useState<CpvSuggestion[]>([]);
  useEffect(() => {
    if (!enabled || q.length < 2) { setItems([]); return; }
    let cancelled = false;
    (async () => {
      const isNumeric = /^\d+$/.test(q);
      const { data } = await supabase
        .from("cpv_codes")
        .select("code, label_en")
        .or(isNumeric ? `code.like.${q}%` : `label_en.ilike.%${q}%`)
        .limit(8);
      if (cancelled) return;
      setItems((data || []).map((r: any) => ({ code: r.code, label: r.label_en || r.code })));
    })();
    return () => { cancelled = true; };
  }, [q, enabled]);
  return items;
}
