"use server";

import { attempt, done, numOf, optStr, str } from "@/lib/actions";
import { CONTRACTOR_WRITERS, requireUser } from "@/lib/auth";
import { withActor } from "@/lib/db";
import {
  addDeliveryDocument, approveInvoice, commentOnDispute, decidePurchase, raiseDispute, recordPayment, setDisputeStatus, verifyDelivery,
} from "@/lib/services/orders";

export async function decidePurchaseAction(prId: string, decision: "approved" | "rejected", fd: FormData) {
  const user = await requireUser(["contractor_manager"]);
  let po: { id: string; po_number: string } | null = null;
  await attempt("/approvals", async () => {
    po = await withActor(user, (tx) => decidePurchase(tx, user, prId, decision, optStr(fd, "note")));
  });
  const issued = po as { id: string; po_number: string } | null;
  if (issued) done(`/orders/${issued.id}`, `Approved. ${issued.po_number} issued to the supplier for confirmation.`);
  done("/approvals", "Purchase request rejected.");
}

export async function verifyDeliveryAction(orderId: string, deliveryId: string, fd: FormData) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  const back = `/orders/${orderId}`;
  let status = "";
  await attempt(`${back}?verify=${deliveryId}${str(fd, "qr_token") ? `&qr=${str(fd, "qr_token")}` : ""}`, async () => {
    const ids = fd.getAll("item").map(String);
    const lines = ids.map((id) => ({
      deliveryItemId: id, received: numOf(fd, `received_${id}`) ?? 0, accepted: numOf(fd, `accepted_${id}`) ?? 0, reason: optStr(fd, `reason_${id}`),
    }));
    status = await withActor(user, async (tx) => {
      const s = await verifyDelivery(tx, user, deliveryId, {
        method: str(fd, "method") === "qr" ? "qr" : "otp", otp: optStr(fd, "otp"), qrToken: optStr(fd, "qr_token"),
        condition: (str(fd, "condition") || "good") as "good", notes: optStr(fd, "notes"), lines,
      });
      for (const kind of ["photo", "delivery_note"] as const) {
        const f = fd.get(kind);
        if (f instanceof File && f.size > 0) await addDeliveryDocument(tx, user, deliveryId, kind, f);
      }
      return s;
    });
  });
  const msg = status === "accepted" ? "Delivery verified and accepted in full."
    : status === "partially_accepted" ? "Partial delivery recorded. The balance stays open on the order - raise a dispute if needed."
    : "Delivery rejected. Raise a dispute so the supplier can respond.";
  done(back, msg);
}

export async function raiseDisputeAction(orderId: string, fd: FormData) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  let id = "";
  await attempt(`/orders/${orderId}`, async () => {
    const description = str(fd, "description");
    if (description.length < 10) throw new Error("Describe the issue (at least 10 characters).");
    id = await withActor(user, (tx) => raiseDispute(tx, user, {
      poId: orderId, deliveryId: optStr(fd, "delivery_id"), invoiceId: optStr(fd, "invoice_id"),
      type: str(fd, "type") || "other", description, amount: numOf(fd, "amount"),
    }));
  });
  done(`/disputes/${id}`, "Dispute raised. The supplier has been notified.");
}

export async function commentAction(disputeId: string, fd: FormData) {
  const user = await requireUser();
  await attempt(`/disputes/${disputeId}`, async () => {
    const body = str(fd, "body");
    if (!body) throw new Error("Write a message.");
    await withActor(user, (tx) => commentOnDispute(tx, user, disputeId, body));
  });
  done(`/disputes/${disputeId}`, "Message posted.");
}

export async function disputeStatusAction(disputeId: string, status: "escalated" | "resolved", fd: FormData) {
  const user = await requireUser();
  await attempt(`/disputes/${disputeId}`, async () => {
    await withActor(user, (tx) => setDisputeStatus(tx, user, disputeId, status, optStr(fd, "resolution")));
  });
  done(`/disputes/${disputeId}`, status === "resolved" ? "Dispute resolved." : "Escalated to the platform team.");
}

export async function approveInvoiceAction(invoiceId: string) {
  const user = await requireUser(["contractor_manager"]);
  await attempt("/invoices", async () => { await withActor(user, (tx) => approveInvoice(tx, user, invoiceId)); });
  done("/invoices", "Invoice approved for payment.");
}

export async function recordPaymentAction(invoiceId: string, fd: FormData) {
  const user = await requireUser(["contractor_manager"]);
  await attempt("/invoices", async () => {
    const ref = str(fd, "reference");
    if (!ref) throw new Error("Enter the payment reference.");
    await withActor(user, (tx) => recordPayment(tx, user, invoiceId, ref));
  });
  done("/invoices", "Payment recorded.");
}
