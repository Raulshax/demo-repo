import Link from "next/link";
import { Card, Empty, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { aed, date } from "@/lib/format";

export const metadata = { title: "RFQs" };

export default async function SupplierRfqs() {
  const user = await requireUser(["supplier"]);
  const list = await withActor(user, (tx) => rows<{ rfq_id: string; number: string; title: string; contractor: string; status: string; rfq_status: string;
    quote_due: string | null; needed_by: string | null; delivery_location: string | null; lines: number; my_total: number | null }>(tx,
    `select r.id as rfq_id, r.number, r.title, o.name as contractor, i.status, r.status as rfq_status, r.quote_due, r.needed_by, r.delivery_location,
            (select count(*)::int from rfq_items ri where ri.rfq_id = r.id) as lines,
            (select q.total from quotes q where q.rfq_id = r.id and q.supplier_org_id = $1) as my_total
     from rfq_invitations i join rfqs r on r.id = i.rfq_id join organizations o on o.id = r.org_id
     where i.supplier_org_id = $1 order by i.status in ('invited','viewed') desc, r.quote_due nulls last`, [user.orgId]));
  return (
    <>
      <PageHeader title="RFQs" subtitle="Requests for quotation sent to you. You only ever see your own quotes." />
      <Card padded={false}>
        {list.length === 0 ? <div className="p-4"><Empty title="No RFQs yet">Keep your catalogue and categories up to date to be recommended for more RFQs.</Empty></div> : (
          <Table>
            <thead><tr><Th>RFQ</Th><Th>Contractor</Th><Th>Deliver to</Th><Th right>Lines</Th><Th>Quotes due</Th><Th>Your status</Th><Th right>Your quote</Th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.rfq_id} className="hover:bg-surface-2">
                <Td><Link href={`/supplier/rfqs/${r.rfq_id}`} className="font-medium hover:text-accent">{r.title}</Link><div className="text-xs text-muted">{r.number}</div></Td>
                <Td>{r.contractor}</Td><Td className="text-muted">{r.delivery_location}</Td><Td right>{r.lines}</Td><Td className="text-muted">{date(r.quote_due)}</Td>
                <Td><StatusBadge status={r.status} /></Td><Td right>{aed(r.my_total)}</Td>
              </tr>))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
