import Link from "next/link";
import { Card, Empty, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { aed, dateTime, titleCase } from "@/lib/format";

export const metadata = { title: "Disputes" };

export default async function Disputes() {
  const user = await requireUser();
  const list = await withActor(user, (tx) => rows<{ id: string; type: string; status: string; created_at: string; amount_at_stake: number | null; po_number: string; contractor: string; supplier: string; comments: number }>(tx,
    `select d.id, d.type, d.status, d.created_at, d.amount_at_stake, po.po_number, c.name as contractor, s.name as supplier,
            (select count(*)::int from dispute_comments x where x.dispute_id = d.id) as comments
     from disputes d join purchase_orders po on po.id = d.po_id join organizations c on c.id = d.org_id join organizations s on s.id = d.supplier_org_id
     order by d.status = 'resolved', d.status = 'escalated' desc, d.created_at desc`));
  return (
    <>
      <PageHeader title="Disputes" subtitle={user.role === "platform_admin" ? "Escalated disputes need platform mediation." : "Short deliveries, damage, specification and pricing issues - tracked to resolution."} />
      <Card padded={false}>
        {list.length === 0 ? <div className="p-4"><Empty title="No disputes" /></div> : (
          <Table>
            <thead><tr><Th>Issue</Th><Th>{user.orgKind === "supplier" ? "Contractor" : "Supplier"}</Th>{user.role === "platform_admin" && <Th>Contractor</Th>}<Th>PO</Th><Th right>At stake</Th><Th>Status</Th><Th>Raised</Th></tr></thead>
            <tbody>{list.map((d) => (
              <tr key={d.id} className="hover:bg-surface-2">
                <Td><Link href={`/disputes/${d.id}`} className="font-medium hover:text-accent">{titleCase(d.type)}</Link><div className="text-xs text-muted">{d.comments} message(s)</div></Td>
                <Td>{user.orgKind === "supplier" ? d.contractor : d.supplier}</Td>
                {user.role === "platform_admin" && <Td>{d.contractor}</Td>}
                <Td className="text-muted">{d.po_number}</Td><Td right>{aed(d.amount_at_stake)}</Td><Td><StatusBadge status={d.status} /></Td><Td className="text-muted">{dateTime(d.created_at)}</Td>
              </tr>))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
