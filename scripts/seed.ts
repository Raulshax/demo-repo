import { config } from "dotenv";
import bcrypt from "bcryptjs";
import pg from "pg";
import { CATALOG, CATEGORIES } from "../src/lib/engine/catalog";

config({ path: ".env.local" });
pg.types.setTypeParser(1700, (v) => Number(v));

const db = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
const PASSWORD = "Demo@2026";

// Deterministic pseudo-random so the demo looks the same on every reset.
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const between = (a: number, b: number) => a + (b - a) * rand();
const pickN = <T,>(arr: T[], n: number) => [...arr].sort(() => rand() - 0.5).slice(0, n);
const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const ts = (offset: number, hour = 9) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query(sql, params)).rows as T[];
}
async function id(sql: string, params: unknown[] = []) {
  return (await q<{ id: string }>(sql, params))[0].id;
}

interface SupplierDef {
  key: string; name: string; categories: string[]; emirates: string[]; lead: number;
  fleet: "own_fleet" | "third_party" | "collection_only"; priceFactor: number; onTime: number; fill: number;
  verified: boolean; terms: string; email: string; contact: string; description: string;
}

const SUPPLIERS: SupplierDef[] = [
  { key: "gulfcable", name: "Gulf Cable & Electrical Trading LLC", categories: ["ELEC-CABLE", "ELEC-WIRE", "ELEC-CONTAIN", "CONS"], emirates: ["Dubai", "Sharjah", "Abu Dhabi"], lead: 2, fleet: "own_fleet", priceFactor: 0.97, onTime: 0.96, fill: 0.99, verified: true, terms: "60 days PDC", email: "sales@gulfcable.demo", contact: "Arun Pillai", description: "Stockist of LV power cables, building wires and containment. Warehouse in Al Quoz." },
  { key: "alwaha", name: "Al Waha Electrical Supplies", categories: ["ELEC-CABLE", "ELEC-WIRE", "ELEC-ACC", "ELEC-PANEL", "ELEC-LIGHT"], emirates: ["Dubai", "Abu Dhabi"], lead: 4, fleet: "third_party", priceFactor: 0.93, onTime: 0.78, fill: 0.92, verified: true, terms: "30 days", email: "quotes@alwaha.demo", contact: "Fatima Rahman", description: "Broad-line electrical distributor with aggressive pricing." },
  { key: "emswitch", name: "Emirates Switchgear Distribution", categories: ["ELEC-PANEL", "ELEC-ACC", "ELEC-CABLE"], emirates: ["Dubai", "Sharjah", "Abu Dhabi", "Ajman"], lead: 3, fleet: "own_fleet", priceFactor: 1.04, onTime: 0.97, fill: 1.0, verified: true, terms: "45 days", email: "tenders@emswitch.demo", contact: "Michael Dsouza", description: "Authorised panel builder and switchgear distributor." },
  { key: "desertbreeze", name: "Desert Breeze HVAC Supplies", categories: ["HVAC-EQUIP", "HVAC-AIR", "HVAC-PIPE", "INSUL"], emirates: ["Dubai", "Sharjah"], lead: 5, fleet: "own_fleet", priceFactor: 1.0, onTime: 0.91, fill: 0.97, verified: true, terms: "30 days", email: "sales@desertbreeze.demo", contact: "Hassan Qureshi", description: "HVAC equipment, air distribution and refrigerant piping." },
  { key: "coolpoint", name: "Coolpoint Refrigeration Trading", categories: ["HVAC-PIPE", "INSUL", "CONS"], emirates: ["Dubai"], lead: 2, fleet: "own_fleet", priceFactor: 0.96, onTime: 0.93, fill: 0.98, verified: true, terms: "30 days", email: "orders@coolpoint.demo", contact: "Li Wei", description: "Copper pipe and insulation specialist, same-day delivery in Dubai." },
  { key: "blueline", name: "Blue Line Pipes & Fittings", categories: ["PLUMB-PIPE", "PLUMB-FIT", "PLUMB-VALVE"], emirates: ["Dubai", "Sharjah", "Ajman"], lead: 3, fleet: "own_fleet", priceFactor: 0.99, onTime: 0.9, fill: 0.96, verified: true, terms: "45 days", email: "sales@blueline.demo", contact: "George Mathew", description: "PPR, uPVC and HDPE pipe systems and valves." },
  { key: "buildchem", name: "BuildChem Middle East", categories: ["CHEM", "FAST", "INSUL"], emirates: ["Dubai", "Abu Dhabi", "Sharjah"], lead: 3, fleet: "third_party", priceFactor: 1.01, onTime: 0.88, fill: 0.97, verified: true, terms: "30 days", email: "info@buildchem.demo", contact: "Nadia Farouk", description: "Construction chemicals, waterproofing and fixings." },
  { key: "northern", name: "Northern Emirates MEP Traders", categories: ["ELEC-CABLE", "ELEC-WIRE", "ELEC-ACC", "PLUMB-PIPE"], emirates: ["Sharjah", "Ajman", "Ras Al Khaimah"], lead: 6, fleet: "third_party", priceFactor: 0.9, onTime: 0.72, fill: 0.88, verified: true, terms: "Cash on delivery", email: "sales@nemep.demo", contact: "Imran Sheikh", description: "Low-cost MEP trader serving the northern emirates." },
  { key: "atlas", name: "Atlas Fixings & Consumables", categories: ["FAST", "CONS", "ELEC-CONTAIN"], emirates: ["Dubai", "Sharjah"], lead: 2, fleet: "own_fleet", priceFactor: 0.98, onTime: 0.85, fill: 0.95, verified: false, terms: "15 days", email: "sales@atlasfix.demo", contact: "Ravi Kumar", description: "Fixings, supports and site consumables." },
];

