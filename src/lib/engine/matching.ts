// Recommends a short list (3-5) of suppliers for an RFQ instead of broadcasting to everyone.

export interface MatchItem {
  id: string;
  materialId: string | null;
  categoryCode: string | null;
  quantity: number;
}

export interface SupplierCandidate {
  orgId: string;
  name: string;
  categories: string[];
  emirates: string[];
  defaultLeadTimeDays: number;
  deliveryCapability: "own_fleet" | "third_party" | "collection_only";
  verified: boolean;
  products: { materialId: string; unitPrice: number | null; stockQty: number; leadTimeDays: number | null }[];
  scorecard: { deliveries: number; onTimeRate: number | null; fillRate: number | null; disputes: number } | null;
  history: { ordersWithContractor: number; disputesWithContractor: number };
}

export interface MatchResult {
  orgId: string;
  name: string;
  score: number;
  coverage: number;
  exactCoverage: number;
  reasons: string[];
  risks: string[];
  breakdown: Record<string, number>;
  serves: boolean;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const parentOf = (code: string | null) => (code ? code.split("-")[0] : null);

export const WEIGHTS = { coverage: 35, price: 20, reliability: 20, leadTime: 10, logistics: 10, relationship: 5 };

export function matchSuppliers(input: {
  items: MatchItem[];
  emirate: string;
  daysUntilNeeded: number | null;
  benchmarks: Record<string, number>; // materialId -> network median unit price
  suppliers: SupplierCandidate[];
  limit?: number;
}): { recommended: MatchResult[]; others: MatchResult[] } {
  const { items, emirate, daysUntilNeeded, benchmarks } = input;
  const results: MatchResult[] = [];
  const totalWeight = items.length || 1;

  for (const s of input.suppliers) {
    const reasons: string[] = [];
    const risks: string[] = [];
    const byMaterial = new Map(s.products.map((p) => [p.materialId, p]));

    // 1. Coverage: exact catalogue listing = full credit, category-only = partial credit.
    let covered = 0, exact = 0, stockShort = 0;
    for (const it of items) {
      const p = it.materialId ? byMaterial.get(it.materialId) : undefined;
      if (p) {
        covered += 1; exact += 1;
        if (p.stockQty < it.quantity) stockShort += 1;
      } else if (it.categoryCode && (s.categories.includes(it.categoryCode) || s.categories.includes(parentOf(it.categoryCode)!))) {
        covered += 0.5;
      }
    }
    const coverage = covered / totalWeight;
    if (coverage === 0) continue;
    if (exact > 0) reasons.push(`Lists ${exact} of ${items.length} requested items in its catalogue`);
    else reasons.push(`Supplies the requested categories (items not individually listed)`);
    if (stockShort > 0) risks.push(`Stock on hand below requested quantity for ${stockShort} item(s)`);

    // 2. Price: catalogue prices vs network median for the listed items.
    let spend = 0, bench = 0;
    for (const it of items) {
      const p = it.materialId ? byMaterial.get(it.materialId) : undefined;
      const b = it.materialId ? benchmarks[it.materialId] : undefined;
      if (p?.unitPrice && b) { spend += p.unitPrice * it.quantity; bench += b * it.quantity; }
    }
    let priceScore = 0.5;
    if (bench > 0) {
      const index = spend / bench;
      priceScore = clamp(1 - (index - 0.9) / 0.25);
      const diff = (index - 1) * 100;
      if (diff <= -1) reasons.push(`Catalogue prices ~${Math.abs(diff).toFixed(1)}% below network median`);
      else if (diff >= 3) risks.push(`Catalogue prices ~${diff.toFixed(1)}% above network median`);
    }

    // 3. Reliability from verified deliveries across the platform.
    let reliability = 0.6;
    const sc = s.scorecard;
    if (sc && sc.deliveries >= 3 && sc.onTimeRate !== null) {
      reliability = clamp(sc.onTimeRate * 0.65 + (sc.fillRate ?? sc.onTimeRate) * 0.35 - Math.min(sc.disputes, 5) * 0.02);
      if (sc.onTimeRate >= 0.9) reasons.push(`${pct(sc.onTimeRate)} on-time across ${sc.deliveries} verified deliveries`);
      else if (sc.onTimeRate < 0.8) risks.push(`On-time rate ${pct(sc.onTimeRate)} across ${sc.deliveries} deliveries`);
      if (sc.fillRate !== null && sc.fillRate < 0.95) risks.push(`Fill rate ${pct(sc.fillRate)} (short deliveries)`);
    } else {
      risks.push("Limited delivery history on the platform");
    }

    // 4. Lead time vs need date.
    const leads = s.products.filter((p) => items.some((i) => i.materialId === p.materialId)).map((p) => p.leadTimeDays ?? s.defaultLeadTimeDays);
    const lead = leads.length ? Math.max(...leads) : s.defaultLeadTimeDays;
    let leadScore = clamp(1 - lead / 21);
    if (daysUntilNeeded !== null) {
      if (lead <= daysUntilNeeded) { leadScore = Math.max(leadScore, 0.7); reasons.push(`Typical lead time ${lead} day(s); needed in ${daysUntilNeeded}`); }
      else { leadScore = 0; risks.push(`Typical lead time ${lead} days exceeds the ${daysUntilNeeded} days available`); }
    }

    // 5. Logistics: serves the delivery emirate and can deliver.
    const serves = s.emirates.map((e) => e.toLowerCase()).includes(emirate.toLowerCase());
    let logistics = serves ? 0.7 : 0.1;
    if (s.deliveryCapability === "own_fleet") logistics += 0.3;
    else if (s.deliveryCapability === "collection_only") { logistics -= 0.4; risks.push("Collection only - no delivery"); }
    logistics = clamp(logistics);
    if (serves) reasons.push(`Delivers to ${emirate}${s.deliveryCapability === "own_fleet" ? " with own fleet" : ""}`);
    else risks.push(`Does not list ${emirate} as a delivery area`);

    // 6. Relationship with this contractor.
    let relationship = 0.5;
    if (s.history.ordersWithContractor > 0) {
      relationship = clamp(0.6 + s.history.ordersWithContractor * 0.08 - s.history.disputesWithContractor * 0.2);
      reasons.push(`${s.history.ordersWithContractor} previous order(s) with your company`);
    }
    if (s.history.disputesWithContractor > 0) risks.push(`${s.history.disputesWithContractor} dispute(s) with your company`);
    if (!s.verified) risks.push("Trade licence not yet verified by the platform");

    const breakdown = {
      coverage: coverage * WEIGHTS.coverage,
      price: priceScore * WEIGHTS.price,
      reliability: reliability * WEIGHTS.reliability,
      leadTime: leadScore * WEIGHTS.leadTime,
      logistics: logistics * WEIGHTS.logistics,
      relationship: relationship * WEIGHTS.relationship,
    };
    const score = Object.values(breakdown).reduce((a, b) => a + b, 0) - (s.verified ? 0 : 5);
    results.push({
      orgId: s.orgId, name: s.name, score: Math.round(score * 10) / 10, coverage, exactCoverage: exact / totalWeight,
      reasons, risks, breakdown, serves,
    });
  }

  results.sort((a, b) => b.score - a.score);
  const limit = input.limit ?? 5;
  // Recommend 3-5: always the top 3 eligible, plus up to 2 more that are close to the leader.
  // Suppliers that deliver to the project's emirate come first; others only fill a short list.
  const qualified = results.filter((r) => r.coverage >= 0.3 && r.score >= 35);
  const local = qualified.filter((r) => r.serves);
  const eligible = local.length >= 3 ? local : [...local, ...qualified.filter((r) => !r.serves)].slice(0, Math.max(3, local.length));
  const top = eligible.slice(0, 3);
  for (const r of eligible.slice(3, limit)) if (r.score >= eligible[0].score * 0.8) top.push(r);
  const ids = new Set(top.map((r) => r.orgId));
  return { recommended: top, others: results.filter((r) => !ids.has(r.orgId)) };
}
