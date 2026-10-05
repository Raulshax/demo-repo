import Link from "next/link";
import { Card, Empty, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { date } from "@/lib/format";

export const metadata = { title: "RFQs" };

export default async function Rfqs() {
  const user = await requireUser(CONTRACTOR_ROLES);
  const list = await withActor(user, (tx) => rows<{ id: string; number: string; title: string; status: string; project: string; quote_due: string | null;
    needed_by: string | null; lines: number; invited: number; quotes: number; pr_status: string | null }>(tx,
    `select r.id, r.number, r.title, r.status, p.name as project, r.quote_due, r.needed_by,
            (select count(*)::int from rfq_items i where i.rfq_id = r.id) as lines,
            (select count(*)::int from rfq_invitations i where i.rfq_id = r.id and i.status <> 'recommended') as invited,
            (select count(*)::int from quotes q where q.rfq_id = r.id) as quotes,
            (select pr.status from purchase_requests pr where pr.rfq_id = r.id order by pr.created_at desc limit 1) as pr_status
     from rfqs r join projects p on p.id = r.project_id order by r.status in ('awarded','cancelled','closed'), r.created_at desc`));
  return (
    <>
      <PageHeader title="RFQs & quotes" subtitle="Targeted requests for quotation, AI quote comparison and award." />
      <Card padded={false}>
        {list.length === 0 ? <div className="p-4"><Empty title="No RFQs yet">Create one from confirmed requirements on a project.</Empty></div> : (
          <Table>
            <thead><tr><Th>RFQ</Th><Th>Project</Th><Th>Status</Th><Th right>Lines</Th><Th>Responses</Th><Th>Quotes due</Th><Th>Needed by</Th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <Td><Link href={`/rfqs/${r.id}`} className="font-medium hover:text-accent">{r.title}</Link><div className="text-xs text-muted">{r.number}</div></Td>
                <Td className="text-muted">{r.project}</Td>
                <Td><div className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.pr_status === "pending" && <StatusBadge status="pending" />}</div></Td>
                <Td right>{r.lines}</Td>
                <Td className="text-muted">{r.status === "draft" ? "Not sent" : `${r.quotes} of ${r.invited} quoted`}</Td>
                <Td className="text-muted">{date(r.quote_due)}</Td>
                <Td className="text-muted">{date(r.needed_by)}</Td>
              </tr>))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
