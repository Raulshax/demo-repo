import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/engine/catalog";
import { compareQuotes, paymentDays, type CompareQuote } from "@/lib/engine/compare";
import { matchSuppliers, type SupplierCandidate } from "@/lib/engine/matching";
import { extractSpec, normaliseLine, type MaterialRef } from "@/lib/engine/normalize";
import { parseDate, parseRows, parseTextLines } from "@/lib/engine/parse";

const catalog: MaterialRef[] = CATALOG.map((c) => ({
  id: c.sku, sku: c.sku, name: c.name, category_code: c.category, base_unit: c.unit, spec: { ...c.spec, family: c.family },
}));
const norm = (description: string, quantity = 10, unit = "m") => normaliseLine({ description, quantity, unit }, catalog);

describe("spec extraction", () => {
  it("reads cable cores and cross-section", () => {
    expect(extractSpec("4C x 16mm XLPE Cable")).toMatchObject({ cores: 4, size_mm2: 16 });
    expect(extractSpec("4 core x 95 sq.mm Cu/XLPE/SWA/PVC")).toMatchObject({ cores: 4, size_mm2: 95 });
    expect(extractSpec("Cable 4x185mm2 armoured")).toMatchObject({ cores: 4, size_mm2: 185 });
  });
  it("reads ratings, gangs and inch sizes", () => {
    expect(extractSpec("MCB 32A SP 10kA")).toMatchObject({ amp: 32, poles: 1 });
    expect(extractSpec("13A 2 gang switched socket")).toMatchObject({ gang: 2, amp: 13 });
    expect(extractSpec('Copper pipe 3/8" soft')).toMatchObject({ dia_in: "3/8" });
    expect(extractSpec("PPR pipe PN20 25mm")).toMatchObject({ dia_mm: 25, pn: 20 });
  });
});

describe("normalisation against the material database", () => {
  it("normalises the canonical XLPE example exactly", () => {
    const n = norm("4C x 16mm XLPE Cable", 1200, "mtr");
    expect(n.sku).toBe("CAB-XLPE-4C16");
    expect(n.categoryCode).toBe("ELEC-CABLE");
    expect(n.unit).toBe("m");
    expect(n.method).toBe("exact");
    expect(n.confidence).toBeGreaterThan(0.9);
  });
  it("matches assorted MEP lines", () => {
    expect(norm("Single core PVC wire 2.5 sqmm", 5, "coil").sku).toBe("WIR-PVC-2.5");
    expect(norm("Single core PVC wire 2.5 sqmm", 5, "coil").quantity).toBe(500);
    expect(norm("MCB 1P 20A C curve", 40, "nos").sku).toBe("PNL-MCB-1P20");
    expect(norm("RCBO 32A 30mA", 12, "nos").sku).toBe("PNL-RCBO-32");
    expect(norm("Twin switched socket outlet 13A double gang", 80, "nos").sku).toBe("ACC-SKT-2G");
    expect(norm("13A twin switched socket outlet, white", 80, "nos").sku).toBe("ACC-SKT-2G");
    expect(norm("GI conduit 25mm", 300, "m").sku).toBe("CNT-GI-25");
    expect(norm("PVC conduit 20mm", 300, "m").sku).toBe("CNT-PVC-20");
    expect(norm("Perforated cable tray 300mm wide", 120, "m").sku).toBe("CNT-TRAY-300");
    expect(norm('Copper refrigerant pipe 5/8"', 200, "m").sku).toBe("HVP-CU-5-8");
    expect(norm("Armaflex 19mm thk pipe insulation", 200, "m").sku).toBe("INS-ARM-19");
    expect(norm("Fan coil unit 2 TR ducted", 6, "nos").sku).toBe("HVE-FCU-2");
    expect(norm("PPR elbow 25mm", 150, "nos").sku).toBe("PLF-PPR-EL25");
    expect(norm("uPVC drainage pipe 110mm", 90, "m").sku).toBe("PLP-UPVC-110");
    expect(norm('Ball valve 3/4" brass', 20, "nos").sku).toBe("PLV-BV-3-4");
    expect(norm("Anchor bolt M12", 500, "nos").sku).toBe("FST-ANC-M12");
  });
  it("proposes the closest item with low confidence when no exact size exists", () => {
    const n = norm("4C x 300mm2 XLPE SWA cable", 100, "m");
    expect(n.method).toBe("closest");
    expect(n.confidence).toBeLessThan(0.6);
    expect(n.warnings.join(" ")).toMatch(/closest/);
  });
  it("flags unrecognised items rather than guessing", () => {
    const n = norm("Marble polishing services", 1, "lot");
    expect(n.materialId).toBeNull();
    expect(n.method).toBe("unmatched");
  });
});

