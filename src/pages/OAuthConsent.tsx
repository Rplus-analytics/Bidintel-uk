import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Zap, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

// NOT AVAILABLE ON AWS. `supabase.auth.oauth` is a Lovable Cloud extension that
// backs the MCP consent flow at /.lovable/oauth/consent; Cognito has no
// equivalent and the `mcp` edge function was never ported. Without this guard
// the page throws a TypeError on undefined and renders a blank screen.
//
// Reaching this route at all requires a Lovable MCP client, so on AWS it is
// unreachable in normal use. See docs/DEPLOYMENT-STATUS.md.
const oauth = (): OAuthApi => {
  const api = (supabase.auth as unknown as { oauth?: OAuthApi }).oauth;
  if (!api) {
    const unavailable = async () => ({
      data: null,
      error: { message: "The MCP OAuth consent flow is not available on AWS." },
    });
    return {
      getAuthorizationDetails: unavailable,
      approveAuthorization: unavailable,
      denyAuthorization: unavailable,
    };
  }
  return api;
};

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Missing authorization_id");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      if (!active) return;
      setEmail(sess.session.user.email ?? null);
      const { data, error: err } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (err) return setError(err.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error: err } = approve
      ? await oauth().approveAuthorization(authorizationId)
      : await oauth().denyAuthorization(authorizationId);
    if (err) {
      setBusy(false);
      return setError(err.message);
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("No redirect returned by the authorization server.");
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? details?.client?.client_name ?? "an application";
  const redirectUri = details?.client?.redirect_uri ?? details?.redirect_uri;
  const scopes: string[] = Array.isArray(details?.scopes)
    ? details.scopes
    : typeof details?.scope === "string"
      ? details.scope.split(" ").filter(Boolean)
      : [];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md glass-card p-8 space-y-6">
        <div className="flex items-center gap-2">
          <Zap className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold">BidIntel</h1>
        </div>

        {error ? (
          <div className="space-y-2">
            <h2 className="font-semibold">Could not load this authorization request</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : !details ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading authorization request…
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Connect {clientName} to BidIntel</h2>
              <p className="text-sm text-muted-foreground">
                {clientName} will be able to call BidIntel's enabled tools as you.
              </p>
            </div>

            <dl className="space-y-2 text-sm">
              {email && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Signed in as</dt>
                  <dd className="truncate">{email}</dd>
                </div>
              )}
              {redirectUri && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Redirects to</dt>
                  <dd className="truncate">{redirectUri}</dd>
                </div>
              )}
              {scopes.length > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Requested</dt>
                  <dd className="truncate">{scopes.join(", ")}</dd>
                </div>
              )}
            </dl>

            <p className="text-xs text-muted-foreground">
              This does not bypass BidIntel's permissions — data stays scoped to your organisation.
            </p>

            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Approve
              </Button>
              <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
                Cancel connection
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
