import Link from "next/link";
import { notFound } from "next/navigation";
import { AiPanel, Badge, ButtonLink, Card, Field, Input, KeyValue, PageHeader, StatusBadge, Table, Td, Textarea, Th, cx } from "@/components/ui";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { aed, date, dateTime, daysFromToday, num, price } from "@/lib/format";
import { buildComparison } from "@/lib/services/rfq";
import { cancelRfq, refreshRecommendations, requestApprovalAction, sendRfqAction } from "../../../actions/rfqs";

interface Invite { supplier_org_id: string; name: string; status: string; match_score: number | null; selected: boolean;
  match_reasons: { reasons?: string[]; risks?: string[]; breakdown?: Record<string, number>; coverage?: number } | string[]; verified: boolean; invited_at: string | null; responded_at: string | null }

export default async function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(CONTRACTOR_ROLES);
  const data = await withActor(user, async (tx) => {
    const rfq = await one<{ id: string; number: string; title: string; status: string; quote_due: string | null; needed_by: string | null; delivery_location: string | null;
      delivery_emirate: string; project_id: string; project: string; code: string; sent_at: string | null; creator: string }>(tx,
      `select r.*, p.name as project, p.code, u.full_name as creator from rfqs r join projects p on p.id = r.project_id left join users u on u.id = r.created_by where r.id = $1`, [id]);
    if (!rfq) return null;
    const invites = await rows<Invite>(tx,
      `select i.supplier_org_id, o.name, i.status, i.match_score, i.selected, i.match_reasons, sp.verified, i.invited_at, i.responded_at
       from rfq_invitations i join organizations o on o.id = i.supplier_org_id left join supplier_profiles sp on sp.org_id = i.supplier_org_id
       where i.rfq_id = $1 order by i.match_score desc nulls last`, [id]);
    const pr = await one<{ id: string; status: string; amount: number; supplier: string; decision_note: string | null; decider: string | null; requester: string }>(tx,
      `select pr.id, pr.status, pr.amount, o.name as supplier, pr.decision_note, d.full_name as decider, u.full_name as requester
       from purchase_requests pr join organizations o on o.id = pr.supplier_org_id join users u on u.id = pr.requested_by left join users d on d.id = pr.decided_by
       where pr.rfq_id = $1 order by pr.created_at desc limit 1`, [id]);
    const po = await one<{ id: string; po_number: string }>(tx, "select id, po_number from purchase_orders where rfq_id = $1", [id]);
    const cmp = rfq.status === "draft" ? null : await buildComparison(tx, user, id);
    const items = cmp?.items ?? await rows<{ id: string; line_no: number; description: string; quantity: number; unit: string; brand_pref: string | null; material_id: string | null }>(tx,
      "select id, line_no, description, quantity, unit, brand_pref, material_id from rfq_items where rfq_id = $1 order by line_no", [id]);
    const quoteMeta = await rows<{ id: string; lead_time_days: number; payment_terms: string | null; delivery_cost: number; notes: string | null; submitted_at: string; validity_days: number }>(tx,
      "select id, lead_time_days, payment_terms, delivery_cost, notes, submitted_at, validity_days from quotes where rfq_id = $1", [id]);
    return { rfq, invites, pr, po, cmp, items, quoteMeta };
  });
  if (!data) notFound();
  const { rfq, invites, pr, po, cmp, items, quoteMeta } = data;
  const canWrite = user.role !== "contractor_exec";
  const daysLeft = daysFromToday(rfq.needed_by);

  return (
    <>
      <PageHeader title={rfq.title} crumbs={[{ href: "/rfqs", label: "RFQs" }, { href: `/projects/${rfq.project_id}`, label: rfq.code }]}
        subtitle={<>{rfq.number} · {rfq.project} · <StatusBadge status={rfq.status} /> {daysLeft !== null && <span className={cx("ml-1", daysLeft < 7 ? "text-danger" : "")}>· needed {date(rfq.needed_by)} ({daysLeft} days)</span>}</>}
        actions={canWrite && ["draft", "sent"].includes(rfq.status) && !pr && (
          <form action={cancelRfq.bind(null, id)}><ConfirmButton variant="ghost" message="Cancel this RFQ? Its requirements will be released.">Cancel RFQ</ConfirmButton></form>
        )} />

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card title={`Items (${items.length})`} padded={false}>
          <Table>
            <thead><tr><Th>#</Th><Th>Material</Th><Th right>Quantity</Th><Th>Brand</Th><Th right>Market median</Th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}><Td className="text-muted">{i.line_no}</Td><Td>{i.description}</Td><Td right>{num(i.quantity)} {i.unit}</Td>
                <Td className="text-muted">{i.brand_pref ?? "Any"}</Td>
                <Td right className="text-muted">{cmp?.benchmarks[i.material_id ?? ""] ? price(cmp.benchmarks[i.material_id!]) : "—"}</Td></tr>))}
            </tbody>
          </Table>
        </Card>
        <Card title="Details">
          <KeyValue items={[["Delivery to", rfq.delivery_location ?? "—"], ["Emirate", rfq.delivery_emirate], ["Quotes due", date(rfq.quote_due)],
            ["Sent", rfq.sent_at ? dateTime(rfq.sent_at) : "Not sent"], ["Created by", rfq.creator]]} />
        </Card>
      </div>

      {rfq.status === "draft" ? <Recommendations id={id} invites={invites} canWrite={canWrite} quoteDue={rfq.quote_due} /> : (
        <>
          {pr && (
            <div className={cx("mb-6 border px-4 py-3 text-sm",
              pr.status === "approved" ? "border-success/30 bg-success-soft" : pr.status === "rejected" ? "border-danger/30 bg-danger-soft" : "border-warn/30 bg-warn-soft")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><span className="font-medium">Purchase request · {aed(pr.amount)} with {pr.supplier}</span> <StatusBadge status={pr.status} />
                  <div className="text-xs text-muted">Requested by {pr.requester}{pr.decider ? ` · decided by ${pr.decider}` : " · awaiting a procurement manager"}{pr.decision_note ? ` · “${pr.decision_note}”` : ""}</div></div>
                {po ? <ButtonLink href={`/orders/${po.id}`} size="sm">View {po.po_number}</ButtonLink> : user.role === "contractor_manager" && pr.status === "pending" ? <ButtonLink href="/approvals" size="sm">Review approval</ButtonLink> : null}
              </div>
            </div>
          )}
          {cmp && cmp.comparison.evaluations.length > 0
            ? <Comparison id={id} cmp={cmp} quoteMeta={quoteMeta} canRequest={canWrite && (!pr || pr.status === "rejected")} />
            : <Card title="Quotes"><p className="text-sm text-muted">No quotes received yet. Suppliers have been notified; quotes are due {date(rfq.quote_due)}.</p></Card>}
          <Card title="Suppliers invited" className="mt-6" padded={false}>
            <Table>
              <thead><tr><Th>Supplier</Th><Th>Status</Th><Th right>Match score</Th><Th>Invited</Th><Th>Responded</Th></tr></thead>
              <tbody>{invites.filter((i) => i.status !== "recommended").map((i) => (
                <tr key={i.supplier_org_id}><Td>{i.name}</Td><Td><StatusBadge status={i.status} /></Td><Td right>{i.match_score ?? "—"}</Td>
                  <Td className="text-muted">{dateTime(i.invited_at)}</Td><Td className="text-muted">{dateTime(i.responded_at)}</Td></tr>))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

function reasonsOf(i: Invite) {
  const m = Array.isArray(i.match_reasons) ? { reasons: i.match_reasons } : i.match_reasons;
  return { reasons: m.reasons ?? [], risks: m.risks ?? [], breakdown: m.breakdown ?? {} };
}

function Recommendations({ id, invites, canWrite, quoteDue }: { id: string; invites: Invite[]; canWrite: boolean; quoteDue: string | null }) {
  const rec = invites.filter((i) => i.selected);
  const others = invites.filter((i) => !i.selected);
  const Row = ({ i }: { i: Invite }) => {
    const { reasons, risks, breakdown } = reasonsOf(i);
    return (
      <label className="flex cursor-pointer gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-surface-2">
        <input type="checkbox" name="supplier" value={i.supplier_org_id} defaultChecked={i.selected} disabled={!canWrite} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{i.name}</span>
            {i.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}
            <span className="ml-auto text-sm font-semibold tabular">{i.match_score}<span className="text-xs font-normal text-muted"> / 100</span></span>
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-muted">{reasons.map((r) => <li key={r}>✓ {r}</li>)}{risks.map((r) => <li key={r} className="text-warn">! {r}</li>)}</ul>
          {Object.keys(breakdown).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-subtle">
              {Object.entries(breakdown).map(([k, v]) => <span key={k}>{k} {Math.round(v)}</span>)}
            </div>
          )}
        </div>
      </label>
    );
  };
  return (
    <form action={sendRfqAction.bind(null, id)} className="space-y-4">
      <AiPanel title={`${rec.length} suppliers recommended for this RFQ`}
        footer="Ranked on catalogue coverage, price vs network benchmark, verified delivery performance, lead time vs need date, delivery area and your history with them. Not every supplier gets every RFQ - targeted RFQs get better responses.">
        Review the shortlist. Add or remove suppliers, then send. Each supplier will only ever see its own invitation and its own quote.
      </AiPanel>
      <Card title="Recommended" padded={false}>{rec.length ? rec.map((i) => <Row key={i.supplier_org_id} i={i} />) : <div className="p-4 text-sm text-muted">No suitable suppliers found - check categories or add suppliers manually below.</div>}</Card>
      {others.length > 0 && (
        <details className=" border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Other eligible suppliers ({others.length})</summary>
          <div className="border-t border-line">{others.map((i) => <Row key={i.supplier_org_id} i={i} />)}</div>
        </details>
      )}
      {canWrite && (
        <div className="flex flex-wrap items-end gap-3 border border-line bg-surface px-4 py-3">
          <Field label="Quotes due"><Input type="date" name="quote_due" defaultValue={quoteDue ?? ""} /></Field>
          <div className="ml-auto flex gap-2">
            <SubmitButton formAction={refreshRecommendations.bind(null, id)} variant="secondary" formNoValidate>Re-run matching</SubmitButton>
            <SubmitButton pendingText="Sending…">Send RFQ to selected suppliers</SubmitButton>
          </div>
        </div>
      )}
    </form>
  );
}

function Comparison({ id, cmp, quoteMeta, canRequest }: {
  id: string; canRequest: boolean;
  cmp: NonNullable<Awaited<ReturnType<typeof buildComparison>>>;
  quoteMeta: { id: string; lead_time_days: number; payment_terms: string | null; delivery_cost: number; notes: string | null; submitted_at: string; validity_days: number }[];
}) {
  const { comparison: c, items, benchmarks } = cmp;
  const evals = c.evaluations;
  return (
    <div className="space-y-6">
      <AiPanel title={c.headline} footer={<>Generated {dateTime(c.generatedAt)} from {evals.length} quote(s). Totals are compared like-for-like: lines a supplier did not quote are priced at the best competing price. The AI recommends; a procurement manager approves.</>}>
        <p>{c.explanation}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {c.savings.vsSecond !== null && c.savings.vsSecond > 0 && <Badge tone="onDark">Saves {aed(c.savings.vsSecond)} vs next best</Badge>}
          {c.savings.vsHighest > 0 && <Badge tone="onDark">{aed(c.savings.vsHighest)} below highest quote</Badge>}
          {c.savings.vsBenchmark !== null && <Badge tone="onDark">{c.savings.vsBenchmark <= 0 ? `${Math.abs(c.savings.vsBenchmark).toFixed(1)}% below market` : `${c.savings.vsBenchmark.toFixed(1)}% above market`}</Badge>}
          {c.splitAward && <Badge tone="onDark">Split award option saves {aed(c.splitAward.saving)}</Badge>}
        </div>
      </AiPanel>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {evals.map((e, rank) => {
          const meta = quoteMeta.find((q) => q.id === e.quoteId);
          const best = e.quoteId === c.recommendedQuoteId;
          return (
            <div key={e.quoteId} className={cx("border bg-surface p-4", best ? "border-2 border-ink" : "border-line", !e.eligible && "opacity-75")}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-xs text-muted">#{rank + 1}</div><div className="font-semibold">{e.supplierName}</div></div>
                {best ? <Badge tone="ai">Recommended</Badge> : !e.eligible ? <Badge tone="danger">Non-compliant</Badge> : null}
              </div>
              <div className="mt-3 text-2xl font-semibold tabular">{aed(e.comparableTotal)}</div>
              <div className="text-xs text-muted">{e.gapFillAmount > 0 ? `Quoted ${aed(e.quotedTotal)} + ${aed(e.gapFillAmount)} to cover gaps` : "Complete quote incl. delivery"}</div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted">Score</dt><dd className="text-right font-medium tabular">{e.score.toFixed(1)}</dd>
                <dt className="text-muted">Lines complete</dt><dd className="text-right tabular">{e.linesComplete}/{items.length}</dd>
                <dt className="text-muted">Lead time</dt><dd className={cx("text-right tabular", e.lateByDays > 0 && "text-danger")}>{e.leadTimeDays} days{e.lateByDays > 0 ? ` (+${e.lateByDays} late)` : ""}</dd>
                <dt className="text-muted">On-time record</dt><dd className="text-right tabular">{e.onTimeRate !== null && e.deliveries >= 3 ? `${Math.round(e.onTimeRate * 100)}% (${e.deliveries})` : "Limited"}</dd>
                <dt className="text-muted">Payment terms</dt><dd className="text-right">{meta?.payment_terms ?? "—"}</dd>
                <dt className="text-muted">Delivery charge</dt><dd className="text-right tabular">{aed(meta?.delivery_cost)}</dd>
              </dl>
              {[...e.disqualifiers, ...e.flags].length > 0 && (
                <ul className="mt-3 space-y-0.5 text-xs">{e.disqualifiers.map((f) => <li key={f} className="text-danger">✕ {f}</li>)}{e.flags.map((f) => <li key={f} className="text-warn">! {f}</li>)}</ul>
              )}
              {meta?.notes && <p className="mt-2 text-xs italic text-muted">“{meta.notes}”</p>}
            </div>
          );
        })}
      </div>

      <Card title="Line-by-line comparison" subtitle="Unit prices (AED). Green = best compliant price; % shows variance from network market median." padded={false}>
        <Table>
          <thead><tr><Th>Line</Th><Th right>Qty</Th><Th right>Market</Th>{evals.map((e) => <Th key={e.quoteId} right>{e.supplierName.split(" ").slice(0, 2).join(" ")}</Th>)}</tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <Td><div className="max-w-xs text-sm">{it.description}</div>{it.brand_pref && <div className="text-xs text-muted">Brand: {it.brand_pref}</div>}</Td>
                <Td right>{num(it.quantity)} {it.unit}</Td>
                <Td right className="text-muted">{benchmarks[it.material_id ?? ""] ? price(benchmarks[it.material_id!]) : "—"}</Td>
                {evals.map((e) => {
                  const l = e.lines.find((x) => x.rfqItemId === it.id)!;
                  return (
                    <Td key={e.quoteId} right className={cx(l.cheapest && "bg-success-soft", l.compliant === false && "bg-danger-soft")}>
                      {l.unitPrice === null ? <span className="text-subtle">—</span> : <>
                        <div className="font-medium">{price(l.unitPrice)}</div>
                        {l.vsBenchmarkPct !== null && <div className={cx("text-[11px]", l.vsBenchmarkPct > 5 ? "text-danger" : l.vsBenchmarkPct < -2 ? "text-success" : "text-muted")}>{l.vsBenchmarkPct > 0 ? "+" : ""}{l.vsBenchmarkPct.toFixed(1)}%</div>}
                        {l.issue && <div className="text-[11px] text-warn">{l.issue}</div>}
                      </>}
                    </Td>
                  );
                })}
              </tr>
            ))}
            <tr className="bg-surface-2 font-medium">
              <Td>Comparable total (incl. delivery)</Td><Td /><Td />
              {evals.map((e) => <Td key={e.quoteId} right>{aed(e.comparableTotal)}</Td>)}
            </tr>
          </tbody>
        </Table>
      </Card>

      {canRequest && (
        <Card title="Recommend for approval" subtitle="Creates a purchase request for a procurement manager. No order is placed until it is approved.">
          <form action={requestApprovalAction.bind(null, id)} className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {evals.map((e) => (
                <label key={e.quoteId} className={cx("flex items-center gap-3 border px-3 py-2", e.eligible ? "border-line-strong" : "border-line opacity-50")}>
                  <input type="radio" name="quote_id" value={e.quoteId} defaultChecked={e.quoteId === c.recommendedQuoteId} disabled={!e.eligible} required className="accent-[var(--accent)]" />
                  <span className="text-sm"><span className="font-medium">{e.supplierName}</span><span className="block text-xs text-muted">{aed(e.quotedTotal)}{e.quoteId === c.recommendedQuoteId ? " · AI recommended" : ""}</span></span>
                </label>
              ))}
            </div>
            <Field label="Justification" hint="Required if you choose a different supplier from the AI recommendation.">
              <Textarea name="justification" placeholder="e.g. Supplier has approved submittals for this project." />
            </Field>
            <SubmitButton>Send for approval</SubmitButton>
          </form>
        </Card>
      )}
      <p className="text-xs text-muted">Quotes are visible only to your organisation. <Link href="/suppliers" className="text-accent hover:underline">Supplier scorecards →</Link></p>
    </div>
  );
}
