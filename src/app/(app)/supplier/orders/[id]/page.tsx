import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, Field, Input, KeyValue, PageHeader, Select, StatusBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { aed, date, dateTime, num, price } from "@/lib/format";
import { matchInvoice } from "@/lib/services/orders";
import { dispatchAction, respondToPo, submitInvoiceAction, uploadDeliveryDoc } from "../../../../actions/supplier";

export default async function SupplierOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(["supplier"]);
  const data = await withActor(user, async (tx) => {
    const po = await one<{ id: string; po_number: string; status: string; contractor: string; total: number; delivery_cost: number; delivery_location: string | null;
      required_date: string | null; promised_date: string | null; payment_terms: string | null; issued_at: string; supplier_note: string | null }>(tx,
      "select po.*, o.name as contractor from purchase_orders po join organizations o on o.id = po.org_id where po.id = $1", [id]);
    if (!po) return null;
    const lines = await rows<{ id: string; line_no: number; description: string; quantity: number; unit: string; unit_price: number; line_total: number; accepted_qty: number; delivered_qty: number; in_transit: number }>(tx,
      `select pi.*, coalesce((select sum(di.qty_shipped) from delivery_items di join deliveries d on d.id = di.delivery_id where di.po_item_id = pi.id and d.status = 'dispatched'),0) as in_transit
       from po_items pi where pi.po_id = $1 order by pi.line_no`, [id]);
    const deliveries = await rows<{ id: string; number: string; status: string; scheduled_date: string | null; dispatched_at: string | null; verified_at: string | null; otp: string | null; vehicle_no: string | null }>(tx,
      "select d.id, d.number, d.status, d.scheduled_date, d.dispatched_at, d.verified_at, delivery_otp_for_supplier(d.id) as otp, d.vehicle_no from deliveries d where d.po_id = $1 order by d.created_at", [id]);
    const dItems = await rows<{ delivery_id: string; description: string; qty_shipped: number; qty_accepted: number | null; qty_rejected: number | null; reject_reason: string | null }>(tx,
      "select di.delivery_id, pi.description, di.qty_shipped, di.qty_accepted, di.qty_rejected, di.reject_reason from delivery_items di join po_items pi on pi.id = di.po_item_id where di.delivery_id = any($1) order by pi.line_no", [deliveries.map((d) => d.id)]);
    const invoices = await rows<{ id: string; invoice_number: string; amount: number; status: string; submitted_at: string }>(tx,
      "select id, invoice_number, amount, status, submitted_at from invoices where po_id = $1 order by submitted_at", [id]);
    const payable = await matchInvoice(tx, id, 0);
    const disputes = await rows<{ id: string; type: string; status: string }>(tx, "select id, type, status from disputes where po_id = $1", [id]);
    return { po, lines, deliveries, dItems, invoices, payable, disputes };
  });
  if (!data) notFound();
  const { po, lines, deliveries, dItems, invoices, payable, disputes } = data;
  const open = lines.map((l) => ({ ...l, open: Math.max(l.quantity - l.accepted_qty - l.in_transit, 0) }));
  const canDispatch = ["confirmed", "partially_delivered", "in_delivery"].includes(po.status) && open.some((l) => l.open > 0);
  const canInvoice = payable.payable > 0.5 && !invoices.some((i) => ["submitted", "matched", "mismatch", "disputed"].includes(i.status));

  return (
    <>
      <PageHeader title={`${po.po_number} · ${po.contractor}`} crumbs={[{ href: "/supplier/orders", label: "Orders" }]}
        subtitle={<><StatusBadge status={po.status} /> · {aed(po.total)} · issued {dateTime(po.issued_at)}</>} />

      {po.status === "issued" && (
        <Card title="Confirm this purchase order" className="mb-6">
          <form className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
            <Field label="Promised delivery date"><Input type="date" name="promised_date" defaultValue={po.required_date ?? ""} /></Field>
            <Field label="Note to contractor"><Input name="note" placeholder="Stock reserved; delivery by own fleet." /></Field>
            <div className="flex gap-2">
              <SubmitButton formAction={respondToPo.bind(null, id, true)}>Confirm order</SubmitButton>
              <SubmitButton formAction={respondToPo.bind(null, id, false)} variant="secondary">Decline</SubmitButton>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card title="Order lines" padded={false}>
          <Table>
            <thead><tr><Th>#</Th><Th>Material</Th><Th right>Ordered</Th><Th right>Unit price</Th><Th right>Accepted</Th><Th right>In transit</Th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id}><Td className="text-muted">{l.line_no}</Td><Td>{l.description}</Td><Td right>{num(l.quantity)} {l.unit}</Td><Td right>{price(l.unit_price)}</Td>
                <Td right>{num(l.accepted_qty)}</Td><Td right>{num(l.in_transit)}</Td></tr>))}
            </tbody>
          </Table>
        </Card>
        <Card title="Order"><KeyValue items={[["Deliver to", po.delivery_location ?? "—"], ["Required", date(po.required_date)], ["Promised", date(po.promised_date)], ["Payment terms", po.payment_terms ?? "—"], ["Delivery charge", aed(po.delivery_cost)]]} /></Card>
      </div>

      {canDispatch && (
        <Card title="Dispatch a delivery" subtitle="Partial deliveries are fine - the balance stays open." className="mb-6" padded={false}>
          <form action={dispatchAction.bind(null, id)}>
            <Table>
              <thead><tr><Th>Material</Th><Th right>Open quantity</Th><Th>Dispatch now</Th></tr></thead>
              <tbody>{open.filter((l) => l.open > 0).map((l) => (
                <tr key={l.id}><Td>{l.description}<input type="hidden" name="po_item" value={l.id} /></Td><Td right>{num(l.open)} {l.unit}</Td>
                  <Td><Input name={`qty_${l.id}`} defaultValue={l.open} inputMode="decimal" className="w-28 text-right" aria-label="Dispatch quantity" /></Td></tr>))}
              </tbody>
            </Table>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Delivery date"><Input type="date" name="scheduled_date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
              <Field label="Vehicle"><Input name="vehicle" placeholder="DXB 12345" /></Field>
              <Field label="Driver"><Input name="driver" /></Field>
              <Field label="Driver phone"><Input name="driver_phone" placeholder="+971 5x xxx xxxx" /></Field>
              <Field label="Delivery note (optional)"><Input type="file" name="delivery_note" accept="image/*,application/pdf" /></Field>
            </div>
            <div className="flex justify-end border-t border-line bg-surface-2 px-4 py-3"><SubmitButton>Dispatch & generate delivery code</SubmitButton></div>
          </form>
        </Card>
      )}

      <div className="space-y-4">
        {deliveries.map((d) => (
          <Card key={d.id} title={<span className="flex items-center gap-2">Delivery {d.number} <StatusBadge status={d.status} /></span>}
            subtitle={<>Scheduled {date(d.scheduled_date)}{d.vehicle_no ? ` · ${d.vehicle_no}` : ""}{d.verified_at ? ` · verified ${dateTime(d.verified_at)}` : ""}</>}
            actions={d.status === "dispatched" && <ButtonLink size="sm" variant="secondary" href={`/supplier/orders/${id}/delivery/${d.id}`}>Print delivery note & QR</ButtonLink>}>
            {d.status === "dispatched" && d.otp && (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
                <span>Delivery code for the driver:</span><span className="font-mono text-lg font-semibold tracking-[0.3em]">{d.otp}</span>
                <span className="text-xs text-muted">The site enters this code (or scans the QR on the delivery note) to confirm receipt. Do not share it with anyone else.</span>
              </div>
            )}
            <ul className="space-y-1 text-sm">{dItems.filter((i) => i.delivery_id === d.id).map((i, k) => (
              <li key={k} className="flex flex-wrap justify-between gap-2"><span>{i.description}</span>
                <span className="tabular text-muted">shipped {num(i.qty_shipped)}{i.qty_accepted !== null && <> · accepted <span className={i.qty_accepted < i.qty_shipped ? "text-warn" : "text-success"}>{num(i.qty_accepted)}</span></>}
                  {i.qty_rejected ? <span className="text-danger"> · rejected {num(i.qty_rejected)} ({i.reject_reason})</span> : null}</span></li>))}
            </ul>
            {d.status === "dispatched" && (
              <form action={uploadDeliveryDoc.bind(null, id, d.id)} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <Field label="Upload document"><Input type="file" name="file" required accept="image/*,application/pdf" /></Field>
                <Field label="Type"><Select name="kind"><option value="delivery_note">Delivery note</option><option value="photo">Photo</option><option value="other">Other</option></Select></Field>
                <SubmitButton size="sm" variant="secondary">Upload</SubmitButton>
              </form>
            )}
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Invoice" subtitle="Invoices are matched to PO prices × quantities accepted on site.">
          {invoices.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm">{invoices.map((i) => <li key={i.id} className="flex justify-between"><span>{i.invoice_number} · {aed(i.amount)}</span><StatusBadge status={i.status} /></li>)}</ul>
          )}
          {canInvoice ? (
            <form action={submitInvoiceAction.bind(null, id)} className="space-y-3">
              <p className="text-sm">Payable now: <strong>{aed(payable.payable, 2)}</strong> <span className="text-xs text-muted">(accepted goods + delivery, less invoices already approved)</span></p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Invoice number"><Input name="invoice_number" required /></Field>
                <Field label="Amount (AED)"><Input name="amount" required inputMode="decimal" defaultValue={payable.payable.toFixed(2)} /></Field>
              </div>
              <Textarea name="notes" rows={1} placeholder="Notes (optional)" />
              <SubmitButton>Submit invoice</SubmitButton>
            </form>
          ) : <p className="text-sm text-muted">{payable.payable > 0.5 ? "An invoice is already under review." : "Nothing to invoice until the site accepts a delivery."}</p>}
        </Card>
        <Card title="Disputes">
          {disputes.length === 0 ? <p className="text-sm text-muted">None.</p> : (
            <ul className="space-y-1 text-sm">{disputes.map((x) => <li key={x.id} className="flex justify-between"><Link className="hover:text-accent" href={`/disputes/${x.id}`}>{x.type.replace("_", " ")}</Link><StatusBadge status={x.status} /></li>)}</ul>
          )}
          {po.supplier_note && <p className="mt-3 text-xs text-muted">Your note: “{po.supplier_note}”</p>}
          <Badge tone="neutral" className="mt-3">Contractor prices from other suppliers are never shown to you</Badge>
        </Card>
      </div>
    </>
  );
}
