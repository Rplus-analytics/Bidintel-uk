import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Zap, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SignInResult } from "@/integrations/aws/cognito";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Auth() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { refreshMembership } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // First sign-in after an administrator creates the account. Cognito puts the
  // user in FORCE_CHANGE_PASSWORD and will not issue tokens until a permanent
  // password is set, so this is a required second step rather than an error.
  // `challenge` holds the callback that completes it; the Cognito session it
  // closes over is single-use, which is why it is held in state instead of
  // re-authenticating.
  const [challenge, setChallenge] = useState<((pw: string) => Promise<SignInResult>) | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Only allow same-origin relative paths (used by the OAuth consent flow).
  const rawNext = params.get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null;

  // Shared by both steps: whatever produced the session, the landing behaviour
  // is identical.
  const onSignedIn = async () => {
    await refreshMembership();
    toast.success("Welcome back");
    if (next) {
      window.location.href = next;
      return;
    }
    navigate("/");
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const result = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (result.status === "ERROR") return toast.error(result.message);

    if (result.status === "NEW_PASSWORD_REQUIRED") {
      setChallenge(() => result.complete);
      return;
    }

    await onSignedIn();
  };

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return toast.error("Passwords do not match");
    if (!challenge) return;

    setLoading(true);
    const result = await challenge(newPassword);
    setLoading(false);

    if (result.status === "ERROR") return toast.error(result.message);
    // Cognito does not re-issue the challenge, so any other status here would
    // leave the form stuck; SUCCESS is the only remaining case.
    await onSignedIn();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md glass-card p-8 space-y-6">
        <div className="flex items-center gap-2">
          <Zap className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold">BidIntel</h1>
        </div>

        {challenge ? (
          <form onSubmit={handleNewPassword} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose a new password to finish setting up your account.
            </p>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" type="password" required autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input id="confirm-password" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} Set password and sign in
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              At least 12 characters, with an uppercase letter, a lowercase letter and a number.
            </p>
          </form>
        ) : (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              New organisations and users are provisioned by the platform administrator.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
