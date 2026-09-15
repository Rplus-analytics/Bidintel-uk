// ============================================================================
// Cognito auth — the replacement for supabase.auth
// ============================================================================
//
// Exposes exactly the four methods the app used (getSession, signInWithPassword,
// signOut, onAuthStateChange) with the same return shapes, plus the one thing
// Supabase never needed: a NEW_PASSWORD_REQUIRED challenge.
//
// WHY amazon-cognito-identity-js AND NOT PLAIN fetch: the user pool's app client
// allows only ALLOW_USER_SRP_AUTH and ALLOW_REFRESH_TOKEN_AUTH. SRP means the
// password is never transmitted — the browser proves knowledge of it through a
// zero-knowledge exchange. Implementing that by hand is ~200 lines of BigInt
// modular arithmetic where a subtle bug is invisible until it is a
// vulnerability. The alternative was to enable ALLOW_USER_PASSWORD_AUTH and
// send the password to Cognito directly; that would have been a downgrade for
// the sake of avoiding a dependency.
//
// WHICH TOKEN THE APP USES: the ID token, everywhere. The pre-token-generation
// V1 trigger enriches the ID token — and only the ID token — with the `role`,
// `app_user_id` and `org_id` claims that PostgREST turns into a SET ROLE and
// that the RLS policies read through auth.uid(). An access token would
// authenticate the user and then behave as if they had no organisation.

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;

if (!USER_POOL_ID || !CLIENT_ID) {
  // Loud and early. A missing pool ID otherwise surfaces as an opaque network
  // error on the first sign-in attempt.
  console.error(
    "[auth] VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_CLIENT_ID are not set. Copy .env.example to .env.local.",
  );
}

const pool = new CognitoUserPool({
  UserPoolId: USER_POOL_ID,
  ClientId: CLIENT_ID,
  // Session persistence across a page refresh. amazon-cognito-identity-js
  // writes the ID, access and refresh tokens here under
  // CognitoIdentityServiceProvider.<clientId>.<username>.*
  Storage: window.localStorage,
});

// --- Shapes ----------------------------------------------------------------
//
// Structurally compatible with the parts of Supabase's User and Session the app
// actually reads (user.id, user.email, session.access_token), so AuthContext
// and its consumers keep working unchanged.

export interface AuthUser {
  id: string;
  email: string | null;
  /** Full ID-token claim set, including role / app_user_id / org_id. */
  claims: Record<string, any>;
}

export interface AuthSession {
  /** The ID token. Named access_token so existing consumers do not change. */
  access_token: string;
  id_token: string;
  expires_at: number;
  user: AuthUser;
}

type AuthChangeEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED";
type Listener = (event: AuthChangeEvent, session: AuthSession | null) => void;

const listeners = new Set<Listener>();

function emit(event: AuthChangeEvent, session: AuthSession | null) {
  for (const l of listeners) {
    try {
      l(event, session);
    } catch (e) {
      console.error("[auth] listener threw", e);
    }
  }
}

function toSession(s: CognitoUserSession): AuthSession {
  const idToken = s.getIdToken();
  const claims = idToken.decodePayload() as Record<string, any>;
  return {
    access_token: idToken.getJwtToken(),
    id_token: idToken.getJwtToken(),
    expires_at: idToken.getExpiration(),
    user: {
      // app_user_id is the row id in public.profiles, carried over from the
      // Supabase user id by the migration. `sub` is the Cognito user id and is
      // NOT the same value — using it would look up a profile that
      // does not exist.
      id: claims.app_user_id ?? claims.sub,
      email: claims.email ?? null,
      claims,
    },
  };
}

// --- Session ---------------------------------------------------------------

/**
 * Current session, refreshing it if the ID token has expired.
 *
 * getSession() on amazon-cognito-identity-js already performs a refresh-token
 * exchange when the cached tokens are stale, so this doubles as the refresh
 * path — there is no timer to run.
 */
export function getSession(): Promise<{ data: { session: AuthSession | null }; error: Error | null }> {
  return new Promise((resolve) => {
    const user = pool.getCurrentUser();
    if (!user) return resolve({ data: { session: null }, error: null });

    user.getSession((err: Error | null, s: CognitoUserSession | null) => {
      if (err || !s || !s.isValid()) {
        // An expired or revoked refresh token lands here. Treat it as signed
        // out rather than as an error the UI has to render: the user's next
        // action will send them to /auth, which is the correct outcome.
        return resolve({ data: { session: null }, error: null });
      }
      resolve({ data: { session: toSession(s) }, error: null });
    });
  });
}

/**
 * A valid ID token, refreshed if needed. Used by every PostgREST and API
 * Gateway request. Returns null when signed out.
 */
export async function getIdToken(): Promise<string | null> {
  const { data } = await getSession();
  return data.session?.access_token ?? null;
}

// --- Sign in ---------------------------------------------------------------

export type SignInResult =
  | { status: "SUCCESS"; session: AuthSession }
  | { status: "NEW_PASSWORD_REQUIRED"; complete: (newPassword: string) => Promise<SignInResult> }
  | { status: "ERROR"; message: string };

/**
 * SRP sign-in.
 *
 * NEW_PASSWORD_REQUIRED is not an error: every user created by an
 * administrator lands in FORCE_CHANGE_PASSWORD and must set a password on first
 * sign-in. It is returned as a first-class result with a `complete` callback so
 * the caller can render a second field rather than parse an error string.
 */