describe("document parsing", () => {
  it("detects BOQ headers, skips section rows and totals", () => {
    const rows = [
      ["Dubai Villa Project - MEP BOQ"],
      ["Item", "Description", "Unit", "Qty", "Brand", "Required Date", "Location", "Remarks"],
      ["A", "ELECTRICAL WORKS", "", "", "", "", "", ""],
      ["1.1", "4C x 16mm XLPE Cable", "mtr", "1,200", "Ducab", "15/11/2026", "Villa 3", ""],
      ["1.2", "MCB 1P 20A", "nos", 40, "Schneider", "15-Nov-2026", "", "C curve"],
      ["", "Sub-total", "", "", "", "", "", ""],
    ];
    const r = parseRows(rows);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ description: "4C x 16mm XLPE Cable", quantity: 1200, unit: "mtr", brand: "Ducab", requiredDate: "2026-11-15", section: "ELECTRICAL WORKS", location: "Villa 3" });
    expect(r.lines[1].requiredDate).toBe("2026-11-15");
  });
  it("parses PDF-style text lines", () => {
    const text = `ELECTRICAL WORKS\n1.1  4C x 16mm XLPE/SWA/PVC cable   1,200  m  Ducab\n1.2  MCB 1P 20A 10kA   40 nos\nTotal 12,000`;
    const r = parseTextLines(text);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ ref: "1.1", quantity: 1200, unit: "m", brand: "Ducab", section: "ELECTRICAL WORKS" });
  });
  it("parses UAE day-first dates", () => {
    expect(parseDate("03/04/2026")).toBe("2026-04-03");
    expect(parseDate("Nov 5, 2026")).toBe("2026-11-05");
  });
});

const supplier = (over: Partial<SupplierCandidate>): SupplierCandidate => ({
  orgId: "s", name: "S", categories: ["ELEC"], emirates: ["Dubai"], defaultLeadTimeDays: 3, deliveryCapability: "own_fleet",
  verified: true, products: [], scorecard: { deliveries: 20, onTimeRate: 0.95, fillRate: 0.98, disputes: 0 },
  history: { ordersWithContractor: 0, disputesWithContractor: 0 }, ...over,
});

describe("supplier matching", () => {
  it("recommends a short list ranked by fit and excludes irrelevant suppliers", () => {
    const items = [{ id: "i1", materialId: "A", categoryCode: "ELEC-CABLE", quantity: 1000 }];
    const r = matchSuppliers({
      items, emirate: "Dubai", daysUntilNeeded: 10, benchmarks: { A: 50 },
      suppliers: [
        supplier({ orgId: "good", name: "Good", products: [{ materialId: "A", unitPrice: 47, stockQty: 5000, leadTimeDays: 2 }] }),
        supplier({ orgId: "pricey", name: "Pricey", products: [{ materialId: "A", unitPrice: 58, stockQty: 5000, leadTimeDays: 2 }] }),
        supplier({ orgId: "late", name: "Late", scorecard: { deliveries: 20, onTimeRate: 0.6, fillRate: 0.8, disputes: 3 }, products: [{ materialId: "A", unitPrice: 48, stockQty: 100, leadTimeDays: 14 }] }),
        supplier({ orgId: "cat", name: "CategoryOnly", categories: ["ELEC"] }),
        supplier({ orgId: "plumb", name: "Plumbing", categories: ["PLUMB"] }),
        supplier({ orgId: "far", name: "Sharjah only", emirates: ["Sharjah"], products: [{ materialId: "A", unitPrice: 40, stockQty: 5000, leadTimeDays: 2 }] }),
      ],
    });
    // cheapest, but does not deliver to Dubai and there are enough local suppliers
    expect(r.recommended.find((x) => x.orgId === "far")).toBeUndefined();
    expect(r.recommended[0].orgId).toBe("good");
    expect(r.recommended.length).toBeGreaterThanOrEqual(3);
    expect(r.recommended.length).toBeLessThanOrEqual(5);
    expect([...r.recommended, ...r.others].find((x) => x.orgId === "plumb")).toBeUndefined();
    expect(r.recommended[0].reasons.join(" ")).toMatch(/on-time/);
  });
});

