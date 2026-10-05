import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Field, Input, KeyValue, PageHeader, Progress, Select, StatusBadge, Table, Td, Textarea, Th, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { aed, date, dateTime, num, price } from "@/lib/format";
import { raiseDisputeAction, verifyDeliveryAction } from "../../../actions/orders";

interface Delivery { id: string; number: string; status: string; scheduled_date: string | null; dispatched_at: string | null; vehicle_no: string | null; driver_name: string | null;
  driver_phone: string | null; verified_at: string | null; verifier: string | null; verification_method: string | null; condition: string | null; site_notes: string | null; qr_token: string }

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ verify?: string; qr?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(CONTRACTOR_ROLES);
  const data = await withActor(user, async (tx) => {
    const po = await one<{ id: string; po_number: string; status: string; supplier: string; supplier_org_id: string; project: string; project_id: string; total: number; subtotal: number;
      delivery_cost: number; delivery_location: string | null; required_date: string | null; promised_date: string | null; payment_terms: string | null; issued_at: string;
      confirmed_at: string | null; supplier_note: string | null; rfq_id: string | null; issuer: string | null; approver: string | null }>(tx,
      `select po.*, o.name as supplier, p.name as project, u.full_name as issuer, a.full_name as approver
       from purchase_orders po join organizations o on o.id = po.supplier_org_id join projects p on p.id = po.project_id
       left join users u on u.id = po.issued_by left join purchase_requests pr on pr.id = po.purchase_request_id left join users a on a.id = pr.decided_by
       where po.id = $1`, [id]);
    if (!po) return null;
    const deliveries = await rows<Delivery>(tx,
      `select d.*, u.full_name as verifier from deliveries d left join users u on u.id = d.verified_by where d.po_id = $1 order by d.created_at`, [id]);
    return {
      po, deliveries,
      lines: await rows<{ id: string; line_no: number; description: string; quantity: number; unit: string; unit_price: number; line_total: number; delivered_qty: number; accepted_qty: number }>(tx,
        "select * from po_items where po_id = $1 order by line_no", [id]),
      dItems: await rows<{ id: string; delivery_id: string; po_item_id: string; description: string; unit: string; qty_shipped: number; qty_received: number | null; qty_accepted: number | null; qty_rejected: number | null; reject_reason: string | null }>(tx,
        `select di.*, pi.description, pi.unit from delivery_items di join po_items pi on pi.id = di.po_item_id where di.delivery_id = any($1) order by pi.line_no`, [deliveries.map((d) => d.id)]),
      docs: await rows<{ id: string; delivery_id: string; kind: string; filename: string; created_at: string }>(tx,
        "select id, delivery_id, kind, filename, created_at from delivery_documents where delivery_id = any($1) order by created_at", [deliveries.map((d) => d.id)]),
      invoices: await rows<{ id: string; invoice_number: string; amount: number; status: string; submitted_at: string; match_result: { variance?: number; payable?: number } | null }>(tx,
        "select id, invoice_number, amount, status, submitted_at, match_result from invoices where po_id = $1 order by submitted_at", [id]),
      disputes: await rows<{ id: string; type: string; status: string; created_at: string; amount_at_stake: number | null }>(tx,
        "select id, type, status, created_at, amount_at_stake from disputes where po_id = $1 order by created_at desc", [id]),
    };
  });
  if (!data) notFound();
  const { po, deliveries, lines, dItems, docs, invoices, disputes } = data;
  const canWrite = user.role !== "contractor_exec";
  const ordered = lines.reduce((a, l) => a + l.quantity, 0);
  const accepted = lines.reduce((a, l) => a + l.accepted_qty, 0);
  const pending = deliveries.filter((d) => d.status === "dispatched");
  const verifyId = sp.verify ?? pending[0]?.id;
  const shortValue = lines.reduce((a, l) => a + Math.max(l.quantity - l.accepted_qty, 0) * l.unit_price, 0);

  return (
    <>
      <PageHeader title={`${po.po_number} · ${po.supplier}`} crumbs={[{ href: "/orders", label: "Orders" }, { href: `/projects/${po.project_id}`, label: po.project }]}
        subtitle={<><StatusBadge status={po.status} /> · {aed(po.total)} · issued {dateTime(po.issued_at)}{po.rfq_id && <> · <Link href={`/rfqs/${po.rfq_id}`} className="hover:text-accent">source RFQ</Link></>}</>} />

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card title="Order lines" padded={false}>
          <Table>
            <thead><tr><Th>#</Th><Th>Material</Th><Th right>Ordered</Th><Th right>Unit price</Th><Th right>Line total</Th><Th>Accepted on site</Th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id}><Td className="text-muted">{l.line_no}</Td><Td>{l.description}</Td><Td right>{num(l.quantity)} {l.unit}</Td><Td right>{price(l.unit_price)}</Td><Td right>{aed(l.line_total)}</Td>
                <Td className="w-44"><Progress value={l.accepted_qty / l.quantity} tone={l.accepted_qty >= l.quantity ? "success" : l.accepted_qty > 0 ? "warn" : "accent"} />
                  <div className="mt-1 text-xs text-muted">{num(l.accepted_qty)} of {num(l.quantity)}{l.delivered_qty > l.accepted_qty ? ` · ${num(l.delivered_qty - l.accepted_qty)} rejected` : ""}</div></Td></tr>))}
              <tr className="bg-surface-2"><Td colSpan={4}>Delivery charge</Td><Td right>{aed(po.delivery_cost)}</Td><Td /></tr>
              <tr className="bg-surface-2 font-semibold"><Td colSpan={4}>Total</Td><Td right>{aed(po.total)}</Td><Td>{Math.round((accepted / ordered) * 100)}% received</Td></tr>
            </tbody>
          </Table>
        </Card>
        <Card title="Order">
          <KeyValue items={[["Deliver to", po.delivery_location ?? "—"], ["Required", date(po.required_date)], ["Supplier promised", date(po.promised_date)],
            ["Payment terms", po.payment_terms ?? "—"], ["Approved by", po.approver ?? "—"], ["Supplier confirmed", po.confirmed_at ? dateTime(po.confirmed_at) : "Awaiting"]]} />
          {po.supplier_note && <p className="mt-3 rounded bg-surface-2 px-2 py-1.5 text-xs">Supplier: “{po.supplier_note}”</p>}
        </Card>
      </div>

      {deliveries.length === 0 && <Card title="Deliveries"><p className="text-sm text-muted">{po.status === "issued" ? "Waiting for the supplier to confirm the order." : "No deliveries dispatched yet."}</p></Card>}
      <div className="space-y-4">
        {deliveries.map((d) => {
          const its = dItems.filter((i) => i.delivery_id === d.id);
          const dDocs = docs.filter((x) => x.delivery_id === d.id);
          const verifying = d.status === "dispatched" && d.id === verifyId && canWrite;
          return (
            <Card key={d.id} title={<span className="flex items-center gap-2">Delivery {d.number} <StatusBadge status={d.status} /></span>}
              subtitle={<>Scheduled {date(d.scheduled_date)} · dispatched {dateTime(d.dispatched_at)}{d.vehicle_no ? ` · ${d.vehicle_no}` : ""}{d.driver_name ? ` · driver ${d.driver_name} ${d.driver_phone ?? ""}` : ""}</>}
              padded={!verifying}>
              {verifying ? <VerifyForm orderId={id} d={d} items={its} qr={sp.qr} /> : (
                <>
                  <Table>
                    <thead><tr><Th>Material</Th><Th right>Shipped</Th><Th right>Received</Th><Th right>Accepted</Th><Th>Rejected</Th></tr></thead>
                    <tbody>{its.map((i) => (
                      <tr key={i.id}><Td>{i.description}</Td><Td right>{num(i.qty_shipped)} {i.unit}</Td><Td right>{i.qty_received === null ? "—" : num(i.qty_received)}</Td>
                        <Td right className={cx(i.qty_accepted !== null && i.qty_accepted < i.qty_shipped && "text-warn")}>{i.qty_accepted === null ? "—" : num(i.qty_accepted)}</Td>
                        <Td className="text-xs text-danger">{i.qty_rejected ? `${num(i.qty_rejected)} · ${i.reject_reason}` : ""}</Td></tr>))}
                    </tbody>
                  </Table>
                  {d.verified_at && <p className="mt-3 text-xs text-muted">Verified by {d.verifier} {dateTime(d.verified_at)} via {d.verification_method === "otp" ? "delivery code (OTP)" : "QR scan"} · condition: {d.condition?.replace("_", " ")}{d.site_notes ? ` · “${d.site_notes}”` : ""}</p>}
                  {d.status === "dispatched" && canWrite && <p className="mt-3 text-sm"><Link className="text-accent hover:underline" href={`/orders/${id}?verify=${d.id}`}>Verify this delivery →</Link></p>}
                </>
              )}
              {dDocs.length > 0 && (
                <div className={cx("flex flex-wrap gap-2", verifying ? "border-t border-line px-4 py-3" : "mt-3")}>
                  {dDocs.map((x) => <a key={x.id} href={`/api/files/delivery/${x.id}`} target="_blank" className="rounded border border-line px-2 py-1 text-xs hover:border-accent">{x.kind === "photo" ? "📷" : "📄"} {x.filename}</a>)}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Invoices" padded={false}>
          {invoices.length === 0 ? <div className="p-4 text-sm text-muted">No invoices yet.</div> : (
            <Table><thead><tr><Th>Invoice</Th><Th right>Amount</Th><Th>Match</Th></tr></thead>
              <tbody>{invoices.map((i) => (
                <tr key={i.id}><Td><Link href="/invoices" className="hover:text-accent">{i.invoice_number}</Link><div className="text-xs text-muted">{dateTime(i.submitted_at)}</div></Td><Td right>{aed(i.amount)}</Td>
                  <Td><StatusBadge status={i.status} />{i.status === "mismatch" && i.match_result?.variance ? <div className="text-xs text-danger">{aed(i.match_result.variance)} over accepted value</div> : null}</Td></tr>))}
              </tbody></Table>)}
        </Card>
        <Card title="Disputes" padded={false}>
          {disputes.length > 0 && (
            <ul className="divide-y divide-line">{disputes.map((x) => (
              <li key={x.id}><Link href={`/disputes/${x.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2">
                <span className="text-sm">{x.type.replace("_", " ")} · {dateTime(x.created_at)}{x.amount_at_stake ? ` · ${aed(x.amount_at_stake)}` : ""}</span><StatusBadge status={x.status} /></Link></li>))}</ul>)}
          {canWrite && (
            <details className={cx(disputes.length > 0 && "border-t border-line")} open={disputes.length === 0 && shortValue > 0 && deliveries.some((d) => d.status !== "dispatched")}>
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Raise a dispute</summary>
              <form action={raiseDisputeAction.bind(null, id)} className="space-y-3 px-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Type"><Select name="type" defaultValue={shortValue > 0 ? "short_delivery" : "other"}>
                    {["short_delivery", "damaged", "wrong_spec", "pricing", "late", "other"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</Select></Field>
                  <Field label="Amount at stake (AED)"><Input name="amount" inputMode="decimal" defaultValue={shortValue > 0 ? shortValue.toFixed(2) : ""} /></Field>
                </div>
                <Field label="Delivery"><Select name="delivery_id" defaultValue=""><option value="">—</option>{deliveries.map((d) => <option key={d.id} value={d.id}>{d.number}</option>)}</Select></Field>
                {invoices.length > 0 && <Field label="Invoice"><Select name="invoice_id" defaultValue=""><option value="">—</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_number}</option>)}</Select></Field>}
                <Field label="What happened?"><Textarea name="description" required /></Field>
                <SubmitButton variant="danger">Raise dispute</SubmitButton>
              </form>
            </details>
          )}
        </Card>
      </div>
    </>
  );
}

function VerifyForm({ orderId, d, items, qr }: { orderId: string; d: Delivery; qr?: string;
  items: { id: string; description: string; unit: string; qty_shipped: number }[] }) {
  const viaQr = !!qr && qr === d.qr_token;
  return (
    <form action={verifyDeliveryAction.bind(null, orderId, d.id)}>
      <div className="border-b border-line bg-accent-soft/50 px-4 py-3 text-sm">
        <span className="font-medium">Site verification.</span> Count what was physically received. Accept only what is in good condition and to specification - partial acceptance keeps the balance open on the order.
      </div>
      <Table>
        <thead><tr><Th>Material</Th><Th right>Dispatched</Th><Th>Received</Th><Th>Accepted</Th><Th>Reason for any rejection</Th></tr></thead>
        <tbody>{items.map((i) => (
          <tr key={i.id}>
            <Td>{i.description}<input type="hidden" name="item" value={i.id} /></Td>
            <Td right>{num(i.qty_shipped)} {i.unit}</Td>
            <Td><Input name={`received_${i.id}`} defaultValue={i.qty_shipped} inputMode="decimal" className="w-28 text-right" aria-label="Received" /></Td>
            <Td><Input name={`accepted_${i.id}`} defaultValue={i.qty_shipped} inputMode="decimal" className="w-28 text-right" aria-label="Accepted" /></Td>
            <Td><Input name={`reason_${i.id}`} placeholder="e.g. damaged coil" aria-label="Rejection reason" /></Td>
          </tr>))}
        </tbody>
      </Table>
      <div className="grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
        {viaQr ? (
          <div className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
            <input type="hidden" name="method" value="qr" /><input type="hidden" name="qr_token" value={qr} />
            ✓ Delivery note QR scanned
          </div>
        ) : (
          <Field label="Delivery code (from driver)" hint="6-digit code on the driver's delivery note">
            <input type="hidden" name="method" value="otp" />
            <Input name="otp" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="••••••" className="font-mono tracking-widest" />
          </Field>
        )}
        <Field label="Condition"><Select name="condition" defaultValue="good"><option value="good">Good</option><option value="minor_damage">Minor damage</option><option value="damaged">Damaged</option></Select></Field>
        <Field label="Delivery photo"><Input type="file" name="photo" accept="image/*" capture="environment" /></Field>
        <Field label="Signed delivery note"><Input type="file" name="delivery_note" accept="image/*,application/pdf" /></Field>
        <Field label="Site notes" className="md:col-span-2 xl:col-span-4"><Textarea name="notes" rows={2} placeholder="Offloaded at gate 3, stored in MEP laydown area." /></Field>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-2 px-4 py-3">
        <span className="text-xs text-muted">{viaQr ? "" : <>Driver can&apos;t find the code? Scan the QR on the delivery note instead.</>} <Badge tone="info">Recorded in audit trail</Badge></span>
        <SubmitButton pendingText="Recording…">Confirm receipt</SubmitButton>
      </div>
    </form>
  );
}
