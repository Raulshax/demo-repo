-- ProcureOS core schema.
-- Multi-tenant: every tenant-owned row carries org_id (the contractor that owns the
-- procurement record) and, where a supplier is party to it, supplier_org_id.
-- The application connects as procure_app (not the table owner), so every query is
-- filtered by the Row Level Security policies in 002_rls.sql.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Request context (set per transaction by the app via set_config(..., true))
-- ---------------------------------------------------------------------------
create or replace function app_user() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create or replace function app_org() returns uuid language sql stable as
$$ select nullif(current_setting('app.org_id', true), '')::uuid $$;
create or replace function app_role() returns text language sql stable as
$$ select coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$;
create or replace function app_org_kind() returns text language sql stable as
$$ select coalesce(nullif(current_setting('app.org_kind', true), ''), 'none') $$;
create or replace function is_admin() returns boolean language sql stable as
$$ select app_role() = 'platform_admin' $$;

-- ---------------------------------------------------------------------------
-- Organisations & users
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('contractor', 'supplier', 'platform')),
  trade_license text,
  city text default 'Dubai',
  -- contractor settings: approval thresholds etc.
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'suspended', 'pending')),
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  email text not null unique,
  full_name text not null,
  title text,
  role text not null check (role in (
    'contractor_user', 'contractor_manager', 'contractor_exec', 'supplier', 'platform_admin')),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on users(org_id);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Material master data (platform-wide)
-- ---------------------------------------------------------------------------
create table categories (
  code text primary key,
  name text not null,
  parent_code text references categories(code),
  wedge text not null default 'secondary' check (wedge in ('primary', 'secondary', 'other'))
);

create table materials (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  category_code text not null references categories(code),
  name text not null,
  -- normalised specification attributes, e.g. {"cores":4,"size_mm2":16,"insulation":"XLPE"}
  spec jsonb not null default '{}'::jsonb,
  base_unit text not null,
  keywords text[] not null default '{}',
  typical_brands text[] not null default '{}',
  benchmark_price_aed numeric(14, 2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on materials(category_code);

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
create table supplier_profiles (
  org_id uuid primary key references organizations(id),
  description text,
  categories text[] not null default '{}',
  emirates text[] not null default '{Dubai}',
  default_lead_time_days int not null default 3,
  delivery_capability text not null default 'own_fleet'
    check (delivery_capability in ('own_fleet', 'third_party', 'collection_only')),
  payment_terms text default '30 days',
  min_order_aed numeric(14, 2) default 0,
  verified boolean not null default false,
  contact_email text,
  phone text,
  updated_at timestamptz not null default now()
);

create table supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_org_id uuid not null references organizations(id),
  material_id uuid not null references materials(id),
  brand text,
  unit_price_aed numeric(14, 2),
  stock_qty numeric(14, 2) not null default 0,
  lead_time_days int,
  updated_at timestamptz not null default now(),
  unique (supplier_org_id, material_id, brand)
);
create index on supplier_products(material_id);

-- ---------------------------------------------------------------------------
-- Projects, documents, requirements
-- ---------------------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  code text not null,
  name text not null,
  client_name text,
  location text,
  emirate text not null default 'Dubai',
  status text not null default 'active' check (status in ('planning', 'active', 'on_hold', 'completed')),
  start_date date,
  end_date date,
  budget_aed numeric(16, 2),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  filename text not null,
  mime_type text not null,
  size_bytes int not null,
  content bytea not null,
  kind text not null default 'boq' check (kind in ('boq', 'procurement_list', 'specification', 'other')),
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'extracted', 'failed')),
  extraction jsonb,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on documents(project_id);

create table requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  document_id uuid references documents(id),
  line_no int,
  raw_text text,
  description text not null,
  category_code text references categories(code),
  material_id uuid references materials(id),
  spec jsonb not null default '{}'::jsonb,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit text not null,
  brand text,
  required_date date,
  location text,
  notes text,
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'in_rfq', 'ordered', 'cancelled')),
  confidence numeric(4, 3),
  match_method text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on requirements(project_id, status);

