import { Suspense } from "react";
import { Flash } from "@/components/client";
import Link from "next/link";
import { NavSide, NavTabs, type NavItem } from "@/components/nav";
import { BRAND, LogoMark } from "@/components/ui";
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
    { href: "/supplier/orders", label: "Orders", count: n.orders },
    { href: "/disputes", label: "Disputes", count: n.disputes },
    { href: "/supplier/profile", label: "Catalogue" },
    { href: "/audit", label: "Activity" },
  ];
  const items: NavItem[] = [
    { href: "/dashboard", label: "Today" },
    { href: "/projects", label: "Projects" },
    { href: "/rfqs", label: "RFQs" },
    { href: "/approvals", label: "Approvals", count: user.role === "contractor_manager" ? n.approvals : undefined },
    { href: "/orders", label: "Orders", count: n.deliveries },
    { href: "/invoices", label: "Invoices", count: user.role === "contractor_manager" ? n.invoices : undefined },
    { href: "/disputes", label: "Disputes", count: n.disputes },
    { href: "/intelligence", label: "Intelligence" },
    { href: "/suppliers", label: "Suppliers" },
    { href: "/materials", label: "Materials" },
    { href: "/audit", label: "Audit" },
  ];
  if (user.role === "contractor_exec") return items.filter((i) => !["/materials"].includes(i.href));
  return items;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = await navFor(user);
  if (user.role === "platform_admin") {
    return (
      <div className="graphite min-h-screen lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="no-print flex flex-col gap-1 border-b border-line bg-nav px-3.5 py-[18px] lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
          <Link href="/admin" className="m mb-5 flex items-center gap-2 px-1.5 text-muted"><LogoMark className="text-ink" /> {BRAND} · Desk</Link>
          <NavSide items={items} />
          <div className="m mt-auto hidden px-2 text-[10px] text-muted lg:block">
            <div className="text-ink">{user.fullName}</div>
            <div>{ROLE_LABEL[user.role]}</div>
            <form action={logoutAction} className="mt-3"><button className="border-b border-current pb-0.5 hover:text-ink">Sign out</button></form>
          </div>
        </aside>
        <main className="drafting min-w-0 px-4 pt-6 pb-24 sm:px-[clamp(16px,2.6vw,36px)]">
          <Suspense><Flash /></Suspense>
          {children}
        </main>
      </div>
    );
  }
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-[60px] max-w-[1360px] items-center gap-4 px-[clamp(16px,3.2vw,48px)]">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5 text-ink">
            <LogoMark />
            <span className="text-[17px] font-bold uppercase tracking-[.06em] [font-stretch:125%] [font-variation-settings:'wdth'_125]">{BRAND}</span>
          </Link>
          <nav className="min-w-0 flex-1"><NavTabs items={items} /></nav>
          <div className="flex shrink-0 items-center gap-3">
            <details className="relative">
              <summary className="m flex cursor-pointer list-none items-center gap-2 border border-ink px-2.5 py-2 text-ink hover:bg-ink hover:text-surface">
                {initials(user.fullName)}
              </summary>
              <div className="absolute right-0 z-40 mt-1 w-64 border border-ink bg-surface p-3">
                <div className="text-sm font-semibold">{user.fullName}</div>
                <div className="m mt-0.5 text-muted">{ROLE_LABEL[user.role]}</div>
                <div className="m lc mt-0.5 text-muted">{user.orgName}</div>
                <form action={logoutAction} className="mt-3 border-t border-line pt-3"><button className="m border-b border-current pb-0.5 text-ink">Sign out</button></form>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1360px] px-[clamp(16px,3.2vw,48px)] pt-8 pb-28">
        <Suspense><Flash /></Suspense>
        {children}
      </main>
    </div>
  );
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}
