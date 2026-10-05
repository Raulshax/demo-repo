import { notFound } from "next/navigation";
import { AiPanel, ButtonLink, Card, KeyValue, PageHeader, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { RequirementsEditor, type EditorRow } from "@/components/requirements-editor";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { one, rows, withActor } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { reextract, saveRequirements } from "../../../../../actions/projects";

export default async function DocumentReview({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const user = await requireUser(CONTRACTOR_ROLES);
  const data = await withActor(user, async (tx) => {
    const doc = await one<{ id: string; filename: string; status: string; size_bytes: number; created_at: string; mime_type: string;
      extraction: { engine?: string; lines?: number; matched?: number; warnings?: string[]; error?: string } | null; project: string; code: string }>(tx,
      `select d.id, d.filename, d.status, d.size_bytes, d.created_at, d.mime_type, d.extraction, p.name as project, p.code
       from documents d join projects p on p.id = d.project_id where d.id = $1 and d.project_id = $2`, [docId, id]);
    if (!doc) return null;
    return {
      doc,
      reqs: await rows<EditorRow>(tx,
        `select id, status, raw_text, description, material_id, category_code, quantity, unit, brand, required_date::text, location, notes, confidence, match_method
         from requirements where document_id = $1 order by line_no`, [docId]),
      materials: await rows<{ id: string; name: string; category_code: string; base_unit: string }>(tx, "select id, name, category_code, base_unit from materials where active order by category_code, name"),
      categories: Object.fromEntries((await rows<{ code: string; name: string }>(tx, "select code, name from categories")).map((c) => [c.code, c.name])),
    };
  });
  if (!data) notFound();
  const { doc, reqs, materials, categories } = data;
  const x = doc.extraction ?? {};
  const canWrite = user.role !== "contractor_exec";
  const pending = reqs.filter((r) => r.status === "draft");

  return (
    <>
      <PageHeader title={doc.filename} crumbs={[{ href: "/projects", label: "Projects" }, { href: `/projects/${id}`, label: doc.code }, { href: "#", label: "Document" }]}
        subtitle={<>Uploaded {dateTime(doc.created_at)} · <StatusBadge status={doc.status} /></>}
        actions={<>
          <ButtonLink variant="secondary" href={`/api/files/document/${doc.id}`}>Open original</ButtonLink>
          {canWrite && <form action={reextract.bind(null, id, docId)}><SubmitButton variant="secondary" pendingText="Processing…">Re-run extraction</SubmitButton></form>}
        </>} />
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <AiPanel title={pending.length ? "Here's what you need to buy" : "Extraction reviewed"}
          footer="AI recommends - you decide. Edit any line, change the catalogue match, untick lines you don't need, then confirm.">
          {x.lines ?? 0} line(s) extracted from this document; {x.matched ?? 0} matched to the central material database.
          {x.warnings && x.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-warn">{x.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
        </AiPanel>
        <Card title="Extraction">
          <KeyValue items={[["Engine", x.engine?.startsWith("claude") ? `AI (${x.engine.replace("claude:", "")})` : x.engine ?? "—"], ["Lines", x.lines ?? 0], ["Matched", x.matched ?? 0], ["Size", `${Math.round(doc.size_bytes / 1024)} KB`]]} />
        </Card>
      </div>
      <Card padded={false}>
        <RequirementsEditor rows={reqs} materials={materials} categories={categories} readOnly={!canWrite}
          action={saveRequirements.bind(null, id, `/projects/${id}/documents/${docId}`)} />
      </Card>
    </>
  );
}
