// Shared autocomplete inputs used by both the Contracts Search page and the
// Create Saved Search dialog. Keeps a single source of truth for buyer / CPV
// suggestion logic — both screens consume the same hooks
// (useBuyerSuggestions, useCpvSuggestions) and the same AutocompleteInput.
import { AutocompleteInput } from "@/components/filters/AutocompleteInput";
import {
  useBuyerSuggestions,
  useSupplierSuggestions,
  useFrameworkSuggestions,
  useCpvSuggestions,
} from "@/hooks/useFilterSuggestions";

export function BuyerAutocomplete({
  value, onChange, placeholder = "e.g. NHS, Council",
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const items = useBuyerSuggestions(value);
  return (
    <AutocompleteInput
      value={value}
      onChange={onChange}
      suggestions={items.map((n) => ({ value: n }))}
      placeholder={placeholder}
      emptyHint="No matching buyers"
    />
  );
}

export function SupplierAutocomplete({
  value, onChange, placeholder = "Supplier name",
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const items = useSupplierSuggestions(value);
  return (
    <AutocompleteInput
      value={value}
      onChange={onChange}
      suggestions={items.map((n) => ({ value: n }))}
      placeholder={placeholder}
      emptyHint="No matching suppliers"
    />
  );
}

export function FrameworkAutocomplete({
  value, onChange, placeholder = "e.g. CCS, G-Cloud, RM6",
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const items = useFrameworkSuggestions(value);
  return (
    <AutocompleteInput
      value={value}
      onChange={onChange}
      suggestions={items.map((n) => ({ value: n }))}
      placeholder={placeholder}
      emptyHint="No matching frameworks"
    />
  );
}

export function CpvAutocomplete({
  value, onChange, placeholder = "Search by code or service category",
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const items = useCpvSuggestions(value);
  return (
    <AutocompleteInput
      value={value}
      onChange={onChange}
      suggestions={items.map((c) => ({ value: c.code, label: `${c.code} — ${c.label}`, hint: "CPV" }))}
      placeholder={placeholder}
      emptyHint="Type 2+ characters"
    />
  );
}
