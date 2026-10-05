import { Badge, Card, PageHeader, Table, Td, Th, cx } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { aed, num } from "@/lib/format";

export const metadata = { title: "Suppliers" };

export default async function Suppliers() {
  const user = await requireUser(["contractor_user", "contractor_manager", "contractor_exec", "platform_admin"]);
  const list = await withActor(user, (tx) => rows<{ org_id: string; name: string; status: string; categories: string[]; emirates: string[]; verified: boolean; delivery_capability: string;
    payment_terms: string | null; products: number; deliveries: number; on_time_rate: number | null; fill_rate: number | null; acceptance_rate: number | null; disputes: number;
    my_orders: number; my_spend: number }>(tx,
    `select sp.org_id, o.name, o.status, sp.categories, sp.emirates, sp.verified, sp.delivery_capability, sp.payment_terms,
            (select count(*)::int from supplier_products x where x.supplier_org_id = sp.org_id) as products,
            sc.deliveries, sc.on_time_rate, sc.fill_rate, sc.acceptance_rate, sc.disputes,
            (select count(*)::int from purchase_orders po where po.supplier_org_id = sp.org_id and po.org_id = $1) as my_orders,
            (select coalesce(sum(total),0) from purchase_orders po where po.supplier_org_id = sp.org_id and po.org_id = $1) as my_spend
     from supplier_profiles sp join organizations o on o.id = sp.org_id left join supplier_scorecards() sc on sc.supplier_org_id = sp.org_id
     order by sc.on_time_rate desc nulls last`, [user.orgId]));
  const rate = (v: number | null, good = 0.9, ok = 0.8) => v === null ? <span className="text-subtle">—</span>
    : <span className={cx("font-medium", v >= good ? "text-success" : v >= ok ? "text-warn" : "text-danger")}>{Math.round(v * 100)}%</span>;
  return (
    <>
      <PageHeader title="Supplier network" subtitle="Scorecards are built from verified site deliveries across the whole platform - not supplier self-reporting." />
      <Card padded={false}>
        <Table>
          <thead><tr><Th>Supplier</Th><Th>Categories</Th><Th>Delivers to</Th><Th right>Verified deliveries</Th><Th right>On time</Th><Th right>Fill rate</Th><Th right>Accepted</Th><Th right>Disputes</Th><Th right>Your spend</Th></tr></thead>
          <tbody>{list.map((s) => (
            <tr key={s.org_id}>
              <Td><div className="font-medium">{s.name}</div><div className="mt-0.5 flex flex-wrap gap-1">{s.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}
                <Badge>{s.delivery_capability.replace("_", " ")}</Badge>{s.payment_terms && <Badge>{s.payment_terms}</Badge>}</div></Td>
              <Td className="max-w-48 text-xs text-muted">{s.categories.join(", ")} · {s.products} listed</Td>
              <Td className="max-w-40 text-xs text-muted">{s.emirates.join(", ")}</Td>
              <Td right>{num(s.deliveries)}</Td><Td right>{rate(s.on_time_rate)}</Td><Td right>{rate(s.fill_rate, 0.97, 0.92)}</Td><Td right>{rate(s.acceptance_rate, 0.98, 0.95)}</Td>
              <Td right>{s.disputes}</Td><Td right>{s.my_orders ? <>{aed(s.my_spend)}<div className="text-xs text-muted">{s.my_orders} orders</div></> : "—"}</Td>
            </tr>))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
