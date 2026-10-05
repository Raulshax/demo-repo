import Link from "next/link";
import { Card, Empty, Input, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { aed, dateTime } from "@/lib/format";
import { approveInvoiceAction, recordPaymentAction } from "../../actions/orders";

export const metadata = { title: "Invoices & payments" };

export default async function Invoices() {
  const user = await requireUser(CONTRACTOR_ROLES);
  const list = await withActor(user, (tx) => rows<{ id: string; invoice_number: string; amount: number; status: string; submitted_at: string; po_id: string; po_number: string;
    supplier: string; match_result: { payable?: number; accepted_value?: number; variance?: number; notes?: string[] } | null; paid_at: string | null; reference: string | null }>(tx,
    `select i.id, i.invoice_number, i.amount, i.status, i.submitted_at, i.po_id, po.po_number, o.name as supplier, i.match_result, pay.paid_at, pay.reference
     from invoices i join purchase_orders po on po.id = i.po_id join organizations o on o.id = i.supplier_org_id
     left join payments pay on pay.invoice_id = i.id
     order by i.status in ('paid','rejected'), i.submitted_at desc limit 100`));
  const isMgr = user.role === "contractor_manager";
  const sum = (s: string[]) => list.filter((i) => s.includes(i.status)).reduce((a, i) => a + i.amount, 0);
  return (
    <>
      <PageHeader title="Invoices & payments" subtitle="Every invoice is three-way matched: PO price × quantity accepted on site. Only matched invoices can be approved for payment." />
      <div className="mb-8 grid grid-cols-2 gap-x-5 gap-y-6 lg:grid-cols-4">
        <Stat label="Awaiting approval" value={aed(sum(["matched"]))} />
        <Stat label="Approved, unpaid" value={aed(sum(["approved"]))} />
        <Stat label="Blocked (mismatch / disputed)" value={aed(sum(["mismatch", "disputed"]))} tone="bad" hint="Payment held" />
        <Stat label="Paid" value={aed(sum(["paid"]))} />
      </div>
      <Card padded={false}>
        {list.length === 0 ? <div className="p-4"><Empty title="No invoices yet" /></div> : (
          <Table>
            <thead><tr><Th>Invoice</Th><Th>Supplier</Th><Th>PO</Th><Th right>Invoiced</Th><Th right>Payable (accepted)</Th><Th>Status</Th><Th>Action</Th></tr></thead>
            <tbody>{list.map((i) => (
              <tr key={i.id}>
                <Td className="font-medium">{i.invoice_number}<div className="text-xs font-normal text-muted">{dateTime(i.submitted_at)}</div></Td>
                <Td>{i.supplier}</Td>
                <Td><Link href={`/orders/${i.po_id}`} className="hover:text-accent">{i.po_number}</Link></Td>
                <Td right>{aed(i.amount)}</Td>
                <Td right>{aed(i.match_result?.payable ?? i.match_result?.accepted_value)}{i.status === "mismatch" && i.match_result?.variance ? <div className="text-xs text-danger">+{aed(i.match_result.variance)}</div> : null}</Td>
                <Td><StatusBadge status={i.status} />{i.match_result?.notes?.map((n) => <div key={n} className="mt-1 max-w-xs text-xs text-muted">{n}</div>)}</Td>
                <Td>
                  {isMgr && i.status === "matched" && <form action={approveInvoiceAction.bind(null, i.id)}><SubmitButton size="sm">Approve</SubmitButton></form>}
                  {isMgr && i.status === "approved" && (
                    <form action={recordPaymentAction.bind(null, i.id)} className="flex gap-1">
                      <Input name="reference" placeholder="Bank ref" className="w-28 py-1 text-xs" required />
                      <SubmitButton size="sm">Mark paid</SubmitButton>
                    </form>)}
                  {i.status === "paid" && <span className="text-xs text-muted">{dateTime(i.paid_at)} · {i.reference}</span>}
                  {i.status === "mismatch" && <Link href={`/orders/${i.po_id}`} className="text-xs text-accent hover:underline">Dispute / review</Link>}
                </Td>
              </tr>))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
