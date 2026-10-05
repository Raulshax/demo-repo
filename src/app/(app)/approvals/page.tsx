import Link from "next/link";
import { AiPanel, Badge, Card, Empty, Field, PageHeader, StatusBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { aed, dateTime } from "@/lib/format";
import { decidePurchaseAction } from "../../actions/orders";

export const metadata = { title: "Approvals" };

interface Pr {
  id: string; amount: number; status: string; high_value: boolean; justification: string | null; follows_ai_recommendation: boolean | null; created_at: string;
  rfq_id: string; rfq_title: string; rfq_number: string; project: string; supplier: string; requester: string; requested_by: string;
  decider: string | null; decided_at: string | null; decision_note: string | null;
  ai_recommendation: { headline?: string; explanation?: string; ranking?: { supplier: string; total: number; score: number; eligible: boolean }[] } | null;
}

export default async function Approvals() {
  const user = await requireUser(CONTRACTOR_ROLES);
  const { list, threshold } = await withActor(user, async (tx) => ({
    list: await rows<Pr>(tx,
      `select pr.*, r.title as rfq_title, r.number as rfq_number, p.name as project, o.name as supplier, u.full_name as requester, d.full_name as decider
       from purchase_requests pr join rfqs r on r.id = pr.rfq_id join projects p on p.id = pr.project_id join organizations o on o.id = pr.supplier_org_id
       join users u on u.id = pr.requested_by left join users d on d.id = pr.decided_by
       order by pr.status = 'pending' desc, pr.created_at desc limit 50`),
    threshold: (await rows<{ t: number }>(tx, "select (settings->>'high_value_threshold_aed')::numeric as t from organizations where id = $1", [user.orgId]))[0]?.t ?? 250000,
  }));
  const pending = list.filter((p) => p.status === "pending");
  const decided = list.filter((p) => p.status !== "pending");
  const canDecide = user.role === "contractor_manager";
  return (
    <>
      <PageHeader title="Approvals" subtitle={<>Purchases need a procurement manager&apos;s approval before a PO is issued. Requests above {aed(threshold)} are high-value and need a written note. Approvers cannot approve their own requests.</>} />
      {pending.length === 0 ? <Empty title="No purchases awaiting approval" /> : (
        <div className="space-y-4">
          {pending.map((p) => {
            const own = p.requested_by === user.userId;
            return (
              <Card key={p.id} title={<span className="flex flex-wrap items-center gap-2">{aed(p.amount)} · {p.supplier}{p.high_value && <Badge tone="danger">High value</Badge>}
                {p.follows_ai_recommendation ? <Badge tone="ai">Follows AI recommendation</Badge> : <Badge tone="warn">Deviates from AI recommendation</Badge>}</span>}
                subtitle={<><Link className="hover:text-accent" href={`/rfqs/${p.rfq_id}`}>{p.rfq_title} ({p.rfq_number})</Link> · {p.project} · requested by {p.requester} {dateTime(p.created_at)}</>}>
                <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
                  <div className="space-y-3">
                    {p.ai_recommendation?.explanation && <AiPanel title={p.ai_recommendation.headline ?? "Recommendation"}>{p.ai_recommendation.explanation}</AiPanel>}
                    {p.justification && <div className=" bg-surface-2 px-3 py-2 text-sm"><span className="text-xs font-medium text-muted">Requester&apos;s justification</span><p>{p.justification}</p></div>}
                    {p.ai_recommendation?.ranking && (
                      <Table><thead><tr><Th>Quote</Th><Th right>Comparable total</Th><Th right>Score</Th></tr></thead>
                        <tbody>{p.ai_recommendation.ranking.map((r) => (
                          <tr key={r.supplier}><Td>{r.supplier}{!r.eligible && <Badge tone="danger" className="ml-2">Non-compliant</Badge>}</Td><Td right>{aed(r.total)}</Td><Td right>{r.score.toFixed(1)}</Td></tr>))}
                        </tbody></Table>
                    )}
                  </div>
                  {canDecide ? (own ? <p className="text-sm text-muted">You raised this request, so another manager must approve it.</p> : (
                    <form className="space-y-3">
                      <Field label={p.high_value ? "Decision note (required)" : "Decision note"}><Textarea name="note" required={p.high_value} placeholder="e.g. Approved - best compliant value, delivery fits programme." /></Field>
                      <div className="flex gap-2">
                        <SubmitButton formAction={decidePurchaseAction.bind(null, p.id, "approved")} pendingText="Issuing PO…">Approve & issue PO</SubmitButton>
                        <SubmitButton formAction={decidePurchaseAction.bind(null, p.id, "rejected")} variant="secondary" formNoValidate>Reject</SubmitButton>
                      </div>
                      <p className="text-xs text-muted">Approval issues a purchase order to {p.supplier} immediately.</p>
                    </form>
                  )) : <p className="text-sm text-muted">Awaiting a procurement manager.</p>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {decided.length > 0 && (
        <Card title="Recent decisions" className="mt-6" padded={false}>
          <Table>
            <thead><tr><Th>Request</Th><Th right>Amount</Th><Th>Supplier</Th><Th>Decision</Th><Th>By</Th><Th>Note</Th></tr></thead>
            <tbody>{decided.map((p) => (
              <tr key={p.id}><Td><Link href={`/rfqs/${p.rfq_id}`} className="hover:text-accent">{p.rfq_title}</Link></Td><Td right>{aed(p.amount)}</Td><Td>{p.supplier}</Td>
                <Td><StatusBadge status={p.status} /></Td><Td className="text-muted">{p.decider} · {dateTime(p.decided_at)}</Td><Td className="text-xs text-muted">{p.decision_note}</Td></tr>))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
