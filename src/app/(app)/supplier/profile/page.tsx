import { Card, Field, Input, PageHeader, Select, Table, Td, Textarea, Th, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { dateTime, num } from "@/lib/format";
import { updateProfile, updateStock, upsertProduct } from "../../../actions/supplier";

export const metadata = { title: "Company & catalogue" };
const EMIRATES = ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain"];

export default async function SupplierProfile() {
  const user = await requireUser(["supplier"]);
  const d = await withActor(user, async (tx) => ({
    p: (await one<{ description: string | null; categories: string[]; emirates: string[]; default_lead_time_days: number; delivery_capability: string; payment_terms: string | null;
      contact_email: string | null; phone: string | null; verified: boolean }>(tx, "select * from supplier_profiles where org_id = $1", [user.orgId]))!,
    categories: await rows<{ code: string; name: string; parent_code: string | null }>(tx, "select code, name, parent_code from categories order by code"),
    products: await rows<{ id: string; name: string; sku: string; brand: string | null; unit_price_aed: number | null; stock_qty: number; lead_time_days: number | null; base_unit: string; updated_at: string }>(tx,
      `select sp.id, m.name, m.sku, sp.brand, sp.unit_price_aed, sp.stock_qty, sp.lead_time_days, m.base_unit, sp.updated_at
       from supplier_products sp join materials m on m.id = sp.material_id where sp.supplier_org_id = $1 order by m.sku`, [user.orgId]),
    materials: await rows<{ id: string; name: string; category_code: string }>(tx, "select id, name, category_code from materials where active order by category_code, name"),
    card: await one<{ deliveries: number; on_time_rate: number | null; fill_rate: number | null; acceptance_rate: number | null }>(tx, "select * from supplier_scorecards() where supplier_org_id = $1", [user.orgId]),
  }));
  return (
    <>
      <PageHeader title="Company & catalogue" subtitle={<>{user.orgName} · {d.p.verified ? <Badge tone="success">Verified by platform</Badge> : <Badge tone="warn">Verification pending</Badge>}</>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card title="Catalogue & availability" subtitle="Listing materials with prices and stock makes you more likely to be recommended. Prices are visible to contractors only - never to other suppliers." padded={false}>
          <div id="catalogue" />
          <Table>
            <thead><tr><Th>Material</Th><Th>Brand</Th><Th>Unit price · stock · lead (days)</Th><Th>Updated</Th></tr></thead>
            <tbody>{d.products.map((p) => (
              <tr key={p.id}>
                <Td><div className="text-sm">{p.name}</div><div className="font-mono text-[11px] text-subtle">{p.sku}</div></Td>
                <Td className="text-muted">{p.brand ?? "—"}</Td>
                <Td>
                  <form action={updateStock.bind(null, p.id)} className="flex items-center gap-1">
                    <Input name="unit_price_aed" defaultValue={p.unit_price_aed ?? ""} inputMode="decimal" className="w-20 py-1 text-right text-xs" aria-label="Unit price" title={`AED per ${p.base_unit}`} />
                    <Input name="stock_qty" defaultValue={p.stock_qty} inputMode="decimal" className="w-20 py-1 text-right text-xs" aria-label="Stock" />
                    <Input name="lead_time_days" defaultValue={p.lead_time_days ?? ""} inputMode="numeric" className="w-12 py-1 text-right text-xs" aria-label="Lead time" />
                    <SubmitButton size="sm" variant="ghost">Save</SubmitButton>
                  </form>
                </Td>
                <Td className="text-xs text-muted">{dateTime(p.updated_at)}</Td>
              </tr>))}
            </tbody>
          </Table>
          <form action={upsertProduct} className="grid gap-2 border-t border-line p-4 sm:grid-cols-[1fr_110px_100px_90px_70px_auto] sm:items-end">
            <Field label="Add material"><Select name="material_id" required defaultValue=""><option value="" disabled>Choose…</option>{d.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            <Field label="Brand"><Input name="brand" /></Field>
            <Field label="Price (AED)"><Input name="unit_price_aed" inputMode="decimal" /></Field>
            <Field label="Stock"><Input name="stock_qty" inputMode="decimal" /></Field>
            <Field label="Lead"><Input name="lead_time_days" inputMode="numeric" /></Field>
            <SubmitButton variant="secondary">Add</SubmitButton>
          </form>
        </Card>
        <div className="space-y-6">
          <Card title="Your performance (as contractors see it)">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div><dt className="text-xs text-muted">On time</dt><dd className="text-lg font-semibold">{d.card?.on_time_rate != null ? `${Math.round(d.card.on_time_rate * 100)}%` : "—"}</dd></div>
              <div><dt className="text-xs text-muted">Fill rate</dt><dd className="text-lg font-semibold">{d.card?.fill_rate != null ? `${Math.round(d.card.fill_rate * 100)}%` : "—"}</dd></div>
              <div><dt className="text-xs text-muted">Deliveries</dt><dd className="text-lg font-semibold">{num(d.card?.deliveries ?? 0)}</dd></div>
            </dl>
          </Card>
          <Card title="Company profile">
            <form action={updateProfile} className="space-y-3">
              <Field label="Description"><Textarea name="description" defaultValue={d.p.description ?? ""} /></Field>
              <Field label="Categories supplied">
                <div className="grid grid-cols-1 gap-1 border border-line p-2 text-sm">
                  {d.categories.filter((c) => c.parent_code || !d.categories.some((x) => x.parent_code === c.code)).map((c) => (
                    <label key={c.code} className="flex items-center gap-2"><input type="checkbox" name="categories" value={c.code} defaultChecked={d.p.categories.includes(c.code)} className="accent-[var(--accent)]" />{c.name}</label>))}
                </div>
              </Field>
              <Field label="Delivery areas">
                <div className="grid grid-cols-2 gap-1 border border-line p-2 text-sm">
                  {EMIRATES.map((e) => <label key={e} className="flex items-center gap-2"><input type="checkbox" name="emirates" value={e} defaultChecked={d.p.emirates.includes(e)} className="accent-[var(--accent)]" />{e}</label>)}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Default lead time (days)"><Input name="default_lead_time_days" defaultValue={d.p.default_lead_time_days} inputMode="numeric" /></Field>
                <Field label="Delivery"><Select name="delivery_capability" defaultValue={d.p.delivery_capability}><option value="own_fleet">Own fleet</option><option value="third_party">Third-party</option><option value="collection_only">Collection only</option></Select></Field>
              </div>
              <Field label="Standard payment terms"><Input name="payment_terms" defaultValue={d.p.payment_terms ?? ""} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email"><Input name="contact_email" defaultValue={d.p.contact_email ?? ""} /></Field>
                <Field label="Phone"><Input name="phone" defaultValue={d.p.phone ?? ""} /></Field>
              </div>
              <SubmitButton>Save profile</SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
