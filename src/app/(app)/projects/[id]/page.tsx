import Link from "next/link";
import { notFound } from "next/navigation";
import { AiPanel, Badge, ButtonLink, Card, Empty, Field, Input, KeyValue, PageHeader, Select, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { SelectAll, SubmitButton } from "@/components/client";
import { RequirementsEditor, type EditorRow } from "@/components/requirements-editor";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { claudeEnabled } from "@/lib/ai/claude";
import { one, rows, withActor } from "@/lib/db";
import { aed, date, dateTime, daysFromToday, num } from "@/lib/format";
import { addRequirement, createRfq, saveRequirements, uploadDocument } from "../../../actions/projects";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(CONTRACTOR_ROLES);
  const data = await withActor(user, async (tx) => {
    const project = await one<{ id: string; code: string; name: string; client_name: string | null; location: string | null; emirate: string; status: string;
      start_date: string | null; end_date: string | null; budget_aed: number | null }>(tx, "select * from projects where id = $1", [id]);
    if (!project) return null;
    return {
      project,
      docs: await rows<{ id: string; filename: string; status: string; size_bytes: number; created_at: string; extraction: { engine?: string; lines?: number; matched?: number; error?: string } | null; uploader: string }>(tx,
        `select d.id, d.filename, d.status, d.size_bytes, d.created_at, d.extraction, u.full_name as uploader from documents d left join users u on u.id = d.uploaded_by
         where d.project_id = $1 order by d.created_at desc`, [id]),
      reqs: await rows<EditorRow & { material_name: string | null }>(tx,
        `select r.id, r.status, r.raw_text, r.description, r.material_id, r.category_code, r.quantity, r.unit, r.brand, r.required_date::text, r.location, r.notes,
                r.confidence, r.match_method, m.name as material_name
         from requirements r left join materials m on m.id = r.material_id where r.project_id = $1 and r.status <> 'cancelled'
         order by r.status = 'draft' desc, r.status = 'confirmed' desc, r.required_date nulls last, r.line_no`, [id]),
      materials: await rows<{ id: string; name: string; category_code: string; base_unit: string }>(tx, "select id, name, category_code, base_unit from materials where active order by category_code, name"),
      categories: Object.fromEntries((await rows<{ code: string; name: string }>(tx, "select code, name from categories")).map((c) => [c.code, c.name])),
      rfqs: await rows<{ id: string; number: string; title: string; status: string; quotes: number; created_at: string }>(tx,
        `select r.id, r.number, r.title, r.status, r.created_at, (select count(*)::int from quotes q where q.rfq_id = r.id) as quotes
         from rfqs r where r.project_id = $1 order by r.created_at desc`, [id]),
      orders: await rows<{ id: string; po_number: string; supplier: string; total: number; status: string }>(tx,
        `select po.id, po.po_number, o.name as supplier, po.total, po.status from purchase_orders po join organizations o on o.id = po.supplier_org_id
         where po.project_id = $1 order by po.issued_at desc`, [id]),
    };
  });
  if (!data) notFound();
  const { project, docs, reqs, materials, categories, rfqs, orders } = data;
  const canWrite = user.role !== "contractor_exec";
  const committed = orders.filter((o) => o.status !== "cancelled").reduce((a, o) => a + o.total, 0);
  const drafts = reqs.filter((r) => r.status === "draft");
  const confirmed = reqs.filter((r) => r.status === "confirmed");
  const active = reqs.filter((r) => !["draft", "confirmed"].includes(r.status));
  const earliest = confirmed.map((r) => r.required_date).filter(Boolean).sort()[0] ?? null;

  return (
    <>
      <PageHeader title={project.name} crumbs={[{ href: "/projects", label: "Projects" }, { href: `/projects/${id}`, label: project.code }]}
        subtitle={<>{project.location} · {project.client_name ?? "—"} · <StatusBadge status={project.status} /></>} />
      <div className="mb-8 grid grid-cols-2 gap-x-5 gap-y-6 lg:grid-cols-4">
        <Stat label="Committed (POs)" value={aed(committed)} hint={project.budget_aed ? `${Math.round((committed / project.budget_aed) * 100)}% of ${aed(project.budget_aed)} budget` : undefined} />
        <Stat label="Requirements to review" value={drafts.length} hint={drafts.length ? "AI-extracted, unconfirmed" : "None"} />
        <Stat label="Confirmed, not sourced" value={confirmed.length} hint={earliest ? `Earliest needed in ${daysFromToday(earliest)} days` : undefined} tone={earliest && (daysFromToday(earliest) ?? 99) < 7 ? "bad" : "neutral"} />
        <Stat label="RFQs / orders" value={`${rfqs.length} / ${orders.length}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {drafts.length > 0 && (
            <section id="requirements-review">
              <AiPanel title="Here's what you need to buy" footer="Extracted from your documents and matched to the central material database. Review, correct and confirm - nothing is ordered automatically.">
                {drafts.length} line(s) extracted. {drafts.filter((d) => (d.confidence ?? 0) >= 0.85).length} matched with high confidence; {drafts.filter((d) => (d.confidence ?? 0) < 0.6).length} need your attention.
              </AiPanel>
              <Card className="mt-3" padded={false}>
                <RequirementsEditor rows={drafts} materials={materials} categories={categories} readOnly={!canWrite}
                  action={saveRequirements.bind(null, id, `/projects/${id}`)} />
              </Card>
            </section>
          )}

          <Card title="Confirmed requirements" subtitle="Select lines to source together in one RFQ" padded={false}>
            <div id="requirements" />
            {confirmed.length === 0 ? <div className="p-4"><Empty title="No confirmed requirements waiting">Upload a BOQ or add lines manually, then confirm them.</Empty></div> : (
              <form action={createRfq.bind(null, id)} id="rfq-form">
                <Table>
                  <thead><tr><Th>{canWrite && <SelectAll name="req" formId="rfq-form" />}</Th><Th>Material</Th><Th right>Qty</Th><Th>Brand</Th><Th>Needed</Th></tr></thead>
                  <tbody>{confirmed.map((r) => (
                    <tr key={r.id}>
                      <Td>{canWrite && <input type="checkbox" name="req" value={r.id} defaultChecked className="h-4 w-4 accent-[var(--accent)]" aria-label="Select" />}</Td>
                      <Td><div className="font-medium">{r.material_name ?? r.description}</div>{r.material_name && r.material_name !== r.description && <div className="text-xs text-muted">{r.description}</div>}
                        {!r.material_id && <Badge tone="warn">Not in catalogue - category matching only</Badge>}</Td>
                      <Td right>{num(r.quantity)} {r.unit}</Td>
                      <Td className="text-muted">{r.brand ?? "Any"}</Td>
                      <Td className="text-muted">{date(r.required_date)}</Td>
                    </tr>))}
                  </tbody>
                </Table>
                {canWrite && (
                  <div className="flex flex-wrap items-end gap-3 border-t border-line bg-surface-2 px-4 py-3">
                    <Field label="RFQ title" className="min-w-64 flex-1"><Input name="title" defaultValue={`${project.code} - materials ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`} /></Field>
                    <SubmitButton pendingText="Matching suppliers…">Create RFQ & match suppliers</SubmitButton>
                  </div>
                )}
              </form>
            )}
          </Card>

          {active.length > 0 && (
            <Card title="Sourcing & ordered" padded={false}>
              <Table>
                <thead><tr><Th>Material</Th><Th right>Qty</Th><Th>Needed</Th><Th>Status</Th></tr></thead>
                <tbody>{active.map((r) => (
                  <tr key={r.id}><Td>{r.material_name ?? r.description}</Td><Td right>{num(r.quantity)} {r.unit}</Td><Td className="text-muted">{date(r.required_date)}</Td><Td><StatusBadge status={r.status} /></Td></tr>
                ))}</tbody>
              </Table>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="RFQs" padded={false}>
              {rfqs.length === 0 ? <div className="p-4 text-sm text-muted">None yet.</div> : (
                <ul className="divide-y divide-line">{rfqs.map((r) => (
                  <li key={r.id}><Link href={`/rfqs/${r.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-surface-2">
                    <span><span className="text-sm font-medium">{r.title}</span><span className="block text-xs text-muted">{r.number} · {r.quotes} quote(s)</span></span>
                    <StatusBadge status={r.status} /></Link></li>))}</ul>)}
            </Card>
            <Card title="Purchase orders" padded={false}>
              {orders.length === 0 ? <div className="p-4 text-sm text-muted">None yet.</div> : (
                <ul className="divide-y divide-line">{orders.map((o) => (
                  <li key={o.id}><Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-surface-2">
                    <span><span className="text-sm font-medium">{o.po_number} · {aed(o.total)}</span><span className="block text-xs text-muted">{o.supplier}</span></span>
                    <StatusBadge status={o.status} /></Link></li>))}</ul>)}
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          {canWrite && (
            <Card title="Upload BOQ / procurement list" subtitle={claudeEnabled() ? "AI document understanding (Claude) + material normalisation" : "Rules engine extraction + material normalisation"}>
              <form action={uploadDocument.bind(null, id)} className="space-y-3">
                <Input type="file" name="file" required accept=".pdf,.xlsx,.xlsm,.csv,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
                <Field label="Document type">
                  <Select name="kind" defaultValue="boq"><option value="boq">Bill of quantities</option><option value="procurement_list">Procurement / material list</option><option value="specification">Specification</option></Select>
                </Field>
                <SubmitButton className="w-full" pendingText="Reading document…">Upload & extract</SubmitButton>
                <p className="text-xs text-muted">PDF, Excel or CSV up to 15 MB. Try the samples: <a className="text-accent hover:underline" href="/samples/dubai-villa-mep-boq.xlsx">Excel BOQ</a> · <a className="text-accent hover:underline" href="/samples/dubai-villa-boq.pdf">PDF BOQ</a> · <a className="text-accent hover:underline" href="/samples/site-procurement-list.csv">CSV list</a></p>
              </form>
            </Card>
          )}
          <Card title="Documents" padded={false}>
            {docs.length === 0 ? <div className="p-4 text-sm text-muted">No documents uploaded.</div> : (
              <ul className="divide-y divide-line">{docs.map((d) => (
                <li key={d.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/projects/${id}/documents/${d.id}`} className="truncate text-sm font-medium hover:text-accent">{d.filename}</Link>
                    <StatusBadge status={d.status} />
                  </div>
                  <div className="text-xs text-muted">{dateTime(d.created_at)} · {d.uploader}{d.extraction?.lines !== undefined ? ` · ${d.extraction.lines} lines, ${d.extraction.matched} matched` : ""}</div>
                  {d.extraction?.error && <div className="text-xs text-danger">{d.extraction.error}</div>}
                </li>))}</ul>)}
          </Card>
          {canWrite && (
            <Card title="Add a line manually">
              <form action={addRequirement.bind(null, id)} className="space-y-3">
                <Field label="Material description"><Input name="description" required placeholder="4C x 16mm XLPE cable" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Quantity"><Input name="quantity" required inputMode="decimal" /></Field>
                  <Field label="Unit"><Input name="unit" placeholder="m" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Brand"><Input name="brand" placeholder="Any" /></Field>
                  <Field label="Required by"><Input name="required_date" type="date" /></Field>
                </div>
                <SubmitButton variant="secondary" className="w-full">Add & normalise</SubmitButton>
              </form>
            </Card>
          )}
          <Card title="Project details">
            <KeyValue items={[["Code", project.code], ["Emirate", project.emirate], ["Start", date(project.start_date)], ["End", date(project.end_date)], ["Budget", aed(project.budget_aed)]]} />
          </Card>
          {canWrite && <ButtonLink href="/rfqs" variant="ghost" className="w-full">All RFQs →</ButtonLink>}
        </div>
      </div>
    </>
  );
}
