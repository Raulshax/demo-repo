import { Badge, Card, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { price } from "@/lib/format";
import { addMaterial } from "../../actions/admin";

export const metadata = { title: "Material database" };

export default async function Materials({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string }> }) {
  const { q = "", cat = "" } = await searchParams;
  const user = await requireUser(["contractor_user", "contractor_manager", "platform_admin"]);
  const d = await withActor(user, async (tx) => ({
    categories: await rows<{ code: string; name: string; wedge: string; n: number }>(tx,
      "select c.code, c.name, c.wedge, (select count(*)::int from materials m where m.category_code = c.code) as n from categories c order by c.code"),
    materials: await rows<{ id: string; sku: string; name: string; category_code: string; base_unit: string; spec: Record<string, unknown>; typical_brands: string[]; benchmark_price_aed: number | null; median: number | null }>(tx,
      `select m.*, b.median from materials m left join material_benchmarks(array(select id from materials)) b on b.material_id = m.id
       where ($1 = '' or m.name ilike '%' || $1 || '%' or m.sku ilike '%' || $1 || '%') and ($2 = '' or m.category_code = $2 or m.category_code like $2 || '-%')
       order by m.category_code, m.sku`, [q, cat]),
  }));
  return (
    <>
      <PageHeader title="Material database" subtitle="The central, normalised catalogue every BOQ line is matched against. Specifications are structured so quotes can be compared like-for-like." />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Search name or SKU" className="max-w-xs" />
        <Select name="cat" defaultValue={cat} className="max-w-xs"><option value="">All categories</option>{d.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
        <SubmitButton variant="secondary">Filter</SubmitButton>
      </form>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card padded={false} subtitle={`${d.materials.length} materials`} title="Catalogue">
          <Table>
            <thead><tr><Th>SKU</Th><Th>Material</Th><Th>Specification</Th><Th>Unit</Th><Th right>Market median</Th></tr></thead>
            <tbody>{d.materials.map((m) => (
              <tr key={m.id}>
                <Td className="font-mono text-xs text-muted">{m.sku}</Td>
                <Td><div>{m.name}</div><div className="text-xs text-muted">{m.typical_brands.join(", ")}</div></Td>
                <Td><div className="flex flex-wrap gap-1">{Object.entries(m.spec).filter(([k]) => k !== "family").map(([k, v]) => <Badge key={k}>{k}: {String(v)}</Badge>)}</div></Td>
                <Td>{m.base_unit}</Td>
                <Td right>{price(m.median ?? m.benchmark_price_aed)}</Td>
              </tr>))}
            </tbody>
          </Table>
        </Card>
        <div className="space-y-6">
          <Card title="Categories">
            <ul className="space-y-1 text-sm">{d.categories.map((c) => (
              <li key={c.code} className="flex justify-between"><span>{c.name} {c.wedge === "primary" && <Badge tone="accent" className="ml-1">MEP focus</Badge>}</span><span className="text-muted">{c.n}</span></li>))}</ul>
          </Card>
          {user.role === "platform_admin" && (
            <Card title="Add material">
              <form action={addMaterial} className="space-y-3">
                <div className="grid grid-cols-2 gap-3"><Field label="SKU"><Input name="sku" required /></Field><Field label="Unit"><Input name="base_unit" required placeholder="m" /></Field></div>
                <Field label="Name"><Input name="name" required /></Field>
                <Field label="Category"><Select name="category_code" required>{d.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>
                <Field label="Specification (JSON)" hint='Include "family" to enable automatic matching, e.g. {"family":"cable_xlpe","cores":4,"size_mm2":300}'><Textarea name="spec" rows={2} defaultValue="{}" /></Field>
                <div className="grid grid-cols-2 gap-3"><Field label="Keywords"><Input name="keywords" placeholder="comma separated" /></Field><Field label="Brands"><Input name="brands" placeholder="comma separated" /></Field></div>
                <Field label="Benchmark price (AED)"><Input name="benchmark_price_aed" inputMode="decimal" /></Field>
                <SubmitButton>Add material</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
