"use server";

import bcrypt from "bcryptjs";
import { attempt, done, numOf, optStr, str } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { withActor } from "@/lib/db";

export async function setOrgStatus(orgId: string, status: "active" | "suspended") {
  const user = await requireUser(["platform_admin"]);
  await attempt("/admin/organizations", async () => {
    await withActor(user, async (tx) => {
      await tx.query("update organizations set status = $2 where id = $1 and kind <> 'platform'", [orgId, status]);
      await audit(tx, user, "organization", orgId, status === "active" ? "activated" : "suspended", {}, { orgId: null });
    });
  });
  done("/admin/organizations", `Organisation ${status === "active" ? "activated" : "suspended"}.`);
}

export async function verifySupplier(orgId: string) {
  const user = await requireUser(["platform_admin"]);
  await attempt("/admin/organizations", async () => {
    await withActor(user, async (tx) => {
      await tx.query("update supplier_profiles set verified = true where org_id = $1", [orgId]);
      await audit(tx, user, "organization", orgId, "verified", {}, { orgId: null, supplierOrgId: orgId });
    });
  });
  done("/admin/organizations", "Supplier verified.");
}

export async function createOrganization(fd: FormData) {
  const user = await requireUser(["platform_admin"]);
  await attempt("/admin/organizations", async () => {
    const kind = str(fd, "kind");
    const name = str(fd, "name"), email = str(fd, "email").toLowerCase(), contact = str(fd, "contact");
    if (!name || !email || !contact || !["contractor", "supplier"].includes(kind)) throw new Error("Name, kind, contact and email are required.");
    const tempPassword = str(fd, "password");
    if (tempPassword.length < 8) throw new Error("Temporary password must be at least 8 characters.");
    await withActor(user, async (tx) => {
      const org = (await tx.query("insert into organizations (name, kind, trade_license) values ($1,$2,$3) returning id", [name, kind, optStr(fd, "trade_license")])).rows[0];
      await tx.query("insert into users (org_id, email, full_name, role, password_hash) values ($1,$2,$3,$4,$5)",
        [org.id, email, contact, kind === "supplier" ? "supplier" : "contractor_manager", await bcrypt.hash(tempPassword, 10)]);
      if (kind === "supplier") await tx.query("insert into supplier_profiles (org_id, categories, contact_email) values ($1,$2,$3)", [org.id, fd.getAll("categories").map(String), email]);
      await audit(tx, user, "organization", org.id, "created", { name, kind }, { orgId: null });
    }).catch((e) => { throw /unique/.test(String(e)) ? new Error("A user with that email already exists.") : e; });
  });
  done("/admin/organizations", "Organisation created with its first user.");
}

export async function addMaterial(fd: FormData) {
  const user = await requireUser(["platform_admin"]);
  await attempt("/materials", async () => {
    const sku = str(fd, "sku").toUpperCase(), name = str(fd, "name"), category = str(fd, "category_code"), unit = str(fd, "base_unit");
    if (!sku || !name || !category || !unit) throw new Error("SKU, name, category and unit are required.");
    let spec: Record<string, unknown> = {};
    try { spec = JSON.parse(str(fd, "spec") || "{}"); } catch { throw new Error("Specification must be valid JSON."); }
    await withActor(user, async (tx) => {
      await tx.query(`insert into materials (sku, category_code, name, spec, base_unit, keywords, typical_brands, benchmark_price_aed)
                      values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [sku, category, name, JSON.stringify(spec), unit, str(fd, "keywords").split(",").map((s) => s.trim()).filter(Boolean),
         str(fd, "brands").split(",").map((s) => s.trim()).filter(Boolean), numOf(fd, "benchmark_price_aed")]);
      await audit(tx, user, "material", null, "created", { sku, name }, { orgId: null });
    }).catch((e) => { throw /unique/.test(String(e)) ? new Error(`SKU ${sku} already exists.`) : e; });
  });
  done("/materials", "Material added to the central database.");
}
