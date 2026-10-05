// Normalises and compares supplier quotes on a like-for-like basis and explains the
// recommendation. The output is advisory: a person must approve any purchase.

export interface CompareRfqItem {
  id: string;
  lineNo: number;
  description: string;
  quantity: number;
  unit: string;
  brandPref: string | null;
  materialId: string | null;
}

export interface CompareQuote {
  id: string;
  supplierOrgId: string;
  supplierName: string;
  deliveryCost: number;
  leadTimeDays: number;
  paymentTerms: string | null;
  items: {
    rfqItemId: string;
    unitPrice: number;
    quantity: number;
    availableQty: number;
    brand: string | null;
    compliant: boolean;
    leadTimeDays: number | null;
  }[];
  scorecard: { deliveries: number; onTimeRate: number | null; fillRate: number | null } | null;
  ordersWithContractor: number;
  disputesWithContractor: number;
}

export interface LineView {
  rfqItemId: string;
  unitPrice: number | null;
  lineTotal: number | null;
  shortfall: number;
  compliant: boolean | null;
  issue: string | null;
  vsBenchmarkPct: number | null;
  cheapest: boolean;
}

export interface QuoteEvaluation {
  quoteId: string;
  supplierOrgId: string;
  supplierName: string;
  quotedTotal: number;          // as submitted (lines + delivery)
  comparableTotal: number;      // gaps filled at the best competing price, so totals are like-for-like
  gapFillAmount: number;
  linesQuoted: number;
  linesComplete: number;
  nonCompliantLines: number;
  leadTimeDays: number;
  lateByDays: number;
  paymentDays: number;
  financingBenefit: number;
  onTimeRate: number | null;
  deliveries: number;
  score: number;
  eligible: boolean;
  disqualifiers: string[];
  flags: string[];
  lines: LineView[];
  breakdown: Record<string, number>;
}

export interface Comparison {
  evaluations: QuoteEvaluation[];
  recommendedQuoteId: string | null;
  headline: string;
  explanation: string;
  savings: { vsHighest: number; vsSecond: number | null; vsBenchmark: number | null; vsSecondPct: number | null };
  splitAward: { total: number; saving: number; suppliers: number } | null;
  generatedAt: string;
}

const WEIGHTS = { price: 45, reliability: 25, leadTime: 15, terms: 5, relationship: 10 };
const ANNUAL_COST_OF_CAPITAL = 0.08;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-US")}`;

export function paymentDays(terms: string | null): number {
  if (!terms) return 0;
  const t = terms.toLowerCase();
  if (/advance|prepay|cash|cod|on delivery|immediate/.test(t)) return 0;
  const m = t.match(/(\d{1,3})\s*(?:days?|d\b)/) ?? t.match(/net\s*(\d{1,3})/);
  if (m) {
    const days = Number(m[1]);
    // "PDC 60 days" etc. treated as credit days; part-advance terms halve the benefit.
    return /\d+\s*%\s*advance/.test(t) ? Math.round(days / 2) : days;
  }
  return 0;
}

