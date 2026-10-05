// End-to-end extraction of the sample documents (rules engine, no network).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/engine/catalog";
import { normaliseLine, type MaterialRef } from "@/lib/engine/normalize";
import { parseRows, parseTextLines } from "@/lib/engine/parse";
import { readDocument } from "@/lib/services/extraction";

const catalog: MaterialRef[] = CATALOG.map((c) => ({ id: c.sku, sku: c.sku, name: c.name, category_code: c.category, base_unit: c.unit, spec: { ...c.spec, family: c.family } }));

async function extract(file: string, mime: string) {
  const { rows, text } = await readDocument(readFileSync(`public/samples/${file}`), file, mime);
  const parsed = rows ? parseRows(rows) : parseTextLines(text);
  return parsed.lines.map((l) => ({ line: l, n: normaliseLine({ description: l.description, quantity: l.quantity, unit: l.unit }, catalog) }));
}

describe("sample documents", () => {
  it("extracts and normalises the Excel BOQ", async () => {
    const r = await extract("dubai-villa-mep-boq.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r).toHaveLength(21);
    const skus = r.map((x) => x.n.sku);
    expect(skus.slice(0, 4)).toEqual(["CAB-XLPE-4C16", "CAB-XLPE-4C35", "WIR-PVC-2.5", "WIR-PVC-4"]);
    expect(r[2].n.quantity).toBe(6000); // 60 coils -> metres
    expect(r[0].line.requiredDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // labour-only line is extracted but not matched to a material
    expect(r[r.length - 1].n.materialId).toBeNull();
    expect(r.filter((x) => x.n.materialId).length).toBe(20);
  });

  it("extracts and normalises the PDF BOQ", async () => {
    const r = await extract("dubai-villa-boq.pdf", "application/pdf");
    expect(r.length).toBe(21);
    expect(r.filter((x) => x.n.method === "exact").length).toBeGreaterThanOrEqual(18);
    expect(r.find((x) => x.line.description.startsWith("Copper refrigerant pipe 5/8"))?.n.sku).toBe("HVP-CU-5-8");
  });

  it("extracts the free-form CSV list", async () => {
    const r = await extract("site-procurement-list.csv", "text/csv");
    expect(r.map((x) => x.n.sku)).toEqual(["CAB-XLPE-4C25", "CNT-GI-25", "CNT-TRAY-300", "FST-ANC-M12", "FST-ROD-M10", "CHM-PU-600", "CON-TIE-300"]);
  });
});