-- ---------------------------------------------------------------------------
-- RFQs and quotes
-- ---------------------------------------------------------------------------
create sequence rfq_seq start 1001;
create table rfqs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  number text not null unique default ('RFQ-' || to_char(now(), 'YYYY') || '-' || nextval('rfq_seq')),
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'closed', 'awarded', 'cancelled')),
  quote_due date,
  needed_by date,
  delivery_location text,
  delivery_emirate text not null default 'Dubai',
  notes text,
  created_by uuid references users(id),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table rfq_items (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references rfqs(id) on delete cascade,
  org_id uuid not null references organizations(id),
  requirement_id uuid references requirements(id),
  -- all project requirements consolidated into this line (same material/brand/unit)
  requirement_ids uuid[] not null default '{}',
  line_no int not null,
  material_id uuid references materials(id),
  category_code text references categories(code),
  description text not null,
  spec jsonb not null default '{}'::jsonb,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit text not null,
  brand_pref text
);
create index on rfq_items(rfq_id);

create table rfq_invitations (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references rfqs(id) on delete cascade,
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  -- 'recommended' rows are AI suggestions the contractor has not yet sent; suppliers never see them.
  status text not null default 'recommended'
    check (status in ('recommended', 'invited', 'viewed', 'quoted', 'declined', 'awarded', 'not_selected')),
  match_score numeric(5, 2),
  match_reasons jsonb not null default '[]'::jsonb,
  selected boolean not null default true,
  invited_at timestamptz,
  responded_at timestamptz,
  unique (rfq_id, supplier_org_id)
);
create index on rfq_invitations(supplier_org_id, status);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references rfqs(id),
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  status text not null default 'submitted'
    check (status in ('submitted', 'withdrawn', 'accepted', 'rejected')),
  currency text not null default 'AED',
  delivery_cost numeric(14, 2) not null default 0,
  lead_time_days int not null,
  payment_terms text,
  validity_days int not null default 14,
  notes text,
  subtotal numeric(16, 2) not null default 0,
  total numeric(16, 2) not null default 0,
  submitted_by uuid references users(id),
  submitted_at timestamptz not null default now(),
  unique (rfq_id, supplier_org_id)
);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  rfq_item_id uuid not null references rfq_items(id),
  unit_price numeric(14, 4) not null check (unit_price >= 0),
  quantity numeric(14, 3) not null,
  available_qty numeric(14, 3) not null,
  brand text,
  offered_spec text,
  compliant boolean not null default true,
  lead_time_days int,
  notes text,
  unique (quote_id, rfq_item_id)
);

-- ---------------------------------------------------------------------------
-- Approvals and purchase orders
-- ---------------------------------------------------------------------------
create table purchase_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  rfq_id uuid not null references rfqs(id),
  quote_id uuid not null references quotes(id),
  supplier_org_id uuid not null references organizations(id),
  amount numeric(16, 2) not null,
  high_value boolean not null default false,
  justification text,
  -- snapshot of the AI comparison at the time of the request (recommendation only)
  ai_recommendation jsonb,
  follows_ai_recommendation boolean,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid not null references users(id),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create sequence po_seq start 50001;
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  rfq_id uuid references rfqs(id),
  quote_id uuid references quotes(id),
  purchase_request_id uuid unique references purchase_requests(id),
  po_number text not null unique default ('PO-' || to_char(now(), 'YYYY') || '-' || nextval('po_seq')),
  status text not null default 'issued' check (status in (
    'issued', 'confirmed', 'declined', 'in_delivery', 'partially_delivered', 'delivered', 'closed', 'cancelled')),
  currency text not null default 'AED',
  subtotal numeric(16, 2) not null,
  delivery_cost numeric(14, 2) not null default 0,
  total numeric(16, 2) not null,
  delivery_location text,
  required_date date,
  payment_terms text,
  supplier_note text,
  issued_by uuid references users(id),
  issued_at timestamptz not null default now(),
  confirmed_at timestamptz,
  promised_date date
);
create index on purchase_orders(org_id, status);
create index on purchase_orders(supplier_org_id, status);

create table po_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  rfq_item_id uuid references rfq_items(id),
  material_id uuid references materials(id),
  line_no int not null,
  description text not null,
  quantity numeric(14, 3) not null,
  unit text not null,
  unit_price numeric(14, 4) not null,
  line_total numeric(16, 2) not null,
  delivered_qty numeric(14, 3) not null default 0,
  accepted_qty numeric(14, 3) not null default 0
);