export function compareQuotes(input: {
  items: CompareRfqItem[];
  quotes: CompareQuote[];
  benchmarks: Record<string, number>; // materialId -> median unit price
  daysUntilNeeded: number | null;
}): Comparison {
  const { items, quotes, benchmarks, daysUntilNeeded } = input;

  // Best (lowest) compliant unit price per line across all quotes.
  const bestPrice = new Map<string, number>();
  for (const it of items) {
    const prices = quotes.flatMap((q) => q.items.filter((qi) => qi.rfqItemId === it.id && qi.compliant && qi.availableQty >= it.quantity).map((qi) => qi.unitPrice));
    if (prices.length) bestPrice.set(it.id, Math.min(...prices));
  }

  const evals: QuoteEvaluation[] = quotes.map((q) => {
    const flags: string[] = [];
    const disqualifiers: string[] = [];
    let linesTotal = 0, gapFill = 0, quoted = 0, complete = 0, nonCompliant = 0;
    const lines: LineView[] = items.map((it) => {
      const qi = q.items.find((x) => x.rfqItemId === it.id);
      if (!qi) {
        const fill = (bestPrice.get(it.id) ?? (it.materialId ? benchmarks[it.materialId] : 0) ?? 0) * it.quantity;
        gapFill += fill;
        return { rfqItemId: it.id, unitPrice: null, lineTotal: null, shortfall: it.quantity, compliant: null, issue: "Not quoted", vsBenchmarkPct: null, cheapest: false };
      }
      quoted++;
      const qty = Math.min(qi.availableQty, it.quantity);
      const lineTotal = qi.unitPrice * it.quantity;
      linesTotal += lineTotal;
      const shortfall = Math.max(it.quantity - qi.availableQty, 0);
      if (shortfall > 0) gapFill += (bestPrice.get(it.id) ?? qi.unitPrice) * shortfall - qi.unitPrice * shortfall;
      let issue: string | null = null;
      const brandMismatch = it.brandPref && qi.brand && !qi.brand.toLowerCase().includes(it.brandPref.toLowerCase().split(/[\s/]/)[0]);
      if (!qi.compliant) { nonCompliant++; issue = "Supplier declared non-compliant with specification"; }
      else if (brandMismatch) { issue = `Offers ${qi.brand} (requested ${it.brandPref})`; }
      else if (shortfall > 0) issue = `Can supply ${qty} of ${it.quantity} ${it.unit}`;
      if (qi.compliant && shortfall === 0) complete++;
      const b = it.materialId ? benchmarks[it.materialId] : undefined;
      const vsB = b ? ((qi.unitPrice - b) / b) * 100 : null;
      if (vsB !== null && vsB > 15) flags.push(`Line ${it.lineNo}: ${vsB.toFixed(0)}% above market median`);
      if (vsB !== null && vsB < -30) flags.push(`Line ${it.lineNo}: ${Math.abs(vsB).toFixed(0)}% below market - verify specification`);
      return {
        rfqItemId: it.id, unitPrice: qi.unitPrice, lineTotal: r2(lineTotal), shortfall, compliant: qi.compliant, issue,
        vsBenchmarkPct: vsB === null ? null : r2(vsB),
        cheapest: bestPrice.get(it.id) !== undefined && qi.compliant && qi.unitPrice <= bestPrice.get(it.id)!,
      };
    });

    if (nonCompliant > 0) disqualifiers.push(`${nonCompliant} line(s) not compliant with the requested specification`);
    if (quoted === 0) disqualifiers.push("No lines quoted");
    if (quoted < items.length) flags.push(`Quoted ${quoted} of ${items.length} lines`);
    const lateBy = daysUntilNeeded === null ? 0 : Math.max(q.leadTimeDays - daysUntilNeeded, 0);
    if (lateBy > 0) flags.push(`Lead time ${q.leadTimeDays} days - ${lateBy} day(s) after the need date`);
    const pDays = paymentDays(q.paymentTerms);
    const quotedTotal = r2(linesTotal + q.deliveryCost);
    const financing = r2(quotedTotal * ANNUAL_COST_OF_CAPITAL * (pDays / 365));
    if (q.disputesWithContractor > 0) flags.push(`${q.disputesWithContractor} past dispute(s) with your company`);

    return {
      quoteId: q.id, supplierOrgId: q.supplierOrgId, supplierName: q.supplierName,
      quotedTotal, comparableTotal: r2(quotedTotal + gapFill), gapFillAmount: r2(gapFill),
      linesQuoted: quoted, linesComplete: complete, nonCompliantLines: nonCompliant,
      leadTimeDays: q.leadTimeDays, lateByDays: lateBy, paymentDays: pDays, financingBenefit: financing,
      onTimeRate: q.scorecard?.onTimeRate ?? null, deliveries: q.scorecard?.deliveries ?? 0,
      score: 0, eligible: disqualifiers.length === 0, disqualifiers, flags, lines, breakdown: {},
    };
  });
  const quoteById = new Map(quotes.map((q) => [q.id, q]));

  // Score relative to the field.
  const costs = evals.map((e) => e.comparableTotal - e.financingBenefit);
  const minCost = Math.min(...costs);
  for (const e of evals) {
    const q = quoteById.get(e.quoteId)!;
    const fill = q.scorecard?.fillRate ?? null;
    const effective = e.comparableTotal - e.financingBenefit;
    const price = minCost > 0 ? clamp(1 - ((effective - minCost) / minCost) / 0.2) : 0;
    const reliability = e.deliveries >= 3 && e.onTimeRate !== null
      ? clamp(e.onTimeRate * 0.7 + (fill ?? e.onTimeRate) * 0.3)
      : 0.6;
    const leadTime = e.lateByDays > 0 ? clamp(0.4 - e.lateByDays * 0.1) : clamp(1 - e.leadTimeDays / 30);
    const terms = clamp(e.paymentDays / 90);
    const relationship = clamp(0.5 + q.ordersWithContractor * 0.08 - q.disputesWithContractor * 0.2);
    e.breakdown = {
      price: r2(price * WEIGHTS.price), reliability: r2(reliability * WEIGHTS.reliability),
      leadTime: r2(leadTime * WEIGHTS.leadTime), terms: r2(terms * WEIGHTS.terms), relationship: r2(relationship * WEIGHTS.relationship),
    };
    const completeness = e.linesComplete / Math.max(items.length, 1);
    e.score = r2(Object.values(e.breakdown).reduce((a, b) => a + b, 0) * (0.7 + 0.3 * completeness));
  }

  evals.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
  const eligible = evals.filter((e) => e.eligible);
  const best = eligible[0] ?? null;

  // Benchmark for the whole basket.
  let benchTotal = 0, benchCovered = true;
  for (const it of items) {
    const b = it.materialId ? benchmarks[it.materialId] : undefined;
    if (b) benchTotal += b * it.quantity; else benchCovered = false;
  }

  // Split award: cheapest compliant price per line, each extra supplier adds its delivery cost.
  let splitAward: Comparison["splitAward"] = null;
  if (quotes.length > 1 && best) {
    let total = 0; const used = new Set<string>(); let feasible = true;
    for (const it of items) {
      const options = quotes.flatMap((q) => q.items.filter((qi) => qi.rfqItemId === it.id && qi.compliant && qi.availableQty >= it.quantity).map((qi) => ({ q, qi })));
      if (!options.length) { feasible = false; break; }
      const o = options.sort((a, b) => a.qi.unitPrice - b.qi.unitPrice)[0];
      total += o.qi.unitPrice * it.quantity; used.add(o.q.id);
    }
    if (feasible) {
      for (const id of used) total += quotes.find((q) => q.id === id)!.deliveryCost;
      const saving = best.comparableTotal - total;
      if (used.size > 1 && saving > Math.max(500, best.comparableTotal * 0.01)) splitAward = { total: r2(total), saving: r2(saving), suppliers: used.size };
    }
  }

  const highest = Math.max(...evals.map((e) => e.comparableTotal));
  const second = eligible[1] ?? null;
  const savings = {
    vsHighest: best ? r2(highest - best.comparableTotal) : 0,
    vsSecond: best && second ? r2(second.comparableTotal - best.comparableTotal) : null,
    vsSecondPct: best && second && second.comparableTotal > 0 ? r2(((second.comparableTotal - best.comparableTotal) / second.comparableTotal) * 100) : null,
    vsBenchmark: best && benchCovered && benchTotal > 0 ? r2(((best.comparableTotal - benchTotal) / benchTotal) * 100) : null,
  };

  const { headline, explanation } = explain(best, second, evals, savings, splitAward, items.length, daysUntilNeeded);
  return { evaluations: evals, recommendedQuoteId: best?.quoteId ?? null, headline, explanation, savings, splitAward, generatedAt: new Date().toISOString() };
}

