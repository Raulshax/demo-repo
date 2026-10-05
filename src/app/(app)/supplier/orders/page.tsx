import Link from "next/link";
import { Card, Empty, PageHeader, Progress, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { aed, date } from "@/lib/format";

export const metadata = { title: "Orders" };

export default async function SupplierOrders() {
  const user = await requireUser(["supplier"]);
  const list = await withActor(user, (tx) => rows<{ id: string; po_number: string; contractor: string; total: number; status: string; required_date: string | null; ordered: number; accepted: number }>(tx,
    `select po.id, po.po_number, o.name as contractor, po.total, po.status, po.required_date,
            (select sum(quantity) from po_items where po_id = po.id) as ordered, (select sum(accepted_qty) from po_items where po_id = po.id) as accepted
     from purchase_orders po join organizations o on o.id = po.org_id order by po.status in ('closed','cancelled','declined'), po.issued_at desc`));
  return (
    <>
      <PageHeader title="Orders & deliveries" subtitle="Confirm orders, dispatch deliveries and invoice against quantities accepted on site." />
      <Card padded={false}>
        {list.length === 0 ? <div className="p-4"><Empty title="No orders yet" /></div> : (
          <Table>
            <thead><tr><Th>PO</Th><Th>Contractor</Th><Th right>Value</Th><Th>Status</Th><Th>Accepted on site</Th><Th>Required</Th></tr></thead>
            <tbody>{list.map((o) => (
              <tr key={o.id} className="hover:bg-surface-2">
                <Td><Link href={`/supplier/orders/${o.id}`} className="font-medium hover:text-accent">{o.po_number}</Link></Td>
                <Td>{o.contractor}</Td><Td right>{aed(o.total)}</Td><Td><StatusBadge status={o.status} /></Td>
                <Td className="w-36"><Progress value={o.ordered ? o.accepted / o.ordered : 0} /></Td><Td className="text-muted">{date(o.required_date)}</Td>
              </tr>))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
