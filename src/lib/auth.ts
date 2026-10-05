import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type Actor, type OrgKind, type Role, one, withActor } from "./db";

const COOKIE = "procure_session";
const TTL_HOURS = 12;

export interface SessionUser extends Actor {
  email: string;
  fullName: string;
  title: string | null;
  orgName: string;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function login(email: string, password: string): Promise<Role | null> {
  return withActor(null, async (tx) => {
    const u = await one<{ id: string; password_hash: string; active: boolean; role: Role }>(
      tx, "select * from auth_user_for_login($1)", [email.trim()]);
    // Compare against a dummy hash when the user is unknown to keep timing uniform.
    const ok = await bcrypt.compare(password, u?.password_hash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    if (!u || !u.active || !ok) return null;
    const token = randomBytes(32).toString("base64url");
    await tx.query("select auth_create_session($1, $2, $3)", [u.id, hash(token), TTL_HOURS]);
    (await cookies()).set(COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: TTL_HOURS * 3600,
    });
    return u.role;
  });
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await withActor(null, (tx) => tx.query("select auth_end_session($1)", [hash(token)]));
  jar.delete(COOKIE);
}

export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const r = await withActor(null, (tx) =>
    one<{ user_id: string; email: string; full_name: string; title: string | null; role: Role;
          org_id: string; org_name: string; org_kind: OrgKind }>(
      tx, "select * from auth_session($1)", [hash(token)]));
  if (!r) return null;
  return {
    userId: r.user_id, orgId: r.org_id, role: r.role, orgKind: r.org_kind,
    email: r.email, fullName: r.full_name, title: r.title, orgName: r.org_name,
  };
});

/** Server-side guard: redirects to /login if unauthenticated, 403s on wrong role. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (roles && !roles.includes(s.role)) redirect("/dashboard?denied=1");
  return s;
}

export const CONTRACTOR_ROLES: Role[] = ["contractor_user", "contractor_manager", "contractor_exec"];
export const CONTRACTOR_WRITERS: Role[] = ["contractor_user", "contractor_manager"];

export const ROLE_LABEL: Record<Role, string> = {
  contractor_user: "Procurement",
  contractor_manager: "Procurement Manager",
  contractor_exec: "Executive",
  supplier: "Supplier",
  platform_admin: "Platform Admin",
};
