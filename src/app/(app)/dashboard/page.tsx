import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, ButtonLink, Card, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireUser, type SessionUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { aed, date, dateTime, daysFromToday, num } from "@/lib/format";

export const metadata = { title: "Today" };

interface Task { href: string; title: string; detail: string; tone: "danger" | "warn" | "info" | "ai" | "accent"; tag: string; due?: string | null }

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  if (user.role === "platform_admin") redirect("/admin");
  const { denied } = await searchParams;
  return (
    <>
      {denied && <div className="mb-4 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">That page is not available for your role.</div>}
      {user.orgKind === "supplier" ? <SupplierDashboard user={user} /> : <ContractorDashboard user={user} />}
    </>
  );
}

async function ContractorDashboard({ user }: { user: SessionUser }) {
  const data = await withActor(user, async (tx) => {
    const tasks: Task[] = [];
    if (user.role === "contractor_manager" || user.role === "contractor_exec") {
      for (const p of await rows<{ id: string; amount: number; supplier: string; title: string; high_value: boolean; follows: boolean; requester: string; created_at: string }>(tx,
        `select pr.id, pr.amount, o.name as supplier, r.title, pr.high_value, pr.follows_ai_recommendation as follows, u.full_name as requester, pr.created_at
         from purchase_requests pr join organizations o on o.id = pr.supplier_org_id join rfqs r on r.id = pr.rfq_id join users u on u.id = pr.requested_by
         where pr.status = 'pending' order by pr.created_at`))
        tasks.push({ href: "/approvals", tag: "Approve", tone: "danger", title: `${aed(p.amount)} - ${p.title}`,
          detail: `${p.requester} requests ${p.supplier}${p.high_value ? " · high value" : ""}${p.follows ? " · follows AI recommendation" : " · deviates from AI recommendation"}` });
    }
    for (const r of await rows<{ id: string; number: string; title: string; quotes: number; invited: number; quote_due: string | null }>(tx,
      `select r.id, r.number, r.title, r.quote_due,
              (select count(*)::int from quotes q where q.rfq_id = r.id) as quotes,
              (select count(*)::int from rfq_invitations i where i.rfq_id = r.id and i.status <> 'recommended') as invited
       from rfqs r where r.status = 'sent' and not exists (select 1 from purchase_requests pr where pr.rfq_id = r.id and pr.status in ('pending','approved'))
       order by r.quote_due nulls last`)) {
      if (r.quotes > 0)
        tasks.push({ href: `/rfqs/${r.id}`, tag: "Compare quotes", tone: "ai", title: `${r.quotes} of ${r.invited} quotes in - ${r.title}`,
          detail: `${r.number} · AI comparison ready${r.quote_due ? ` · quotes due ${date(r.quote_due)}` : ""}` });
      else if ((daysFromToday(r.quote_due) ?? 1) < 0)
        tasks.push({ href: `/rfqs/${r.id}`, tag: "Chase", tone: "warn", title: `No quotes yet - ${r.title}`, detail: `${r.number} · due ${date(r.quote_due)}` });
    }
    for (const d of await rows<{ id: string; po_id: string; number: string; supplier: string; po_number: string; scheduled_date: string; project: string; vehicle_no: string | null }>(tx,
      `select d.id, d.po_id, d.number, o.name as supplier, po.po_number, d.scheduled_date, p.name as project, d.vehicle_no
       from deliveries d join purchase_orders po on po.id = d.po_id join organizations o on o.id = d.supplier_org_id join projects p on p.id = po.project_id
       where d.status = 'dispatched' order by d.scheduled_date`))
      tasks.push({ href: `/orders/${d.po_id}?verify=${d.id}`, tag: "Verify delivery", tone: "accent", title: `${d.supplier} - ${d.number} arriving ${date(d.scheduled_date)}`,
        detail: `${d.po_number} · ${d.project}${d.vehicle_no ? ` · vehicle ${d.vehicle_no}` : ""}` });
    for (const p of await rows<{ id: string; po_number: string; supplier: string; issued_at: string }>(tx,
      `select po.id, po.po_number, o.name as supplier, po.issued_at from purchase_orders po join organizations o on o.id = po.supplier_org_id
       where po.status = 'issued' order by po.issued_at`))
      tasks.push({ href: `/orders/${p.id}`, tag: "Awaiting supplier", tone: "info", title: `${p.po_number} not yet confirmed by ${p.supplier}`, detail: `Issued ${dateTime(p.issued_at)}` });
    for (const i of await rows<{ po_id: string; invoice_number: string; supplier: string; variance: number }>(tx,
      `select i.po_id, i.invoice_number, o.name as supplier, (i.match_result->>'variance')::numeric as variance
       from invoices i join organizations o on o.id = i.supplier_org_id where i.status = 'mismatch'`))
      tasks.push({ href: "/invoices", tag: "Invoice mismatch", tone: "danger", title: `${i.supplier} invoice ${i.invoice_number} over by ${aed(i.variance)}`, detail: "Invoice exceeds goods accepted on site" });
    if (user.role === "contractor_manager")
      for (const i of await rows<{ invoice_number: string; supplier: string; amount: number; status: string }>(tx,
        `select i.invoice_number, o.name as supplier, i.amount, i.status from invoices i join organizations o on o.id = i.supplier_org_id where i.status in ('matched','approved')`))
        tasks.push({ href: "/invoices", tag: i.status === "matched" ? "Approve invoice" : "Record payment", tone: "warn", title: `${i.supplier} - ${i.invoice_number} · ${aed(i.amount)}`, detail: "Three-way matched to PO and site receipt" });
    for (const d of await rows<{ id: string; type: string; supplier: string; status: string; amount_at_stake: number | null }>(tx,
      `select d.id, d.type, o.name as supplier, d.status, d.amount_at_stake from disputes d join organizations o on o.id = d.supplier_org_id where d.status <> 'resolved'`))
      tasks.push({ href: `/disputes/${d.id}`, tag: d.status === "supplier_responded" ? "Supplier replied" : "Dispute", tone: "warn",
        title: `${d.type.replace("_", " ")} - ${d.supplier}`, detail: d.amount_at_stake ? `${aed(d.amount_at_stake)} at stake` : "Open" });
    for (const r of await rows<{ project_id: string; project: string; n: number }>(tx,
      `select r.project_id, p.name as project, count(*)::int as n from requirements r join projects p on p.id = r.project_id where r.status = 'draft' group by 1, 2`))
      tasks.push({ href: `/projects/${r.project_id}#requirements`, tag: "Review", tone: "ai", title: `${r.n} AI-extracted line(s) to review - ${r.project}`, detail: "Confirm what you need to buy before sourcing" });
    for (const r of await rows<{ project_id: string; project: string; n: number; first: string }>(tx,
      `select r.project_id, p.name as project, count(*)::int as n, min(r.required_date)::text as first from requirements r join projects p on p.id = r.project_id
       where r.status = 'confirmed' group by 1, 2`))
      tasks.push({ href: `/projects/${r.project_id}#requirements`, tag: "Source", tone: "info", title: `${r.n} confirmed requirement(s) not yet in an RFQ - ${r.project}`,
        detail: r.first ? `Earliest needed ${date(r.first)} (${daysFromToday(r.first)} days)` : "No need-by date" });

    const k = await one<{ spend_30: number; open_pos: number; open_value: number; on_time: number | null; deliveries: number; saving: number }>(tx, `
      select
        (select coalesce(sum(total),0) from purchase_orders where issued_at > now() - interval '30 days') as spend_30,
        (select count(*)::int from purchase_orders where status in ('issued','confirmed','in_delivery','partially_delivered')) as open_pos,
        (select coalesce(sum(total),0) from purchase_orders where status in ('issued','confirmed','in_delivery','partially_delivered')) as open_value,
        (select avg(case when d.verified_at::date <= coalesce(po.promised_date, po.required_date) then 1.0 else 0 end) from deliveries d join purchase_orders po on po.id = d.po_id where d.verified_at is not null) as on_time,
        (select count(*)::int from deliveries where verified_at is not null) as deliveries,
        (select coalesce(sum(greatest(m.benchmark_price_aed - pi.unit_price, 0) * pi.quantity),0) from po_items pi join materials m on m.id = pi.material_id
          join purchase_orders po on po.id = pi.po_id where po.issued_at > now() - interval '90 days') as saving`);
    return { tasks, k: k! };
  });

  const { tasks, k } = data;
  return (
    <>
      <PageHeader title={`Good ${greeting()}, ${user.fullName.split(" ")[0]}`}
        subtitle={<>What needs your attention today · {user.orgName}</>}
        actions={user.role !== "contractor_exec" && <ButtonLink href="/projects">Upload a BOQ</ButtonLink>} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Spend, last 30 days" value={aed(k.spend_30)} />
        <Stat label="Open orders" value={num(k.open_pos)} hint={aed(k.open_value)} />
        <Stat label="On-time delivery" value={k.on_time === null ? "—" : `${Math.round(k.on_time * 100)}%`} hint={`${k.deliveries} verified deliveries`} tone={k.on_time !== null && k.on_time >= 0.9 ? "good" : "bad"} />
        <Stat label="Savings vs market, 90 days" value={aed(k.saving)} hint="Paid below network benchmark" tone="good" />
      </div>
      <Card title="Needs attention" subtitle={`${tasks.length} item(s)`} padded={false}>
        {tasks.length === 0 ? <div className="p-4"><Empty title="All clear">Nothing needs your attention right now.</Empty></div> : (
          <ul className="divide-y divide-line">
            {tasks.map((t, i) => (
              <li key={i}>
                <Link href={t.href} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <Badge tone={t.tone} className="w-32 justify-center">{t.tag}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{t.title}</div>
                    <div className="truncate text-xs text-muted">{t.detail}</div>
                  </div>
                  <span className="text-xs text-subtle">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

async function SupplierDashboard({ user }: { user: SessionUser }) {
  const d = await withActor(user, async (tx) => ({
    rfqs: await rows<{ rfq_id: string; number: string; title: string; contractor: string; quote_due: string | null; status: string; lines: number }>(tx,
      `select r.id as rfq_id, r.number, r.title, o.name as contractor, r.quote_due, i.status,
              (select count(*)::int from rfq_items ri where ri.rfq_id = r.id) as lines
       from rfq_invitations i join rfqs r on r.id = i.rfq_id join organizations o on o.id = r.org_id
       where i.status in ('invited','viewed') and r.status = 'sent' order by r.quote_due nulls last`),
    orders: await rows<{ id: string; po_number: string; contractor: string; total: number; status: string; required_date: string | null }>(tx,
      `select po.id, po.po_number, o.name as contractor, po.total, po.status, po.required_date from purchase_orders po join organizations o on o.id = po.org_id
       where po.status in ('issued','confirmed','partially_delivered','in_delivery') order by po.required_date`),
    disputes: await rows<{ id: string; type: string; contractor: string; status: string }>(tx,
      `select d.id, d.type, o.name as contractor, d.status from disputes d join organizations o on o.id = d.org_id where d.status in ('open','escalated','supplier_responded')`),
    k: (await one<{ won: number; quoted: number; revenue: number; on_time: number | null }>(tx, `
      select (select count(*)::int from rfq_invitations where status = 'awarded') as won,
             (select count(*)::int from rfq_invitations where status in ('quoted','awarded','not_selected')) as quoted,
             (select coalesce(sum(total),0) from purchase_orders where issued_at > now() - interval '90 days') as revenue,
             (select on_time_rate from supplier_scorecards() where supplier_org_id = $1) as on_time`, [user.orgId]))!,
  }));
  return (
    <>
      <PageHeader title={user.orgName} subtitle="Your RFQs, orders and deliveries" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open RFQs" value={d.rfqs.length} />
        <Stat label="Win rate" value={d.k.quoted ? `${Math.round((d.k.won / d.k.quoted) * 100)}%` : "—"} hint={`${d.k.won} of ${d.k.quoted} quotes`} />
        <Stat label="Orders, 90 days" value={aed(d.k.revenue)} />
        <Stat label="Your on-time rate" value={d.k.on_time === null ? "—" : `${Math.round(d.k.on_time * 100)}%`} hint="Seen by contractors" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="RFQs awaiting your quote" padded={false}>
          {d.rfqs.length === 0 ? <div className="p-4 text-sm text-muted">No open RFQs.</div> : (
            <ul className="divide-y divide-line">{d.rfqs.map((r) => (
              <li key={r.rfq_id}><Link href={`/supplier/rfqs/${r.rfq_id}`} className="block px-4 py-3 hover:bg-surface-2">
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{r.title}</span><StatusBadge status={r.status} /></div>
                <div className="text-xs text-muted">{r.contractor} · {r.number} · {r.lines} lines · due {date(r.quote_due)}</div>
              </Link></li>))}</ul>)}
        </Card>
        <Card title="Orders to fulfil" padded={false}>
          {d.orders.length === 0 ? <div className="p-4 text-sm text-muted">No open orders.</div> : (
            <ul className="divide-y divide-line">{d.orders.map((o) => (
              <li key={o.id}><Link href={`/supplier/orders/${o.id}`} className="block px-4 py-3 hover:bg-surface-2">
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{o.po_number} · {aed(o.total)}</span><StatusBadge status={o.status} /></div>
                <div className="text-xs text-muted">{o.contractor} · required {date(o.required_date)}</div>
              </Link></li>))}</ul>)}
        </Card>
        {d.disputes.length > 0 && (
          <Card title="Disputes" padded={false}>
            <ul className="divide-y divide-line">{d.disputes.map((x) => (
              <li key={x.id}><Link href={`/disputes/${x.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2">
                <span className="text-sm">{x.type.replace("_", " ")} · {x.contractor}</span><StatusBadge status={x.status} />
              </Link></li>))}</ul>
          </Card>
        )}
      </div>
    </>
  );
}

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dubai" }));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
