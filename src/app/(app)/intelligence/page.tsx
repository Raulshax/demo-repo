import Link from "next/link";
import { BarList, Columns, PriceTrend } from "@/components/charts";
import { AiPanel, Badge, Card, PageHeader, Select, Stat, Table, Td, Th, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { aed, num, price } from "@/lib/format";

export const metadata = { title: "Procurement intelligence" };

interface Insight { tone: "success" | "warn" | "danger" | "info"; title: string; detail: string; value?: number; href?: string }

export default async function Intelligence({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const user = await requireUser(CONTRACTOR_ROLES);
  const d = await withActor(user, async (tx) => {
    const k = (await one<{ spend: number; pos: number; bench_saving: number; quote_saving: number; on_time: number | null; deliveries: number; cycle_days: number | null; ai_follow: number | null; prs: number }>(tx, `
      select
        (select coalesce(sum(total),0) from purchase_orders where issued_at > now() - interval '365 days' and status <> 'cancelled') as spend,
        (select count(*)::int from purchase_orders where issued_at > now() - interval '365 days') as pos,
        (select coalesce(sum((m.benchmark_price_aed - pi.unit_price) * pi.quantity),0) from po_items pi join materials m on m.id = pi.material_id
           join purchase_orders po on po.id = pi.po_id where po.issued_at > now() - interval '365 days') as bench_saving,
        (select coalesce(sum(mx.max_total - q.total),0) from purchase_orders po join quotes q on q.id = po.quote_id
           join lateral (select max(total) as max_total from quotes q2 where q2.rfq_id = po.rfq_id) mx on true
           where po.issued_at > now() - interval '365 days') as quote_saving,
        (select avg(case when d.verified_at::date <= coalesce(po.promised_date, po.required_date) then 1.0 else 0 end) from deliveries d join purchase_orders po on po.id = d.po_id where d.verified_at is not null) as on_time,
        (select count(*)::int from deliveries where verified_at is not null) as deliveries,
        (select avg(extract(epoch from po.issued_at - r.sent_at) / 86400) from purchase_orders po join rfqs r on r.id = po.rfq_id where r.sent_at is not null) as cycle_days,
        (select avg(case when follows_ai_recommendation then 1.0 else 0 end) from purchase_requests where follows_ai_recommendation is not null) as ai_follow,
        (select count(*)::int from purchase_requests) as prs`))!;
    const monthly = await rows<{ month: string; value: number }>(tx,
      `select to_char(g, 'YYYY-MM') as month, coalesce(sum(po.total),0) as value
       from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') g
       left join purchase_orders po on date_trunc('month', po.issued_at) = g and po.status <> 'cancelled' group by g order by g`);
    const byCategory = await rows<{ label: string; value: number; n: number }>(tx,
      `select coalesce(pc.name, c.name, 'Uncategorised') as label, sum(pi.line_total) as value, count(distinct pi.po_id)::int as n
       from po_items pi left join materials m on m.id = pi.material_id left join categories c on c.code = m.category_code left join categories pc on pc.code = c.parent_code
       join purchase_orders po on po.id = pi.po_id where po.issued_at > now() - interval '365 days' group by 1 order by 2 desc`);
    const bySupplier = await rows<{ label: string; value: number; n: number }>(tx,
      `select o.name as label, sum(po.total) as value, count(*)::int as n from purchase_orders po join organizations o on o.id = po.supplier_org_id
       where po.issued_at > now() - interval '365 days' group by 1 order by 2 desc limit 8`);
    const byProject = await rows<{ label: string; value: number; n: number }>(tx,
      `select p.name as label, sum(po.total) as value, count(*)::int as n from purchase_orders po join projects p on p.id = po.project_id group by 1 order by 2 desc`);

    // Price trend for one material.
    const purchased = await rows<{ id: string; name: string; base_unit: string; spend: number }>(tx,
      `select m.id, m.name, m.base_unit, sum(pi.line_total) as spend from po_items pi join materials m on m.id = pi.material_id group by 1,2,3 order by 4 desc limit 25`);
    const sel = purchased.find((p) => p.id === m) ?? purchased[0];
    const market = sel ? await rows<{ month: string; value: number }>(tx,
      `select to_char(date_trunc('month', observed_on), 'YYYY-MM') as month, percentile_cont(0.5) within group (order by unit_price)::numeric(14,2) as value
       from price_history where material_id = $1 and source = 'market' and observed_on > current_date - 365 group by 1 order by 1`, [sel.id]) : [];
    const paid = sel ? await rows<{ date: string; value: number; supplier: string }>(tx,
      `select ph.observed_on::text as date, ph.unit_price as value, o.name as supplier from price_history ph join organizations o on o.id = ph.supplier_org_id
       where ph.material_id = $1 and ph.source = 'po' and ph.contractor_org_id = $2 order by ph.observed_on`, [sel.id, user.orgId]) : [];

    // ---------------- insights
    const insights: Insight[] = [];
    for (const r of await rows<{ name: string; paid: number; median: number; qty: number; supplier: string; observed_on: string }>(tx,
      `with mk as (select material_id, date_trunc('month', observed_on) as mo, percentile_cont(0.5) within group (order by unit_price) as median
                   from price_history where source = 'market' group by 1, 2)
       select m.name, ph.unit_price as paid, mk.median::numeric(14,2) as median, ph.quantity as qty, o.name as supplier, ph.observed_on::text
       from price_history ph join mk on mk.material_id = ph.material_id and mk.mo = date_trunc('month', ph.observed_on)
       join materials m on m.id = ph.material_id join organizations o on o.id = ph.supplier_org_id
       where ph.source = 'po' and ph.contractor_org_id = $1 and ph.observed_on > current_date - 180 and ph.unit_price > mk.median * 1.05
       order by (ph.unit_price - mk.median) * ph.quantity desc limit 3`, [user.orgId]))
      insights.push({ tone: "warn", title: `Paid ${(((r.paid - r.median) / r.median) * 100).toFixed(0)}% above market for ${r.name}`,
        detail: `${r.supplier} at ${price(r.paid)} vs market median ${price(r.median)} - re-negotiate or re-quote next time.`, value: (r.paid - r.median) * r.qty });
    for (const r of await rows<{ id: string; name: string; recent: number; prior: number; open_qty: number; base_unit: string }>(tx,
      `with t as (select material_id,
                    percentile_cont(0.5) within group (order by unit_price) filter (where observed_on > current_date - 90) as recent,
                    percentile_cont(0.5) within group (order by unit_price) filter (where observed_on between current_date - 365 and current_date - 180) as prior
                  from price_history where source = 'market' group by 1)
       select m.id, m.name, t.recent::numeric(14,2), t.prior::numeric(14,2), sum(r.quantity) as open_qty, m.base_unit
       from requirements r join t on t.material_id = r.material_id join materials m on m.id = r.material_id
       where r.status in ('draft','confirmed') and t.recent > t.prior * 1.03 group by m.id, m.name, t.recent, t.prior, m.base_unit order by (t.recent - t.prior) * sum(r.quantity) desc limit 3`))
      insights.push({ tone: "info", title: `${r.name}: market up ${(((r.recent - r.prior) / r.prior) * 100).toFixed(1)}% year-on-year`,
        detail: `You still need ${num(r.open_qty)} ${r.base_unit} that is not yet ordered - consider sourcing now rather than closer to the need date.`, href: `/intelligence?m=${r.id}` });
    for (const r of await rows<{ name: string; suppliers: number; lo: number; hi: number; qty: number }>(tx,
      `select m.name, count(distinct ph.supplier_org_id)::int as suppliers, min(ph.unit_price) as lo, max(ph.unit_price) as hi, sum(ph.quantity) as qty
       from price_history ph join materials m on m.id = ph.material_id where ph.source = 'po' and ph.contractor_org_id = $1 and ph.observed_on > current_date - 365
       group by m.name having count(distinct ph.supplier_org_id) > 1 and max(ph.unit_price) > min(ph.unit_price) * 1.05 order by (max(ph.unit_price) - min(ph.unit_price)) * sum(ph.quantity) desc limit 2`, [user.orgId]))
      insights.push({ tone: "info", title: `Consolidate ${r.name}`, detail: `Bought from ${r.suppliers} suppliers at ${price(r.lo)}-${price(r.hi)}. A framework price with the best performer could standardise cost across projects.` });
    for (const r of await rows<{ name: string; on_time: number; orders: number }>(tx,
      `select o.name, sc.on_time_rate as on_time, count(po.id)::int as orders from purchase_orders po join organizations o on o.id = po.supplier_org_id
       join supplier_scorecards() sc on sc.supplier_org_id = po.supplier_org_id where sc.on_time_rate < 0.82 and po.issued_at > now() - interval '365 days'
       group by 1, 2 order by 3 desc limit 2`))
      insights.push({ tone: "danger", title: `${r.name} delivers on time only ${Math.round(r.on_time * 100)}% of the time`, detail: `You placed ${r.orders} order(s) with them this year. Prefer better-performing suppliers for programme-critical items.` });

    const supplierPerf = await rows<{ name: string; orders: number; spend: number; on_time: number | null; fill: number | null; disputes: number }>(tx,
      `select o.name, count(distinct po.id)::int as orders, (select sum(p3.total) from purchase_orders p3 where p3.supplier_org_id = o.id) as spend,
              avg(case when d.verified_at is null then null when d.verified_at::date <= coalesce(po.promised_date, po.required_date) then 1.0 else 0 end) as on_time,
              (select sum(pi.accepted_qty) / nullif(sum(pi.quantity),0) from po_items pi join purchase_orders p2 on p2.id = pi.po_id where p2.supplier_org_id = o.id and p2.status in ('closed','delivered','partially_delivered')) as fill,
              (select count(*)::int from disputes x where x.supplier_org_id = o.id) as disputes
       from purchase_orders po join organizations o on o.id = po.supplier_org_id left join deliveries d on d.po_id = po.id group by o.id, o.name order by spend desc`);
    return { k, monthly, byCategory, bySupplier, byProject, purchased, sel, market, paid, insights, supplierPerf };
  });

  const { k } = d;
  const totalSaving = Math.max(k.bench_saving, 0) + k.quote_saving;
  return (
    <>
      <PageHeader title="Procurement intelligence" subtitle="What you spend, what you saved, what the market is doing and how suppliers perform - built from your own transactions and the anonymised network." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <Stat label="Spend, 12 months" value={aed(k.spend)} hint={`${k.pos} purchase orders`} />
        <Stat label="Saved vs highest quote" value={aed(k.quote_saving)} hint="Competitive tendering" tone="good" />
        <Stat label="Saved vs market benchmark" value={aed(k.bench_saving)} hint={k.spend ? `${((k.bench_saving / k.spend) * 100).toFixed(1)}% of spend` : undefined} tone={k.bench_saving >= 0 ? "good" : "bad"} />
        <Stat label="On-time delivery" value={k.on_time === null ? "—" : `${Math.round(k.on_time * 100)}%`} hint={`${k.deliveries} verified`} />
        <Stat label="RFQ → PO cycle" value={k.cycle_days === null ? "—" : `${k.cycle_days.toFixed(1)} days`} />
        <Stat label="AI recommendations followed" value={k.ai_follow === null ? "—" : `${Math.round(k.ai_follow * 100)}%`} hint={`${k.prs} decisions`} />
      </div>

      {d.insights.length > 0 && (
        <div className="mb-6">
          <AiPanel title={`${d.insights.length} savings & risk opportunities`} footer={`Combined measurable savings to date: ${aed(totalSaving)}. Opportunities are suggestions - nothing is purchased automatically.`}>
            <ul className="mt-1 grid gap-3 md:grid-cols-2">
              {d.insights.map((x, i) => (
                <li key={i} className="rounded-md border border-line bg-surface px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{x.href ? <Link href={x.href} className="hover:text-accent">{x.title}</Link> : x.title}</span>
                    <Badge tone={x.tone}>{x.tone === "danger" ? "Risk" : x.tone === "warn" ? "Overpaid" : "Opportunity"}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{x.detail}{x.value ? ` (≈ ${aed(x.value)})` : ""}</p>
                </li>
              ))}
            </ul>
          </AiPanel>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Monthly spend" subtitle="Purchase orders issued, last 12 months">
          <Columns data={d.monthly.map((x) => ({ label: new Date(x.month + "-01").toLocaleDateString("en-GB", { month: "short" }), value: x.value }))} />
          <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Table view</summary>
            <Table className="mt-2"><tbody>{d.monthly.map((x) => <tr key={x.month}><Td>{x.month}</Td><Td right>{aed(x.value)}</Td></tr>)}</tbody></Table></details>
        </Card>
        <Card title="Price trend vs what you paid" subtitle={d.sel ? `${d.sel.name} · AED per ${d.sel.base_unit}` : undefined}
          actions={d.purchased.length > 0 && (
            <form className="flex gap-1">
              <Select name="m" defaultValue={d.sel?.id} className="max-w-56 py-1 text-xs">{d.purchased.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
              <SubmitButton size="sm" variant="secondary">Show</SubmitButton>
            </form>)}>
          {d.sel ? <PriceTrend market={d.market} paid={d.paid} unit={d.sel.base_unit} /> : <p className="text-sm text-muted">No purchases yet.</p>}
        </Card>
        <Card title="Spend by category" subtitle="12 months"><BarList data={d.byCategory.map((x) => ({ label: x.label, value: x.value, detail: `${x.n} orders` }))} /></Card>
        <Card title="Spend by supplier" subtitle="Top 8, 12 months"><BarList data={d.bySupplier.map((x) => ({ label: x.label, value: x.value, detail: `${x.n} orders` }))} /></Card>
        <Card title="Spend by project"><BarList data={d.byProject.map((x) => ({ label: x.label, value: x.value, detail: `${x.n} orders` }))} /></Card>
        <Card title="Your supplier performance" subtitle="From deliveries verified by your site teams" padded={false}>
          <Table>
            <thead><tr><Th>Supplier</Th><Th right>Orders</Th><Th right>On time</Th><Th right>Fill rate</Th><Th right>Disputes</Th></tr></thead>
            <tbody>{d.supplierPerf.map((s) => (
              <tr key={s.name}><Td>{s.name}</Td><Td right>{s.orders}</Td>
                <Td right className={cx(s.on_time !== null && (s.on_time >= 0.9 ? "text-success" : s.on_time < 0.8 ? "text-danger" : "text-warn"))}>{s.on_time === null ? "—" : `${Math.round(s.on_time * 100)}%`}</Td>
                <Td right>{s.fill === null ? "—" : `${Math.round(s.fill * 100)}%`}</Td><Td right>{s.disputes}</Td></tr>))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
