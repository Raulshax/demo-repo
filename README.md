# ProcureOS — AI procurement operating system for construction

From project demand to the best supplier, best price, completed delivery and procurement intelligence.
Initial market: medium-sized contractors in Dubai / UAE, MEP materials first.

This is a working prototype: real database with tenant isolation, real document extraction, real
workflow. It is not a mockup. **AI recommends; people approve.** No purchase commitment is ever created
without a human decision, and the database enforces that.

## The journey it supports

| Step | What happens | Where |
|---|---|---|
| 1–2 | Contractor logs in, creates a project | `/projects` |
| 3–4 | Upload a BOQ (PDF, Excel, CSV). AI extracts material, spec, qty, unit, brand, date, location, notes | project page → upload |
| 5 | **"Here's what you need to buy"**: review grid with confidence per line; edit, re-match, untick, confirm | `/projects/:id/documents/:doc` |
| 6 | Each line is normalised against the central material database (e.g. `4C x 16mm XLPE Cable` → ELEC-CABLE · XLPE · 4 core · 16 mm² · m) | `/materials` |
| 7–9 | RFQ built from confirmed requirements. Same-material demand is consolidated. 3–5 suppliers recommended with reasons and risks; contractor edits the shortlist and sends | `/rfqs/:id` |
| 10 | Supplier sees only its own invitation, quotes per line (prefilled from its catalogue) or declines | `/supplier/rfqs/:id` |
| 11 | AI compares quotes like-for-like: gap-filling, spec compliance, lead time vs need date, delivery cost, payment terms, reliability and history. Explains the recommendation, flags prices off-market and suggests a split award | `/rfqs/:id` |
| 12–13 | Procurement user sends for approval. A manager approves, which issues the PO automatically | `/approvals` |
| 14–15 | Supplier confirms the PO, dispatches full or partial deliveries, gets a 6-digit delivery code and a printable delivery note with a QR code | `/supplier/orders/:id` |
| 16–17 | Site verifies by OTP or QR, counts received/accepted per line, records rejections, photo and delivery note. Partial deliveries keep the balance open | `/orders/:id` |
| + | Three-way invoice match (PO price × qty accepted on site), approval, payment record, disputes with threaded messages and escalation to the platform | `/invoices`, `/disputes` |
| + | Intelligence: spend, savings vs highest quote and vs market, price trends vs what you paid, supplier scorecards, generated savings and risk opportunities | `/intelligence` |
| + | "What needs my attention today" for each role | `/dashboard` |

## Quick start

Requires Node 20+ and PostgreSQL 14+.

```bash
npm install
# create roles + database (adjust to your Postgres setup)
psql -U postgres -c "create role procure_owner login password 'owner_dev_pw' createdb;"
psql -U postgres -c "create role procure_app login password 'app_dev_pw';"
psql -U postgres -c "create database procure owner procure_owner;"
cp .env.example .env.local          # optionally add ANTHROPIC_API_KEY
npm run db:reset                    # schema + RLS + demo data
npm run build && npm run start      # http://localhost:3000
```

All demo users share the password **`Demo@2026`**. The login page has one-click buttons for each role.

| Account | Role | Good for |
|---|---|---|
| omar@falconcrest.demo | Procurement engineer | Upload BOQ → RFQ → compare quotes (one RFQ already has 3 quotes) |
| sara@falconcrest.demo | Procurement manager | A purchase request is waiting for approval; invoices, disputes |
| daniel@falconcrest.demo | Site engineer | A partial delivery is arriving today. Its OTP is **482913** (the supplier sees it) |
| rajesh@falconcrest.demo | Executive (read-only) | Intelligence, spend, outstanding approvals |
| sales@gulfcable.demo, tenders@emswitch.demo, sales@blueline.demo, orders@coolpoint.demo | Suppliers | RFQ to quote, PO to confirm, delivery in progress |
| lena@meridianbuild.demo | Second contractor | Proves tenant isolation |
| admin@procureos.demo | Platform admin | Organisations, supplier verification, disputes, material database |

Sample documents are in `public/samples/` and linked from the upload card.

## Architecture

```
Next.js 16 (App Router, server components + server actions) · TypeScript · Tailwind v4
        │  every request: withActor(user) → BEGIN; set_config(app.user_id/org_id/role/org_kind); …; COMMIT
        ▼
PostgreSQL ── Row Level Security on every tenant table (db/002_rls.sql)
        │     runtime connects as procure_app (NOT the table owner), so policies always apply
        ├─ SECURITY DEFINER functions: auth, delivery OTP, anonymised network benchmarks & scorecards
        └─ triggers: financial controls (below)
src/lib/engine/   deterministic procurement engine (pure TS, unit-tested)
   parse.ts       BOQ header detection, section rows, totals, UAE day-first dates, PDF text lines
   normalize.ts   spec extraction (cores, mm², A, poles, gang, inch/mm, TR, PN, thread…), units, catalogue match + confidence
   matching.ts    supplier recommendation (coverage, price vs benchmark, reliability, lead time, logistics, relationship)
   compare.ts     like-for-like quote comparison, compliance gating, scoring, explanation, split-award detection
src/lib/ai/claude.ts   Claude (claude-opus-5-5) document understanding with structured JSON output
src/lib/services/      extraction, RFQ, order lifecycle (approval → PO → delivery → invoice → payment → dispute)
```

**How the AI is used.** Claude reads the document: scanned PDFs, messy BOQs, free-form lists. Its output
is then *grounded* by the deterministic normaliser against the material database. Numbers in a
recommendation (prices, percentages, on-time rates) always come from the engine, so explanations are
reproducible and auditable. Without `ANTHROPIC_API_KEY` the rules engine does the extraction, so the app
works offline. The engine used is shown on each document and recorded in `ai_runs`.

## Security & controls (enforced in the database, not just the UI)

- **Tenant isolation:** a contractor can only read and write its own organisation's rows.
- **Supplier confidentiality:** a supplier sees only RFQs it was actually invited to (unsent AI
  recommendations are hidden), only its own quote, never competitor catalogue prices or price history,
  and not which other suppliers were invited.
- **Purchases:** only a contractor manager can approve or reject; never the requester (segregation of
  duties); high-value approvals require a written note; PO terms are immutable.
- **POs** cannot be inserted without an approved purchase request with matching supplier and amount.
- **Suppliers** cannot change PO commercial terms, cannot verify their own deliveries and cannot record
  received quantities.
- **Contractors** cannot change supplier quote prices.
- **Credentials and audit:** password hashes and sessions are unreadable by the runtime role. The
  delivery OTP is readable only by the supplier and checked via a function. The audit log is
  append-only.

These are proven by `tests/rls.test.ts`, which runs as the real runtime role.

## Tests

```bash
npm test          # engine unit tests + sample-document extraction + RLS/controls integration tests (34)
npm run e2e       # browser walk-through of steps 1–17 + invoice/payment + isolation (needs a running server)
```

`npm run e2e` resets nothing. Run `npm run db:reset` first for a clean run. In environments where
`NODE_ENV=development` is preset, the `build`/`start` scripts pin `production`.

## What is intentionally not done yet

- Extraction runs synchronously in the request. Production should move it to a background job with
  progress updates.
- Notifications (email/WhatsApp) for invitations, approvals and dispatches. The dashboard covers them in-app.
- Split awards are detected and quantified but not yet executable (one PO per RFQ).
- Payments are recorded, not executed; ERP/bank integration is a later layer.
- Demand forecasting from programme/BIM, and AI-assisted spec-equivalence checks on supplier alternatives.
- Files are stored in Postgres (`bytea`). Move to object storage with signed URLs at scale.
