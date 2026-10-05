import Link from "next/link";
import { BarList, Columns } from "@/components/charts";
import { Card, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { aed, num } from "@/lib/format";

export const metadata = { title: "Platform overview" };

export default async function Admin() {
  const user = await requireUser(["platform_admin"]);
  const d = await withActor(user, async (tx) => ({
    k: (await one<{ gmv: number; contractors: number; suppliers: number; users: number; rfqs: number; response: number | null; open_disputes: number; escalated: number; ai_runs: number }>(tx, `
      select (select coalesce(sum(total),0) from purchase_orders where issued_at > now() - interval '365 days') as gmv,
             (select count(*)::int from organizations where kind = 'contractor') as contractors,
             (select count(*)::int from organizations where kind = 'supplier') as suppliers,
             (select count(*)::int from users) as users,
             (select count(*)::int from rfqs where status <> 'draft') as rfqs,
             (select avg(case when status in ('quoted','awarded','not_selected') then 1.0 else 0 end) from rfq_invitations where status <> 'recommended') as response,
             (select count(*)::int from disputes where status <> 'resolved') as open_disputes,
             (select count(*)::int from disputes where status = 'escalated') as escalated,
             (select count(*)::int from ai_runs) as ai_runs`))!,
    monthly: await rows<{ month: string; value: number }>(tx,
      `select to_char(g, 'YYYY-MM') as month, coalesce(sum(po.total),0) as value
       from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') g
       left join purchase_orders po on date_trunc('month', po.issued_at) = g group by g order by g`),
    byContractor: await rows<{ label: string; value: number }>(tx,
      "select o.name as label, sum(po.total) as value from purchase_orders po join organizations o on o.id = po.org_id group by 1 order by 2 desc"),
    disputes: await rows<{ id: string; type: string; status: string; contractor: string; supplier: string }>(tx,
      `select d.id, d.type, d.status, c.name as contractor, s.name as supplier from disputes d join organizations c on c.id = d.org_id join organizations s on s.id = d.supplier_org_id
       where d.status <> 'resolved' order by d.status = 'escalated' desc`),
  }));
  return (
    <>
      <PageHeader title="Platform overview" subtitle="Transactions, network health and disputes across all tenants." />
      <div className="mb-8 grid grid-cols-2 gap-x-5 gap-y-6 lg:grid-cols-4">
        <Stat label="Order value, 12 months" value={aed(d.k.gmv)} />
        <Stat label="Organisations" value={`${d.k.contractors} / ${d.k.suppliers}`} hint="contractors / suppliers" />
        <Stat label="RFQ response rate" value={d.k.response === null ? "—" : `${Math.round(d.k.response * 100)}%`} hint={`${num(d.k.rfqs)} RFQs sent`} />
        <Stat label="Open disputes" value={d.k.open_disputes} hint={`${d.k.escalated} escalated to platform`} tone={d.k.escalated ? "bad" : "neutral"} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Monthly order value"><Columns data={d.monthly.map((x) => ({ label: new Date(x.month + "-01").toLocaleDateString("en-GB", { month: "short" }), value: x.value }))} /></Card>
        <Card title="Order value by contractor"><BarList data={d.byContractor} /></Card>
        <Card title="Open disputes" padded={false}>
          {d.disputes.length === 0 ? <p className="p-4 text-sm text-muted">None.</p> : (
            <ul className="divide-y divide-line">{d.disputes.map((x) => (
              <li key={x.id}><Link href={`/disputes/${x.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2">
                <span className="text-sm">{x.type.replace("_", " ")} · {x.contractor} ↔ {x.supplier}</span><StatusBadge status={x.status} /></Link></li>))}</ul>)}
        </Card>
        <Card title="Platform"><p className="text-sm text-muted">{num(d.k.users)} users · {num(d.k.ai_runs)} AI runs logged (extraction, supplier matching, quote comparison).</p></Card>
      </div>
    </>
  );
}
