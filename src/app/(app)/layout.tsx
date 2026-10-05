import { Suspense } from "react";
import { Flash } from "@/components/client";
import { NavLinks, type NavItem } from "@/components/nav";
import { ROLE_LABEL, requireUser, type SessionUser } from "@/lib/auth";
import { one, withActor } from "@/lib/db";
import { logoutAction } from "../login/actions";

async function navFor(user: SessionUser): Promise<NavItem[]> {
  const c = await withActor(user, (tx) => one<Record<string, number>>(tx, user.orgKind === "supplier" ? `
      select (select count(*)::int from rfq_invitations where status in ('invited','viewed')) as rfqs,
             (select count(*)::int from purchase_orders where status = 'issued') as orders,
             (select count(*)::int from disputes where status in ('open','escalated')) as disputes` : user.orgKind === "contractor" ? `
      select (select count(*)::int from purchase_requests where status = 'pending') as approvals,
             (select count(*)::int from deliveries where status = 'dispatched') as deliveries,
             (select count(*)::int from disputes where status <> 'resolved') as disputes,
             (select count(*)::int from invoices where status in ('submitted','matched','mismatch')) as invoices` : `
      select (select count(*)::int from disputes where status = 'escalated') as disputes,
             (select count(*)::int from organizations where status = 'pending') as orgs`));
  const n = c ?? {};
  if (user.role === "platform_admin") return [
    { href: "/admin", label: "Platform overview" },
    { href: "/admin/organizations", label: "Organisations", count: n.orgs },
    { href: "/disputes", label: "Disputes", count: n.disputes },
    { href: "/materials", label: "Material database" },
    { href: "/suppliers", label: "Supplier network" },
    { href: "/audit", label: "Audit trail" },
  ];
  if (user.orgKind === "supplier") return [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/supplier/rfqs", label: "RFQs", count: n.rfqs },
    { href: "/supplier/orders", label: "Orders & deliveries", count: n.orders },
    { href: "/disputes", label: "Disputes", count: n.disputes },
    { href: "/supplier/profile", label: "Company & catalogue" },
    { href: "/audit", label: "Activity" },
  ];
  const items: NavItem[] = [
    { href: "/dashboard", label: "Today" },
    { href: "/projects", label: "Projects" },
    { href: "/rfqs", label: "RFQs & quotes" },
    { href: "/approvals", label: "Approvals", count: user.role === "contractor_manager" ? n.approvals : undefined },
    { href: "/orders", label: "Orders & deliveries", count: n.deliveries },
    { href: "/invoices", label: "Invoices & payments", count: user.role === "contractor_manager" ? n.invoices : undefined },
    { href: "/disputes", label: "Disputes", count: n.disputes },
    { href: "/intelligence", label: "Intelligence" },
    { href: "/suppliers", label: "Suppliers" },
    { href: "/materials", label: "Material database" },
    { href: "/audit", label: "Audit trail" },
  ];
  if (user.role === "contractor_exec") return items.filter((i) => !["/materials"].includes(i.href));
  return items;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = await navFor(user);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print bg-nav lg:fixed lg:inset-y-0 lg:flex lg:w-60 lg:flex-col">
        <div className="flex items-center justify-between px-4 py-3 lg:py-4">
          <div className="flex items-center gap-2 text-white">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="var(--accent)" /><path d="M9 22V10h7.5a4.5 4.5 0 010 9H13" stroke="white" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /><circle cx="21.5" cy="22" r="2" fill="white" /></svg>
            <span className="font-semibold">ProcureOS</span>
          </div>
          <form action={logoutAction} className="lg:hidden"><button className="text-xs text-nav-text hover:text-white">Sign out</button></form>
        </div>
        <nav className="lg:hidden"><NavLinks items={items} horizontal /></nav>
        <nav className="hidden flex-1 overflow-y-auto px-2 lg:block"><NavLinks items={items} /></nav>
        <div className="hidden border-t border-white/10 px-4 py-3 lg:block">
          <div className="truncate text-sm font-medium text-white">{user.fullName}</div>
          <div className="truncate text-xs text-nav-text">{ROLE_LABEL[user.role]} · {user.orgName}</div>
          <form action={logoutAction} className="mt-2"><button className="text-xs text-nav-text hover:text-white">Sign out</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Suspense><Flash /></Suspense>
          {children}
        </div>
      </main>
    </div>
  );
}