-- ---------------------------------------------------------------------------
-- Deliveries and verification
-- ---------------------------------------------------------------------------
create sequence dn_seq start 7001;
create table deliveries (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id),
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  number text not null unique default ('DN-' || nextval('dn_seq')),
  status text not null default 'scheduled' check (status in (
    'scheduled', 'dispatched', 'accepted', 'partially_accepted', 'rejected')),
  scheduled_date date,
  dispatched_at timestamptz,
  vehicle_no text,
  driver_name text,
  driver_phone text,
  -- QR token printed on the delivery note; opens the site verification screen.
  qr_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  verified_by uuid references users(id),
  verified_at timestamptz,
  verification_method text,
  otp_verified boolean not null default false,
  condition text check (condition in ('good', 'minor_damage', 'damaged')),
  site_notes text,
  created_at timestamptz not null default now()
);
create index on deliveries(po_id);

-- The OTP lives in its own table that only the supplier can read, so the site team
-- has to obtain it from the driver at handover. Checked via verify_delivery_otp().
create table delivery_secrets (
  delivery_id uuid primary key references deliveries(id) on delete cascade,
  supplier_org_id uuid not null references organizations(id),
  otp_code text not null
);

create table delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  po_item_id uuid not null references po_items(id),
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  qty_shipped numeric(14, 3) not null check (qty_shipped >= 0),
  qty_received numeric(14, 3),
  qty_accepted numeric(14, 3),
  qty_rejected numeric(14, 3),
  reject_reason text,
  unique (delivery_id, po_item_id)
);

create table delivery_documents (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  kind text not null check (kind in ('delivery_note', 'photo', 'other')),
  filename text not null,
  mime_type text not null,
  size_bytes int not null,
  content bytea not null,
  uploaded_by uuid references users(id),
  uploaded_by_org uuid references organizations(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Invoices, payments, disputes
-- ---------------------------------------------------------------------------
create table invoices (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id),
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  invoice_number text not null,
  amount numeric(16, 2) not null,
  status text not null default 'submitted' check (status in (
    'submitted', 'matched', 'mismatch', 'approved', 'paid', 'disputed', 'rejected')),
  -- three-way match: PO price x accepted quantity vs invoiced amount
  match_result jsonb,
  submitted_by uuid references users(id),
  submitted_at timestamptz not null default now(),
  approved_by uuid references users(id),
  approved_at timestamptz,
  unique (supplier_org_id, invoice_number)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  amount numeric(16, 2) not null,
  method text not null default 'bank_transfer',
  reference text,
  status text not null default 'paid' check (status in ('scheduled', 'paid')),
  recorded_by uuid references users(id),
  paid_at timestamptz not null default now()
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  po_id uuid not null references purchase_orders(id),
  delivery_id uuid references deliveries(id),
  invoice_id uuid references invoices(id),
  type text not null check (type in ('short_delivery', 'damaged', 'wrong_spec', 'pricing', 'late', 'other')),
  description text not null,
  amount_at_stake numeric(16, 2),
  status text not null default 'open' check (status in ('open', 'supplier_responded', 'escalated', 'resolved')),
  raised_by uuid references users(id),
  resolution text,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table dispute_comments (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete cascade,
  org_id uuid not null references organizations(id),
  supplier_org_id uuid not null references organizations(id),
  author_id uuid references users(id),
  author_org_id uuid references organizations(id),
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Intelligence & audit
-- ---------------------------------------------------------------------------
create table price_history (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id),
  supplier_org_id uuid references organizations(id),
  contractor_org_id uuid references organizations(id),
  unit_price numeric(14, 4) not null,
  quantity numeric(14, 3),
  source text not null check (source in ('po', 'quote', 'market')),
  observed_on date not null,
  created_at timestamptz not null default now()
);
create index on price_history(material_id, observed_on);

create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  kind text not null check (kind in ('extraction', 'normalisation', 'supplier_matching', 'quote_comparison')),
  subject_id uuid,
  engine text not null,
  status text not null default 'succeeded' check (status in ('succeeded', 'failed', 'fallback')),
  summary text,
  output jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  org_id uuid references organizations(id),
  supplier_org_id uuid references organizations(id),
  actor_id uuid references users(id),
  actor_org_id uuid references organizations(id),
  entity text not null,
  entity_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on audit_log(org_id, created_at desc);
