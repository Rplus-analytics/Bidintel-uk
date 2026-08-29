import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type OrgRole = "admin" | "member";

export interface Membership {
  organisation_id: string;
  role: OrgRole;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  membership: Membership | null;
  orgName: string | null;
  loading: boolean;
  isAdmin: boolean;
  refreshMembership: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMembership = async (uid: string | null) => {
    if (!uid) {
      setMembership(null);
      setOrgName(null);
      return;
    }
    const { data: mem } = await supabase
      .from("memberships")
      .select("organisation_id, role")
      .eq("user_id", uid)
      .maybeSingle();
    setMembership(mem ? { organisation_id: mem.organisation_id, role: mem.role as OrgRole } : null);
    if (mem) {
      const { data: org } = await supabase
        .from("organisations")
        .select("name")
        .eq("id", mem.organisation_id)
        .maybeSingle();
      setOrgName(org?.name ?? null);
    } else {
      setOrgName(null);
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      // Defer DB calls to avoid deadlocks
      setTimeout(() => loadMembership(sess?.user?.id ?? null), 0);
    });

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      loadMembership(sess?.user?.id ?? null).finally(() => setLoading(false));
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthContextValue = {
    user,
    session,
    membership,
    orgName,
    loading,
    isAdmin: membership?.role === "admin",
    refreshMembership: () => loadMembership(user?.id ?? null),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
