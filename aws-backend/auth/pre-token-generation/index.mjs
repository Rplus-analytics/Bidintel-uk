/**
 * Cognito pre-token-generation trigger — V1 (ID token customisation).
 *
 * WHY V1 AND NOT V2: V2 customises the ACCESS token but requires the user pool
 * to be on the Essentials or Plus feature plan. V1 customises the ID TOKEN and
 * works on every tier including Lite. Since PostgREST simply validates whatever
 * JWT it is handed, sending it the ID token removes the tier dependency
 * entirely. See docs/DEPLOYMENT-PLAN.md.
 *
 * WHAT IT ADDS:
 *   role         PostgREST requires a `role` claim to choose a database role.
 *                Without it every request falls back to the anonymous role and
 *                RLS sees no user. This is the claim that makes PostgREST work.
 *   app_user_id  The user's EXISTING profiles.id UUID, so auth.uid() keeps
 *                returning the same value it did on Lovable Cloud and no
 *                foreign key has to be rewritten.
 *   org_id       Organisation, for the org-scoping RLS policies.
 *
 * NOTE `custom:app_user_id` and `custom:org_id` already appear in the ID token
 * as-is; they are re-emitted here under short names so the RLS helper functions
 * read plain `app_user_id` rather than `custom:app_user_id`, which is awkward to
 * quote in SQL.
 */
export const handler = async (event) => {
  const attrs = event.request?.userAttributes ?? {};
  const appUserId = attrs["custom:app_user_id"] ?? "";
  const orgId = attrs["custom:org_id"] ?? "";

  // Fail loudly in logs rather than issuing a token that silently resolves to
  // no user — that would make RLS return zero rows and look like a data bug.
  if (!appUserId) {
    console.warn(
      JSON.stringify({
        msg: "custom:app_user_id missing — auth.uid() will be NULL and RLS will return no rows",
        username: event.userName,
        triggerSource: event.triggerSource,
      }),
    );
  }

  event.response = {
    ...event.response,
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        // PostgREST reads this to pick the DB role. Must match a real,
        // non-owner, non-BYPASSRLS role granted to the authenticator.
        role: "authenticated",
        app_user_id: appUserId,
        org_id: orgId,
      },
    },
  };

  return event;
};
