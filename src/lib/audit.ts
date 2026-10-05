import "server-only";
import type { SessionUser } from "./auth";
import type { Tx } from "./db";

export async function audit(
  tx: Tx,
  user: SessionUser,
  entity: string,
  entityId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
  parties: { orgId?: string | null; supplierOrgId?: string | null } = {},
) {
  const orgId = parties.orgId ?? (user.orgKind === "contractor" ? user.orgId : null);
  const supplierOrgId = parties.supplierOrgId ?? (user.orgKind === "supplier" ? user.orgId : null);
  await tx.query(
    `insert into audit_log (org_id, supplier_org_id, actor_id, actor_org_id, entity, entity_id, action, detail)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [orgId, supplierOrgId, user.userId, user.orgId, entity, entityId, action, JSON.stringify(detail)],
  );
}
