# Auth Migration Plan — Supabase Auth → AWS Cognito

**Status:** Design + scaffolding. Nothing deployed, nothing in `/supabase` or `/src` touched.
**Blocked on:** AWS account access (open question #1 in the [migration report](../../docs/migration/supabase-aws-migration-status.md)).

The migration report calls this "the highest-effort, highest-risk item" and schedules the
auth-dependent functions last, after the stateless proxies, `buyer-profile`, `embed-tenders-batch`,
`semantic-search` and the ingestion set. That ordering still holds — this document is written now so
the design is settled before the code that depends on it gets built, not because auth should move next.

---

## 1. How auth works today

Read from `src/contexts/AuthContext.tsx`, `src/pages/Auth.tsx`, `src/components/ProtectedRoute.tsx`,
`src/integrations/supabase/client.ts`, `supabase/functions/{bootstrap-org,admin-create-user}`, and
the RLS policies across `supabase/migrations/`.

### Sign-up

**There is none.** `Auth.tsx` renders a sign-in form only, with the note *"New organisations and
users are provisioned by the platform administrator."* Two provisioning paths exist:

- **`admin-create-user`** — an org admin posts `{ email, password, display_name, role }`. The
  function verifies the caller's JWT, confirms the caller is `role = 'admin'` in `memberships`, calls
  `supabase.auth.admin.createUser` with `email_confirm: true`, then upserts `profiles` and upserts a
  `memberships` row into *the caller's own org*. A user cannot be created into a different org.
- **`bootstrap-org`** — a signed-in user with no membership posts `{ name }`, gets an
  `organisations` row (slug = slugified name + 5 random chars) and a `memberships` row with
  `role = 'admin'`. Refuses if the caller already has a membership.

A trigger on `auth.users`, `handle_new_user()`, mirrors every new auth user into `profiles`.

### Sign-in

`supabase.auth.signInWithPassword({ email, password })`. The session is persisted to `localStorage`
with `autoRefreshToken: true`. There is no OAuth/social provider, no magic link, no MFA.

### Org membership and roles

`memberships.user_id` is the **PRIMARY KEY**, so **a user belongs to exactly one organisation**. The
role enum is `org_role = ('admin', 'member')`.

`AuthContext` loads membership client-side on every auth state change:

```
memberships  ->  { organisation_id, role }   (eq user_id, maybeSingle)
organisations ->  { name }                    (eq id = organisation_id)
```

and exposes `{ user, session, membership, orgName, isAdmin, loading }`. `ProtectedRoute` gates on
`user` → `/auth`, then on `membership` → `/auth`, then on `adminOnly && !isAdmin` → `/`.

### Enforcement: RLS, not application code

This is the part that does not survive the move. The frontend talks to Postgres directly through
PostgREST, and **the database is the authorization layer**. Two SECURITY DEFINER helpers do the work:

```sql
current_org_id()  -> SELECT organisation_id FROM memberships WHERE user_id = auth.uid()
is_org_admin()    -> EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND role = 'admin')
```

`is_org_admin()` was later re-scoped (migration `20260611204301`) to also require
`organisation_id = current_org_id()`. Both are SECURITY DEFINER specifically to avoid RLS recursion
when policies on `memberships` call them.

The full auth-dependent policy set — 19 live policies across the 6 tables the app reads:

| Table | Policy | Rule |
|---|---|---|
| `organisations` | Members view own org | `SELECT` where `id = current_org_id()` |
| | Admins update own org | `UPDATE` where `id = current_org_id() AND is_org_admin()` |
| `profiles` | Users view own profile | `SELECT` where `id = auth.uid()` |
| | Admins view org profiles | `SELECT` where `is_org_admin() AND id IN (members of current_org_id())` |
| | Users update own profile | `UPDATE` where `id = auth.uid()` |
| | Users insert own profile | `INSERT` check `id = auth.uid()` |
| `memberships` | Users view memberships in their org | `SELECT` where `organisation_id = current_org_id()` |
| | Admins insert/update/delete | `organisation_id = current_org_id() AND is_org_admin()` |
| `saved_bids` | Members view org bids | `SELECT` where `organisation_id = current_org_id()` |
| | Members insert org bids | `INSERT` check `organisation_id = current_org_id() AND saved_by = auth.uid()` |
| | Saver or admin update/delete | `organisation_id = current_org_id() AND (saved_by = auth.uid() OR is_org_admin())` |
| `org_match_profiles` | Members view / Admins insert+update+delete | `organisation_id = current_org_id()`, writes also `AND is_org_admin()` |
| `saved_searches` | Admins manage org saved_searches | `ALL` where `organisation_id = current_org_id() AND is_org_admin()` — **the only policy on this table; see the note below** |

> **`saved_searches` is admin-only, and that is easy to miss.** Its policy history: migration
> `20260608130148` added a permissive `FOR SELECT TO authenticated USING (true)` read policy;
> `20260610170345` dropped it two days later; `20260611204301` then added the org-scoped
> `FOR ALL` policy. The end state is a single policy requiring **both** `organisation_id =
> current_org_id()` **and** `is_org_admin()`, with no separate read policy beneath it.
>
> So a non-admin member currently gets **zero rows** from `saved_searches` — not their org's rows,
> none. The frontend has 7 `saved_searches` call sites (`SavedSearches.tsx` and others) that will
> render empty for members. Worth confirming this is intended before it is faithfully reproduced in
> the Lambda port, because application-layer code makes it an explicit `requireAdmin` rather than a
> silently empty result set.

> **The migrations are not a complete record of RLS.** Replaying every `CREATE POLICY` minus every
> `DROP POLICY` across the 90 migration files yields **19 live policies** on these 6 tables
> (organisations 2, profiles 4, memberships 4, saved_bids 4, org_match_profiles 4, saved_searches 1).
> The migration report cites *25 policies across 8 tables*, the extra 3 tables being `companies`,
> `matches` and `user_actions` — and **no `CREATE POLICY` for any of those three appears anywhere in
> `supabase/migrations/`**. They were almost certainly created through the Supabase dashboard.
>
> The practical consequence: do not treat the migration files as the source of truth when porting
> RLS. Dump the live policy set from the source database
> (`SELECT * FROM pg_policies WHERE schemaname = 'public'`) and port from that. The same caution
> applies to any dashboard-created index, trigger or grant.

### What the frontend reads directly

21 files call `supabase.from(...)`. On the RLS-protected tables: `saved_searches` (7 call sites),
`saved_bids` (5), `memberships` (4), `organisations` (2), `org_match_profiles` (2), `profiles` (1).
Every one of those is a direct database call that RLS is silently securing, and every one needs an
API endpoint after the move. The rest (`tenders`, `notices`, `cpv_codes`, `buyers`, `suppliers`,
`awards`, …) are public-read and carry no auth dependency.

### MCP

`src/lib/mcp/index.ts` configures `auth.oauth.issuer({ issuer: "https://<ref>.supabase.co/auth/v1",
acceptedAudiences: "authenticated" })`. `src/pages/OAuthConsent.tsx` drives Supabase's
`supabase.auth.oauth` consent API. The five MCP tools query Supabase with the end user's token, so
**RLS is what scopes MCP results to the caller's org too**.

---

## 2. Cognito design

### 2.1 Attribute and group mapping

| Postgres | Cognito | Notes |
|---|---|---|
| `auth.users.id` | `sub` | Cognito-generated, **not** the existing UUID |
| `profiles.id` | `custom:app_user_id` | The existing UUID, carried as a claim — see §3 |
| `profiles.email` | `email` (username attribute) | Case-insensitive |
| `profiles.display_name` | `name` | Standard attribute |
| `memberships.organisation_id` | `custom:org_id` | One per user; mutable by admins only |
| `memberships.role` | group `org_admin` / `org_member` | Arrives as `cognito:groups` |
| `organisations.name` | *not a claim* | Served by `GET /me`; see §5 |

**Why groups for role and an attribute for org.** Role is a small closed set that maps cleanly onto
Cognito's group primitive and lands in both the ID and access tokens for free. Org is
high-cardinality and identifier-shaped — a group per org would work but buys nothing while
`memberships.user_id` is a primary key.

**Why not a group per org (`org:<uuid>:admin`).** That is the design you need for multi-org
membership, because `cognito:groups` is an array while `custom:org_id` is a single value. It costs an
extra parse on every request and a group lifecycle to manage. The database says one org per user
today, so the simpler model is correct today. If multi-org ever ships, both `memberships` and this
design change together — that is called out in §8.

**The schema is immutable.** Cognito custom attributes cannot be added, removed, or retyped after
pool creation; Terraform will plan a *full replacement* — destroying every user — if the `schema`
blocks change. `prevent_destroy = true` is set on the pool as a backstop, but the real mitigation is
settling the attribute set before the first apply. If you think you might ever need
`custom:tenant_tier` or similar, add it now as an unused attribute.

### 2.2 Provisioning model

`allow_admin_create_user_only = true` mirrors today's reality — no self sign-up — and enforces it in
Cognito rather than relying on the absence of a form in the UI.

### 2.3 App clients

| | SPA | MCP |
|---|---|---|
| Secret | none (public client) | none (public + PKCE) |
| Auth flow | `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH` | `code` + PKCE, `ALLOW_REFRESH_TOKEN_AUTH` |
| Scopes | `openid email profile` | those plus `tenders.read`, `bids.read`, `searches.read` |
| Can read | `email`, `name`, `custom:org_id`, `custom:app_user_id` | same |
| Can **write** | `email`, `name` only | nothing |

SRP rather than `USER_PASSWORD_AUTH` so the raw password never crosses the wire.

**The `write_attributes` restriction is the load-bearing control in this whole design.** `custom:org_id`
and `custom:app_user_id` are deliberately excluded, so a user calling `updateUserAttributes` cannot
move themselves into another organisation or impersonate another application user. Only IAM-gated
admin calls (`AdminUpdateUserAttributes`) can set them. Remove that asymmetry and the tenancy model
becomes an honour system — a browser-side attribute update would be a complete cross-tenant breach.

### 2.4 What is in the Terraform

`versions.tf`, `variables.tf`, `cognito.tf`, `outputs.tf`, `terraform.tfvars.example`.
Seven resources: the user pool, two groups, the API resource server, two app clients, the hosted
domain. Thirteen outputs, including a `frontend_env` block that emits the SPA's `.env` values.

Terraform was chosen over CDK because the pool is foundational infra that other stacks reference by
ID, because CDK needs `cdk bootstrap` in the account before it can even synthesise (and there is no
account yet), and because the Cognito resource coverage is complete without escape hatches.

**Validation status — read this before trusting it.** No `terraform` binary and no AWS credentials
exist in this environment, so the stack has **not** been through `terraform validate`, `plan`, or
`apply`. What has been checked: all four files parse as valid HCL2, all 17 declared variables are
referenced and all 17 referenced variables are declared, and all 7 resource references resolve to
defined resources. Provider-schema correctness — argument names, valid enum values, required blocks —
is **unverified**. Expect to fix a few argument-level details on the first real `plan`.

### 2.5 Before you apply

1. `cognito_domain_prefix` is globally unique across all AWS accounts; `bidintel-auth` may be taken.
2. Decide the feature plan. Access-token claim customisation (§4.1) needs the Essentials or Plus
   tier and a `PreTokenGeneration` V2 trigger; the Lite tier cannot do it. The recommendation below
   avoids needing it.
3. Cognito's built-in email sender is capped at **50 emails/day**. Fine for 7 users and the initial
   invite wave, not fine afterwards — set `ses_source_arn` before real growth.
4. Move to remote state (the S3 backend block in `versions.tf`) before the first apply.

---

## 3. Identity mapping — the part that bites

**Cognito's `sub` is generated by Cognito and cannot be set during user import.** The existing schema
has three foreign keys pointing at `auth.users(id)`:

```
profiles.id            -> auth.users(id)
memberships.user_id    -> auth.users(id)
saved_bids.saved_by    -> auth.users(id)
```

Two options:

- **Re-key the database to Cognito subs.** Clean end state, but rewrites live user data and every FK.
- **Keep the existing UUIDs as canonical and carry them as a claim.** ← recommended.
  `custom:app_user_id` holds the original `profiles.id`. Nothing in the database moves, and the
  authorizer resolves "who is this" from the token with **no database lookup**.

Also add `profiles.cognito_sub uuid UNIQUE` so the mapping is recorded durably in the database and
not only inside Cognito — you want to be able to reconcile the two directions during cutover.

With 7 profiles and 6 memberships, either option is an afternoon. The claim-based one is recommended
because it does not touch production rows.

### Passwords cannot be migrated

Supabase stores bcrypt hashes in `auth.users.encrypted_password`. **Cognito's user import does not
accept password hashes** — imported users land in `FORCE_CHANGE_PASSWORD` state, and the
alternative (a migration Lambda that verifies against the old system on first sign-in) would require
keeping Supabase Auth reachable during a grace period.

For 7 users, just reset: import them, let Cognito send invites, everyone sets a new password once.
Two consequences:

- `password_minimum_length` defaults to **12** here rather than the current 8, since everyone resets
  anyway. Set it to 8 in `terraform.tfvars` to match today exactly.
- **The SPA must handle the `NEW_PASSWORD_REQUIRED` challenge**, which is a UI state
  `Auth.tsx` does not have today. Every migrated user hits it on first sign-in. See §5.

---

## 4. Enforcing org access control in Lambda

### 4.1 Which token the API validates

Cognito puts custom attributes in the **ID token**, not the access token. The access token carries
`sub`, `cognito:groups`, `scope` and `client_id` — so `custom:org_id` is not there by default.

| Option | Verdict |
|---|---|
| **Send the ID token to the API**, validate with an API Gateway JWT authorizer | **Recommended.** Carries `custom:org_id` and `cognito:groups` with no extra cost or tier requirement. |
| Send the access token, add claims with a `PreTokenGeneration` **V2** trigger | Cleaner per AWS guidance, but needs the Essentials/Plus feature plan. Revisit if you adopt that tier anyway. |
| Send the access token, look `org_id` up from RDS in a Lambda authorizer | Always correct, never stale — but a database round trip on every request. Authorizer result caching softens it. |

Configure the HTTP API JWT authorizer with `issuer` = the pool issuer URL and `audience` = the SPA
client ID. For MCP routes, use the MCP client ID and additionally require the relevant custom scope.

### 4.2 Two layers, because losing RLS is the real risk

RLS **fails closed**: forget a filter and you get zero rows. Application-layer scoping **fails
open**: forget a filter and you leak every organisation's data. That inversion, not the plumbing, is
the dangerous part of this migration.

So do both.

**Layer 1 — the database keeps enforcing.** Do not throw RLS away when moving to RDS. Port the
policies almost verbatim by swapping the identity source from `auth.uid()` to a session GUC:

```sql
-- RDS replacements for the two Supabase helpers
CREATE OR REPLACE FUNCTION public.auth_uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::uuid
  $$;

CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.org_id', true), '')::uuid
  $$;

CREATE OR REPLACE FUNCTION public.is_org_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(current_setting('app.is_admin', true), 'false')::boolean
  $$;
```

Note these no longer need SECURITY DEFINER — they read settings rather than querying `memberships`,
so the RLS recursion they were working around disappears. **All 19 policies above then work
unchanged**, because they are written against the helper functions rather than against `auth.uid()`
directly. That is a large, and slightly lucky, win.

Every Lambda request opens a transaction and stamps the GUCs from verified claims:

```ts
await client.query("BEGIN");
await client.query(
  "SELECT set_config('app.user_id', $1, true), " +
  "       set_config('app.org_id',  $2, true), " +
  "       set_config('app.is_admin',$3, true)",
  [auth.appUserId, auth.orgId, String(auth.isAdmin)],
);
// ... queries ...
await client.query("COMMIT");
```

Three non-negotiables:

- **`set_config(..., true)` is transaction-local.** Session-level `SET` on a pooled connection leaks
  one user's identity into the next user's request. Always `true`, always inside a transaction.
- **The application role must not bypass RLS.** Table owners and `BYPASSRLS` roles ignore policies
  silently. Connect as a dedicated non-owner role, and add `ALTER TABLE … FORCE ROW LEVEL SECURITY`
  as a belt-and-braces measure.
- **Never interpolate claims into SQL strings.** Parameters only.

**Layer 2 — scope in code as well.** A single data-access module whose functions all take an
`AuthContext` as their first argument, with no raw pool handle exported. Handlers cannot query
without an identity in hand, so "forgot the filter" fails at the type level rather than at runtime.

```ts
export interface AuthContext {
  appUserId: string;   // custom:app_user_id -> profiles.id
  orgId: string;       // custom:org_id
  isAdmin: boolean;    // cognito:groups includes "org_admin"
  email: string;
  cognitoSub: string;
}

export function requireAuth(event: APIGatewayProxyEventV2WithJWTAuthorizer): AuthContext {
  const c = event.requestContext.authorizer?.jwt?.claims;
  if (!c) throw new HttpError(401, "Unauthorized");
  const orgId = c["custom:org_id"] as string | undefined;
  // Mirrors ProtectedRoute: authenticated but not yet in an org is a distinct state.
  if (!orgId) throw new HttpError(403, "No organisation membership");
  const groups = (c["cognito:groups"] ?? []) as string[];
  return {
    appUserId: c["custom:app_user_id"] as string,
    orgId,
    isAdmin: groups.includes("org_admin"),
    email: c.email as string,
    cognitoSub: c.sub as string,
  };
}

export function requireAdmin(ctx: AuthContext): AuthContext {
  if (!ctx.isAdmin) throw new HttpError(403, "Admin access required");
  return ctx;
}
```

Trust these claims **only** because API Gateway verified the JWT signature, issuer and audience
first. A Lambda invoked by anything other than that authorizer must verify the token itself
(`aws-jwt-verify`) before reading a single claim.

### 4.3 Policy-by-policy port

| RLS policy | Lambda equivalent |
|---|---|
| organisations: members view own org | `GET /orgs/current` → `WHERE id = ctx.orgId` |
| organisations: admins update own org | `PATCH /orgs/current` → `requireAdmin`, `WHERE id = ctx.orgId` |
| profiles: users view own | `GET /me` → `WHERE id = ctx.appUserId` |
| profiles: admins view org profiles | `GET /orgs/current/members` → `requireAdmin`, join `memberships` on `ctx.orgId` |
| profiles: users update own | `PATCH /me` → `WHERE id = ctx.appUserId` |
| profiles: users insert own | dropped — provisioning now creates the row |
| memberships: view in own org | `GET /orgs/current/members` → `WHERE organisation_id = ctx.orgId` |
| memberships: admins insert/update/delete | `POST/PATCH/DELETE /orgs/current/members/:id` → `requireAdmin` + org filter |
| saved_bids: members view | `GET /bids` → `WHERE organisation_id = ctx.orgId` |
| saved_bids: members insert | `POST /bids` → force `organisation_id = ctx.orgId`, `saved_by = ctx.appUserId` from the token, never the body |
| saved_bids: saver or admin update/delete | `PATCH/DELETE /bids/:id` → `WHERE organisation_id = ctx.orgId AND (saved_by = ctx.appUserId OR ctx.isAdmin)` |
| org_match_profiles: members view | `GET /orgs/current/match-profile` → org filter |
| org_match_profiles: admins write | `PUT /orgs/current/match-profile` → `requireAdmin` + org filter |
| saved_searches: admins manage (the only policy) | `GET/POST/PATCH/DELETE /saved-searches` → `requireAdmin` + `WHERE organisation_id = ctx.orgId`. Reproduces today's admin-only behaviour exactly — see the §1 note before deciding whether members should get read access. |

The recurring rule: **`organisation_id` and `saved_by` come from the token, never from the request
body.** Accepting either from the client reintroduces exactly the cross-tenant write RLS was
preventing.

### 4.4 Porting the three auth-dependent functions

- **`admin-create-user`** — the only genuine rewrite. `supabase.auth.admin.createUser` becomes
  `AdminCreateUser` + `AdminSetUserPassword` + `AdminAddUserToGroup` + `AdminUpdateUserAttributes`
  (for `custom:org_id` and `custom:app_user_id`). Keep the existing guard: caller must be admin, and
  the new user goes into *the caller's* org, taken from `ctx.orgId`. Its execution role needs
  `cognito-idp:AdminCreateUser`, `AdminSetUserPassword`, `AdminAddUserToGroup`,
  `AdminUpdateUserAttributes`, `AdminGetUser`, scoped to the pool ARN — nothing wildcard.
  Generate `custom:app_user_id` as a fresh UUID for new users; the `profiles` insert uses the same value.

  > While porting, note that the current version upserts `memberships` with
  > `onConflict: "user_id,organisation_id"` while the table's primary key is `user_id` alone. That
  > conflict target does not match an existing unique constraint, so the upsert path errors rather
  > than updating when the user already has a membership. Don't reproduce it.

- **`bootstrap-org`** — insert `organisations` + `memberships`, then stamp the caller's
  `custom:org_id` and add them to `org_admin`. **The caller's existing token will not have the new
  claims** — it must be refreshed before the next API call, or the user appears org-less. The SPA
  needs an explicit token refresh after bootstrap.

- **`draft-bid-response`** — the simplest. It reads `saved_bids` under the caller's identity; swap
  the Supabase user-client for `requireAuth` + the org-scoped data module.

### 4.5 Keeping claims and the database in step

Claims are a cache of `memberships`. When an admin changes someone's role or org, that user's
existing tokens stay stale until they expire (≤ 60 min) or refresh.

- Always write **both** — the `memberships` row and the Cognito attribute/group — in the same
  handler, and treat a partial failure as an error worth alerting on.
- For immediate revocation use `AdminUserGlobalSignOut`, which invalidates refresh tokens.
- If staleness proves unacceptable, switch to the RDS-lookup authorizer in §4.1 (variable
  `pre_token_generation_lambda_arn` exists for the token-time variant).

---

## 5. Frontend changes

None of this is in scope now — `/src` is untouched — but this is the work it implies.

**Dependencies:** add `aws-amplify` v6 (`aws-amplify/auth` alone is enough; it handles SRP, the
challenge flow, token storage and refresh). Remove `@supabase/supabase-js` only once the last
`supabase.from(...)` call site is gone.

| File | Change |
|---|---|
| `src/integrations/supabase/client.ts` | Replaced by a Cognito config + a typed API client. The generated `Database` types go with it — the API needs its own types. |
| `src/contexts/AuthContext.tsx` | `signInWithPassword` → `signIn`; `getSession` → `fetchAuthSession`; `onAuthStateChange` → Amplify's Hub. **`loadMembership`'s two database queries disappear** — `membership` comes from token claims. `orgName` is the exception: fetch it from `GET /me` rather than adding a claim that goes stale when an org is renamed. |
| `src/pages/Auth.tsx` | Swap the sign-in call, **and add a `NEW_PASSWORD_REQUIRED` challenge screen** — every migrated user hits it on first sign-in. Add a forgot-password path (`resetPassword` / `confirmResetPassword`); there isn't one today. |
| `src/components/ProtectedRoute.tsx` | Logic unchanged. It already distinguishes "no user" from "no membership", which maps exactly onto "no token" vs "no `custom:org_id`". |
| `src/pages/OAuthConsent.tsx` | **Delete.** `supabase.auth.oauth` has no Cognito equivalent; Cognito's hosted UI runs its own consent screen. The `?next=` handling in `Auth.tsx` goes with it. |
| `src/hooks/useSavedBids.ts` | 5 direct calls → `GET/POST/PATCH/DELETE /bids`. Stop sending `organisation_id`/`saved_by`; the server sets them. |
| `src/pages/SavedSearches.tsx` + 6 others | 7 `saved_searches` call sites → API. |
| `src/hooks/useMatchProfile.ts` | 2 calls → `/orgs/current/match-profile`. |
| `src/pages/Admin.tsx`, `Settings.tsx` | `memberships`/`profiles`/`organisations` reads → `/orgs/current/members`, `/me`. |
| All `supabase.functions.invoke(...)` | → `fetch` with `Authorization: Bearer <ID token>`. `src/lib/contractsFinder.ts:49` (`invokeSource`) is the single seam for the three search proxies. |
| `src/lib/mcp/index.ts` | `auth.oauth.issuer` issuer → the Cognito issuer; audience → the MCP client ID. |
| `.env` | `VITE_SUPABASE_*` → `VITE_COGNITO_*` (the `frontend_env` Terraform output emits these). |

Public-read tables (`tenders`, `notices`, `cpv_codes`, `buyers`, `suppliers`, `awards`) also need
endpoints eventually, but they carry no auth dependency and can move on the ingestion timeline.

---

## 6. MCP and OAuth

`auth.oauth.issuer` is issuer-agnostic, so pointing it at Cognito is a config change. Two real
constraints:

1. **Cognito does not support RFC 7591 dynamic client registration.** MCP clients generally expect
   to self-register. Every client's redirect URI must be pre-registered in `mcp_callback_urls`, or
   you front Cognito with a small registration shim. Confirm which MCP clients need access before
   committing to the pre-registered list.
2. **The MCP tools currently rely on RLS for org scoping.** Once RLS moves behind the API, each tool
   must go through the same org-scoped data module. The custom scopes (`tenders.read`, `bids.read`,
   `searches.read`) then become a second gate: scope says *what kind* of data, `custom:org_id` says
   *whose*.

`supabase/functions/mcp/index.ts` is generated by `@lovable.dev/mcp-js` from `src/lib/mcp/` — edit
the source, never the bundle. That generator is Supabase-shaped, so the AWS port likely means owning
the file (delete the banner line) or replacing the generator.

---

## 7. Suggested sequence

1. Apply the Terraform into a **dev** pool. Confirm the plan is clean and the schema is right — this
   is the last easy moment to change custom attributes.
2. Port `current_org_id()` / `is_org_admin()` / `auth_uid()` to the GUC versions on an RDS restore
   and confirm all 19 policies still apply. **Test with the app role, not the owner** — an owner
   bypasses RLS and every test passes for the wrong reason.
3. Build `requireAuth` + the org-scoped data module with the `GET /me` endpoint as the first consumer.
4. Port `draft-bid-response` (simplest), then `bootstrap-org`, then `admin-create-user`.
5. Import the 7 users; verify `custom:app_user_id` matches `profiles.id` for every one.
6. Move the frontend behind a `VITE_AUTH_PROVIDER` flag so both paths run during transition.
7. Cut over, keeping Supabase Auth reachable for rollback until MCP clients have re-authorised.

## 8. Open decisions

1. **Feature plan / tier** — determines whether access-token claim customisation is available (§4.1).
2. **Identity mapping** — carry `custom:app_user_id` (recommended) or re-key the database to Cognito subs?
3. **Password reset** — accept that all 7 users reset (recommended), or build a migration-trigger
   Lambda to verify against Supabase on first sign-in?
4. **`saved_searches` visibility** — today only org *admins* can read saved searches; members get
   zero rows. Reproduce that, or give members read access as part of the port?
5. **Which MCP clients** need pre-registered redirect URIs?
6. **MFA** — `OPTIONAL` is scaffolded. Should admins be required to use it?
7. **Multi-org** — is one-org-per-user permanent? It is baked into both `memberships.user_id` as PK
   and this Cognito design; changing it later changes both together.
8. **Rollback window** — how long does Supabase Auth stay live after cutover?

## 9. Not included here

No Lambda code, no API Gateway/RDS/VPC Terraform, no user-import tooling, no frontend changes, and
no SQL migration for the GUC-based helpers. Those come after the account exists and the decisions in
§8 are made. The `requireAuth` sketch in §4.2 is illustrative, not a compiled artefact.