function explain(
  best: QuoteEvaluation | null, second: QuoteEvaluation | null, all: QuoteEvaluation[],
  savings: Comparison["savings"], split: Comparison["splitAward"], nLines: number, daysUntilNeeded: number | null,
) {
  if (!best) {
    return {
      headline: "No quote can be recommended yet",
      explanation: all.length === 0
        ? "No quotes have been received."
        : "Every quote received has at least one line that does not comply with the requested specification. Ask suppliers to re-quote compliant alternatives, or amend the specification.",
    };
  }
  const parts: string[] = [];
  if (second && savings.vsSecondPct !== null) {
    if (savings.vsSecondPct > 0.05) parts.push(`are ${savings.vsSecondPct.toFixed(1)}% cheaper than the next-best compliant quote (${aed(savings.vsSecond!)} less than ${second.supplierName})`);
    else if (savings.vsSecondPct < -0.05) parts.push(`are ${Math.abs(savings.vsSecondPct).toFixed(1)}% more expensive than ${second.supplierName}, but score higher overall on reliability and delivery`);
    else parts.push(`are priced in line with ${second.supplierName}`);
  }
  parts.push(best.linesComplete === nLines ? `meet the requested specification and full quantity on all ${nLines} line(s)` : `cover ${best.linesComplete} of ${nLines} lines in full`);
  if (daysUntilNeeded !== null) {
    parts.push(best.lateByDays === 0
      ? `quote a ${best.leadTimeDays}-day lead time (needed in ${daysUntilNeeded} days)`
      : `quote a ${best.leadTimeDays}-day lead time, ${best.lateByDays} day(s) late`);
  } else {
    parts.push(`quote a ${best.leadTimeDays}-day lead time`);
  }
  if (best.onTimeRate !== null && best.deliveries >= 3) parts.push(`have a ${Math.round(best.onTimeRate * 100)}% on-time delivery rate over ${best.deliveries} verified deliveries`);
  else parts.push("have limited delivery history on the platform");
  if (best.paymentDays > 0) parts.push(`offer ${best.paymentDays}-day payment terms`);

  let explanation = `${best.supplierName} is recommended because they ${joinList(parts)}.`;
  if (savings.vsBenchmark !== null) {
    explanation += savings.vsBenchmark <= 0
      ? ` The recommended price is ${Math.abs(savings.vsBenchmark).toFixed(1)}% below the network market median for this basket.`
      : ` Note: the recommended price is ${savings.vsBenchmark.toFixed(1)}% above the network market median - consider negotiating.`;
  }
  if (best.flags.length) explanation += ` Watch-outs: ${best.flags.join("; ")}.`;
  const disq = all.filter((e) => !e.eligible);
  if (disq.length) explanation += ` ${disq.map((e) => e.supplierName).join(", ")} ${disq.length === 1 ? "was" : "were"} excluded for non-compliance.`;
  if (split) explanation += ` Alternative: splitting the award across ${split.suppliers} suppliers would save a further ${aed(split.saving)}, at the cost of coordinating multiple deliveries.`;

  return { headline: `Recommend ${best.supplierName} - ${aed(best.comparableTotal)}`, explanation };
}

function joinList(parts: string[]) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