describe("quote comparison", () => {
  const items = [
    { id: "l1", lineNo: 1, description: "4C x 16mm XLPE", quantity: 1000, unit: "m", brandPref: null, materialId: "A" },
    { id: "l2", lineNo: 2, description: "MCB 20A", quantity: 40, unit: "pcs", brandPref: null, materialId: "B" },
  ];
  const quote = (id: string, p1: number, p2: number, over: Partial<CompareQuote> = {}): CompareQuote => ({
    id, supplierOrgId: id, supplierName: `Supplier ${id}`, deliveryCost: 0, leadTimeDays: 2, paymentTerms: "30 days",
    items: [
      { rfqItemId: "l1", unitPrice: p1, quantity: 1000, availableQty: 1000, brand: null, compliant: true, leadTimeDays: null },
      { rfqItemId: "l2", unitPrice: p2, quantity: 40, availableQty: 40, brand: null, compliant: true, leadTimeDays: null },
    ],
    scorecard: { deliveries: 30, onTimeRate: 0.96, fillRate: 0.99 }, ordersWithContractor: 2, disputesWithContractor: 0, ...over,
  });

  it("recommends the cheapest reliable compliant quote and explains why", () => {
    const c = compareQuotes({ items, benchmarks: { A: 50, B: 15 }, daysUntilNeeded: 9, quotes: [quote("A", 46, 14), quote("B", 48, 14.5)] });
    expect(c.recommendedQuoteId).toBe("A");
    expect(c.explanation).toMatch(/Supplier A is recommended because they are 4\.\d% cheaper/);
    expect(c.explanation).toMatch(/96% on-time/);
    expect(c.savings.vsSecond).toBeGreaterThan(0);
  });

  it("never recommends a non-compliant quote even when cheapest", () => {
    const cheapBad = quote("X", 30, 10);
    cheapBad.items[0].compliant = false;
    const c = compareQuotes({ items, benchmarks: {}, daysUntilNeeded: 9, quotes: [cheapBad, quote("B", 48, 14.5)] });
    expect(c.recommendedQuoteId).toBe("B");
    expect(c.explanation).toMatch(/excluded for non-compliance/);
  });

  it("compares partial quotes like-for-like by filling gaps", () => {
    const partial = quote("P", 40, 0);
    partial.items = partial.items.slice(0, 1);
    const c = compareQuotes({ items, benchmarks: { A: 50, B: 15 }, daysUntilNeeded: 9, quotes: [partial, quote("F", 47, 14)] });
    const p = c.evaluations.find((e) => e.quoteId === "P")!;
    expect(p.gapFillAmount).toBeCloseTo(40 * 14);
    expect(p.comparableTotal).toBeGreaterThan(p.quotedTotal);
  });

  it("penalises late delivery against the need date", () => {
    const c = compareQuotes({ items, benchmarks: {}, daysUntilNeeded: 5, quotes: [quote("Slow", 45, 14, { leadTimeDays: 20 }), quote("Fast", 46, 14)] });
    expect(c.recommendedQuoteId).toBe("Fast");
  });

  it("parses payment terms", () => {
    expect(paymentDays("60 days PDC")).toBe(60);
    expect(paymentDays("Cash on delivery")).toBe(0);
    expect(paymentDays("Net 45")).toBe(45);
  });
});
