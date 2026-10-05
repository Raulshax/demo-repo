import { notFound } from "next/navigation";
import { Card, Field, Input, KeyValue, PageHeader, StatusBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { aed, date, num } from "@/lib/format";
import { declineRfq, submitQuote } from "../../../../actions/supplier";

export default async function SupplierRfq({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(["supplier"]);
  const data = await withActor(user, async (tx) => {
    const inv = await one<{ status: string }>(tx, "select status from rfq_invitations where rfq_id = $1 and supplier_org_id = $2", [id, user.orgId]);
    if (!inv) return null;
    if (inv.status === "invited") await tx.query("update rfq_invitations set status = 'viewed' where rfq_id = $1 and supplier_org_id = $2", [id, user.orgId]);
    const rfq = await one<{ number: string; title: string; status: string; quote_due: string | null; needed_by: string | null; delivery_location: string | null; delivery_emirate: string; notes: string | null; contractor: string }>(tx,
      "select r.number, r.title, r.status, r.quote_due, r.needed_by, r.delivery_location, r.delivery_emirate, r.notes, o.name as contractor from rfqs r join organizations o on o.id = r.org_id where r.id = $1", [id]);
    const items = await rows<{ id: string; line_no: number; description: string; quantity: number; unit: string; brand_pref: string | null; material_id: string | null }>(tx,
      "select id, line_no, description, quantity, unit, brand_pref, material_id from rfq_items where rfq_id = $1 order by line_no", [id]);
    const quote = await one<{ id: string; status: string; delivery_cost: number; lead_time_days: number; payment_terms: string | null; validity_days: number; notes: string | null; total: number }>(tx,
      "select * from quotes where rfq_id = $1 and supplier_org_id = $2", [id, user.orgId]);
    const qItems = quote ? await rows<{ rfq_item_id: string; unit_price: number; available_qty: number; brand: string | null; offered_spec: string | null; compliant: boolean }>(tx,
      "select * from quote_items where quote_id = $1", [quote.id]) : [];
    // Pre-fill from the supplier's own catalogue (never other suppliers' prices).
    const catalogue = await rows<{ material_id: string; unit_price_aed: number | null; brand: string | null; stock_qty: number }>(tx,
      "select material_id, unit_price_aed, brand, stock_qty from supplier_products where supplier_org_id = $1", [user.orgId]);
    const profile = await one<{ payment_terms: string | null; default_lead_time_days: number }>(tx, "select payment_terms, default_lead_time_days from supplier_profiles where org_id = $1", [user.orgId]);
    return { inv, rfq: rfq!, items, quote, qItems, catalogue, profile };
  });
  if (!data) notFound();
  const { inv, rfq, items, quote, qItems, catalogue, profile } = data;
  const open = rfq.status === "sent" && (!quote || quote.status === "submitted") && inv.status !== "declined";

  return (
    <>
      <PageHeader title={rfq.title} crumbs={[{ href: "/supplier/rfqs", label: "RFQs" }]}
        subtitle={<>{rfq.number} · {rfq.contractor} · <StatusBadge status={inv.status === "invited" ? "viewed" : inv.status} /></>} />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Delivery"><KeyValue items={[["Deliver to", rfq.delivery_location ?? "—"], ["Emirate", rfq.delivery_emirate], ["Needed by", date(rfq.needed_by)], ["Quotes due", date(rfq.quote_due)]]} /></Card>
        <Card title="Your quote" className="lg:col-span-2">
          {quote ? <p className="text-sm">Submitted · <strong>{aed(quote.total)}</strong> · <StatusBadge status={quote.status} />{open && " · you can revise it until the RFQ closes."}</p>
            : <p className="text-sm text-muted">Price each line you can supply. Mark lines non-compliant if you are offering an alternative. Prices are confidential to you and {rfq.contractor}.</p>}
        </Card>
      </div>
      <form action={submitQuote.bind(null, id)}>
        <Card title="Lines" padded={false}>
          <Table>
            <thead><tr><Th>#</Th><Th>Requested</Th><Th right>Qty</Th><Th>Unit price (AED)</Th><Th>Can supply</Th><Th>Brand offered</Th><Th>Meets spec</Th><Th>Notes / alternative</Th></tr></thead>
            <tbody>{items.map((it) => {
              const q = qItems.find((x) => x.rfq_item_id === it.id);
              const c = catalogue.find((x) => x.material_id === it.material_id);
              return (
                <tr key={it.id}>
                  <Td className="text-muted">{it.line_no}</Td>
                  <Td><div className="max-w-xs">{it.description}</div>{it.brand_pref && <div className="text-xs text-muted">Brand requested: {it.brand_pref}</div>}{c && !q && <div className="text-xs text-accent">From your catalogue · {num(c.stock_qty)} in stock</div>}</Td>
                  <Td right>{num(it.quantity)} {it.unit}</Td>
                  <Td><Input name={`price_${it.id}`} inputMode="decimal" defaultValue={q?.unit_price ?? c?.unit_price_aed ?? ""} disabled={!open} className="w-28 text-right" aria-label="Unit price" /></Td>
                  <Td><Input name={`available_${it.id}`} inputMode="decimal" defaultValue={q?.available_qty ?? it.quantity} disabled={!open} className="w-24 text-right" aria-label="Available quantity" /></Td>
                  <Td><Input name={`brand_${it.id}`} defaultValue={q?.brand ?? it.brand_pref ?? c?.brand ?? ""} disabled={!open} className="w-28" aria-label="Brand" /></Td>
                  <Td><input type="checkbox" name={`compliant_${it.id}`} defaultChecked={q ? q.compliant : true} disabled={!open} className="h-4 w-4 accent-[var(--accent)]" aria-label="Meets specification" /></Td>
                  <Td><Input name={`spec_${it.id}`} defaultValue={q?.offered_spec ?? ""} disabled={!open} placeholder="Optional" aria-label="Notes" /></Td>
                </tr>);
            })}</tbody>
          </Table>
          <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Lead time (days)"><Input name="lead_time_days" inputMode="numeric" required defaultValue={quote?.lead_time_days ?? profile?.default_lead_time_days ?? 3} disabled={!open} /></Field>
            <Field label="Delivery charge (AED)"><Input name="delivery_cost" inputMode="decimal" defaultValue={quote?.delivery_cost ?? 0} disabled={!open} /></Field>
            <Field label="Payment terms"><Input name="payment_terms" defaultValue={quote?.payment_terms ?? profile?.payment_terms ?? "30 days"} disabled={!open} /></Field>
            <Field label="Validity (days)"><Input name="validity_days" inputMode="numeric" defaultValue={quote?.validity_days ?? 14} disabled={!open} /></Field>
            <Field label="Notes to contractor" className="sm:col-span-2 lg:col-span-4"><Textarea name="notes" defaultValue={quote?.notes ?? ""} disabled={!open} rows={2} /></Field>
          </div>
          {open && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-3">
              <span className="text-xs text-muted">Leave a price blank for lines you cannot supply.</span>
              <div className="flex gap-2">
                {!quote && <SubmitButton formAction={declineRfq.bind(null, id)} variant="ghost" formNoValidate>Decline RFQ</SubmitButton>}
                <SubmitButton pendingText="Submitting…">{quote ? "Revise quote" : "Submit quote"}</SubmitButton>
              </div>
            </div>
          )}
        </Card>
      </form>
    </>
  );
}
