"use server";

import { attempt, done, numOf, optStr, str } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { addDeliveryDocument, dispatchDelivery, submitInvoice, supplierRespondToPo } from "@/lib/services/orders";

export async function submitQuote(rfqId: string, fd: FormData) {
  const user = await requireUser(["supplier"]);
  const path = `/supplier/rfqs/${rfqId}`;
  await attempt(path, async () => {
    await withActor(user, async (tx) => {
      const inv = await one<{ org_id: string; status: string }>(tx, "select org_id, status from rfq_invitations where rfq_id = $1 and supplier_org_id = $2", [rfqId, user.orgId]);
      const rfq = await one<{ status: string }>(tx, "select status from rfqs where id = $1", [rfqId]);
      if (!inv || !rfq) throw new Error("RFQ not found");
      if (rfq.status !== "sent") throw new Error("This RFQ is closed for quotations.");
      const items = await rows<{ id: string; quantity: number }>(tx, "select id, quantity from rfq_items where rfq_id = $1 order by line_no", [rfqId]);
      const lead = numOf(fd, "lead_time_days");
      if (lead === null || lead < 0) throw new Error("Enter your lead time in days.");
      const lines = items.map((it) => ({
        it, price: numOf(fd, `price_${it.id}`), available: numOf(fd, `available_${it.id}`),
        brand: optStr(fd, `brand_${it.id}`), spec: optStr(fd, `spec_${it.id}`), compliant: fd.get(`compliant_${it.id}`) === "on",
      })).filter((l) => l.price !== null);
      if (!lines.length) throw new Error("Price at least one line.");
      if (lines.some((l) => l.price! < 0)) throw new Error("Prices cannot be negative.");
      const delivery = numOf(fd, "delivery_cost") ?? 0;
      const subtotal = lines.reduce((a, l) => a + l.price! * l.it.quantity, 0);
      const existing = await one<{ id: string; status: string }>(tx, "select id, status from quotes where rfq_id = $1 and supplier_org_id = $2", [rfqId, user.orgId]);
      if (existing && existing.status !== "submitted") throw new Error("This quote can no longer be revised.");
      const values = [delivery, lead, optStr(fd, "payment_terms"), numOf(fd, "validity_days") ?? 14, optStr(fd, "notes"),
        Math.round(subtotal * 100) / 100, Math.round((subtotal + delivery) * 100) / 100, user.userId];
      const quoteId = existing
        ? (await one<{ id: string }>(tx, `update quotes set delivery_cost=$2, lead_time_days=$3, payment_terms=$4, validity_days=$5, notes=$6, subtotal=$7, total=$8,
              submitted_by=$9, submitted_at=now() where id=$1 returning id`, [existing.id, ...values]))!.id
        : (await one<{ id: string }>(tx, `insert into quotes (rfq_id, org_id, supplier_org_id, delivery_cost, lead_time_days, payment_terms, validity_days, notes, subtotal, total, submitted_by)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`, [rfqId, inv.org_id, user.orgId, ...values]))!.id;
      await tx.query("delete from quote_items where quote_id = $1", [quoteId]);
      for (const l of lines)
        await tx.query(`insert into quote_items (quote_id, org_id, supplier_org_id, rfq_item_id, unit_price, quantity, available_qty, brand, offered_spec, compliant)
                        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [quoteId, inv.org_id, user.orgId, l.it.id, l.price, l.it.quantity, Math.min(l.available ?? l.it.quantity, l.it.quantity), l.brand, l.spec, l.compliant]);
      await tx.query("update rfq_invitations set status = 'quoted', responded_at = now() where rfq_id = $1 and supplier_org_id = $2", [rfqId, user.orgId]);
      await audit(tx, user, "quote", quoteId, existing ? "revised" : "submitted", { total: values[6] }, { orgId: inv.org_id });
    });
  });
  done(path, "Quote submitted. The contractor will be notified; you can revise it until the RFQ closes.");
}

export async function declineRfq(rfqId: string, fd: FormData) {
  const user = await requireUser(["supplier"]);
  await attempt(`/supplier/rfqs/${rfqId}`, async () => {
    await withActor(user, async (tx) => {
      const inv = await one<{ org_id: string }>(tx, "update rfq_invitations set status = 'declined', responded_at = now() where rfq_id = $1 and supplier_org_id = $2 and status in ('invited','viewed') returning org_id", [rfqId, user.orgId]);
      if (!inv) throw new Error("This RFQ cannot be declined.");
      await audit(tx, user, "rfq", rfqId, "declined", { reason: optStr(fd, "reason") }, { orgId: inv.org_id });
    });
  });
  done("/supplier/rfqs", "RFQ declined.");
}

export async function respondToPo(poId: string, accept: boolean, fd: FormData) {
  const user = await requireUser(["supplier"]);
  await attempt(`/supplier/orders/${poId}`, async () => {
    await withActor(user, (tx) => supplierRespondToPo(tx, user, poId, accept, optStr(fd, "promised_date"), optStr(fd, "note")));
  });
  done(`/supplier/orders/${poId}`, accept ? "Order confirmed. Schedule a delivery when ready." : "Order declined.");
}

export async function dispatchAction(poId: string, fd: FormData) {
  const user = await requireUser(["supplier"]);
  await attempt(`/supplier/orders/${poId}`, async () => {
    await withActor(user, async (tx) => {
      const lines = fd.getAll("po_item").map(String).map((id) => ({ poItemId: id, qty: numOf(fd, `qty_${id}`) ?? 0 }));
      const dv = await dispatchDelivery(tx, user, poId, {
        scheduledDate: optStr(fd, "scheduled_date"), vehicle: optStr(fd, "vehicle"), driver: optStr(fd, "driver"), driverPhone: optStr(fd, "driver_phone"), lines,
      });
      const note = fd.get("delivery_note");
      if (note instanceof File && note.size > 0) await addDeliveryDocument(tx, user, dv.id, "delivery_note", note);
    });
  });
  done(`/supplier/orders/${poId}`, "Delivery dispatched. Give the driver the delivery code - the site needs it to verify receipt.");
}

export async function uploadDeliveryDoc(poId: string, deliveryId: string, fd: FormData) {
  const user = await requireUser(["supplier"]);
  await attempt(`/supplier/orders/${poId}`, async () => {
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose a file.");
    await withActor(user, (tx) => addDeliveryDocument(tx, user, deliveryId, (str(fd, "kind") || "delivery_note") as "delivery_note", f));
  });
  done(`/supplier/orders/${poId}`, "Document uploaded.");
}

export async function submitInvoiceAction(poId: string, fd: FormData) {
  const user = await requireUser(["supplier"]);
  let status = "";
  await attempt(`/supplier/orders/${poId}`, async () => {
    const number = str(fd, "invoice_number");
    const amount = numOf(fd, "amount");
    if (!number || !amount || amount <= 0) throw new Error("Invoice number and amount are required.");
    const m = await withActor(user, (tx) => submitInvoice(tx, user, poId, number, amount)).catch((e) => {
      throw /unique/.test(String(e)) ? new Error(`Invoice ${number} already exists.`) : e;
    });
    status = m.status;
  });
  done(`/supplier/orders/${poId}`, status === "matched" ? "Invoice submitted and matched to the accepted delivery." : "Invoice submitted, but it does not match the accepted quantities - the contractor will review.");
}

export async function updateProfile(fd: FormData) {
  const user = await requireUser(["supplier"]);
  await attempt("/supplier/profile", async () => {
    await withActor(user, async (tx) => {
      await tx.query(`update supplier_profiles set description = $2, categories = $3, emirates = $4, default_lead_time_days = $5, delivery_capability = $6,
                        payment_terms = $7, contact_email = $8, phone = $9, updated_at = now() where org_id = $1`,
        [user.orgId, optStr(fd, "description"), fd.getAll("categories").map(String), fd.getAll("emirates").map(String),
         numOf(fd, "default_lead_time_days") ?? 3, str(fd, "delivery_capability") || "own_fleet", optStr(fd, "payment_terms"), optStr(fd, "contact_email"), optStr(fd, "phone")]);
      await audit(tx, user, "supplier_profile", user.orgId, "updated");
    });
  });
  done("/supplier/profile", "Company profile updated.");
}

export async function upsertProduct(fd: FormData) {
  const user = await requireUser(["supplier"]);
  await attempt("/supplier/profile", async () => {
    const materialId = str(fd, "material_id");
    if (!materialId) throw new Error("Choose a material.");
    await withActor(user, async (tx) => {
      await tx.query(`insert into supplier_products (supplier_org_id, material_id, brand, unit_price_aed, stock_qty, lead_time_days)
                      values ($1,$2,$3,$4,$5,$6)
                      on conflict (supplier_org_id, material_id, brand) do update set unit_price_aed = excluded.unit_price_aed,
                        stock_qty = excluded.stock_qty, lead_time_days = excluded.lead_time_days, updated_at = now()`,
        [user.orgId, materialId, optStr(fd, "brand"), numOf(fd, "unit_price_aed"), numOf(fd, "stock_qty") ?? 0, numOf(fd, "lead_time_days")]);
    });
  });
  done("/supplier/profile#catalogue", "Catalogue updated.");
}

export async function updateStock(productId: string, fd: FormData) {
  const user = await requireUser(["supplier"]);
  await attempt("/supplier/profile", async () => {
    await withActor(user, (tx) => tx.query(
      "update supplier_products set unit_price_aed = $2, stock_qty = $3, lead_time_days = $4, updated_at = now() where id = $1",
      [productId, numOf(fd, "unit_price_aed"), numOf(fd, "stock_qty") ?? 0, numOf(fd, "lead_time_days")]));
  });
  done("/supplier/profile#catalogue", "Availability updated.");
}
