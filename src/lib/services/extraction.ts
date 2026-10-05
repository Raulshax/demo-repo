import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { extractText, getDocumentProxy } from "unpdf";
import { claudeEnabled, CLAUDE_MODEL, extractWithClaude } from "@/lib/ai/claude";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { one, type Tx } from "@/lib/db";
import { normaliseLine } from "@/lib/engine/normalize";
import { type RawLine, parseDate, parseRows, parseTextLines } from "@/lib/engine/parse";
import { loadCatalog } from "./catalog";

export const ACCEPTED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/vnd.ms-excel": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

export function detectKind(filename: string, mime: string) {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  if (ext === "csv") return "csv";
  if (ext === "txt") return "txt";
  return null;
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return v;
}

/** Reads a document into rows (spreadsheets) and/or text (PDF). */
export async function readDocument(bytes: Buffer, filename: string, mime: string): Promise<{ rows: unknown[][] | null; text: string }> {
  const kind = detectKind(filename, mime);
  if (kind === "csv" || kind === "txt") {
    const text = bytes.toString("utf8");
    if (kind === "txt") return { rows: null, text };
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    return { rows: parsed.data, text };
  }
  if (kind === "xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const all: unknown[][] = [];
    wb.eachSheet((ws) => {
      ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
        all.push(vals);
      });
    });
    const text = all.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? ""))).join("\t")).join("\n");
    return { rows: all, text };
  }
  if (kind === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return { rows: null, text: (text as string[]).join("\n") };
  }
  throw new Error("Unsupported file type. Upload a PDF, Excel (.xlsx) or CSV file.");
}

interface ExtractedLine extends RawLine { engineWarnings: string[] }

/**
 * Extracts requirements from an uploaded document and stores them as DRAFT requirements
 * for human review. Nothing is sent to suppliers and no commitment is created here.
 */
export async function runExtraction(tx: Tx, user: SessionUser, documentId: string) {
  const doc = await one<{ id: string; project_id: string; filename: string; mime_type: string; content: Buffer; location: string | null }>(tx,
    `select d.id, d.project_id, d.filename, d.mime_type, d.content, p.location from documents d join projects p on p.id = d.project_id where d.id = $1`, [documentId]);
  if (!doc) throw new Error("Document not found");
  await tx.query("update documents set status = 'processing' where id = $1", [documentId]);

  const { rows: sheet, text } = await readDocument(doc.content, doc.filename, doc.mime_type);
  const warnings: string[] = [];
  let engine = "rules";
  let lines: ExtractedLine[] = [];

  if (claudeEnabled()) {
    try {
      const { result, model } = await extractWithClaude({ mimeType: doc.mime_type, bytes: doc.content, text, filename: doc.filename });
      engine = `claude:${model ?? CLAUDE_MODEL}`;
      warnings.push(...result.warnings);
      lines = result.items.filter((i) => i.quantity > 0).map((i, idx) => ({
        lineNo: idx + 1, ref: i.ref, rawText: [i.ref, i.description, i.quantity, i.unit, i.brand].filter(Boolean).join(" | "),
        description: i.description, quantity: i.quantity, unit: i.unit, brand: i.brand,
        requiredDate: parseDate(i.required_date), location: i.location, notes: i.notes, section: i.section, engineWarnings: [],
      }));
    } catch (err) {
      warnings.push(`AI extraction unavailable (${err instanceof Error ? err.message : "error"}); used the rules engine instead.`);
      engine = "rules (AI fallback)";
    }
  }
  if (lines.length === 0) {
    const parsed = sheet ? parseRows(sheet) : parseTextLines(text);
    warnings.push(...parsed.warnings);
    lines = parsed.lines.map((l) => ({ ...l, engineWarnings: [] }));
  }

  const catalog = await loadCatalog(tx);
  // Re-extraction replaces earlier drafts from this document; confirmed rows are kept.
  await tx.query("delete from requirements where document_id = $1 and status = 'draft'", [documentId]);

  let matched = 0;
  for (const l of lines) {
    const n = normaliseLine({ description: l.description, quantity: l.quantity, unit: l.unit }, catalog);
    if (n.materialId) matched++;
    const notes = [l.section ? `Section: ${l.section}` : null, l.notes, ...n.warnings].filter(Boolean).join(" · ") || null;
    await tx.query(
      `insert into requirements (org_id, project_id, document_id, line_no, raw_text, description, category_code, material_id, spec,
         quantity, unit, brand, required_date, location, notes, status, confidence, match_method, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft',$16,$17,$18)`,
      [user.orgId, doc.project_id, documentId, l.lineNo, l.rawText, l.description, n.categoryCode, n.materialId, JSON.stringify(n.spec),
       n.quantity, n.unit || l.unit || "pcs", l.brand, l.requiredDate, l.location ?? doc.location, notes, n.confidence, n.method, user.userId]);
  }

  const summary = `${lines.length} line(s) extracted, ${matched} matched to the material database`;
  const extraction = { engine, lines: lines.length, matched, warnings, extracted_at: new Date().toISOString() };
  await tx.query("update documents set status = $2, extraction = $3 where id = $1",
    [documentId, lines.length ? "extracted" : "failed", JSON.stringify(extraction)]);
  await tx.query(`insert into ai_runs (org_id, kind, subject_id, engine, status, summary, output, created_by)
                  values ($1,'extraction',$2,$3,$4,$5,$6,$7)`,
    [user.orgId, documentId, engine, engine.includes("fallback") ? "fallback" : "succeeded", summary, JSON.stringify(extraction), user.userId]);
  await audit(tx, user, "document", documentId, "extracted", { engine, lines: lines.length, matched });
  return extraction;
}
