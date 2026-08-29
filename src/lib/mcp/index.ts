import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchTenders from "./tools/search-tenders";
import getTender from "./tools/get-tender";
import listSavedBids from "./tools/list-saved-bids";
import listSavedSearches from "./tools/list-saved-searches";
import searchAwards from "./tools/search-awards";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "bidintel-mcp",
  title: "BidIntel",
  version: "0.1.0",
  instructions:
    "Tools for BidIntel, a UK public sector tender and contract intelligence platform. Use `search_tenders` to find notices, `get_tender` for full detail of one notice, `search_awards` for awarded contracts by supplier or buyer, and `list_saved_bids` / `list_saved_searches` to read the signed-in user's own pipeline and alert configuration. All data is scoped to the authenticated user's organisation.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchTenders, getTender, searchAwards, listSavedBids, listSavedSearches],
});
