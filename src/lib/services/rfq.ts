import "server-only";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { one, rows, type Tx } from "@/lib/db";
import { type CompareQuote, type Comparison, compareQuotes } from "@/lib/engine/compare";
import { type SupplierCandidate, matchSuppliers } from "@/lib/engine/matching";
import { daysFromToday } from "@/lib/format";
import { benchmarks } from "./catalog";

export async function createRfqFromRequirements(tx: Tx, user: SessionUser, projectId: string, requirementIds: string[], title: string) {
  const reqs = await rows<{ id: string; material_id: string | null; category_code: string | null; description: string; spec: object;
    quantity: number; unit: string; brand: string | null; required_date: string | null; status: string }>(tx,
    `select id, material_id, category_code, description, spec, quantity, unit, brand, required_date, status
     from requirements where project_id = $1 and id = any($2) order by line_no nulls last, created_at`, [projectId, requirementIds]);
  if (!reqs.length) throw new Error("Select at least one requirement.");
  const bad = reqs.filter((r) => r.status !== "confirmed");
  if (bad.length) throw new Error("Only confirmed requirements can be added to an RFQ. Review and confirm draft lines first.");
  const project = await one<{ location: string; emirate: string }>(tx, "select location, emirate from projects where id = $1", [projectId]);
  const neededBy = reqs.map((r) => r.required_date).filter(Boolean).sort()[0] ?? null;

  const rfq = await one<{ id: string; number: string }>(tx,
    `insert into rfqs (org_id, project_id, title, needed_by, quote_due, delivery_location, delivery_emirate, created_by)
     values ($1,$2,$3,$4, current_date + 3, $5, $6, $7) returning id, number`,
    [user.orgId, projectId, title, neededBy, project?.location, project?.emirate ?? "Dubai", user.userId]);
  // Consolidate demand: requirements for the same catalogue material, brand and unit become one RFQ line.
  const lines: { reqs: typeof reqs; quantity: number }[] = [];
  for (const r of reqs) {
    const same = r.material_id && lines.find((l) => l.reqs[0].material_id === r.material_id
      && (l.reqs[0].brand ?? "").toLowerCase() === (r.brand ?? "").toLowerCase() && l.reqs[0].unit === r.unit);
    if (same) { same.reqs.push(r); same.quantity += Number(r.quantity); }
    else lines.push({ reqs: [r], quantity: Number(r.quantity) });
  }
  const names = new Map((await rows<{ id: string; name: string }>(tx, "select id, name from materials where id = any($1)",
    [reqs.map((r) => r.material_id).filter(Boolean)])).map((m) => [m.id, m.name]));
  for (const [i, l] of lines.entries()) {
    const r = l.reqs[0];
    const description = l.reqs.length > 1 && r.material_id ? names.get(r.material_id) ?? r.description : r.description;
    await tx.query(
      `insert into rfq_items (rfq_id, org_id, requirement_id, requirement_ids, line_no, material_id, category_code, description, spec, quantity, unit, brand_pref)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [rfq!.id, user.orgId, r.id, l.reqs.map((x) => x.id), i + 1, r.material_id, r.category_code, description, JSON.stringify(r.spec), l.quantity, r.unit, r.brand]);
  }
  await tx.query("update requirements set status = 'in_rfq' where id = any($1)", [reqs.map((r) => r.id)]);
  await audit(tx, user, "rfq", rfq!.id, "created", { number: rfq!.number, lines: lines.length, requirements: reqs.length });
  await recommendSuppliers(tx, user, rfq!.id);
  return rfq!;
}

/** Scores the supplier network for this RFQ and stores 3-5 recommendations (not yet sent). */
export async function recommendSuppliers(tx: Tx, user: SessionUser, rfqId: string) {
  const rfq = await one<{ id: string; status: string; delivery_emirate: string; needed_by: string | null }>(tx,
    "select id, status, delivery_emirate, needed_by from rfqs where id = $1", [rfqId]);
  if (!rfq) throw new Error("RFQ not found");
  const items = await rows<{ id: string; material_id: string | null; category_code: string | null; quantity: number }>(tx,
    "select id, material_id, category_code, quantity from rfq_items where rfq_id = $1", [rfqId]);

  const candidates = await supplierCandidates(tx, user.orgId);
  const bench = await benchmarks(tx, items.map((i) => i.material_id));
  const result = matchSuppliers({
    items: items.map((i) => ({ id: i.id, materialId: i.material_id, categoryCode: i.category_code, quantity: i.quantity })),
    emirate: rfq.delivery_emirate, daysUntilNeeded: daysFromToday(rfq.needed_by), benchmarks: bench, suppliers: candidates,
  });

  // Keep invitations already sent; refresh only the unsent recommendations.
  await tx.query("delete from rfq_invitations where rfq_id = $1 and status = 'recommended'", [rfqId]);
  const sent = new Set((await rows<{ supplier_org_id: string }>(tx, "select supplier_org_id from rfq_invitations where rfq_id = $1", [rfqId])).map((r) => r.supplier_org_id));
  const all = [...result.recommended.map((r) => ({ ...r, selected: true })), ...result.others.map((r) => ({ ...r, selected: false }))];
  for (const r of all) {
    if (sent.has(r.orgId)) continue;
    await tx.query(
      `insert into rfq_invitations (rfq_id, org_id, supplier_org_id, status, match_score, match_reasons, selected)
       values ($1,$2,$3,'recommended',$4,$5,$6)`,
      [rfqId, user.orgId, r.orgId, r.score, JSON.stringify({ reasons: r.reasons, risks: r.risks, breakdown: r.breakdown, coverage: r.coverage }), r.selected]);
  }
  await tx.query(`insert into ai_runs (org_id, kind, subject_id, engine, summary, output, created_by) values ($1,'supplier_matching',$2,'rules',$3,$4,$5)`,
    [user.orgId, rfqId, `Recommended ${result.recommended.length} of ${all.length} eligible suppliers`,
     JSON.stringify({ recommended: result.recommended.map((r) => ({ name: r.name, score: r.score })) }), user.userId]);
  return result;
}

export async function supplierCandidates(tx: Tx, contractorOrgId: string): Promise<SupplierCandidate[]> {
  const profiles = await rows<{ org_id: string; name: string; categories: string[]; emirates: string[]; default_lead_time_days: number;
    delivery_capability: SupplierCandidate["deliveryCapability"]; verified: boolean }>(tx,
    `select sp.org_id, o.name, sp.categories, sp.emirates, sp.default_lead_time_days, sp.delivery_capability, sp.verified
     from supplier_profiles sp join organizations o on o.id = sp.org_id where o.status = 'active'`);
  const products = await rows<{ supplier_org_id: string; material_id: string; unit_price_aed: number | null; stock_qty: number; lead_time_days: number | null }>(tx,
    "select supplier_org_id, material_id, unit_price_aed, stock_qty, lead_time_days from supplier_products");
  const cards = await rows<{ supplier_org_id: string; deliveries: number; on_time_rate: number | null; fill_rate: number | null; disputes: number }>(tx,
    "select * from supplier_scorecards()");
  const hist = await rows<{ supplier_org_id: string; orders: number; disputes: number }>(tx,
    `select s.id as supplier_org_id,
            (select count(*)::int from purchase_orders po where po.supplier_org_id = s.id and po.org_id = $1) as orders,
            (select count(*)::int from disputes d where d.supplier_org_id = s.id and d.org_id = $1) as disputes
     from organizations s where s.kind = 'supplier'`, [contractorOrgId]);
  return profiles.map((p) => {
    const c = cards.find((x) => x.supplier_org_id === p.org_id);
    const h = hist.find((x) => x.supplier_org_id === p.org_id);
    return {
      orgId: p.org_id, name: p.name, categories: p.categories, emirates: p.emirates, defaultLeadTimeDays: p.default_lead_time_days,
      deliveryCapability: p.delivery_capability, verified: p.verified,
      products: products.filter((x) => x.supplier_org_id === p.org_id).map((x) => ({
        materialId: x.material_id, unitPrice: x.unit_price_aed, stockQty: x.stock_qty, leadTimeDays: x.lead_time_days })),
      scorecard: c ? { deliveries: c.deliveries, onTimeRate: c.on_time_rate, fillRate: c.fill_rate, disputes: c.disputes } : null,
      history: { ordersWithContractor: h?.orders ?? 0, disputesWithContractor: h?.disputes ?? 0 },
    };
  });
}

export async function sendRfq(tx: Tx, user: SessionUser, rfqId: string, supplierIds: string[], quoteDue: string | null) {
  const rfq = await one<{ status: string; number: string }>(tx, "select status, number from rfqs where id = $1", [rfqId]);
  if (!rfq) throw new Error("RFQ not found");
  if (!["draft", "sent"].includes(rfq.status)) throw new Error("This RFQ can no longer be sent.");
  if (!supplierIds.length) throw new Error("Select at least one supplier.");
  if (supplierIds.length > 8) throw new Error("Send to at most 8 suppliers - targeted RFQs get better responses.");
  const r = await tx.query(
    `update rfq_invitations set status = 'invited', invited_at = now(), selected = true
     where rfq_id = $1 and supplier_org_id = any($2) and status = 'recommended'`, [rfqId, supplierIds]);
  await tx.query("update rfqs set status = 'sent', sent_at = coalesce(sent_at, now()), quote_due = coalesce($2::date, quote_due) where id = $1", [rfqId, quoteDue || null]);
  await audit(tx, user, "rfq", rfqId, "sent", { number: rfq.number, suppliers: r.rowCount });
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------
export interface RfqItemRow { id: string; line_no: number; description: string; quantity: number; unit: string; brand_pref: string | null; material_id: string | null; spec: Record<string, unknown> }

export async function buildComparison(tx: Tx, user: SessionUser, rfqId: string): Promise<{ comparison: Comparison; items: RfqItemRow[]; benchmarks: Record<string, number> } | null> {
  const rfq = await one<{ needed_by: string | null }>(tx, "select needed_by from rfqs where id = $1", [rfqId]);
  if (!rfq) return null;
  const items = await rows<RfqItemRow>(tx, "select id, line_no, description, quantity, unit, brand_pref, material_id, spec from rfq_items where rfq_id = $1 order by line_no", [rfqId]);
  const quotes = await rows<{ id: string; supplier_org_id: string; name: string; delivery_cost: number; lead_time_days: number; payment_terms: string | null }>(tx,
    `select q.id, q.supplier_org_id, o.name, q.delivery_cost, q.lead_time_days, q.payment_terms
     from quotes q join organizations o on o.id = q.supplier_org_id where q.rfq_id = $1 and q.status <> 'withdrawn'`, [rfqId]);
  if (!quotes.length) return { comparison: compareQuotes({ items: [], quotes: [], benchmarks: {}, daysUntilNeeded: null }), items, benchmarks: {} };
  const qItems = await rows<{ quote_id: string; rfq_item_id: string; unit_price: number; quantity: number; available_qty: number; brand: string | null; compliant: boolean; lead_time_days: number | null }>(tx,
    "select quote_id, rfq_item_id, unit_price, quantity, available_qty, brand, compliant, lead_time_days from quote_items where quote_id = any($1)", [quotes.map((q) => q.id)]);
  const candidates = await supplierCandidates(tx, user.orgId);
  const bench = await benchmarks(tx, items.map((i) => i.material_id));

  const cq: CompareQuote[] = quotes.map((q) => {
    const c = candidates.find((x) => x.orgId === q.supplier_org_id);
    return {
      id: q.id, supplierOrgId: q.supplier_org_id, supplierName: q.name, deliveryCost: q.delivery_cost, leadTimeDays: q.lead_time_days, paymentTerms: q.payment_terms,
      items: qItems.filter((i) => i.quote_id === q.id).map((i) => ({ rfqItemId: i.rfq_item_id, unitPrice: i.unit_price, quantity: i.quantity,
        availableQty: i.available_qty, brand: i.brand, compliant: i.compliant, leadTimeDays: i.lead_time_days })),
      scorecard: c?.scorecard ? { deliveries: c.scorecard.deliveries, onTimeRate: c.scorecard.onTimeRate, fillRate: c.scorecard.fillRate } : null,
      ordersWithContractor: c?.history.ordersWithContractor ?? 0, disputesWithContractor: c?.history.disputesWithContractor ?? 0,
    };
  });
  const comparison = compareQuotes({
    items: items.map((i) => ({ id: i.id, lineNo: i.line_no, description: i.description, quantity: i.quantity, unit: i.unit, brandPref: i.brand_pref, materialId: i.material_id })),
    quotes: cq, benchmarks: bench, daysUntilNeeded: daysFromToday(rfq.needed_by),
  });
  return { comparison, items, benchmarks: bench };
}

/** A procurement user asks a manager to approve buying from a chosen quote. */
export async function requestApproval(tx: Tx, user: SessionUser, rfqId: string, quoteId: string, justification: string | null) {
  const data = await buildComparison(tx, user, rfqId);
  if (!data) throw new Error("RFQ not found");
  const { comparison } = data;
  const evaluation = comparison.evaluations.find((e) => e.quoteId === quoteId);
  if (!evaluation) throw new Error("Quote not found");
  if (!evaluation.eligible) throw new Error("This quote is not compliant with the specification and cannot be put forward.");
  if (evaluation.linesQuoted < data.items.length) throw new Error("This quote does not cover every line. Split awards are not yet supported - ask the supplier to complete the quote.");
  const follows = comparison.recommendedQuoteId === quoteId;
  if (!follows && !justification) throw new Error("Explain why you are not following the AI recommendation.");
  const existing = await one(tx, "select 1 from purchase_requests where rfq_id = $1 and status in ('pending','approved')", [rfqId]);
  if (existing) throw new Error("A purchase request already exists for this RFQ.");

  const q = await one<{ total: number; supplier_org_id: string; project_id: string; validity_days: number; submitted_at: string }>(tx,
    `select q.total, q.supplier_org_id, r.project_id, q.validity_days, q.submitted_at from quotes q join rfqs r on r.id = q.rfq_id where q.id = $1 and q.rfq_id = $2`, [quoteId, rfqId]);
  if (!q) throw new Error("Quote not found");
  const org = await one<{ settings: { high_value_threshold_aed?: number } }>(tx, "select settings from organizations where id = $1", [user.orgId]);
  const threshold = org?.settings?.high_value_threshold_aed ?? 250000;

  const pr = await one<{ id: string }>(tx,
    `insert into purchase_requests (org_id, project_id, rfq_id, quote_id, supplier_org_id, amount, high_value, justification,
       ai_recommendation, follows_ai_recommendation, requested_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [user.orgId, q.project_id, rfqId, quoteId, q.supplier_org_id, q.total, q.total > threshold, justification,
     JSON.stringify({ headline: comparison.headline, explanation: comparison.explanation, recommendedQuoteId: comparison.recommendedQuoteId,
       savings: comparison.savings, ranking: comparison.evaluations.map((e) => ({ quoteId: e.quoteId, supplier: e.supplierName, score: e.score, total: e.comparableTotal, eligible: e.eligible })) }),
     follows, user.userId]);
  await tx.query(`insert into ai_runs (org_id, kind, subject_id, engine, summary, output, created_by) values ($1,'quote_comparison',$2,'rules',$3,$4,$5)`,
    [user.orgId, rfqId, comparison.headline, JSON.stringify({ explanation: comparison.explanation, savings: comparison.savings }), user.userId]);
  await audit(tx, user, "purchase_request", pr!.id, "requested", { amount: q.total, follows_ai_recommendation: follows });
  return pr!.id;
}
