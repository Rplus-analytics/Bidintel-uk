import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "contracts:recent-searches";
const MAX = 5;

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(items: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX))); } catch { /* ignore */ }
}

/** Push a search phrase to the recent list (dedup, most-recent first). */
export function pushRecentSearch(term: string) {
  const t = term.trim();
  if (!t) return;
  const current = read();
  const next = [t, ...current.filter((s) => s.toLowerCase() !== t.toLowerCase())].slice(0, MAX);
  write(next);
  window.dispatchEvent(new CustomEvent("recent-searches:changed"));
}

/** Read the current recent searches list from localStorage. */
export function readRecentSearches(): string[] {
  return read();
}

interface Props {
  visible: boolean;
  onSelect: (term: string) => void;
}

/**
 * Recent Searches chips for the discovery panel.
 * Storage-only feature — no backend, no metadata.
 */
export function RecentSearches({ visible, onSelect }: Props) {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    setItems(read());
    const handler = () => setItems(read());
    window.addEventListener("recent-searches:changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("recent-searches:changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const clear = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setItems([]);
    window.dispatchEvent(new CustomEvent("recent-searches:changed"));
  }, []);

  if (!visible || items.length === 0) return null;

  return (
    <div className="min-w-0">
      <div className="flex flex-row items-center justify-between gap-3 mb-1.5">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Recent searches</div>
        <button
          type="button"
          onClick={clear}
          className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline whitespace-nowrap"
          aria-label="Clear recent searches"
        >
          Clear recent searches
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Recent searches">
        {items.map((term) => (
          <button
            key={term}
            type="button"
            onClick={() => onSelect(term)}
            className="inline-flex items-center rounded-full border border-border bg-secondary px-3 py-1 text-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {term}
          </button>
        ))}
      </div>
    </div>
  );
}

