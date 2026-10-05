"use server";

import { attempt, done, optStr, str } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { CONTRACTOR_WRITERS, requireUser } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { recommendSuppliers, requestApproval, sendRfq } from "@/lib/services/rfq";

export async function refreshRecommendations(rfqId: string) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  await attempt(`/rfqs/${rfqId}`, async () => { await withActor(user, (tx) => recommendSuppliers(tx, user, rfqId)); });
  done(`/rfqs/${rfqId}`, "Supplier recommendations refreshed.");
}

export async function sendRfqAction(rfqId: string, fd: FormData) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  let n = 0;
  await attempt(`/rfqs/${rfqId}`, async () => {
    n = await withActor(user, (tx) => sendRfq(tx, user, rfqId, fd.getAll("supplier").map(String), optStr(fd, "quote_due")));
  });
  done(`/rfqs/${rfqId}`, `RFQ sent to ${n} supplier(s). Each supplier sees only its own invitation.`);
}

export async function requestApprovalAction(rfqId: string, fd: FormData) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  await attempt(`/rfqs/${rfqId}`, async () => {
    await withActor(user, (tx) => requestApproval(tx, user, rfqId, str(fd, "quote_id"), optStr(fd, "justification")));
  });
  done(`/rfqs/${rfqId}`, "Sent for approval. A procurement manager must approve before a purchase order is issued.");
}

export async function cancelRfq(rfqId: string) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  await attempt(`/rfqs/${rfqId}`, async () => {
    await withActor(user, async (tx) => {
      await tx.query("update rfqs set status = 'cancelled' where id = $1 and status in ('draft','sent')", [rfqId]);
      await tx.query("update requirements set status = 'confirmed' where id in (select unnest(requirement_ids) from rfq_items where rfq_id = $1) and status = 'in_rfq'", [rfqId]);
      await audit(tx, user, "rfq", rfqId, "cancelled");
    });
  });
  done(`/rfqs/${rfqId}`, "RFQ cancelled; its requirements are available again.");
}
