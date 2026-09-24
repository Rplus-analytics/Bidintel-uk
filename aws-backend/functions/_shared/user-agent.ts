// ============================================================================
// The User-Agent these workers present to upstream APIs
// ============================================================================
//
// WHAT IT REPLACED, and why that mattered:
//
//   "Mozilla/5.0 BidIntel/1.0"                                    (9 functions)
//   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/..."   (scrape-cf-notice)
//
// Both claim to be a browser. Neither is one. That is worth removing on two
// separate grounds:
//
// 1. IT IS FALSE, and these are UK public-sector APIs whose terms expect
//    automated clients to identify themselves. A contact point is what lets an
//    operator throttle or email us instead of silently blocking us.
//
// 2. IT IS A PLAUSIBLE CAUSE OF THE 403s. Find a Tender and Contracts Finder
//    began returning 403 to the old platform from 9 Sep, and Public Contracts
//    Scotland from May. A browser User-Agent arriving from a datacentre IP at a
//    fixed hourly cadence is a common signature for exactly that kind of block.
//    Unproven — the same requests succeed from here and from AWS today — but
//    presenting an honest identity removes the most likely trigger rather than
//    daring the next one.
//
// Deliberately NOT a different browser string. Rotating or disguising the
// client would be trying to evade a block rather than not earn one, and would
// make the next 403 harder to diagnose, not easier.

const CONTACT = process.env.INGEST_CONTACT_URL
  ?? "https://bidintel.rplusai.co.uk";

/** e.g. `BidIntel/1.0 (+https://bidintel.rplusai.co.uk; automated procurement data collection)` */
export const USER_AGENT =
  `BidIntel/1.0 (+${CONTACT}; automated procurement data collection)`;

/** Standard headers for a JSON upstream fetch. */
export const jsonFetchHeaders: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": USER_AGENT,
};