async function main() {
  await db.connect();
  await db.query("begin");
  const hash = await bcrypt.hash(PASSWORD, 10);

  // ---------------------------------------------------------------- master data
  for (const c of CATEGORIES)
    await q("insert into categories (code, name, parent_code, wedge) values ($1,$2,$3,$4)", [c.code, c.name, c.parent ?? null, c.wedge]);
  const materialIds: Record<string, string> = {};
  for (const m of CATALOG) {
    materialIds[m.sku] = await id(
      `insert into materials (sku, category_code, name, spec, base_unit, keywords, typical_brands, benchmark_price_aed)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [m.sku, m.category, m.name, JSON.stringify({ ...m.spec, family: m.family }), m.unit, m.keywords, m.brands, m.price]);
  }
  const bySku = Object.fromEntries(CATALOG.map((m) => [m.sku, m]));

  // ---------------------------------------------------------------- organisations & users
  const platform = await id("insert into organizations (name, kind) values ('ProcureOS Platform', 'platform') returning id");
  await q("insert into users (org_id, email, full_name, title, role, password_hash) values ($1,'admin@procureos.demo','Layla Ahmed','Platform Operations','platform_admin',$2)", [platform, hash]);

  const falcon = await id(`insert into organizations (name, kind, trade_license, settings) values
    ('Falcon Crest Contracting LLC', 'contractor', 'DED-845512', '{"high_value_threshold_aed": 250000, "currency": "AED"}') returning id`);
  const meridian = await id(`insert into organizations (name, kind, trade_license, settings) values
    ('Meridian Build Contracting', 'contractor', 'DED-771093', '{"high_value_threshold_aed": 150000, "currency": "AED"}') returning id`);

  const user = (org: string, email: string, name: string, title: string, role: string) =>
    id("insert into users (org_id, email, full_name, title, role, password_hash) values ($1,$2,$3,$4,$5,$6) returning id", [org, email, name, title, role, hash]);
  const omar = await user(falcon, "omar@falconcrest.demo", "Omar Haddad", "Procurement Engineer", "contractor_user");
  const daniel = await user(falcon, "daniel@falconcrest.demo", "Daniel Okafor", "Site Engineer", "contractor_user");
  const sara = await user(falcon, "sara@falconcrest.demo", "Sara Al Mansoori", "Procurement Manager", "contractor_manager");
  await user(falcon, "rajesh@falconcrest.demo", "Rajesh Menon", "Managing Director", "contractor_exec");
  const meridianMgr = await user(meridian, "lena@meridianbuild.demo", "Lena Fischer", "Head of Procurement", "contractor_manager");
  const meridianUser = await user(meridian, "yusuf@meridianbuild.demo", "Yusuf Karim", "Buyer", "contractor_user");

  const sup: Record<string, { org: string; user: string; def: SupplierDef }> = {};
  for (const s of SUPPLIERS) {
    const org = await id("insert into organizations (name, kind, trade_license) values ($1,'supplier',$2) returning id", [s.name, `DED-${Math.floor(between(300000, 999999))}`]);
    const u = await user(org, s.email, s.contact, "Sales", "supplier");
    await q(`insert into supplier_profiles (org_id, description, categories, emirates, default_lead_time_days, delivery_capability,
               payment_terms, verified, contact_email, phone) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [org, s.description, s.categories, s.emirates, s.lead, s.fleet, s.terms, s.verified, s.email, `+971 4 ${Math.floor(between(2000000, 4999999))}`]);
    sup[s.key] = { org, user: u, def: s };
  }

  // ---------------------------------------------------------------- supplier catalogues
  const listPrice: Record<string, Record<string, number>> = {};
  for (const s of SUPPLIERS) {
    listPrice[s.key] = {};
    const items = CATALOG.filter((m) => s.categories.includes(m.category));
    for (const m of items) {
      if (rand() < 0.12) continue; // not every supplier lists everything
      const price = r2(m.price * s.priceFactor * between(0.96, 1.06));
      listPrice[s.key][m.sku] = price;
      const brand = m.brands.length ? m.brands[Math.floor(rand() * m.brands.length)] : null;
      await q(`insert into supplier_products (supplier_org_id, material_id, brand, unit_price_aed, stock_qty, lead_time_days)
               values ($1,$2,$3,$4,$5,$6)`,
        [sup[s.key].org, materialIds[m.sku], brand, price, Math.round(between(50, 6000)), Math.max(1, s.lead + Math.round(between(-1, 2)))]);
    }
  }

  // ---------------------------------------------------------------- market price index (12 months)
  for (const m of CATALOG) {
    const copper = /^(CAB|WIR|HVP|CON-LUG)/.test(m.sku);
    for (let month = 12; month >= 0; month--) {
      const trend = copper ? 1 - month * 0.007 : 1 - month * 0.002; // copper-linked items up ~8% YoY
      for (let k = 0; k < 2; k++)
        await q("insert into price_history (material_id, unit_price, source, observed_on) values ($1,$2,'market',$3)",
          [materialIds[m.sku], r2(m.price * trend * between(0.94, 1.06)), day(-month * 30 - Math.floor(between(0, 25)))]);
    }
  }

  // ---------------------------------------------------------------- projects
  const project = (org: string, code: string, name: string, client: string, location: string, budget: number, by: string, status = "active") =>
    id(`insert into projects (org_id, code, name, client_name, location, emirate, status, start_date, end_date, budget_aed, created_by)
        values ($1,$2,$3,$4,$5,'Dubai',$6,$7,$8,$9,$10) returning id`,
      [org, code, name, client, location, status, day(-200), day(320), budget, by]);
  const villa = await project(falcon, "DVP-01", "Dubai Villa Project", "Private client", "Al Barari, Dubai", 18_500_000, omar);
  const tower = await project(falcon, "MRT-02", "Marina Residential Tower - MEP", "Marina Heights Developments", "Dubai Marina, Plot 14", 96_000_000, omar);
  const warehouse = await project(falcon, "JAW-03", "Jebel Ali Logistics Warehouse", "Gulf Freight Holdings", "Jebel Ali Free Zone", 42_000_000, omar);
  await project(falcon, "BBS-04", "Business Bay Office Fit-out", "Confidential", "Business Bay, Dubai", 7_800_000, omar, "completed");
  const meridianProject = await project(meridian, "MB-HOS-1", "Al Qusais Clinic Extension", "Healthcare client", "Al Qusais, Dubai", 24_000_000, meridianMgr);

  // ---------------------------------------------------------------- procurement helper
  interface Line { sku: string; qty: number; brand?: string | null }
  interface Offer { key: string; factor: number; lead: number; delivery: number; noncompliant?: string; partialSku?: string }

  async function rfqWithQuotes(opts: {
    org: string; project: string; by: string; title: string; status: string; lines: Line[]; offers: Offer[];
    created: number; neededBy: number; location: string; invitedOnly?: string[];
  }) {
    const rfq = await id(`insert into rfqs (org_id, project_id, title, status, quote_due, needed_by, delivery_location, created_by, sent_at, created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [opts.org, opts.project, opts.title, opts.status, day(opts.created + 4), day(opts.neededBy), opts.location, opts.by, ts(opts.created), ts(opts.created - 1)]);
    const items: { id: string; line: Line }[] = [];
    for (const [i, line] of opts.lines.entries()) {
      const m = bySku[line.sku];
      const req = await id(`insert into requirements (org_id, project_id, line_no, raw_text, description, category_code, material_id, spec, quantity, unit,
          brand, required_date, status, confidence, match_method, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0.95,'exact',$14) returning id`,
        [opts.org, opts.project, i + 1, m.name, m.name, m.category, materialIds[line.sku], JSON.stringify({ ...m.spec, family: m.family }), line.qty, m.unit,
         line.brand ?? null, day(opts.neededBy), opts.status === "awarded" ? "ordered" : "in_rfq", opts.by]);
      const item = await id(`insert into rfq_items (rfq_id, org_id, requirement_id, requirement_ids, line_no, material_id, category_code, description, spec, quantity, unit, brand_pref)
        values ($1,$2,$3,array[$3::uuid],$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [rfq, opts.org, req, i + 1, materialIds[line.sku], m.category, m.name, JSON.stringify(m.spec), line.qty, m.unit, line.brand ?? null]);
      items.push({ id: item, line });
    }
    const quotes: Record<string, { id: string; total: number; subtotal: number; delivery: number }> = {};
    const invitees = [...new Set([...opts.offers.map((o) => o.key), ...(opts.invitedOnly ?? [])])];
    for (const key of invitees) {
      const offer = opts.offers.find((o) => o.key === key);
      await q(`insert into rfq_invitations (rfq_id, org_id, supplier_org_id, status, match_score, match_reasons, invited_at, responded_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [rfq, opts.org, sup[key].org, offer ? "quoted" : "invited", Math.round(between(55, 90)), JSON.stringify(["Supplies the requested categories"]), ts(opts.created), offer ? ts(opts.created + 2) : null]);
      if (!offer) continue;
      let subtotal = 0;
      const lines = items.map(({ id: itemId, line }) => {
        const base = listPrice[key][line.sku] ?? bySku[line.sku].price * sup[key].def.priceFactor;
        const unit = r2(base * offer.factor * between(0.98, 1.02));
        subtotal += unit * line.qty;
        return { itemId, line, unit };
      });
      const total = r2(subtotal + offer.delivery);
      const quote = await id(`insert into quotes (rfq_id, org_id, supplier_org_id, status, delivery_cost, lead_time_days, payment_terms, validity_days, subtotal, total, submitted_by, submitted_at)
        values ($1,$2,$3,'submitted',$4,$5,$6,14,$7,$8,$9,$10) returning id`,
        [rfq, opts.org, sup[key].org, offer.delivery, offer.lead, sup[key].def.terms, r2(subtotal), total, sup[key].user, ts(opts.created + 2, 11)]);
      for (const l of lines) {
        const nonCompliant = offer.noncompliant === l.line.sku;
        const partial = offer.partialSku === l.line.sku;
        await q(`insert into quote_items (quote_id, org_id, supplier_org_id, rfq_item_id, unit_price, quantity, available_qty, brand, offered_spec, compliant)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [quote, opts.org, sup[key].org, l.itemId, l.unit, l.line.qty, partial ? Math.round(l.line.qty * 0.6) : l.line.qty,
           l.line.brand ?? bySku[l.line.sku].brands[0] ?? null, nonCompliant ? "Equivalent alternative - Cu/PVC/SWA/PVC (not XLPE)" : null, !nonCompliant]);
      }
      quotes[key] = { id: quote, total, subtotal: r2(subtotal), delivery: offer.delivery };
    }
    return { rfq, items, quotes };
  }

  async function award(opts: {
    org: string; project: string; rfq: string; items: { id: string; line: Line }[]; quote: { id: string; total: number; subtotal: number; delivery: number };
    supplierKey: string; requestedBy: string; approvedBy: string | null; created: number; requiredIn: number; poStatus?: string;
    prStatus?: "approved" | "pending"; location: string;
  }) {
    const s = sup[opts.supplierKey];
    const pr = await id(`insert into purchase_requests (org_id, project_id, rfq_id, quote_id, supplier_org_id, amount, high_value, justification,
        follows_ai_recommendation, status, requested_by, decided_by, decided_at, decision_note, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13,$14) returning id`,
      [opts.org, opts.project, opts.rfq, opts.quote.id, s.org, opts.quote.total, opts.quote.total > 250000,
       "Recommended supplier - best value compliant quote.", opts.prStatus ?? "approved", opts.requestedBy,
       opts.prStatus === "pending" ? null : opts.approvedBy, opts.prStatus === "pending" ? null : ts(opts.created),
       opts.prStatus === "pending" ? null : "Approved as recommended.", ts(opts.created - 1)]);
    if (opts.prStatus === "pending") return { pr, po: null as string | null, poItems: [] as { id: string; qty: number; price: number }[] };
    await q("update quotes set status = 'accepted' where id = $1", [opts.quote.id]);
    await q("update quotes set status = 'rejected' where rfq_id = $1 and id <> $2", [opts.rfq, opts.quote.id]);
    await q("update rfq_invitations set status = case when supplier_org_id = $2 then 'awarded' else 'not_selected' end where rfq_id = $1 and status = 'quoted'", [opts.rfq, s.org]);
    const po = await id(`insert into purchase_orders (org_id, supplier_org_id, project_id, rfq_id, quote_id, purchase_request_id, status, subtotal, delivery_cost, total,
        delivery_location, required_date, payment_terms, issued_by, issued_at, confirmed_at, promised_date)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
      [opts.org, s.org, opts.project, opts.rfq, opts.quote.id, pr, opts.poStatus ?? "delivered", opts.quote.subtotal, opts.quote.delivery, opts.quote.total,
       opts.location, day(opts.created + opts.requiredIn), s.def.terms, opts.approvedBy, ts(opts.created),
       (opts.poStatus ?? "delivered") === "issued" ? null : ts(opts.created, 15), day(opts.created + opts.requiredIn)]);
    const qItems = await q<{ rfq_item_id: string; unit_price: number }>("select rfq_item_id, unit_price from quote_items where quote_id = $1", [opts.quote.id]);
    const poItems: { id: string; qty: number; price: number }[] = [];
    for (const [i, it] of opts.items.entries()) {
      const price = qItems.find((x) => x.rfq_item_id === it.id)!.unit_price;
      const m = bySku[it.line.sku];
      const pi = await id(`insert into po_items (po_id, org_id, supplier_org_id, rfq_item_id, material_id, line_no, description, quantity, unit, unit_price, line_total)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [po, opts.org, s.org, it.id, materialIds[it.line.sku], i + 1, m.name, it.line.qty, m.unit, price, r2(price * it.line.qty)]);
      poItems.push({ id: pi, qty: it.line.qty, price });
      await q("insert into price_history (material_id, supplier_org_id, contractor_org_id, unit_price, quantity, source, observed_on) values ($1,$2,$3,$4,$5,'po',$6)",
        [materialIds[it.line.sku], s.org, opts.org, price, it.line.qty, day(opts.created)]);
    }
    return { pr, po, poItems };
  }

  async function deliver(opts: {
    org: string; supplierKey: string; po: string; poItems: { id: string; qty: number }[]; dayOffset: number; late: boolean;
    fillFactor?: number; verifiedBy: string | null; status?: string; damaged?: number;
  }) {
    const s = sup[opts.supplierKey];
    const verified = opts.verifiedBy !== null;
    const deliveryDay = opts.dayOffset + (opts.late ? Math.ceil(between(1, 5)) : -Math.floor(between(0, 2)));
    const dv = await id(`insert into deliveries (po_id, org_id, supplier_org_id, status, scheduled_date, dispatched_at, vehicle_no, driver_name, driver_phone,
        verified_by, verified_at, verification_method, otp_verified, condition, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [opts.po, opts.org, s.org, opts.status ?? "accepted", day(deliveryDay), ts(deliveryDay, 7), `DXB ${Math.floor(between(10000, 99999))}`,
       pickN(["Suresh", "Bilal", "Joseph", "Anwar", "Kamal"], 1)[0], "+971 50 123 4567",
       opts.verifiedBy, verified ? ts(deliveryDay, 11) : null, verified ? "otp" : null, verified, verified ? (opts.damaged ? "minor_damage" : "good") : null, ts(deliveryDay - 1)]);
    await q("insert into delivery_secrets (delivery_id, supplier_org_id, otp_code) values ($1,$2,$3)", [dv, s.org, String(Math.floor(between(100000, 999999)))]);
    for (const it of opts.poItems) {
      const shipped = Math.round(it.qty * (opts.fillFactor ?? 1));
      const accepted = verified ? Math.max(shipped - (opts.damaged ?? 0), 0) : null;
      await q(`insert into delivery_items (delivery_id, po_item_id, org_id, supplier_org_id, qty_shipped, qty_received, qty_accepted, qty_rejected, reject_reason)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [dv, it.id, opts.org, s.org, shipped, verified ? shipped : null, accepted, verified ? shipped - accepted! : null, opts.damaged ? "Damaged in transit" : null]);
      if (verified) await q("update po_items set delivered_qty = delivered_qty + $2, accepted_qty = accepted_qty + $3 where id = $1", [it.id, shipped, accepted]);
    }
    return dv;
  }

  // ---------------------------------------------------------------- history: ~8 months of completed orders
  const historyPlans: { key: string; skus: string[] }[] = [
    { key: "gulfcable", skus: ["CAB-XLPE-4C16", "CAB-XLPE-4C25", "WIR-PVC-2.5", "WIR-PVC-4", "CNT-TRAY-300", "CAB-XLPE-4C50"] },
    { key: "alwaha", skus: ["ACC-SKT-2G", "ACC-SW-1G", "PNL-MCB-1P20", "LGT-PNL-40", "WIR-PVC-1.5", "CAB-XLPE-4C16"] },
    { key: "emswitch", skus: ["PNL-MCB-1P20", "PNL-RCBO-32", "PNL-DB-TPN18", "ACC-ISO-32A"] },
    { key: "desertbreeze", skus: ["HVE-FCU-2", "HVA-DIF-600", "HVA-FLX-8", "INS-ARM-19"] },
    { key: "coolpoint", skus: ["HVP-CU-3-8", "HVP-CU-5-8", "INS-ARM-13", "INS-ARM-19"] },
    { key: "blueline", skus: ["PLP-PPR-25", "PLP-PPR-32", "PLF-PPR-EL25", "PLP-UPVC-110", "PLV-BV-3-4"] },
    { key: "buildchem", skus: ["CHM-MEM-4", "CHM-CWP-20", "CHM-PU-600", "FST-ANC-M12"] },
    { key: "northern", skus: ["WIR-PVC-2.5", "ACC-SKT-1G", "CAB-XLPE-2C4"] },
    { key: "atlas", skus: ["FST-ROD-M10", "FST-ANC-M10", "CON-TIE-300"] },
  ];
  const historicalProjects = [
    { org: falcon, project: tower, by: omar, mgr: sara, site: daniel, location: "Dubai Marina, Plot 14" },
    { org: falcon, project: warehouse, by: omar, mgr: sara, site: daniel, location: "Jebel Ali Free Zone" },
    { org: meridian, project: meridianProject, by: meridianUser, mgr: meridianMgr, site: meridianUser, location: "Al Qusais, Dubai" },
  ];
  let n = 0;
  for (const plan of historyPlans) {
    const s = sup[plan.key].def;
    const orders = plan.key === "northern" || plan.key === "atlas" ? 3 : 6;
    for (let k = 0; k < orders; k++) {
      const hp = historicalProjects[n++ % historicalProjects.length];
      const created = -Math.floor(between(25, 240));
      const lines = pickN(plan.skus, Math.min(plan.skus.length, 1 + Math.floor(between(1, 3)))).map((sku) => ({
        sku, qty: bySku[sku].unit === "m" ? Math.round(between(200, 1500)) : Math.round(between(10, 200)),
      }));
      const competitor = historyPlans.find((h) => h.key !== plan.key && lines.every((l) => listPrice[h.key][l.sku]))?.key;
      const offers: Offer[] = [{ key: plan.key, factor: 1, lead: s.lead, delivery: 0 }];
      if (competitor) offers.push({ key: competitor, factor: 1.05, lead: sup[competitor].def.lead + 1, delivery: 150 });
      const { rfq, items, quotes } = await rfqWithQuotes({
        org: hp.org, project: hp.project, by: hp.by, title: `${bySku[lines[0].sku].name.split(" ").slice(0, 3).join(" ")} - batch ${k + 1}`,
        status: "awarded", lines, offers, created, neededBy: created + 10, location: hp.location,
      });
      const { po, poItems } = await award({ org: hp.org, project: hp.project, rfq, items, quote: quotes[plan.key], supplierKey: plan.key,
        requestedBy: hp.by, approvedBy: hp.mgr, created: created + 3, requiredIn: 7, location: hp.location });
      const late = rand() > s.onTime;
      const short = rand() > s.fill;
      await deliver({ org: hp.org, supplierKey: plan.key, po: po!, poItems, dayOffset: created + 10, late, verifiedBy: hp.site,
        fillFactor: short ? 0.9 : 1, status: short ? "partially_accepted" : "accepted" });
      if (short) {
        await q("update purchase_orders set status = 'partially_delivered' where id = $1", [po]);
        if (rand() > 0.5) await deliver({ org: hp.org, supplierKey: plan.key, po: po!, poItems: poItems.map((p) => ({ id: p.id, qty: p.qty * 0.1 })), dayOffset: created + 16, late: true, verifiedBy: hp.site });
        await q(`update purchase_orders set status = case when (select sum(quantity - accepted_qty) from po_items where po_id = $1) <= 0.5 then 'closed' else 'partially_delivered' end where id = $1`, [po]);
      } else {
        await q("update purchase_orders set status = 'closed' where id = $1", [po]);
      }
      const poRow = (await q<{ total: number; po_number: string }>("select total, po_number from purchase_orders where id = $1", [po]))[0];
      const accepted = (await q<{ v: number }>("select coalesce(sum(accepted_qty * unit_price),0) as v from po_items where po_id = $1", [po]))[0].v;
      const inv = await id(`insert into invoices (po_id, org_id, supplier_org_id, invoice_number, amount, status, match_result, submitted_by, submitted_at, approved_by, approved_at)
        values ($1,$2,$3,$4,$5,'paid',$6,$7,$8,$9,$10) returning id`,
        [po, hp.org, sup[plan.key].org, `INV-${poRow.po_number.slice(-5)}`, r2(accepted + quotes[plan.key].delivery), JSON.stringify({ status: "matched", variance: 0 }),
         sup[plan.key].user, ts(created + 14), hp.mgr, ts(created + 16)]);
      await q("insert into payments (invoice_id, org_id, supplier_org_id, amount, reference, recorded_by, paid_at) values ($1,$2,$3,$4,$5,$6,$7)",
        [inv, hp.org, sup[plan.key].org, r2(accepted + quotes[plan.key].delivery), `TT-${Math.floor(between(100000, 999999))}`, hp.mgr, ts(created + 45)]);
    }
  }
  // A couple of historical disputes for supplier scorecards.
  const disputedPo = (await q<{ id: string; org_id: string; supplier_org_id: string }>(
    `select po.id, po.org_id, po.supplier_org_id from purchase_orders po where po.supplier_org_id = $1 limit 1`, [sup.alwaha.org]))[0];
  await q(`insert into disputes (org_id, supplier_org_id, po_id, type, description, amount_at_stake, status, raised_by, resolution, resolved_by, resolved_at, created_at)
           values ($1,$2,$3,'late','Delivery arrived 5 days late, delaying first-fix works on L4.',0,'resolved',$4,'Supplier credited AED 1,200 delivery charge.',$5,$6,$7)`,
    [disputedPo.org_id, disputedPo.supplier_org_id, disputedPo.id, omar, sara, ts(-60), ts(-70)]);

  // ---------------------------------------------------------------- LIVE DEMO STATES (Falcon Crest)

  // 1) Tower: RFQ sent, three quotes in, ready for AI comparison (Step 11).
  const live1 = await rfqWithQuotes({
    org: falcon, project: tower, by: omar, title: "Sub-main cables - Levels 1-10", status: "sent",
    lines: [
      { sku: "CAB-XLPE-4C95", qty: 850, brand: "Ducab" },
      { sku: "CAB-XLPE-4C50", qty: 1200, brand: "Ducab" },
      { sku: "CAB-XLPE-4C16", qty: 2400, brand: "Ducab" },
      { sku: "CNT-TRAY-300", qty: 420 },
      { sku: "CON-LUG-95", qty: 160 },
    ],
    offers: [
      { key: "gulfcable", factor: 1.0, lead: 3, delivery: 0 },
      { key: "alwaha", factor: 0.99, lead: 9, delivery: 450, partialSku: "CNT-TRAY-300" },
      { key: "northern", factor: 0.9, lead: 6, delivery: 900, noncompliant: "CAB-XLPE-4C95" },
    ],
    invitedOnly: ["emswitch"], created: -3, neededBy: 9, location: "Dubai Marina, Plot 14",
  });
  void live1;

  // 2) Tower: purchase request awaiting manager approval (Step 12).
  const live2 = await rfqWithQuotes({
    org: falcon, project: tower, by: omar, title: "Wiring accessories - Typical floors", status: "sent",
    lines: [{ sku: "ACC-SKT-2G", qty: 640, brand: "MK" }, { sku: "ACC-SW-2G", qty: 380, brand: "MK" }, { sku: "ACC-ISO-20A", qty: 120 }],
    offers: [{ key: "emswitch", factor: 0.97, lead: 3, delivery: 0 }, { key: "alwaha", factor: 0.97, lead: 7, delivery: 300 }],
    created: -6, neededBy: 12, location: "Dubai Marina, Plot 14",
  });
  await award({ org: falcon, project: tower, rfq: live2.rfq, items: live2.items, quote: live2.quotes.emswitch, supplierKey: "emswitch",
    requestedBy: omar, approvedBy: null, created: -1, requiredIn: 12, prStatus: "pending", location: "Dubai Marina, Plot 14" });

  // 3) Warehouse: PO confirmed and dispatched, awaiting site verification (Steps 15-17).
  const live3 = await rfqWithQuotes({
    org: falcon, project: warehouse, by: omar, title: "Refrigerant piping & insulation - Zone B", status: "awarded",
    lines: [{ sku: "HVP-CU-5-8", qty: 1000 }, { sku: "HVP-CU-3-8", qty: 1000 }, { sku: "INS-ARM-19", qty: 900 }],
    offers: [{ key: "coolpoint", factor: 1.0, lead: 2, delivery: 0 }, { key: "desertbreeze", factor: 1.04, lead: 5, delivery: 0 }],
    created: -9, neededBy: 0, location: "Jebel Ali Free Zone, Plot S-21",
  });
  const a3 = await award({ org: falcon, project: warehouse, rfq: live3.rfq, items: live3.items, quote: live3.quotes.coolpoint, supplierKey: "coolpoint",
    requestedBy: omar, approvedBy: sara, created: -5, requiredIn: 5, poStatus: "in_delivery", location: "Jebel Ali Free Zone, Plot S-21" });
  // Supplier ships 900 of the 1,000 m of 5/8" pipe - a partial delivery for the site to verify.
  const dv3 = await id(`insert into deliveries (po_id, org_id, supplier_org_id, status, scheduled_date, dispatched_at, vehicle_no, driver_name, driver_phone)
    values ($1,$2,$3,'dispatched',$4,$5,'DXB 48213','Bilal','+971 50 765 4321') returning id`, [a3.po, falcon, sup.coolpoint.org, day(0), ts(0, 6)]);
  await q("insert into delivery_secrets (delivery_id, supplier_org_id, otp_code) values ($1,$2,'482913')", [dv3, sup.coolpoint.org]);
  for (const [i, pi] of a3.poItems.entries())
    await q("insert into delivery_items (delivery_id, po_item_id, org_id, supplier_org_id, qty_shipped) values ($1,$2,$3,$4,$5)",
      [dv3, pi.id, falcon, sup.coolpoint.org, i === 0 ? 900 : pi.qty]);

  // 4) Villa: PO issued to supplier, awaiting supplier confirmation (Step 14).
  const live4 = await rfqWithQuotes({
    org: falcon, project: villa, by: omar, title: "PPR water supply - Villas 1-6", status: "awarded",
    lines: [{ sku: "PLP-PPR-25", qty: 1800, brand: "Cosmoplast" }, { sku: "PLP-PPR-32", qty: 900, brand: "Cosmoplast" }, { sku: "PLF-PPR-EL25", qty: 600 }, { sku: "PLV-BV-3-4", qty: 60 }],
    offers: [{ key: "blueline", factor: 0.98, lead: 3, delivery: 0 }],
    created: -2, neededBy: 10, location: "Al Barari, Dubai - Villa cluster C",
  });
  await award({ org: falcon, project: villa, rfq: live4.rfq, items: live4.items, quote: live4.quotes.blueline, supplierKey: "blueline",
    requestedBy: omar, approvedBy: sara, created: 0, requiredIn: 10, poStatus: "issued", location: "Al Barari, Dubai - Villa cluster C" });

  // 5) Tower: partially delivered PO with open short-delivery dispute and a mismatched invoice.
  const live5 = await rfqWithQuotes({
    org: falcon, project: tower, by: omar, title: "Final distribution boards - L1-L5", status: "awarded",
    lines: [{ sku: "PNL-DB-TPN18", qty: 10 }, { sku: "PNL-MCB-1P20", qty: 1000 }, { sku: "PNL-RCBO-32", qty: 80 }],
    offers: [{ key: "alwaha", factor: 0.95, lead: 4, delivery: 0 }, { key: "emswitch", factor: 1.0, lead: 3, delivery: 0 }],
    created: -24, neededBy: -12, location: "Dubai Marina, Plot 14",
  });
  const a5 = await award({ org: falcon, project: tower, rfq: live5.rfq, items: live5.items, quote: live5.quotes.alwaha, supplierKey: "alwaha",
    requestedBy: omar, approvedBy: sara, created: -20, requiredIn: 8, poStatus: "partially_delivered", location: "Dubai Marina, Plot 14" });
  const dv5 = await deliver({ org: falcon, supplierKey: "alwaha", po: a5.po!, poItems: a5.poItems, dayOffset: -11, late: true, fillFactor: 0.9, verifiedBy: daniel, status: "partially_accepted" });
  const po5 = (await q<{ po_number: string }>("select po_number from purchase_orders where id = $1", [a5.po]))[0];
  const inv5Amount = r2(a5.poItems.reduce((acc, p) => acc + p.qty * p.price, 0)); // invoiced for the FULL order
  const accepted5 = (await q<{ v: number }>("select sum(accepted_qty * unit_price) as v from po_items where po_id = $1", [a5.po]))[0].v;
  const inv5 = await id(`insert into invoices (po_id, org_id, supplier_org_id, invoice_number, amount, status, match_result, submitted_by, submitted_at)
    values ($1,$2,$3,$4,$5,'mismatch',$6,$7,$8) returning id`,
    [a5.po, falcon, sup.alwaha.org, `AW-${po5.po_number.slice(-5)}`, inv5Amount,
     JSON.stringify({ status: "mismatch", invoiced: inv5Amount, accepted_value: r2(accepted5), variance: r2(inv5Amount - accepted5),
       notes: ["Invoice covers ordered quantity; only accepted quantity is payable."] }), sup.alwaha.user, ts(-8)]);
  const disp = await id(`insert into disputes (org_id, supplier_org_id, po_id, delivery_id, invoice_id, type, description, amount_at_stake, status, raised_by, created_at)
    values ($1,$2,$3,$4,$5,'short_delivery','Site received 90% of ordered quantities on all lines; invoice is for 100%. Balance outstanding and needed for L5 energisation.',$6,'supplier_responded',$7,$8) returning id`,
    [falcon, sup.alwaha.org, a5.po, dv5, inv5, r2(inv5Amount - accepted5), omar, ts(-7)]);
  await q("insert into dispute_comments (dispute_id, org_id, supplier_org_id, author_id, author_org_id, body, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
    [disp, falcon, sup.alwaha.org, omar, falcon, "Only 90% received per signed delivery verification. Please deliver the balance or issue a corrected invoice.", ts(-7, 10)]);
  await q("insert into dispute_comments (dispute_id, org_id, supplier_org_id, author_id, author_org_id, body, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
    [disp, falcon, sup.alwaha.org, sup.alwaha.user, sup.alwaha.org, "Apologies - balance is in transit from Jebel Ali warehouse, will deliver this week and re-issue the invoice.", ts(-6, 14)]);

  // 6) Villa: a draft RFQ ready for supplier recommendation (Step 7-9) - built from confirmed requirements.
  for (const [i, l] of [
    { sku: "CAB-XLPE-4C25", qty: 600 }, { sku: "CAB-XLPE-4C16", qty: 1200 }, { sku: "WIR-PVC-2.5", qty: 8000 }, { sku: "WIR-PVC-4", qty: 3000 },
  ].entries()) {
    const m = bySku[l.sku];
    await q(`insert into requirements (org_id, project_id, line_no, raw_text, description, category_code, material_id, spec, quantity, unit, brand, required_date,
        status, confidence, match_method, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Ducab',$11,'confirmed',0.95,'exact',$12)`,
      [falcon, villa, i + 1, m.name, m.name, m.category, materialIds[l.sku], JSON.stringify({ ...m.spec, family: m.family }), l.qty, m.unit, day(14), omar]);
  }

  // ---------------------------------------------------------------- audit trail for staged items
  await q(`insert into audit_log (org_id, actor_id, actor_org_id, entity, action, detail, created_at)
           values ($1,$2,$1,'system','seeded', '{"note":"Demo data loaded"}', now())`, [falcon, omar]);

  await db.query("commit");
  await db.end();
  console.log(`Seed complete. Password for all demo users: ${PASSWORD}`);
}

main().catch(async (err) => {
  console.error(err);
  await db.query("rollback").catch(() => {});
  process.exit(1);
});
