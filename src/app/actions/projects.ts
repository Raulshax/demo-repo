"use server";

import { revalidatePath } from "next/cache";
import { attempt, done, fail, numOf, optStr, str } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { CONTRACTOR_WRITERS, requireUser } from "@/lib/auth";
import { one, withActor } from "@/lib/db";
import { detectKind, runExtraction } from "@/lib/services/extraction";
import { normaliseLine } from "@/lib/engine/normalize";
import { loadCatalog } from "@/lib/services/catalog";
import { createRfqFromRequirements } from "@/lib/services/rfq";

export async function createProject(fd: FormData) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  let id = "";
  await attempt("/projects", async () => {
    const name = str(fd, "name"), code = str(fd, "code").toUpperCase();
    if (!name || !code) throw new Error("Project name and code are required.");
    id = await withActor(user, async (tx) => {
      const p = await one<{ id: string }>(tx,
        `insert into projects (org_id, code, name, client_name, location, emirate, start_date, end_date, budget_aed, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [user.orgId, code, name, optStr(fd, "client_name"), optStr(fd, "location"), str(fd, "emirate") || "Dubai",
         optStr(fd, "start_date"), optStr(fd, "end_date"), numOf(fd, "budget_aed"), user.userId]);
      await audit(tx, user, "project", p!.id, "created", { code, name });
      return p!.id;
    }).catch((e) => { throw /unique/.test(String(e)) ? new Error(`Project code ${code} is already in use.`) : e; });
  });
  done(`/projects/${id}`, "Project created. Upload a BOQ or procurement list to get started.");
}

const MAX_UPLOAD = 15 * 1024 * 1024;

export async function uploadDocument(projectId: string, fd: FormData) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  const path = `/projects/${projectId}`;
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) fail(path, "Choose a file to upload.");
  if (file.size > MAX_UPLOAD) fail(path, "Files must be 15 MB or smaller.");
  if (!detectKind(file.name, file.type)) fail(path, "Upload a PDF, Excel (.xlsx) or CSV file.");
  let docId = "";
  let summary = "";
  await attempt(path, async () => {
    const bytes = Buffer.from(await file.arrayBuffer());
    docId = await withActor(user, async (tx) => {
      const d = await one<{ id: string }>(tx,
        `insert into documents (org_id, project_id, filename, mime_type, size_bytes, content, kind, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [user.orgId, projectId, file.name, file.type || "application/octet-stream", file.size, bytes, str(fd, "kind") || "boq", user.userId]);
      await audit(tx, user, "document", d!.id, "uploaded", { filename: file.name });
      return d!.id;
    });
    // Extraction runs in its own transaction so a failure keeps the uploaded file.
    const r = await withActor(user, (tx) => runExtraction(tx, user, docId)).catch(async (e) => {
      await withActor(user, (tx) => tx.query("update documents set status = 'failed', extraction = $2 where id = $1",
        [docId, JSON.stringify({ error: e instanceof Error ? e.message : String(e) })]));
      throw e;
    });
    summary = `${r.lines} lines extracted, ${r.matched} matched to the material database.`;
  });
  done(`${path}/documents/${docId}`, `Here's what you need to buy: ${summary} Review before confirming.`);
}

export async function reextract(projectId: string, docId: string) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  const path = `/projects/${projectId}/documents/${docId}`;
  await attempt(path, async () => { await withActor(user, (tx) => runExtraction(tx, user, docId)); });
  done(path, "Document re-processed.");
}

interface RowInput {
  id: string; include: boolean; description: string; material_id: string | null; quantity: number; unit: string;
  brand: string | null; required_date: string | null; location: string | null; notes: string | null;
}

/** Saves the human-reviewed requirement lines; optionally confirms them for sourcing. */
export async function saveRequirements(projectId: string, back: string, fd: FormData) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  const intent = str(fd, "intent");
  let confirmed = 0;
  await attempt(back, async () => {
    const input = JSON.parse(str(fd, "rows") || "[]") as RowInput[];
    await withActor(user, async (tx) => {
      const catalog = await loadCatalog(tx);
      for (const r of input) {
        if (!r.include) {
          if (intent === "confirm") await tx.query("update requirements set status = 'cancelled' where id = $1 and project_id = $2 and status = 'draft'", [r.id, projectId]);
          continue;
        }
        if (!(r.quantity > 0)) throw new Error(`Quantity must be greater than zero ("${r.description}").`);
        const mat = r.material_id ? catalog.find((m) => m.id === r.material_id) : null;
        const status = intent === "confirm" ? "confirmed" : undefined;
        await tx.query(
          `update requirements set description = $3, material_id = $4, category_code = coalesce($5, category_code), spec = coalesce($6, spec),
             quantity = $7, unit = $8, brand = $9, required_date = $10, location = $11, notes = $12,
             status = coalesce($13, status), confidence = case when $4::uuid is distinct from material_id then 1 else confidence end,
             match_method = case when $4::uuid is distinct from material_id then 'manual' else match_method end
           where id = $1 and project_id = $2 and status in ('draft','confirmed')`,
          [r.id, projectId, r.description, r.material_id || null, mat?.category_code ?? null, mat ? JSON.stringify(mat.spec) : null,
           r.quantity, r.unit, r.brand || null, r.required_date || null, r.location || null, r.notes || null, status ?? null]);
        if (status) confirmed++;
      }
      await audit(tx, user, "requirements", projectId, intent === "confirm" ? "confirmed" : "edited", { lines: input.filter((r) => r.include).length });
    });
  });
  revalidatePath(`/projects/${projectId}`);
  done(intent === "confirm" ? `/projects/${projectId}#requirements` : back,
    intent === "confirm" ? `${confirmed} requirement(s) confirmed. Select lines and create an RFQ.` : "Changes saved.");
}

export async function addRequirement(projectId: string, fd: FormData) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  const path = `/projects/${projectId}`;
  await attempt(path, async () => {
    const description = str(fd, "description");
    const quantity = numOf(fd, "quantity");
    if (!description || !quantity || quantity <= 0) throw new Error("Description and a positive quantity are required.");
    await withActor(user, async (tx) => {
      const n = normaliseLine({ description, quantity, unit: str(fd, "unit") }, await loadCatalog(tx));
      await tx.query(
        `insert into requirements (org_id, project_id, raw_text, description, category_code, material_id, spec, quantity, unit, brand, required_date,
           status, confidence, match_method, notes, created_by)
         values ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12,$13,$14)`,
        [user.orgId, projectId, description, n.categoryCode, n.materialId, JSON.stringify(n.spec), n.quantity, n.unit || str(fd, "unit") || "pcs",
         optStr(fd, "brand"), optStr(fd, "required_date"), n.confidence, n.method, n.warnings.join(" · ") || null, user.userId]);
    });
  });
  done(`${path}#requirements`, "Line added as a draft - review the match and confirm it.");
}

export async function createRfq(projectId: string, fd: FormData) {
  const user = await requireUser(CONTRACTOR_WRITERS);
  const path = `/projects/${projectId}`;
  const ids = fd.getAll("req").map(String);
  let rfqId = "";
  await attempt(path, async () => {
    if (!ids.length) throw new Error("Select the confirmed requirements to include in the RFQ.");
    const r = await withActor(user, (tx) => createRfqFromRequirements(tx, user, projectId, ids, str(fd, "title") || "Material RFQ"));
    rfqId = r.id;
  });
  done(`/rfqs/${rfqId}`, "RFQ drafted. Review the recommended suppliers, then send.");
}
