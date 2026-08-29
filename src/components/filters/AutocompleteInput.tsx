import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface AutocompleteSuggestion {
  value: string;
  label?: string;
  hint?: string;
}

interface AutocompleteInputProps {
  value: string;
  onChange: (v: string) => void;
  onSelect?: (s: AutocompleteSuggestion) => void;
  suggestions: AutocompleteSuggestion[];
  placeholder?: string;
  className?: string;
  minChars?: number;
  emptyHint?: string;
}

/**
 * Lightweight typeahead input. Suggestions are passed in by the parent
 * (already-debounced) and rendered in a floating dropdown.
 */
export function AutocompleteInput({
  value,
  onChange,
  onSelect,
  suggestions,
  placeholder,
  className,
  minChars = 2,
  emptyHint,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setFocusIdx(0);
  }, [suggestions.length]);

  const showDropdown = open && value.trim().length >= minChars && (suggestions.length > 0 || !!emptyHint);

  const apply = (s: AutocompleteSuggestion) => {
    onChange(s.value);
    onSelect?.(s);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showDropdown) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setFocusIdx((i) => Math.min(suggestions.length - 1, i + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setFocusIdx((i) => Math.max(0, i - 1)); }
          else if (e.key === "Enter" && suggestions[focusIdx]) {
            e.preventDefault();
            apply(suggestions[focusIdx]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showDropdown && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          {suggestions.length === 0 && emptyHint && (
            <div className="px-3 py-2 text-xs text-muted-foreground">{emptyHint}</div>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${s.value}-${i}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); apply(s); }}
              onMouseEnter={() => setFocusIdx(i)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3",
                i === focusIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
            >
              <span className="truncate">{s.label ?? s.value}</span>
              {s.hint && <span className="text-[10px] uppercase text-muted-foreground shrink-0">{s.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
