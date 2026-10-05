import { Badge, Card, Field, Input, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { aed, date } from "@/lib/format";
import { createOrganization, setOrgStatus, verifySupplier } from "../../../actions/admin";

export const metadata = { title: "Organisations" };

export default async function Organizations() {
  const user = await requireUser(["platform_admin"]);
  const d = await withActor(user, async (tx) => ({
    orgs: await rows<{ id: string; name: string; kind: string; status: string; trade_license: string | null; created_at: string; users: number; verified: boolean | null; volume: number }>(tx,
      `select o.id, o.name, o.kind, o.status, o.trade_license, o.created_at, (select count(*)::int from users u where u.org_id = o.id) as users, sp.verified,
              (select coalesce(sum(total),0) from purchase_orders po where po.org_id = o.id or po.supplier_org_id = o.id) as volume
       from organizations o left join supplier_profiles sp on sp.org_id = o.id where o.kind <> 'platform' order by o.kind, o.name`),
    categories: await rows<{ code: string; name: string }>(tx, "select code, name from categories where parent_code is not null or code in ('INSUL','CHEM','FAST','CONS') order by code"),
  }));
  return (
    <>
      <PageHeader title="Organisations" subtitle="Contractor and supplier tenants. Suspending an organisation blocks its users from signing in." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Organisation</Th><Th>Type</Th><Th>Status</Th><Th right>Users</Th><Th right>Order volume</Th><Th>Actions</Th></tr></thead>
            <tbody>{d.orgs.map((o) => (
              <tr key={o.id}>
                <Td><div className="font-medium">{o.name}</div><div className="text-xs text-muted">{o.trade_license ?? "—"} · joined {date(o.created_at)}</div></Td>
                <Td><Badge tone={o.kind === "contractor" ? "accent" : "info"}>{o.kind}</Badge>{o.kind === "supplier" && (o.verified ? <Badge tone="success" className="ml-1">Verified</Badge> : <Badge tone="warn" className="ml-1">Unverified</Badge>)}</Td>
                <Td><StatusBadge status={o.status} /></Td><Td right>{o.users}</Td><Td right>{aed(o.volume)}</Td>
                <Td><div className="flex gap-1">
                  {o.kind === "supplier" && !o.verified && <form action={verifySupplier.bind(null, o.id)}><SubmitButton size="sm" variant="secondary">Verify</SubmitButton></form>}
                  <form action={setOrgStatus.bind(null, o.id, o.status === "active" ? "suspended" : "active")}>
                    <SubmitButton size="sm" variant={o.status === "active" ? "ghost" : "secondary"}>{o.status === "active" ? "Suspend" : "Activate"}</SubmitButton></form>
                </div></Td>
              </tr>))}
            </tbody>
          </Table>
        </Card>
        <Card title="Onboard an organisation">
          <form action={createOrganization} className="space-y-3">
            <Field label="Company name"><Input name="name" required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type"><Select name="kind" defaultValue="supplier"><option value="supplier">Supplier</option><option value="contractor">Contractor</option></Select></Field>
              <Field label="Trade licence"><Input name="trade_license" /></Field>
            </div>
            <Field label="First user - name"><Input name="contact" required /></Field>
            <Field label="First user - email"><Input name="email" type="email" required /></Field>
            <Field label="Temporary password"><Input name="password" type="text" required minLength={8} /></Field>
            <Field label="Supplier categories"><Select name="categories" multiple className="h-28">{d.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>
            <SubmitButton className="w-full">Create organisation</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