export function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  return new Promise((resolve) => {
    // Trimmed deliberately. The temporary password arrives in an invitation
    // EMAIL and is copy-pasted, which routinely picks up a trailing space or a
    // newline; SRP then fails with the generic "Incorrect username or password"
    // and there is nothing on screen to suggest why. No password Cognito
    // generates, and nothing this pool's policy permits, depends on leading or
    // trailing whitespace being significant, so trimming cannot reject a
    // password that would otherwise have worked.
    const username = email.trim();
    const secret = password.trim();

    const user = new CognitoUser({ Username: username, Pool: pool, Storage: window.localStorage });
    const details = new AuthenticationDetails({ Username: username, Password: secret });

    user.authenticateUser(details, {
      onSuccess: (s) => {
        const session = toSession(s);
        emit("SIGNED_IN", session);
        resolve({ status: "SUCCESS", session });
      },

      onFailure: (err: any) => {
        resolve({ status: "ERROR", message: friendlyError(err) });
      },

      newPasswordRequired: (userAttributes: Record<string, any>, requiredAttributes?: string[]) => {
        // DO NOT echo `userAttributes` back. The challenge hands over the
        // user's CURRENT attributes — including custom:app_user_id and
        // custom:org_id — and passing them to completeNewPasswordChallenge
        // makes Cognito reject the whole call:
        //
        //   Input attributes include non-writable attributes for the client
        //
        // Those two are excluded from the client's write_attributes on purpose:
        // it is the control that stops a user editing their own identity
        // claims, which are exactly what RLS trusts. The fix belongs here, not
        // in write_attributes.
        //
        // An earlier version deleted only `email` and `email_verified`, which
        // missed the custom ones and left this broken.
        //
        // So build the payload from `requiredAttributes` — the list Cognito
        // itself says must be supplied — rather than from what it handed us.
        // On this pool that list is empty: `email` is the only required
        // attribute and it is already set, being the sign-in identifier. The
        // loop exists so this stays correct if the schema ever changes.
        const payload: Record<string, string> = {};
        for (const raw of requiredAttributes ?? []) {
          // Cognito names these "userAttributes.email"; the library may or may
          // not have stripped the prefix already.
          const name = raw.replace(/^userAttributes\./, "");
          if (name === "email_verified" || name.startsWith("custom:")) continue;
          const value = userAttributes?.[name];
          if (value != null) payload[name] = String(value);
        }

        resolve({
          status: "NEW_PASSWORD_REQUIRED",
          complete: (newPassword: string) =>
            new Promise<SignInResult>((res) => {
              user.completeNewPasswordChallenge(newPassword, payload, {
                onSuccess: (s) => {
                  const session = toSession(s);
                  emit("SIGNED_IN", session);
                  res({ status: "SUCCESS", session });
                },
                onFailure: (err: any) => res({ status: "ERROR", message: friendlyError(err) }),
              });
            }),
        });
      },
    });
  });
}

// Cognito's raw messages are either developer-facing or deliberately vague.
// PreventUserExistenceErrors is ENABLED on this client, so a wrong email and a
// wrong password both return NotAuthorizedException — the message below must
// not distinguish them either, or it reintroduces the user-enumeration leak
// that setting exists to close.
function friendlyError(err: any): string {
  const code = err?.code || err?.name || "";
  const raw = String(err?.message || "");

  // NotAuthorizedException is overloaded. Cognito uses it for a wrong password
  // AND for an expired temporary password, distinguishing them only in the
  // message text. Mapping the whole code to "Incorrect email or password" hid
  // that, and an expired invitation looked identical to a typo — which is a bad
  // place to lose information, because the two have completely different fixes
  // (try again vs. ask an administrator to resend the invitation).
  if (/temporary password/i.test(raw)) {
    return "Your temporary password has expired. Ask an administrator to resend the invitation.";
  }

  switch (code) {
    case "NotAuthorizedException":
      return "Incorrect email or password";
    case "UserNotFoundException":
      return "Incorrect email or password";
    case "PasswordResetRequiredException":
      return "Your password must be reset. Contact your administrator.";
    case "UserNotConfirmedException":
      return "Your account is not confirmed yet. Contact your administrator.";
    case "InvalidPasswordException":
      return err?.message || "Password does not meet the policy requirements";
    case "TooManyRequestsException":
    case "LimitExceededException":
      return "Too many attempts. Wait a minute and try again.";
    default:
      return err?.message || "Sign in failed";
  }
}

// --- Sign out --------------------------------------------------------------

export function signOut(): Promise<{ error: Error | null }> {
  return new Promise((resolve) => {
    const user = pool.getCurrentUser();
    if (!user) {
      emit("SIGNED_OUT", null);
      return resolve({ error: null });
    }
    // globalSignOut would also revoke the refresh token server-side, but it
    // requires a valid access token and fails noisily when the session has
    // already expired — which is exactly when people click sign out. signOut()
    // clears local storage unconditionally.
    user.signOut(() => {
      emit("SIGNED_OUT", null);
      resolve({ error: null });
    });
  });
}

// --- Change subscription ---------------------------------------------------

export function onAuthStateChange(cb: Listener): {
  data: { subscription: { unsubscribe: () => void } };
} {
  listeners.add(cb);
  return {
    data: {
      subscription: {
        unsubscribe: () => {
          listeners.delete(cb);
        },
      },
    },
  };
}
