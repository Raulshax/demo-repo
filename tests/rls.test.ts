// Integration tests: run against the seeded database as the runtime (non-owner) role,
// proving tenancy and financial controls are enforced by PostgreSQL itself.
import { config } from "dotenv";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });
pg.types.setTypeParser(1700, (v) => Number(v));

const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL });

interface Actor { userId: string; orgId: string; role: string; orgKind: string }
const actors: Record<string, Actor> = {};

async function as<T>(who: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const a = actors[who];
  const c = await app.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('app.user_id',$1,true), set_config('app.org_id',$2,true), set_config('app.role',$3,true), set_config('app.org_kind',$4,true)`,
      [a.userId, a.orgId, a.role, a.orgKind]);
    return await fn(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

const liveRfqTitle = "Sub-main cables - Levels 1-10";

beforeAll(async () => {
  await owner.connect();
  const users = (await owner.query(`select u.id, u.email, u.role, u.org_id, o.kind from users u join organizations o on o.id = u.org_id`)).rows;
  for (const u of users) actors[u.email] = { userId: u.id, orgId: u.org_id, role: u.role, orgKind: u.kind };
});
afterAll(async () => { await owner.end(); await app.end(); });

describe("tenant isolation", () => {
  it("a contractor cannot see another contractor's projects, RFQs, quotes or orders", async () => {
    await as("lena@meridianbuild.demo", async (c) => {
      const projects = (await c.query("select code from projects")).rows.map((r) => r.code);
      expect(projects).toEqual(["MB-HOS-1"]);
      expect((await c.query("select 1 from rfqs where title = $1", [liveRfqTitle])).rowCount).toBe(0);
      const foreign = await c.query(`select count(*)::int n from purchase_orders po join organizations o on o.id = po.org_id where o.name like 'Falcon%'`);
      expect(foreign.rows[0].n).toBe(0);
      expect((await c.query("select count(*)::int n from quotes q join organizations o on o.id = q.org_id where o.name like 'Falcon%'")).rows[0].n).toBe(0);
    });
  });

  it("cannot write rows into another tenant", async () => {
    const falcon = actors["omar@falconcrest.demo"].orgId;
    await expect(as("lena@meridianbuild.demo", (c) =>
      c.query("insert into projects (org_id, code, name) values ($1, 'HACK', 'x')", [falcon]))).rejects.toThrow(/row-level security/);
  });
});

describe("supplier confidentiality", () => {
  it("an invited supplier sees the RFQ but only its own quote", async () => {
    await as("sales@gulfcable.demo", async (c) => {
      const rfq = await c.query("select id from rfqs where title = $1", [liveRfqTitle]);
      expect(rfq.rowCount).toBe(1);
      const quotes = (await c.query("select supplier_org_id from quotes where rfq_id = $1", [rfq.rows[0].id])).rows;
      expect(quotes).toHaveLength(1);
      expect(quotes[0].supplier_org_id).toBe(actors["sales@gulfcable.demo"].orgId);
      const items = (await c.query("select distinct qi.supplier_org_id from quote_items qi join quotes q on q.id = qi.quote_id where q.rfq_id = $1", [rfq.rows[0].id])).rows;
      expect(items).toHaveLength(1);
      // cannot see who else was invited
      expect((await c.query("select count(*)::int n from rfq_invitations where rfq_id = $1", [rfq.rows[0].id])).rows[0].n).toBe(1);
    });
  });

  it("the contractor sees every quote on its RFQ", async () => {
    await as("omar@falconcrest.demo", async (c) => {
      const n = await c.query("select count(*)::int n from quotes q join rfqs r on r.id = q.rfq_id where r.title = $1", [liveRfqTitle]);
      expect(n.rows[0].n).toBe(3);
    });
  });

  it("a supplier never sees competitor catalogue prices or price history", async () => {
    await as("sales@gulfcable.demo", async (c) => {
      const me = actors["sales@gulfcable.demo"].orgId;
      const others = await c.query("select count(*)::int n from supplier_products where supplier_org_id <> $1", [me]);
      expect(others.rows[0].n).toBe(0);
      const ph = await c.query("select count(*)::int n from price_history where supplier_org_id is distinct from $1", [me]);
      expect(ph.rows[0].n).toBe(0);
      expect((await c.query("select * from material_benchmarks(array(select id from materials))")).rowCount).toBe(0);
    });
  });

  it("an uninvited supplier cannot see the RFQ at all", async () => {
    await as("sales@desertbreeze.demo", async (c) => {
      expect((await c.query("select 1 from rfqs where title = $1", [liveRfqTitle])).rowCount).toBe(0);
      expect((await c.query("select 1 from rfq_items ri join rfqs r on r.id = ri.rfq_id where r.title = $1", [liveRfqTitle])).rowCount).toBe(0);
    });
  });

  it("a supplier cannot submit a quote to an RFQ it was not invited to", async () => {
    const rfq = (await owner.query("select id, org_id from rfqs where title = $1", [liveRfqTitle])).rows[0];
    await expect(as("sales@desertbreeze.demo", (c) =>
      c.query("insert into quotes (rfq_id, org_id, supplier_org_id, lead_time_days) values ($1,$2,$3,2)", [rfq.id, rfq.org_id, actors["sales@desertbreeze.demo"].orgId])))
      .rejects.toThrow(/row-level security/);
  });
});

describe("credentials", () => {
  it("the runtime role cannot read password hashes or sessions", async () => {
    await expect(as("omar@falconcrest.demo", (c) => c.query("select password_hash from users"))).rejects.toThrow(/permission denied/);
    await expect(as("omar@falconcrest.demo", (c) => c.query("select * from sessions"))).rejects.toThrow(/permission denied/);
  });
  it("the site team cannot read the delivery OTP but can verify it", async () => {
    await expect(as("daniel@falconcrest.demo", (c) => c.query("select * from delivery_secrets"))).rejects.toThrow(/permission denied/);
    const dv = (await owner.query("select id from deliveries where status = 'dispatched' and vehicle_no = 'DXB 48213'")).rows[0].id;
    expect(await as("daniel@falconcrest.demo", async (c) => (await c.query("select verify_delivery_otp($1,'000000') ok", [dv])).rows[0].ok)).toBe(false);
    expect(await as("daniel@falconcrest.demo", async (c) => (await c.query("select verify_delivery_otp($1,'482913') ok", [dv])).rows[0].ok)).toBe(true);
    expect(await as("orders@coolpoint.demo", async (c) => (await c.query("select delivery_otp_for_supplier($1) otp", [dv])).rows[0].otp)).toBe("482913");
  });
});

describe("financial controls enforced in the database", () => {
  const pendingPr = async () => (await owner.query("select id, requested_by from purchase_requests where status = 'pending' limit 1")).rows[0];

  it("a procurement user cannot approve a purchase", async () => {
    const pr = await pendingPr();
    const u = actors["daniel@falconcrest.demo"];
    await expect(as("daniel@falconcrest.demo", (c) =>
      c.query("update purchase_requests set status='approved', decided_by=$2 where id=$1", [pr.id, u.userId]))).rejects.toThrow(/only a contractor manager/);
  });

  it("an executive (read-only) cannot approve either", async () => {
    const pr = await pendingPr();
    await expect(as("rajesh@falconcrest.demo", (c) =>
      c.query("update purchase_requests set status='approved', decided_by=$2 where id=$1", [pr.id, actors["rajesh@falconcrest.demo"].userId])))
      .rejects.toThrow();
  });

  it("a manager can approve someone else's request", async () => {
    const pr = await pendingPr();
    const r = await as("sara@falconcrest.demo", (c) =>
      c.query("update purchase_requests set status='approved', decided_by=$2, decision_note='ok' where id=$1 returning status", [pr.id, actors["sara@falconcrest.demo"].userId]));
    expect(r.rows[0].status).toBe("approved");
  });

  it("a purchase order cannot be created without an approved request", async () => {
    const pr = await pendingPr();
    const row = (await owner.query("select * from purchase_requests where id = $1", [pr.id])).rows[0];
    await expect(as("sara@falconcrest.demo", (c) =>
      c.query(`insert into purchase_orders (org_id, supplier_org_id, project_id, purchase_request_id, subtotal, total) values ($1,$2,$3,$4,$5,$5)`,
        [row.org_id, row.supplier_org_id, row.project_id, row.id, row.amount]))).rejects.toThrow(/approved purchase request/);
  });

  it("a supplier cannot change the commercial terms of a PO or verify its own delivery", async () => {
    const po = (await owner.query("select po.id from purchase_orders po join organizations o on o.id = po.supplier_org_id where o.name like 'Coolpoint%' and po.status = 'in_delivery'")).rows[0].id;
    await expect(as("orders@coolpoint.demo", (c) => c.query("update purchase_orders set total = total * 2 where id = $1", [po])))
      .rejects.toThrow(/commercial terms/);
    await expect(as("orders@coolpoint.demo", (c) => c.query("update deliveries set status = 'accepted' where po_id = $1", [po])))
      .rejects.toThrow(/cannot verify/);
  });

  it("contractors cannot alter supplier quote prices", async () => {
    const q = (await owner.query("select q.id from quotes q join rfqs r on r.id = q.rfq_id where r.title = $1 limit 1", [liveRfqTitle])).rows[0].id;
    await expect(as("omar@falconcrest.demo", (c) => c.query("update quotes set total = 1 where id = $1", [q]))).rejects.toThrow(/cannot modify supplier quotes/);
  });

  it("the audit trail is append-only", async () => {
    await expect(as("sara@falconcrest.demo", (c) => c.query("delete from audit_log"))).rejects.toThrow(/permission denied/);
  });
});
