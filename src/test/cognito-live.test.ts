// LIVE end-to-end test of the NEW_PASSWORD_REQUIRED flow.
//
// Skipped unless BIDINTEL_LIVE_AUTH_USER / _PASSWORD are set, so `npm test`
// stays offline and deterministic. Run it with scripts/test-live-auth.sh, which
// provisions a throwaway FORCE_CHANGE_PASSWORD user, runs this, and deletes it.
//
// WHY IT EXISTS: this flow broke twice in ways no type check or unit test could
// catch, because both failures were Cognito rejecting a request the client was
// perfectly happy to construct — first the `global` ReferenceError, then
// "Input attributes include non-writable attributes". The only thing that
// proves it works is signing a real user in against the real pool through the
// real module.

import { describe, it, expect } from "vitest";

const USER = process.env.BIDINTEL_LIVE_AUTH_USER;
const PASS = process.env.BIDINTEL_LIVE_AUTH_PASSWORD;
const NEWPW = process.env.BIDINTEL_LIVE_AUTH_NEWPASSWORD;

describe.runIf(USER && PASS && NEWPW)("Cognito NEW_PASSWORD_REQUIRED (live)", () => {
  it("challenges, completes, and returns a usable ID token", async () => {
    // Imported inside the test so the module is not evaluated when skipped.
    const cognito = await import("@/integrations/aws/cognito");

    const first = await cognito.signInWithPassword(USER!, PASS!);
    expect(first.status).toBe("NEW_PASSWORD_REQUIRED");
    if (first.status !== "NEW_PASSWORD_REQUIRED") return;

    // The step that was failing: completing the challenge must not echo back
    // custom:app_user_id / custom:org_id, which the client cannot write.
    const second = await first.complete(NEWPW!);
    if (second.status === "ERROR") throw new Error(`complete failed: ${second.message}`);
    expect(second.status).toBe("SUCCESS");
    if (second.status !== "SUCCESS") return;

    // The claims RLS depends on must survive the challenge.
    const claims = second.session.user.claims;
    expect(claims.role).toBe("authenticated");
    expect(claims.app_user_id).toBeTruthy();
    expect(claims.token_use).toBe("id");

    // And the session must be readable back the way AuthContext reads it.
    const { data } = await cognito.getSession();
    expect(data.session?.access_token).toBeTruthy();
    expect(data.session?.user.id).toBe(claims.app_user_id);
  }, 30_000);
});
