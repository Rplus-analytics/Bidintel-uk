import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Search, Kanban, Building2, Users, Bell, Settings, ChevronLeft, ChevronRight, Zap, FileText, ShieldCheck, LogOut, Star, CalendarDays, Mic, Layers, Menu, CalendarClock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Search, label: "Contracts", path: "/contracts" },
  { icon: FileText, label: "Open Bids", path: "/open-bids" },
  { icon: Kanban, label: "My Bids", path: "/pipeline" },
  { icon: CalendarClock, label: "Contracts Nearing Expiry", path: "/expiring" },
  { icon: Building2, label: "Buyers", path: "/buyers" },
  { icon: Users, label: "Suppliers", path: "/suppliers" },
  { icon: Star, label: "Saved Searches", path: "/saved-searches" },
  { icon: CalendarDays, label: "Conferences", path: "/conferences" },
  { icon: Mic, label: "Speakers", path: "/speakers" },
  { icon: Layers, label: "Frameworks", path: "/frameworks" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { isAdmin, orgName, user, signOut } = useAuth();

  const bottomItems = [
    ...(isAdmin ? [{ icon: ShieldCheck, label: "Admin", path: "/admin" }] : []),
    { icon: Bell, label: "Alerts", path: "/alerts" },
    { icon: Settings, label: "Settings", path: "/settings" },
  ];

  const SidebarContent = ({ showLabels, onNavigate }: { showLabels: boolean; onNavigate?: () => void }) => (
    <>
      <div className="flex items-center gap-2 px-4 h-16 border-b border-border shrink-0">
        <Zap className="h-7 w-7 text-primary shrink-0" />
        {showLabels && (
          <div className="min-w-0">
            <div className="text-lg font-bold text-foreground tracking-tight leading-tight">BidIntel</div>
            {orgName && <div className="text-[10px] text-muted-foreground truncate">{orgName}</div>}
          </div>
        )}
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {showLabels && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="py-4 space-y-1 px-2 border-t border-border shrink-0">
        {bottomItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {showLabels && <span>{item.label}</span>}
            </Link>
          );
        })}
        {user && (
          <button
            onClick={() => signOut()}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors w-full"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {showLabels && <span className="truncate">Sign out</span>}
          </button>
        )}
        {!onNavigate && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors w-full"
          >
            {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            {showLabels && <span>Collapse</span>}
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex flex-col border-r border-border bg-sidebar transition-all duration-300 ${collapsed ? "w-16" : "w-60"}`}>
        <SidebarContent showLabels={!collapsed} />
      </aside>

      <main className="flex-1 overflow-y-auto">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-2 h-14 px-3 border-b border-border bg-background/95 backdrop-blur">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64 flex flex-col bg-sidebar">
              <SidebarContent showLabels onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 min-w-0">
            <Zap className="h-5 w-5 text-primary shrink-0" />
            <span className="font-bold text-foreground truncate">BidIntel</span>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
