-- Row Level Security, privileges, auth functions and integrity triggers.
-- Tenancy is enforced here, in the database, not only in the application.

-- ---------------------------------------------------------------------------
-- Privileges for the runtime role
-- ---------------------------------------------------------------------------
grant usage on schema public to procure_app;
grant select, insert, update, delete on all tables in schema public to procure_app;
grant usage on all sequences in schema public to procure_app;

-- Sessions and OTP secrets are only reachable through SECURITY DEFINER functions.
revoke all on sessions from procure_app;
revoke all on delivery_secrets from procure_app;
-- Password hashes are never selectable by the runtime role.
revoke select on users from procure_app;
grant select (id, org_id, email, full_name, title, role, active, created_at) on users to procure_app;
-- The audit trail is append-only.
revoke update, delete on audit_log from procure_app;
revoke update, delete on ai_runs from procure_app;
-- Price history and master data are written by the platform (definer functions / admin).
revoke update, delete on price_history from procure_app;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','users','categories','materials','supplier_profiles','supplier_products',
    'projects','documents','requirements','rfqs','rfq_items','rfq_invitations','quotes',
    'quote_items','purchase_requests','purchase_orders','po_items','deliveries','delivery_items',
    'delivery_documents','invoices','payments','disputes','dispute_comments','price_history',
    'ai_runs','audit_log']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Organisations / users
-- ---------------------------------------------------------------------------
create policy org_select on organizations for select using (
  is_admin()
  or id = app_org()
  -- the supplier directory is visible to contractors
  or (kind = 'supplier' and app_org_kind() = 'contractor')
  -- suppliers can see the name of contractors that have invited them
  or (kind = 'contractor' and exists (
        select 1 from rfq_invitations i
        where i.org_id = organizations.id and i.supplier_org_id = app_org()
          and i.status <> 'recommended'))
);
create policy org_update on organizations for update
  using (is_admin() or (id = app_org() and app_role() in ('contractor_manager', 'supplier')))
  with check (is_admin() or id = app_org());
create policy org_insert on organizations for insert with check (is_admin());

create policy users_select on users for select using (is_admin() or org_id = app_org());
create policy users_write on users for all
  using (is_admin() or (org_id = app_org() and app_role() = 'contractor_manager'))
  with check (is_admin() or (org_id = app_org() and app_role() = 'contractor_manager'
                              and role in ('contractor_user', 'contractor_manager', 'contractor_exec')));

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------
create policy categories_read on categories for select using (app_user() is not null);
create policy categories_admin on categories for all using (is_admin()) with check (is_admin());
create policy materials_read on materials for select using (app_user() is not null);
create policy materials_admin on materials for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
create policy sp_select on supplier_profiles for select using (
  is_admin() or org_id = app_org() or app_org_kind() = 'contractor');
create policy sp_write on supplier_profiles for all
  using (is_admin() or (org_id = app_org() and app_role() = 'supplier'))
  with check (is_admin() or (org_id = app_org() and app_role() = 'supplier'));

-- A supplier's catalogue prices are visible to contractors and to the supplier itself,
-- never to competing suppliers.
create policy sprod_select on supplier_products for select using (
  is_admin() or supplier_org_id = app_org() or app_org_kind() = 'contractor');
create policy sprod_write on supplier_products for all
  using (is_admin() or (supplier_org_id = app_org() and app_role() = 'supplier'))
  with check (is_admin() or (supplier_org_id = app_org() and app_role() = 'supplier'));

