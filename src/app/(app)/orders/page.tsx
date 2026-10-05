import Link from "next/link";
import { Card, Empty, PageHeader, Progress, StatusBadge, Table, Td, Th } from "@/components/ui";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { aed, date } from "@/lib/format";

export const metadata = { title: "Orders & deliveries" };

export default async function Orders() {
  const user = await requireUser(CONTRACTOR_ROLES);
  const list = await withActor(user, (tx) => rows<{ id: string; po_number: string; supplier: string; project: string; total: number; status: string;
    required_date: string | null; issued_at: string; ordered: number; accepted: number; in_transit: number }>(tx,
    `select po.id, po.po_number, o.name as supplier, p.name as project, po.total, po.status, po.required_date, po.issued_at,
            (select sum(quantity) from po_items where po_id = po.id) as ordered,
            (select sum(accepted_qty) from po_items where po_id = po.id) as accepted,
            (select count(*)::int from deliveries d where d.po_id = po.id and d.status = 'dispatched') as in_transit
     from purchase_orders po join organizations o on o.id = po.supplier_org_id join projects p on p.id = po.project_id
     order by po.status in ('closed','cancelled'), po.issued_at desc`));
  return (
    <>
      <PageHeader title="Orders & deliveries" subtitle="Purchase orders, delivery progress and site verification." />
      <Card padded={false}>
        {list.length === 0 ? <div className="p-4"><Empty title="No purchase orders yet" /></div> : (
          <Table>
            <thead><tr><Th>PO</Th><Th>Supplier</Th><Th>Project</Th><Th right>Value</Th><Th>Status</Th><Th>Received</Th><Th>Required</Th></tr></thead>
            <tbody>{list.map((o) => (
              <tr key={o.id} className="hover:bg-surface-2">
                <Td><Link href={`/orders/${o.id}`} className="font-medium hover:text-accent">{o.po_number}</Link><div className="text-xs text-muted">{date(o.issued_at)}</div></Td>
                <Td>{o.supplier}</Td><Td className="text-muted">{o.project}</Td><Td right>{aed(o.total)}</Td>
                <Td><div className="flex flex-wrap gap-1"><StatusBadge status={o.status} />{o.in_transit > 0 && <StatusBadge status="dispatched" />}</div></Td>
                <Td className="w-36"><Progress value={o.ordered ? o.accepted / o.ordered : 0} tone={o.accepted >= o.ordered ? "success" : "accent"} /><div className="mt-1 text-xs text-muted">{o.ordered ? Math.round((o.accepted / o.ordered) * 100) : 0}% accepted</div></Td>
                <Td className="text-muted">{date(o.required_date)}</Td>
              </tr>))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
