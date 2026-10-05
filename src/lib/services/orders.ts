import "server-only";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { one, rows, type Tx } from "@/lib/db";

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Approval -> Purchase order
// ---------------------------------------------------------------------------
export async function decidePurchase(tx: Tx, user: SessionUser, prId: string, decision: "approved" | "rejected", note: string | null) {
  // The database enforces: manager only, not the requester, note required for high-value.
  const pr = await one<{ id: string; rfq_id: string; quote_id: string; supplier_org_id: string; project_id: string; amount: number }>(tx,
    `update purchase_requests set status = $2, decided_by = $3, decision_note = $4 where id = $1 and status = 'pending'
     returning id, rfq_id, quote_id, supplier_org_id, project_id, amount`, [prId, decision, user.userId, note]);
  if (!pr) throw new Error("This request has already been decided.");
  await audit(tx, user, "purchase_request", prId, decision, { amount: pr.amount, note });
  if (decision === "rejected") return null;
  return issuePurchaseOrder(tx, user, pr);
}

async function issuePurchaseOrder(tx: Tx, user: SessionUser, pr: { id: string; rfq_id: string; quote_id: string; supplier_org_id: string; project_id: string; amount: number }) {
  const rfq = await one<{ delivery_location: string | null; needed_by: string | null }>(tx, "select delivery_location, needed_by from rfqs where id = $1", [pr.rfq_id]);
  const quote = await one<{ subtotal: number; delivery_cost: number; total: number; payment_terms: string | null; lead_time_days: number }>(tx,
    "select subtotal, delivery_cost, total, payment_terms, lead_time_days from quotes where id = $1", [pr.quote_id]);
  if (!quote) throw new Error("Quote not found");
  const po = await one<{ id: string; po_number: string }>(tx,
    `insert into purchase_orders (org_id, supplier_org_id, project_id, rfq_id, quote_id, purchase_request_id, subtotal, delivery_cost, total,
       delivery_location, required_date, payment_terms, issued_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::date, current_date + $12::int),$13,$14) returning id, po_number`,
    [user.orgId, pr.supplier_org_id, pr.project_id, pr.rfq_id, pr.quote_id, pr.id, quote.subtotal, quote.delivery_cost, quote.total,
     rfq?.delivery_location, rfq?.needed_by, quote.lead_time_days, quote.payment_terms, user.userId]);
  const lines = await rows<{ rfq_item_id: string; material_id: string | null; line_no: number; description: string; quantity: number; unit: string; unit_price: number; requirement_ids: string[] }>(tx,
    `select qi.rfq_item_id, ri.material_id, ri.line_no, ri.description, ri.quantity, ri.unit, qi.unit_price, ri.requirement_ids
     from quote_items qi join rfq_items ri on ri.id = qi.rfq_item_id where qi.quote_id = $1 order by ri.line_no`, [pr.quote_id]);
  for (const l of lines) {
    await tx.query(
      `insert into po_items (po_id, org_id, supplier_org_id, rfq_item_id, material_id, line_no, description, quantity, unit, unit_price, line_total)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [po!.id, user.orgId, pr.supplier_org_id, l.rfq_item_id, l.material_id, l.line_no, l.description, l.quantity, l.unit, l.unit_price, r2(l.unit_price * l.quantity)]);
    if (l.material_id)
      await tx.query(`insert into price_history (material_id, supplier_org_id, contractor_org_id, unit_price, quantity, source, observed_on)
                      values ($1,$2,$3,$4,$5,'po',current_date)`, [l.material_id, pr.supplier_org_id, user.orgId, l.unit_price, l.quantity]);
  }
  await tx.query("update quotes set status = case when id = $2 then 'accepted' else 'rejected' end where rfq_id = $1 and status = 'submitted'", [pr.rfq_id, pr.quote_id]);
  await tx.query(`update rfq_invitations set status = case when supplier_org_id = $2 then 'awarded' else 'not_selected' end
                  where rfq_id = $1 and status in ('quoted','invited','viewed')`, [pr.rfq_id, pr.supplier_org_id]);
  await tx.query("update rfqs set status = 'awarded' where id = $1", [pr.rfq_id]);
  await tx.query("update requirements set status = 'ordered' where id = any($1)", [lines.flatMap((l) => l.requirement_ids)]);
  await audit(tx, user, "purchase_order", po!.id, "issued", { po_number: po!.po_number, total: quote.total }, { supplierOrgId: pr.supplier_org_id });
  return po!;
}

// ---------------------------------------------------------------------------
// Supplier: confirm / decline, dispatch
// ---------------------------------------------------------------------------
export async function supplierRespondToPo(tx: Tx, user: SessionUser, poId: string, accept: boolean, promisedDate: string | null, note: string | null) {
  const po = await one<{ org_id: string; po_number: string }>(tx,
    `update purchase_orders set status = $2, confirmed_at = case when $2 = 'confirmed' then now() end, promised_date = coalesce($3::date, required_date), supplier_note = $4
     where id = $1 and status = 'issued' returning org_id, po_number`, [poId, accept ? "confirmed" : "declined", promisedDate || null, note]);
  if (!po) throw new Error("This order is no longer awaiting confirmation.");
  await audit(tx, user, "purchase_order", poId, accept ? "confirmed" : "declined", { po_number: po.po_number, promised_date: promisedDate, note }, { orgId: po.org_id });
}

export async function dispatchDelivery(tx: Tx, user: SessionUser, poId: string, input: {
  scheduledDate: string | null; vehicle: string | null; driver: string | null; driverPhone: string | null; lines: { poItemId: string; qty: number }[];
}) {
  const po = await one<{ org_id: string; status: string; po_number: string }>(tx, "select org_id, status, po_number from purchase_orders where id = $1", [poId]);
  if (!po) throw new Error("Order not found");
  if (!["confirmed", "partially_delivered", "in_delivery"].includes(po.status)) throw new Error("Confirm the order before dispatching.");
  const items = await rows<{ id: string; quantity: number; accepted_qty: number; in_transit: number }>(tx,
    `select pi.id, pi.quantity, pi.accepted_qty,
            coalesce((select sum(di.qty_shipped) from delivery_items di join deliveries d on d.id = di.delivery_id
                      where di.po_item_id = pi.id and d.status = 'dispatched'), 0) as in_transit
     from po_items pi where pi.po_id = $1`, [poId]);
  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new Error("Enter the quantity being dispatched for at least one line.");
  for (const l of lines) {
    const it = items.find((i) => i.id === l.poItemId);
    if (!it) throw new Error("Unknown order line");
    if (l.qty > it.quantity - it.accepted_qty - it.in_transit + 1e-6) throw new Error("Dispatch quantity exceeds the open quantity on the order.");
  }
  const dv = await one<{ id: string; number: string }>(tx,
    `insert into deliveries (po_id, org_id, supplier_org_id, status, scheduled_date, dispatched_at, vehicle_no, driver_name, driver_phone)
     values ($1,$2,$3,'dispatched',coalesce($4::date, current_date),now(),$5,$6,$7) returning id, number`,
    [poId, po.org_id, user.orgId, input.scheduledDate || null, input.vehicle, input.driver, input.driverPhone]);
  for (const l of lines)
    await tx.query("insert into delivery_items (delivery_id, po_item_id, org_id, supplier_org_id, qty_shipped) values ($1,$2,$3,$4,$5)",
      [dv!.id, l.poItemId, po.org_id, user.orgId, l.qty]);
  await tx.query("select delivery_issue_otp($1)", [dv!.id]);
  await tx.query("update purchase_orders set status = 'in_delivery' where id = $1", [poId]);
  await audit(tx, user, "delivery", dv!.id, "dispatched", { number: dv!.number, po_number: po.po_number, lines: lines.length }, { orgId: po.org_id });
  return dv!;
}

// ---------------------------------------------------------------------------
// Site verification (supports partial delivery and rejection)
// ---------------------------------------------------------------------------
export async function verifyDelivery(tx: Tx, user: SessionUser, deliveryId: string, input: {
  method: "otp" | "qr"; otp: string | null; qrToken: string | null; condition: "good" | "minor_damage" | "damaged"; notes: string | null;
  lines: { deliveryItemId: string; received: number; accepted: number; reason: string | null }[];
}) {
  const dv = await one<{ id: string; po_id: string; status: string; qr_token: string; number: string; supplier_org_id: string }>(tx,
    "select id, po_id, status, qr_token, number, supplier_org_id from deliveries where id = $1", [deliveryId]);
  if (!dv) throw new Error("Delivery not found");
  if (dv.status !== "dispatched") throw new Error("This delivery has already been verified.");

  let otpOk = false;
  if (input.method === "otp") {
    otpOk = (await one<{ ok: boolean }>(tx, "select verify_delivery_otp($1, $2) as ok", [deliveryId, (input.otp ?? "").trim()]))?.ok ?? false;
    if (!otpOk) throw new Error("The delivery code does not match. Ask the driver for the 6-digit code on their delivery note.");
  } else if (input.qrToken !== dv.qr_token) {
    throw new Error("QR code does not match this delivery. Scan the QR code printed on the delivery note.");
  }

  const items = await rows<{ id: string; qty_shipped: number }>(tx, "select id, qty_shipped from delivery_items where delivery_id = $1", [deliveryId]);
  let anyAccepted = false, allFull = true;
  for (const it of items) {
    const l = input.lines.find((x) => x.deliveryItemId === it.id);
    if (!l) throw new Error("Every delivered line must be checked.");
    if (l.received < 0 || l.accepted < 0 || l.accepted > l.received) throw new Error("Accepted quantity cannot exceed received quantity.");
    if (l.received > it.qty_shipped * 1.05) throw new Error("Received quantity is more than was dispatched - check the count.");
    const rejected = l.received - l.accepted;
    if (rejected > 0 && !l.reason) throw new Error("Give a reason for every rejected quantity.");
    if (l.accepted > 0) anyAccepted = true;
    if (l.accepted < it.qty_shipped) allFull = false;
    await tx.query("update delivery_items set qty_received = $2, qty_accepted = $3, qty_rejected = $4, reject_reason = $5 where id = $1",
      [it.id, l.received, l.accepted, rejected, l.reason]);
  }
  const status = !anyAccepted ? "rejected" : allFull ? "accepted" : "partially_accepted";
  await tx.query(
    `update deliveries set status = $2, verified_by = $3, verified_at = now(), verification_method = $4, otp_verified = $5, condition = $6, site_notes = $7
     where id = $1`, [deliveryId, status, user.userId, input.method, otpOk, input.condition, input.notes]);
  // If nothing more is in transit and the order is still open, let the supplier dispatch the balance.
  await tx.query(`update purchase_orders set status = 'partially_delivered'
                  where id = $1 and status = 'in_delivery'
                    and exists (select 1 from po_items where po_id = $1 and accepted_qty < quantity)
                    and not exists (select 1 from deliveries where po_id = $1 and status = 'dispatched')`, [dv.po_id]);
  await audit(tx, user, "delivery", deliveryId, status, { number: dv.number, method: input.method, condition: input.condition }, { supplierOrgId: dv.supplier_org_id });
  return status;
}

export async function addDeliveryDocument(tx: Tx, user: SessionUser, deliveryId: string, kind: "delivery_note" | "photo" | "other", file: File) {
  const dv = await one<{ org_id: string; supplier_org_id: string }>(tx, "select org_id, supplier_org_id from deliveries where id = $1", [deliveryId]);
  if (!dv) throw new Error("Delivery not found");
  if (file.size > 10 * 1024 * 1024) throw new Error("Files must be 10 MB or smaller.");
  if (!/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(file.type)) throw new Error("Upload a photo (JPG/PNG/WebP) or a PDF.");
  const bytes = Buffer.from(await file.arrayBuffer());
  await tx.query(
    `insert into delivery_documents (delivery_id, org_id, supplier_org_id, kind, filename, mime_type, size_bytes, content, uploaded_by, uploaded_by_org)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [deliveryId, dv.org_id, dv.supplier_org_id, kind, file.name, file.type, file.size, bytes, user.userId, user.orgId]);
  await audit(tx, user, "delivery", deliveryId, "document_uploaded", { kind, filename: file.name }, { orgId: dv.org_id, supplierOrgId: dv.supplier_org_id });
}

// ---------------------------------------------------------------------------
// Invoices: three-way match (PO price x accepted qty) and payment
// ---------------------------------------------------------------------------
export async function matchInvoice(tx: Tx, poId: string, amount: number) {
  const po = await one<{ delivery_cost: number }>(tx, "select delivery_cost from purchase_orders where id = $1", [poId]);
  const lines = await rows<{ line_no: number; description: string; quantity: number; accepted_qty: number; unit_price: number }>(tx,
    "select line_no, description, quantity, accepted_qty, unit_price from po_items where po_id = $1 order by line_no", [poId]);
  const prior = await one<{ v: number }>(tx, "select coalesce(sum(amount),0) as v from invoices where po_id = $1 and status in ('approved','paid')", [poId]);
  const acceptedValue = r2(lines.reduce((a, l) => a + l.accepted_qty * l.unit_price, 0) + (po?.delivery_cost ?? 0));
  const payable = r2(acceptedValue - (prior?.v ?? 0));
  const variance = r2(amount - payable);
  const tolerance = Math.max(1, payable * 0.005);
  const notes: string[] = [];
  const shortLines = lines.filter((l) => l.accepted_qty < l.quantity);
  if (shortLines.length) notes.push(`${shortLines.length} line(s) not fully accepted on site; only accepted quantities are payable.`);
  if ((prior?.v ?? 0) > 0) notes.push(`AED ${prior!.v.toLocaleString()} already invoiced and approved on this order.`);
  const status = Math.abs(variance) <= tolerance ? "matched" : "mismatch";
  if (status === "mismatch") notes.push(variance > 0 ? "Invoice exceeds the value of goods accepted on site." : "Invoice is below the accepted value.");
  return { status, invoiced: amount, accepted_value: acceptedValue, payable, variance, tolerance: r2(tolerance), notes,
    lines: lines.map((l) => ({ line: l.line_no, ordered: l.quantity, accepted: l.accepted_qty, unit_price: l.unit_price, value: r2(l.accepted_qty * l.unit_price) })) };
}

export async function submitInvoice(tx: Tx, user: SessionUser, poId: string, invoiceNumber: string, amount: number) {
  const po = await one<{ org_id: string; status: string; po_number: string }>(tx, "select org_id, status, po_number from purchase_orders where id = $1", [poId]);
  if (!po) throw new Error("Order not found");
  const accepted = await one<{ v: number }>(tx, "select coalesce(sum(accepted_qty),0) as v from po_items where po_id = $1", [poId]);
  if (!accepted?.v) throw new Error("Invoices can be submitted once the site has accepted a delivery.");
  const m = await matchInvoice(tx, poId, amount);
  const inv = await one<{ id: string }>(tx,
    `insert into invoices (po_id, org_id, supplier_org_id, invoice_number, amount, status, match_result, submitted_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [poId, po.org_id, user.orgId, invoiceNumber, amount, m.status, JSON.stringify(m), user.userId]);
  await audit(tx, user, "invoice", inv!.id, "submitted", { po_number: po.po_number, amount, match: m.status }, { orgId: po.org_id });
  return m;
}

export async function approveInvoice(tx: Tx, user: SessionUser, invoiceId: string) {
  if (user.role !== "contractor_manager") throw new Error("Only a procurement manager can approve invoices for payment.");
  const inv = await one<{ status: string; amount: number; supplier_org_id: string; po_id: string }>(tx, "select status, amount, supplier_org_id, po_id from invoices where id = $1", [invoiceId]);
  if (!inv) throw new Error("Invoice not found");
  if (inv.status !== "matched") throw new Error("Only invoices that match accepted deliveries can be approved. Resolve the mismatch first.");
  await tx.query("update invoices set status = 'approved', approved_by = $2, approved_at = now() where id = $1", [invoiceId, user.userId]);
  await audit(tx, user, "invoice", invoiceId, "approved", { amount: inv.amount }, { supplierOrgId: inv.supplier_org_id });
}

export async function recordPayment(tx: Tx, user: SessionUser, invoiceId: string, reference: string) {
  if (user.role !== "contractor_manager") throw new Error("Only a procurement manager can record payments.");
  const inv = await one<{ status: string; amount: number; supplier_org_id: string; po_id: string }>(tx, "select status, amount, supplier_org_id, po_id from invoices where id = $1", [invoiceId]);
  if (!inv || inv.status !== "approved") throw new Error("Approve the invoice before recording payment.");
  await tx.query(`insert into payments (invoice_id, org_id, supplier_org_id, amount, reference, recorded_by) values ($1,$2,$3,$4,$5,$6)`,
    [invoiceId, user.orgId, inv.supplier_org_id, inv.amount, reference, user.userId]);
  await tx.query("update invoices set status = 'paid' where id = $1", [invoiceId]);
  // Close the order once everything is delivered and paid.
  await tx.query(`update purchase_orders set status = 'closed' where id = $1 and status = 'delivered'
                  and not exists (select 1 from invoices where po_id = $1 and status not in ('paid','rejected'))`, [inv.po_id]);
  await audit(tx, user, "invoice", invoiceId, "paid", { amount: inv.amount, reference }, { supplierOrgId: inv.supplier_org_id });
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------
export async function raiseDispute(tx: Tx, user: SessionUser, input: { poId: string; deliveryId: string | null; invoiceId: string | null; type: string; description: string; amount: number | null }) {
  const po = await one<{ supplier_org_id: string; po_number: string }>(tx, "select supplier_org_id, po_number from purchase_orders where id = $1", [input.poId]);
  if (!po) throw new Error("Order not found");
  const d = await one<{ id: string }>(tx,
    `insert into disputes (org_id, supplier_org_id, po_id, delivery_id, invoice_id, type, description, amount_at_stake, raised_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [user.orgId, po.supplier_org_id, input.poId, input.deliveryId, input.invoiceId, input.type, input.description, input.amount, user.userId]);
  if (input.invoiceId) await tx.query("update invoices set status = 'disputed' where id = $1", [input.invoiceId]);
  await audit(tx, user, "dispute", d!.id, "raised", { type: input.type, po_number: po.po_number }, { supplierOrgId: po.supplier_org_id });
  return d!.id;
}

export async function commentOnDispute(tx: Tx, user: SessionUser, disputeId: string, body: string) {
  const d = await one<{ org_id: string; supplier_org_id: string; status: string }>(tx, "select org_id, supplier_org_id, status from disputes where id = $1", [disputeId]);
  if (!d) throw new Error("Dispute not found");
  if (d.status === "resolved") throw new Error("This dispute is resolved.");
  await tx.query(`insert into dispute_comments (dispute_id, org_id, supplier_org_id, author_id, author_org_id, body) values ($1,$2,$3,$4,$5,$6)`,
    [disputeId, d.org_id, d.supplier_org_id, user.userId, user.orgId, body]);
  if (user.orgKind === "supplier" && d.status === "open") await tx.query("update disputes set status = 'supplier_responded' where id = $1", [disputeId]);
  await audit(tx, user, "dispute", disputeId, "commented", {}, { orgId: d.org_id, supplierOrgId: d.supplier_org_id });
}

export async function setDisputeStatus(tx: Tx, user: SessionUser, disputeId: string, status: "escalated" | "resolved", resolution: string | null) {
  if (status === "resolved" && !(user.role === "contractor_manager" || user.role === "platform_admin"))
    throw new Error("Only a procurement manager or the platform can resolve disputes.");
  if (status === "resolved" && !resolution) throw new Error("Describe how the dispute was resolved.");
  const d = await one<{ org_id: string; supplier_org_id: string; invoice_id: string | null }>(tx,
    `update disputes set status = $2, resolution = coalesce($3, resolution),
       resolved_by = case when $2 = 'resolved' then $4::uuid end, resolved_at = case when $2 = 'resolved' then now() end
     where id = $1 and status <> 'resolved' returning org_id, supplier_org_id, invoice_id`, [disputeId, status, resolution, user.userId]);
  if (!d) throw new Error("Dispute not found or already resolved.");
  await audit(tx, user, "dispute", disputeId, status, { resolution }, { orgId: d.org_id, supplierOrgId: d.supplier_org_id });
}