-- ---------------------------------------------------------------------------
-- Contractor-private tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['projects','documents','requirements','purchase_requests']
  loop
    execute format($f$
      create policy %1$s_tenant on %1$I for all
        using (is_admin() or org_id = app_org())
        with check (org_id = app_org() and app_org_kind() = 'contractor'
                    and app_role() in ('contractor_user', 'contractor_manager'))
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RFQs: contractor owns; invited suppliers can read once actually invited
-- ---------------------------------------------------------------------------
create policy rfq_invitations_select on rfq_invitations for select using (
  is_admin() or org_id = app_org()
  or (supplier_org_id = app_org() and status <> 'recommended'));
create policy rfq_invitations_contractor on rfq_invitations for all
  using (org_id = app_org() and app_org_kind() = 'contractor')
  with check (org_id = app_org() and app_org_kind() = 'contractor');
-- Suppliers may update their own invitation (viewed / declined / quoted).
create policy rfq_invitations_supplier_update on rfq_invitations for update
  using (supplier_org_id = app_org() and status <> 'recommended')
  with check (supplier_org_id = app_org());

create policy rfqs_select on rfqs for select using (
  is_admin() or org_id = app_org()
  or exists (select 1 from rfq_invitations i
             where i.rfq_id = rfqs.id and i.supplier_org_id = app_org() and i.status <> 'recommended'));
create policy rfqs_write on rfqs for all
  using (org_id = app_org() and app_org_kind() = 'contractor')
  with check (org_id = app_org() and app_org_kind() = 'contractor'
              and app_role() in ('contractor_user', 'contractor_manager'));

create policy rfq_items_select on rfq_items for select using (
  is_admin() or org_id = app_org()
  or exists (select 1 from rfq_invitations i
             where i.rfq_id = rfq_items.rfq_id and i.supplier_org_id = app_org() and i.status <> 'recommended'));
create policy rfq_items_write on rfq_items for all
  using (org_id = app_org() and app_org_kind() = 'contractor')
  with check (org_id = app_org() and app_org_kind() = 'contractor');

-- ---------------------------------------------------------------------------
-- Quotes: a supplier sees ONLY its own quote. The contractor sees all quotes on its RFQs.
-- ---------------------------------------------------------------------------
create policy quotes_select on quotes for select using (
  is_admin() or org_id = app_org() or supplier_org_id = app_org());
create policy quotes_supplier_insert on quotes for insert with check (
  supplier_org_id = app_org() and app_role() = 'supplier'
  and exists (select 1 from rfq_invitations i
              where i.rfq_id = quotes.rfq_id and i.supplier_org_id = app_org()
                and i.org_id = quotes.org_id
                and i.status in ('invited', 'viewed', 'quoted')));
create policy quotes_supplier_update on quotes for update
  using (supplier_org_id = app_org() and app_role() = 'supplier' and status = 'submitted')
  with check (supplier_org_id = app_org());
-- Contractor may only change status (accepted / rejected) - enforced by trigger below.
create policy quotes_contractor_update on quotes for update
  using (org_id = app_org() and app_org_kind() = 'contractor')
  with check (org_id = app_org());

create policy quote_items_select on quote_items for select using (
  is_admin() or org_id = app_org() or supplier_org_id = app_org());
create policy quote_items_supplier on quote_items for all
  using (supplier_org_id = app_org() and app_role() = 'supplier')
  with check (supplier_org_id = app_org() and app_role() = 'supplier'
              and exists (select 1 from quotes q where q.id = quote_items.quote_id
                          and q.supplier_org_id = app_org() and q.org_id = quote_items.org_id));

-- ---------------------------------------------------------------------------
-- Two-party tables (contractor + the supplier on the order)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['purchase_orders','po_items','deliveries','delivery_items',
                           'delivery_documents','invoices','payments','disputes','dispute_comments']
  loop
    execute format($f$
      create policy %1$s_select on %1$I for select
        using (is_admin() or org_id = app_org() or supplier_org_id = app_org())
    $f$, t);
    execute format($f$
      create policy %1$s_contractor on %1$I for all
        using (org_id = app_org() and app_org_kind() = 'contractor')
        with check (org_id = app_org() and app_org_kind() = 'contractor'
                    and app_role() in ('contractor_user', 'contractor_manager'))
    $f$, t);
  end loop;
end $$;

-- Supplier write access on two-party tables, narrowed per table.
create policy po_supplier_update on purchase_orders for update
  using (supplier_org_id = app_org() and app_role() = 'supplier')
  with check (supplier_org_id = app_org());
create policy deliveries_supplier on deliveries for all
  using (supplier_org_id = app_org() and app_role() = 'supplier')
  with check (supplier_org_id = app_org() and app_role() = 'supplier'
              and exists (select 1 from purchase_orders p where p.id = deliveries.po_id
                          and p.supplier_org_id = app_org() and p.org_id = deliveries.org_id));
create policy delivery_items_supplier on delivery_items for all
  using (supplier_org_id = app_org() and app_role() = 'supplier')
  with check (supplier_org_id = app_org() and app_role() = 'supplier');
create policy delivery_documents_supplier on delivery_documents for insert
  with check (supplier_org_id = app_org() and app_role() = 'supplier');
create policy invoices_supplier on invoices for insert
  with check (supplier_org_id = app_org() and app_role() = 'supplier'
              and exists (select 1 from purchase_orders p where p.id = invoices.po_id
                          and p.supplier_org_id = app_org() and p.org_id = invoices.org_id));
create policy disputes_supplier_update on disputes for update
  using (supplier_org_id = app_org() and app_role() = 'supplier')
  with check (supplier_org_id = app_org());
create policy dispute_comments_supplier on dispute_comments for insert
  with check (supplier_org_id = app_org() and author_org_id = app_org() and app_role() = 'supplier');
create policy disputes_admin on disputes for update using (is_admin()) with check (is_admin());
create policy dispute_comments_admin on dispute_comments for insert with check (is_admin());

-- po_items.delivered/accepted totals are maintained by the verification function (definer).

-- ---------------------------------------------------------------------------
-- Intelligence, AI runs, audit
-- ---------------------------------------------------------------------------
-- Contractors see the market index and their own purchase history.
-- Suppliers see only their own price points - never a competitor's.
create policy ph_select on price_history for select using (
  is_admin()
  or (app_org_kind() = 'contractor' and (source = 'market' or contractor_org_id = app_org()))
  or (app_org_kind() = 'supplier' and supplier_org_id = app_org()));
create policy ph_insert on price_history for insert with check (
  is_admin() or (contractor_org_id = app_org() and app_org_kind() = 'contractor'));

create policy ai_runs_tenant on ai_runs for all
  using (is_admin() or org_id = app_org()) with check (org_id = app_org());

create policy audit_select on audit_log for select using (
  is_admin() or org_id = app_org() or supplier_org_id = app_org() or actor_org_id = app_org());
create policy audit_insert on audit_log for insert with check (
  actor_id = app_user() and actor_org_id = app_org());

-- ---------------------------------------------------------------------------
-- Auth (SECURITY DEFINER: the only path to password hashes and sessions)
-- ---------------------------------------------------------------------------
create or replace function auth_user_for_login(p_email text)
returns table (id uuid, password_hash text, active boolean, role text)
language sql security definer set search_path = public as $$
  select u.id, u.password_hash, u.active and o.status = 'active', u.role
  from users u join organizations o on o.id = u.org_id
  where lower(u.email) = lower(p_email)
$$;

create or replace function auth_create_session(p_user uuid, p_token_hash text, p_ttl_hours int)
returns void language sql security definer set search_path = public as $$
  insert into sessions (token_hash, user_id, expires_at)
  values (p_token_hash, p_user, now() + make_interval(hours => p_ttl_hours));
$$;

create or replace function auth_session(p_token_hash text)
returns table (user_id uuid, email text, full_name text, title text, role text,
               org_id uuid, org_name text, org_kind text)
language sql security definer set search_path = public as $$
  select u.id, u.email, u.full_name, u.title, u.role, o.id, o.name, o.kind
  from sessions s
  join users u on u.id = s.user_id
  join organizations o on o.id = u.org_id
  where s.token_hash = p_token_hash and s.expires_at > now()
    and u.active and o.status = 'active'
$$;

create or replace function auth_end_session(p_token_hash text)
returns void language sql security definer set search_path = public as $$
  delete from sessions where token_hash = p_token_hash;
$$;

-- ---------------------------------------------------------------------------
-- Delivery OTP: generated for the supplier; checked for the contractor's site team.
-- ---------------------------------------------------------------------------
create or replace function delivery_issue_otp(p_delivery uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d deliveries;
begin
  select * into d from deliveries where id = p_delivery;
  if d.id is null or d.supplier_org_id <> app_org() then
    raise exception 'not permitted';
  end if;
  insert into delivery_secrets (delivery_id, supplier_org_id, otp_code)
  values (p_delivery, d.supplier_org_id, lpad((floor(random() * 1000000))::int::text, 6, '0'))
  on conflict (delivery_id) do nothing;
end $$;

create or replace function delivery_otp_for_supplier(p_delivery uuid)
returns text language sql security definer set search_path = public as $$
  select otp_code from delivery_secrets
  where delivery_id = p_delivery and supplier_org_id = app_org()
$$;

create or replace function verify_delivery_otp(p_delivery uuid, p_code text)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from delivery_secrets s join deliveries d on d.id = s.delivery_id
    where s.delivery_id = p_delivery and d.org_id = app_org() and s.otp_code = p_code)
$$;

-- ---------------------------------------------------------------------------
-- Network intelligence (aggregated, anonymised across all contractors)
-- ---------------------------------------------------------------------------
create or replace function supplier_scorecards()
returns table (supplier_org_id uuid, deliveries int, on_time_rate numeric,
               fill_rate numeric, acceptance_rate numeric, orders int, disputes int)
language sql stable security definer set search_path = public as $$
  with d as (
    select dv.supplier_org_id,
           count(*) filter (where dv.verified_at is not null) as delivered,
           count(*) filter (where dv.verified_at is not null
                              and dv.verified_at::date <= coalesce(po.promised_date, po.required_date)) as on_time
    from deliveries dv join purchase_orders po on po.id = dv.po_id
    group by dv.supplier_org_id
  ), q as (
    select di.supplier_org_id,
           sum(di.qty_accepted) as accepted, sum(di.qty_received) as received,
           sum(di.qty_shipped) as shipped
    from delivery_items di where di.qty_received is not null
    group by di.supplier_org_id
  ), f as (
    select pi.supplier_org_id, sum(pi.accepted_qty) as accepted, sum(pi.quantity) as ordered,
           count(distinct pi.po_id) as orders
    from po_items pi join purchase_orders po on po.id = pi.po_id
    where po.status in ('delivered', 'closed', 'partially_delivered')
    group by pi.supplier_org_id
  ), x as (
    select supplier_org_id, count(*) as n from disputes group by supplier_org_id
  )
  select o.id,
         coalesce(d.delivered, 0)::int,
         case when coalesce(d.delivered, 0) > 0 then round(d.on_time::numeric / d.delivered, 4) end,
         case when coalesce(f.ordered, 0) > 0 then round(least(f.accepted / f.ordered, 1), 4) end,
         case when coalesce(q.received, 0) > 0 then round(q.accepted / q.received, 4) end,
         coalesce(f.orders, 0)::int,
         coalesce(x.n, 0)::int
  from organizations o
  left join d on d.supplier_org_id = o.id
  left join q on q.supplier_org_id = o.id
  left join f on f.supplier_org_id = o.id
  left join x on x.supplier_org_id = o.id
  where o.kind = 'supplier' and app_org_kind() in ('contractor', 'platform')
$$;

-- Anonymised price benchmark per material across the whole network (no supplier identity).
create or replace function material_benchmarks(p_materials uuid[])
returns table (material_id uuid, samples int, p25 numeric, median numeric, p75 numeric,
               last_90d_median numeric)
language sql stable security definer set search_path = public as $$
  select ph.material_id, count(*)::int,
         percentile_cont(0.25) within group (order by ph.unit_price)::numeric,
         percentile_cont(0.5) within group (order by ph.unit_price)::numeric,
         percentile_cont(0.75) within group (order by ph.unit_price)::numeric,
         (percentile_cont(0.5) within group (order by ph.unit_price)
            filter (where ph.observed_on > current_date - 90))::numeric
  from price_history ph
  where ph.material_id = any(p_materials)
    and ph.observed_on > current_date - 365
    and app_org_kind() in ('contractor', 'platform')
  group by ph.material_id
$$;

-- ---------------------------------------------------------------------------
-- Integrity triggers: financial controls enforced in the database
-- ---------------------------------------------------------------------------

-- Purchase approvals: only a contractor manager may decide; never the requester;
-- high-value approvals require a written note. AI never approves (no system path exists).
create or replace function trg_purchase_request_decision() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    if old.status <> 'pending' then
      raise exception 'purchase request already decided';
    end if;
    if app_role() <> 'contractor_manager' then
      raise exception 'only a contractor manager can approve or reject purchases';
    end if;
    if new.decided_by is distinct from app_user() then
      raise exception 'decided_by must be the acting user';
    end if;
    if new.decided_by = old.requested_by then
      raise exception 'segregation of duties: requester cannot approve own request';
    end if;
    if new.high_value and new.status = 'approved' and coalesce(btrim(new.decision_note), '') = '' then
      raise exception 'high-value approvals require a decision note';
    end if;
    new.decided_at := now();
  end if;
  if new.amount <> old.amount or new.quote_id <> old.quote_id or new.supplier_org_id <> old.supplier_org_id then
    raise exception 'purchase request commercial terms are immutable';
  end if;
  return new;
end $$;
create trigger purchase_request_decision before update on purchase_requests
  for each row execute function trg_purchase_request_decision();

-- A PO can only be issued from an approved purchase request with matching terms.
create or replace function trg_po_requires_approval() returns trigger
language plpgsql as $$
declare pr purchase_requests;
begin
  select * into pr from purchase_requests where id = new.purchase_request_id;
  if pr.id is null or pr.status <> 'approved' then
    raise exception 'purchase order requires an approved purchase request';
  end if;
  if pr.supplier_org_id <> new.supplier_org_id or pr.org_id <> new.org_id
     or abs(pr.amount - new.total) > 0.01 then
    raise exception 'purchase order does not match the approved request';
  end if;
  return new;
end $$;
create trigger po_requires_approval before insert on purchase_orders
  for each row execute function trg_po_requires_approval();

-- Suppliers may only change the operational status fields of a PO.
create or replace function trg_po_supplier_guard() returns trigger
language plpgsql as $$
begin
  if app_org_kind() = 'supplier' then
    if (new.subtotal, new.total, new.delivery_cost, new.org_id, new.supplier_org_id,
        new.project_id, new.purchase_request_id, new.payment_terms, new.required_date)
       is distinct from
       (old.subtotal, old.total, old.delivery_cost, old.org_id, old.supplier_org_id,
        old.project_id, old.purchase_request_id, old.payment_terms, old.required_date) then
      raise exception 'suppliers cannot change commercial terms of a purchase order';
    end if;
    if new.status is distinct from old.status and not (
        (old.status = 'issued' and new.status in ('confirmed', 'declined'))
        or (old.status in ('confirmed', 'partially_delivered') and new.status = 'in_delivery')) then
      raise exception 'invalid supplier status transition % -> %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;
create trigger po_supplier_guard before update on purchase_orders
  for each row execute function trg_po_supplier_guard();

-- Contractors may only change a quote's status, never its prices.
create or replace function trg_quote_contractor_guard() returns trigger
language plpgsql as $$
begin
  if app_org_kind() = 'contractor' and
     (new.total, new.subtotal, new.delivery_cost, new.lead_time_days)
       is distinct from (old.total, old.subtotal, old.delivery_cost, old.lead_time_days) then
    raise exception 'contractors cannot modify supplier quotes';
  end if;
  return new;
end $$;
create trigger quote_contractor_guard before update on quotes
  for each row execute function trg_quote_contractor_guard();

-- Site verification is done by the contractor; suppliers cannot self-verify a delivery.
create or replace function trg_delivery_verify_guard() returns trigger
language plpgsql as $$
begin
  if app_org_kind() = 'supplier' and (
       new.status in ('accepted', 'partially_accepted', 'rejected')
       or new.verified_at is distinct from old.verified_at
       or new.verified_by is distinct from old.verified_by) then
    raise exception 'suppliers cannot verify their own deliveries';
  end if;
  return new;
end $$;
create trigger delivery_verify_guard before update on deliveries
  for each row execute function trg_delivery_verify_guard();

create or replace function trg_delivery_item_guard() returns trigger
language plpgsql as $$
begin
  if app_org_kind() = 'supplier' and
     (new.qty_received, new.qty_accepted, new.qty_rejected)
       is distinct from (old.qty_received, old.qty_accepted, old.qty_rejected) then
    raise exception 'suppliers cannot record received quantities';
  end if;
  return new;
end $$;
create trigger delivery_item_guard before update on delivery_items
  for each row execute function trg_delivery_item_guard();

-- Roll accepted delivery quantities up onto the PO lines and PO status.
create or replace function trg_delivery_rollup() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_open numeric; v_any numeric;
begin
  select po_id into v_po from deliveries where id = new.delivery_id;
  update po_items pi set
    delivered_qty = coalesce((select sum(di.qty_received) from delivery_items di
                              where di.po_item_id = pi.id and di.qty_received is not null), 0),
    accepted_qty  = coalesce((select sum(di.qty_accepted) from delivery_items di
                              where di.po_item_id = pi.id and di.qty_accepted is not null), 0)
  where pi.po_id = v_po;
  select sum(greatest(quantity - accepted_qty, 0)), sum(accepted_qty) into v_open, v_any
  from po_items where po_id = v_po;
  update purchase_orders set status = case
      when v_open <= 0 then 'delivered'
      when v_any > 0 then 'partially_delivered'
      else status end
  where id = v_po and status not in ('closed', 'cancelled');
  return new;
end $$;
create trigger delivery_rollup after update of qty_accepted on delivery_items
  for each row execute function trg_delivery_rollup();

-- updated_at maintenance
create or replace function trg_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger requirements_touch before update on requirements for each row execute function trg_touch();

grant execute on all functions in schema public to procure_app;
