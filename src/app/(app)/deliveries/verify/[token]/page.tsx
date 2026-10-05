import { notFound, redirect } from "next/navigation";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { one, withActor } from "@/lib/db";

// Landing page for the QR code printed on the supplier's delivery note.
export default async function VerifyByQr({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser(CONTRACTOR_ROLES);
  const d = await withActor(user, (tx) => one<{ id: string; po_id: string }>(tx, "select id, po_id from deliveries where qr_token = $1", [token]));
  if (!d) notFound();
  redirect(`/orders/${d.po_id}?verify=${d.id}&qr=${token}`);
}
