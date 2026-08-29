import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus, ShieldCheck, Trash2, RefreshCw, Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import EmbeddingStatusCard from "@/components/EmbeddingStatusCard";

interface MemberRow {
  user_id: string;
  role: "admin" | "member";
  email: string | null;
  display_name: string | null;
}

export default function Admin() {
  const { isAdmin, membership, orgName, user, refreshMembership } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState(orgName || "");
  const [savingOrg, setSavingOrg] = useState(false);

  useEffect(() => setEditingOrg(orgName || ""), [orgName]);

  const { data: members, isLoading } = useQuery({
    queryKey: ["org-members", membership?.organisation_id],
    enabled: !!membership && isAdmin,
    queryFn: async (): Promise<MemberRow[]> => {
      const { data: mems, error } = await supabase
        .from("memberships")
        .select("user_id, role")
        .eq("organisation_id", membership!.organisation_id);
      if (error) throw error;
      const ids = (mems || []).map((m) => m.user_id);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, email, display_name")
        .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const profMap = new Map((profs || []).map((p) => [p.id, p]));
      return (mems || []).map((m) => ({
        user_id: m.user_id,
        role: m.role as "admin" | "member",
        email: profMap.get(m.user_id)?.email ?? null,
        display_name: profMap.get(m.user_id)?.display_name ?? null,
      }));
    },
  });

  if (!membership) {
    return <div className="p-8 text-muted-foreground">You are not part of an organisation yet.</div>;
  }
  if (!isAdmin) {
    return <div className="p-8 text-muted-foreground">Admin access required.</div>;
  }

  const saveOrg = async () => {
    if (!editingOrg.trim()) return;
    setSavingOrg(true);
    const { error } = await supabase
      .from("organisations")
      .update({ name: editingOrg.trim() })
      .eq("id", membership.organisation_id);
    setSavingOrg(false);
    if (error) return toast.error(error.message);
    toast.success("Organisation updated");
    refreshMembership();
  };

  const updateRole = async (uid: string, role: "admin" | "member") => {
    const { error } = await supabase.from("memberships").update({ role }).eq("user_id", uid);
    if (error) return toast.error(error.message);
    toast.success("Role updated");
    queryClient.invalidateQueries({ queryKey: ["org-members"] });
  };

  const removeMember = async (uid: string) => {
    if (uid === user?.id) return toast.error("You cannot remove yourself");
    if (!confirm("Remove this user from the organisation?")) return;
    const { error } = await supabase.from("memberships").delete().eq("user_id", uid);
    if (error) return toast.error(error.message);
    toast.success("User removed");
    queryClient.invalidateQueries({ queryKey: ["org-members"] });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your organisation and team access.</p>
      </div>

      <div className="glass-card p-5 space-y-3 max-w-xl">
        <h3 className="font-semibold">Organisation</h3>
        <div className="space-y-2">
          <Label htmlFor="orgname">Name</Label>
          <div className="flex gap-2">
            <Input id="orgname" value={editingOrg} onChange={(e) => setEditingOrg(e.target.value)} />
            <Button onClick={saveOrg} disabled={savingOrg}>Save</Button>
          </div>
        </div>
      </div>

      <NoticesSyncCard />

      <EmbeddingStatusCard />

      <div className="glass-card overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold">Users ({members?.length || 0})</h3>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2"><UserPlus className="h-4 w-4" /> Add user</Button>
            </DialogTrigger>
            <AddUserDialog onClose={() => setOpen(false)} onCreated={() => queryClient.invalidateQueries({ queryKey: ["org-members"] })} />
          </Dialog>
        </div>
        {isLoading ? (
          <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">User</th>
                <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</th>
                <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody>
              {members?.map((m) => (
                <tr key={m.user_id} className="border-b border-border/50">
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium">{m.display_name || m.email || m.user_id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </td>
                  <td className="px-5 py-4">
                    <Select value={m.role} onValueChange={(v) => updateRole(m.user_id, v as "admin" | "member")}>
                      <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin"><span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Admin</span></SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-5 py-4 text-right">
                    {m.user_id !== user?.id && (
                      <Button variant="ghost" size="icon" onClick={() => removeMember(m.user_id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AddUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: { email, password, display_name: displayName, role },
    });
    setLoading(false);
    if (error || (data && (data as any).error)) {
      return toast.error((data as any)?.error || error?.message || "Failed to create user");
    }
    toast.success("User created");
    setEmail(""); setPassword(""); setDisplayName(""); setRole("member");
    onCreated();
    onClose();
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Add user</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>Email</Label>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Display name</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Temporary password (min 8)</Label>
          <Input type="text" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as "admin" | "member")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Create user</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

interface SyncResult { source: string; fetched: number; upserted: number; error?: string }
function NoticesSyncCard() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SyncResult[] | null>(null);

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["notices-stats"],
    queryFn: async () => {
      const [noticesCnt, tendersCnt, latest] = await Promise.all([
        supabase.from("notices").select("*", { count: "exact", head: true }),
        supabase.from("tenders").select("*", { count: "exact", head: true }),
        supabase
          .from("notices_sync_log")
          .select("started_at, finished_at, source, inserted, error")
          .order("started_at", { ascending: false })
          .limit(7),
      ]);
      return {
        total: noticesCnt.count || 0,
        tendersTotal: tendersCnt.count || 0,
        latest: latest.data || [],
      };
    },
  });

  const runSync = async () => {
    setRunning(true);
    setResults(null);
    const t0 = Date.now();
    toast.info("Sync started — this may take 2–3 minutes");
    const { data, error } = await supabase.functions.invoke("sync-notices", { body: {} });
    setRunning(false);
    if (error) {
      toast.error(`Sync failed: ${error.message}`);
      return;
    }
    const payload = data as { totalUpserted: number; results: SyncResult[] };
    setResults(payload.results || []);
    toast.success(`Synced ${payload.totalUpserted} notices in ${Math.round((Date.now() - t0) / 1000)}s`);
    refetchStats();
  };

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Database className="h-4 w-4 text-primary" /> Notices Database</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Backfill the last 6 months from all 7 sources into the local notices table. Pages read from the DB.
          </p>
        </div>
        <Button onClick={runSync} disabled={running} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {running ? "Syncing…" : "Sync now"}
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div className="p-3 rounded-lg bg-secondary">
          <p className="text-xs text-muted-foreground">Notices (legacy)</p>
          <p className="text-lg font-bold">{stats?.total ?? "—"}</p>
        </div>
        <div className="p-3 rounded-lg bg-secondary">
          <p className="text-xs text-muted-foreground">Tenders (OCDS)</p>
          <p className="text-lg font-bold">{stats?.tendersTotal ?? "—"}</p>
        </div>
        <div className="p-3 rounded-lg bg-secondary col-span-2">
          <p className="text-xs text-muted-foreground">Last sync per source</p>
          <p className="text-xs">
            {stats?.latest.length
              ? stats.latest.map((l) => `${l.source}: ${l.inserted}${l.error ? " ⚠" : ""}`).join(" · ")
              : "Never run"}
          </p>
        </div>
      </div>

      {results && (
        <div className="text-xs space-y-1 border-t border-border pt-3">
          {results.map((r) => (
            <div key={r.source} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{r.source}</span>
              <span className={r.error ? "text-destructive" : ""}>
                {r.error ? `error: ${r.error}` : `${r.upserted} / ${r.fetched}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
