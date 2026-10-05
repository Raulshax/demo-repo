import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Field, KeyValue, PageHeader, StatusBadge, Textarea, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { aed, dateTime, titleCase } from "@/lib/format";
import { commentAction, disputeStatusAction } from "../../../actions/orders";

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const data = await withActor(user, async (tx) => {
    const d = await one<{ id: string; type: string; status: string; description: string; amount_at_stake: number | null; created_at: string; resolution: string | null;
      resolved_at: string | null; po_id: string; po_number: string; contractor: string; supplier: string; raiser: string | null; delivery_number: string | null; invoice_number: string | null }>(tx,
      `select d.*, po.po_number, c.name as contractor, s.name as supplier, u.full_name as raiser, dv.number as delivery_number, i.invoice_number
       from disputes d join purchase_orders po on po.id = d.po_id join organizations c on c.id = d.org_id join organizations s on s.id = d.supplier_org_id
       left join users u on u.id = d.raised_by left join deliveries dv on dv.id = d.delivery_id left join invoices i on i.id = d.invoice_id where d.id = $1`, [id]);
    if (!d) return null;
    // Author names are resolved via organisation names (users from other orgs are not visible under RLS).
    const comments = await rows<{ id: string; body: string; created_at: string; author_org_id: string; author_org: string; author: string | null }>(tx,
      `select x.id, x.body, x.created_at, x.author_org_id, o.name as author_org, u.full_name as author
       from dispute_comments x join organizations o on o.id = x.author_org_id left join users u on u.id = x.author_id where x.dispute_id = $1 order by x.created_at`, [id]);
    return { d, comments };
  });
  if (!data) notFound();
  const { d, comments } = data;
  const open = d.status !== "resolved";
  const canResolve = user.role === "contractor_manager" || user.role === "platform_admin";
  const canComment = user.role !== "contractor_exec";
  const orderHref = user.orgKind === "supplier" ? `/supplier/orders/${d.po_id}` : user.orgKind === "contractor" ? `/orders/${d.po_id}` : null;
  return (
    <>
      <PageHeader title={`${titleCase(d.type)} · ${d.po_number}`} crumbs={[{ href: "/disputes", label: "Disputes" }]}
        subtitle={<><StatusBadge status={d.status} /> · {d.contractor} ↔ {d.supplier}</>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Issue"><p className="text-sm">{d.description}</p><p className="mt-2 text-xs text-muted">Raised by {d.raiser ?? d.contractor} · {dateTime(d.created_at)}</p></Card>
          <Card title="Conversation" padded={false}>
            <ul className="divide-y divide-line">
              {comments.length === 0 && <li className="px-4 py-3 text-sm text-muted">No messages yet.</li>}
              {comments.map((c) => (
                <li key={c.id} className={cx("px-4 py-3", c.author_org_id === user.orgId && "bg-accent-soft/40")}>
                  <div className="text-xs text-muted"><span className="font-medium text-ink">{c.author ?? c.author_org}</span> · {c.author_org} · {dateTime(c.created_at)}</div>
                  <p className="mt-1 text-sm">{c.body}</p>
                </li>))}
            </ul>
            {open && canComment && (
              <form action={commentAction.bind(null, id)} className="space-y-2 border-t border-line p-4">
                <Textarea name="body" required placeholder="Write a message…" />
                <SubmitButton size="sm">Post message</SubmitButton>
              </form>
            )}
          </Card>
          {d.resolution && <Card title="Resolution"><p className="text-sm">{d.resolution}</p><p className="mt-1 text-xs text-muted">{dateTime(d.resolved_at)}</p></Card>}
        </div>
        <div className="space-y-4">
          <Card title="Details">
            <KeyValue items={[["Order", orderHref ? <Link key="o" className="text-accent hover:underline" href={orderHref}>{d.po_number}</Link> : d.po_number], ["Delivery", d.delivery_number ?? "—"],
              ["Invoice", d.invoice_number ?? "—"], ["At stake", aed(d.amount_at_stake)]]} />
          </Card>
          {open && canResolve && (
            <Card title="Resolve">
              <form action={disputeStatusAction.bind(null, id, "resolved")} className="space-y-2">
                <Field label="Resolution"><Textarea name="resolution" required placeholder="e.g. Balance delivered on DN-7012; corrected invoice received." /></Field>
                <SubmitButton size="sm">Mark resolved</SubmitButton>
              </form>
            </Card>
          )}
          {open && d.status !== "escalated" && user.role !== "platform_admin" && canComment && (
            <form action={disputeStatusAction.bind(null, id, "escalated")}>
              <SubmitButton variant="secondary" className="w-full">Escalate to platform</SubmitButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
