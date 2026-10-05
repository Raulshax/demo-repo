// End-to-end walk through the MVP journey against a running server (npm run start) and a freshly seeded DB.
// Usage: BASE_URL=http://localhost:3000 npx tsx e2e/journey.ts [screenshotDir]
import { config } from "dotenv";
import pg from "pg";
import { chromium, type Page } from "playwright";

config({ path: ".env.local" });
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv[2] ?? null;
const db = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });

let step = 0;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, "0")}-${name}.png`, fullPage: true });
}
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Demo@2026");
  await Promise.all([page.waitForURL(/dashboard|admin/), page.click('button[type="submit"]')]);
}
async function expectFlash(page: Page, text: string, msg: string) {
  try {
    await page.locator('[role="status"]', { hasText: text }).first().waitFor({ timeout: 20000 });
  } catch {
    const current = await page.locator('[role="status"]').allTextContents();
    throw new Error(`FAILED: ${msg} (flash: ${JSON.stringify(current)} at ${page.url()})`);
  }
  console.log(`  ✓ ${msg}`);
}

async function main() {
  await db.connect();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => console.error("  page error:", e.message));

  console.log("1. Contractor logs in and sees today's attention list");
  await login(page, "omar@falconcrest.demo");
  ok(await page.getByText("Needs attention").isVisible(), "dashboard shows 'Needs attention'");
  await shot(page, "dashboard-omar");

  console.log("2-5. Upload a BOQ; AI extracts and normalises; contractor reviews and confirms");
  await page.goto(`${BASE}/projects`);
  await page.click("text=Dubai Villa Project");
  await page.setInputFiles('input[name="file"]', "public/samples/dubai-villa-mep-boq.xlsx");
  await Promise.all([page.waitForURL(/documents/), page.click("text=Upload & extract")]);
  await expectFlash(page, "Here's what you need to buy", "extraction summary shown");
  ok(await page.getByText("4C x 16mm XLPE/SWA/PVC Cu cable").first().isVisible(), "raw line shown");
  await shot(page, "extraction-review");
  // Untick the labour-only line, then confirm.
  const labour = page.locator("tr", { hasText: "labour only" }).locator('input[type="checkbox"]');
  await labour.uncheck();
  await Promise.all([page.waitForURL(/projects\/[^/]+(#|$|\?)/), page.click("button[value=confirm]")]);
  await expectFlash(page, "confirmed", "requirements confirmed");

  console.log("6-9. Create RFQ (cables only), get 3-5 recommended suppliers, send");
  const form = page.locator("#rfq-form");
  const boxes = form.locator('input[name="req"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const row = form.locator("tbody tr").nth(i);
    const txt = (await row.textContent()) ?? "";
    if (!/XLPE|Wire Cu\/PVC/.test(txt)) await boxes.nth(i).uncheck();
  }
  await page.fill('input[name="title"]', "Villa cables & wires");
  await Promise.all([page.waitForURL(/rfqs\//), page.click("text=Create RFQ & match suppliers")]);
  const recommended = await page.locator('input[name="supplier"]:checked').count();
  ok(recommended >= 3 && recommended <= 5, `${recommended} suppliers recommended (3-5)`);
  await shot(page, "supplier-recommendations");
  await Promise.all([page.waitForURL(/rfqs\/[^?]+\?|rfqs\/[^?]+$/), page.click("text=Send RFQ to selected suppliers")]);
  await expectFlash(page, "RFQ sent", "RFQ sent");
  const rfqId = page.url().split("/rfqs/")[1].split("?")[0];
  const invited = (await db.query(`select u.email, o.name from rfq_invitations i join users u on u.org_id = i.supplier_org_id join organizations o on o.id = i.supplier_org_id
    where i.rfq_id = $1 and i.status = 'invited'`, [rfqId])).rows as { email: string; name: string }[];
  console.log(`  invited: ${invited.map((x) => x.name).join(", ")}`);

  console.log("10. Suppliers submit quotes, seeing only their own RFQ");
  for (const [k, s] of invited.slice(0, 2).entries()) {
    await login(page, s.email);
    await page.goto(`${BASE}/supplier/rfqs/${rfqId}`);
    // Fill any blank prices with a plausible number; second supplier quotes 6% higher.
    const prices = page.locator('input[name^="price_"]');
    for (let i = 0; i < (await prices.count()); i++) {
      const v = await prices.nth(i).inputValue();
      await prices.nth(i).fill(String(((Number(v) || 10) * (k === 0 ? 1 : 1.06)).toFixed(2)));
    }
    await page.fill('input[name="lead_time_days"]', k === 0 ? "3" : "5");
    if (k === 0) await shot(page, "supplier-quote-form");
    await Promise.all([page.waitForURL(/supplier\/rfqs\//), page.click("button:has-text('Submit quote')")]);
    await expectFlash(page, "Quote submitted", `${s.name} quoted`);
  }
  const compHtml = await (async () => { await login(page, invited[0].email); await page.goto(`${BASE}/rfqs/${rfqId}`); return page.url(); })();
  ok(compHtml.includes("dashboard"), "supplier cannot open the contractor RFQ comparison page");

  console.log("11-12. AI compares quotes and explains; contractor sends for approval; manager approves");
  await login(page, "omar@falconcrest.demo");
  await page.goto(`${BASE}/rfqs/${rfqId}`);
  const explanation = (await page.locator("text=is recommended because").first().textContent()) ?? "";
  ok(explanation.length > 40, `AI explanation: "${explanation.slice(0, 140)}…"`);
  await shot(page, "quote-comparison");
  await page.click("text=Send for approval");
  await expectFlash(page, "Sent for approval", "purchase request created");

  // A procurement user cannot approve.
  await page.goto(`${BASE}/approvals`);
  ok(!(await page.locator("text=Approve & issue PO").count()), "procurement user sees no approve button");

  await login(page, "sara@falconcrest.demo");
  await page.goto(`${BASE}/approvals`);
  await shot(page, "approvals");
  const card = page.locator("section", { hasText: "Villa cables & wires" }).first();
  await card.locator('textarea[name="note"]').fill("Approved - best compliant value.");
  await Promise.all([page.waitForURL(/orders\//), card.locator("text=Approve & issue PO").click()]);
  await expectFlash(page, "issued", "13. PO issued automatically on approval");
  const poId = page.url().split("/orders/")[1].split("?")[0];
  const winner = (await db.query("select u.email, o.name from purchase_orders po join users u on u.org_id = po.supplier_org_id join organizations o on o.id = po.supplier_org_id where po.id = $1", [poId])).rows[0];
  console.log(`  awarded to ${winner.name}`);

  console.log("14-15. Supplier confirms the PO and dispatches a PARTIAL delivery");
  await login(page, winner.email);
  await page.goto(`${BASE}/supplier/orders/${poId}`);
  await page.fill('input[name="promised_date"]', new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10));
  await page.click("text=Confirm order");
  await expectFlash(page, "confirmed", "PO confirmed");
  const qty = page.locator('input[name^="qty_"]').first();
  const full = Number(await qty.inputValue());
  await qty.fill(String(Math.round(full * 0.9)));
  await page.fill('input[name="vehicle"]', "DXB 77120");
  await page.fill('input[name="driver"]', "Anwar");
  await page.click("text=Dispatch & generate delivery code");
  await expectFlash(page, "dispatched", "delivery dispatched");
  const otp = (await page.locator(".tracking-\\[0\\.3em\\]").first().textContent())!.trim();
  ok(/^\d{6}$/.test(otp), `supplier sees 6-digit delivery code`);
  await shot(page, "supplier-dispatch");

  console.log("16-17. Site engineer verifies with OTP; accepts a partial quantity");
  await login(page, "daniel@falconcrest.demo");
  await page.goto(`${BASE}/orders/${poId}`);
  await page.fill('input[name="otp"]', "000000");
  await page.click("text=Confirm receipt");
  await expectFlash(page, "does not match", "wrong OTP rejected");
  await page.goto(`${BASE}/orders/${poId}`);
  await page.fill('input[name="otp"]', otp);
  // Reject 10 m of the first line as damaged.
  const firstItem = page.locator('input[name^="accepted_"]').first();
  const shipped = Number(await firstItem.inputValue());
  await firstItem.fill(String(shipped - 10));
  await page.locator('input[name^="reason_"]').first().fill("Damaged drum end");
  await page.setInputFiles('input[name="photo"]', { name: "site.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
  await shot(page, "site-verification");
  await page.click("text=Confirm receipt");
  await expectFlash(page, "Partial delivery", "partial delivery recorded");
  const po = (await db.query("select status from purchase_orders where id = $1", [poId])).rows[0];
  ok(po.status === "partially_delivered", `PO status is partially_delivered`);
  await shot(page, "order-partial");

  console.log("Invoice: supplier invoices; three-way match; manager approves and pays");
  await login(page, winner.email);
  await page.goto(`${BASE}/supplier/orders/${poId}`);
  await page.fill('input[name="invoice_number"]', `INV-E2E-${Date.now() % 100000}`);
  await page.click("text=Submit invoice");
  await expectFlash(page, "matched", "invoice matched to accepted quantities");
  await login(page, "sara@falconcrest.demo");
  await page.goto(`${BASE}/invoices`);
  await page.locator("tr", { hasText: "INV-E2E" }).locator("text=Approve").click();
  await expectFlash(page, "approved", "invoice approved");
  await page.locator("tr", { hasText: "INV-E2E" }).locator('input[name="reference"]').fill("TT-998877");
  await page.locator("tr", { hasText: "INV-E2E" }).locator("text=Mark paid").click();
  await expectFlash(page, "Payment recorded", "payment recorded");

  console.log("Intelligence, supplier network, audit");
  await page.goto(`${BASE}/intelligence`);
  ok(await page.getByText("Saved vs highest quote").isVisible(), "intelligence KPIs render");
  await shot(page, "intelligence");
  await page.goto(`${BASE}/audit`);
  ok((await page.locator("tbody tr").count()) > 5, "audit trail populated");

  console.log("Tenant isolation in the UI");
  await login(page, "lena@meridianbuild.demo");
  const res = await page.goto(`${BASE}/rfqs/${rfqId}`);
  ok(res?.status() === 404, "another contractor gets 404 on Falcon's RFQ");
  const res2 = await page.goto(`${BASE}/orders/${poId}`);
  ok(res2?.status() === 404, "another contractor gets 404 on Falcon's PO");

  console.log("Supplier dashboard & admin");
  await login(page, "tenders@emswitch.demo");
  await shot(page, "supplier-dashboard");
  await login(page, "admin@procureos.demo");
  ok(page.url().includes("/admin"), "admin lands on platform overview");
  await shot(page, "admin");

  await browser.close();
  await db.end();
  console.log("\nJourney complete ✓");
}

main().catch(async (e) => { console.error(e); await db.end().catch(() => {}); process.exit(1); });
