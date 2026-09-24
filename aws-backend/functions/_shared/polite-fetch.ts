// ============================================================================
// Rate-limit-aware fetch for the upstream OCDS APIs
// ============================================================================
//
// WHY: the first clean catch-up run hit
//
//   429  "Rate limit of 12 exceeded. Please retry after 120 seconds."
//
// on page 23 of Find a Tender and page 3 of Contracts Finder. The run stopped
// mid-window, and — correctly — the watermark did not advance, because a
// truncated window is not a retrieved one. But that means the catch-up can
// never finish: every run would race to the same limit and stop.
//
// So the client has to pace itself. Two mechanisms, deliberately both:
//
//   PACING   a minimum interval between requests, so the limit is not reached
//            in the first place. This is the part that matters — backing off
//            only after being told off is how a client earns a block, and these
//            APIs have already blocked one of our platforms.
//
//   BACKOFF  honouring Retry-After when the limit is hit anyway (another client
//            on the same egress IP, a tightened limit, a burst from a retry).
//
// "Rate limit of 12" is not documented as a period. Twelve per minute is the
// conservative reading, so the default pace is one request per 5s — under that
// ceiling with room for clock skew and for a second function running
// concurrently against the same host.

// 5s proved to be exactly at the edge: Contracts Finder ran clean at that pace,
// Find a Tender still hit 429 on page 3. "Rate limit of 12" is most likely 12
// per minute, so 5s sits precisely on the ceiling with no headroom for clock
// skew, a retry, or a second function sharing the egress IP. 7s leaves room.
const DEFAULT_MIN_INTERVAL_MS = 7_000;

/** Hard ceiling on adaptive slow-down, so a mis-set limit cannot stall a run. */
const MAX_INTERVAL_MS = 30_000;
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 150_000;

/** Last request time per host, so two call sites in one container still pace together. */
const lastRequestAt = new Map<string, number>();

/**
 * Per-host pace, widened whenever that host answers 429.
 *
 * A fixed interval is a guess about someone else's limit. Backing off and
 * STAYING backed off for the rest of the invocation turns the guess into a
 * measurement: the run settles at a pace the server actually tolerates instead
 * of rediscovering the limit on every page.
 */
const hostInterval = new Map<string, number>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface PoliteOptions extends RequestInit {
  /** Override the minimum gap between requests to this host. */
  minIntervalMs?: number;
  /** Stop retrying if fewer than this many ms of Lambda budget remain. */
  remainingMs?: () => number;
}

/**
 * fetch(), paced per host and retrying on 429 / 503 with Retry-After.
 *
 * Returns the final Response. A 429 that survives MAX_RETRIES is returned as-is
 * so the caller records it and leaves the watermark alone — failing loudly
 * beats looping until the Lambda times out.
 */
export async function politeFetch(url: string, init: PoliteOptions = {}): Promise<Response> {
  const { minIntervalMs = DEFAULT_MIN_INTERVAL_MS, remainingMs, ...rest } = init;
  const host = new URL(url).host;

  for (let attempt = 0; ; attempt++) {
    const pace = Math.max(minIntervalMs, hostInterval.get(host) ?? 0);
    const since = Date.now() - (lastRequestAt.get(host) ?? 0);
    if (since < pace) await sleep(pace - since);
    lastRequestAt.set(host, Date.now());

    const res = await fetch(url, rest);
    if (res.status !== 429 && res.status !== 503) return res;
    if (attempt >= MAX_RETRIES) return res;

    // Retry-After is seconds here; the spec also allows an HTTP date.
    const header = res.headers.get("retry-after");
    let waitMs = header && /^\d+$/.test(header.trim())
      ? Number(header.trim()) * 1000
      : 2000 * Math.pow(2, attempt);
    waitMs = Math.min(waitMs, MAX_RETRY_AFTER_MS);

    // Do not start a wait the invocation cannot finish: timing out mid-window
    // loses the run's progress AND its error report.
    if (remainingMs && remainingMs() < waitMs + 20_000) {
      console.warn(JSON.stringify({ politeFetch: "giving up", host, waitMs, remaining: remainingMs() }));
      return res;
    }

    // Slow down for the remainder of this invocation, not just this retry.
    const widened = Math.min(Math.round(Math.max(minIntervalMs, hostInterval.get(host) ?? 0) * 1.5), MAX_INTERVAL_MS);
    hostInterval.set(host, widened);

    console.warn(JSON.stringify({
      politeFetch: "rate limited", host, status: res.status, waitMs, attempt, newPaceMs: widened,
    }));
    await sleep(waitMs);
  }
}
