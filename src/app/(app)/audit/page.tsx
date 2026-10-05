import { Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { dateTime, titleCase } from "@/lib/format";

export const metadata = { title: "Audit trail" };

export default async function Audit() {
  const user = await requireUser();
  const list = await withActor(user, (tx) => rows<{ id: number; entity: string; action: string; detail: Record<string, unknown>; created_at: string; actor: string | null; actor_org: string | null }>(tx,
    `select a.id, a.entity, a.action, a.detail, a.created_at, u.full_name as actor, o.name as actor_org
     from audit_log a left join users u on u.id = a.actor_id left join organizations o on o.id = a.actor_org_id
     order by a.created_at desc, a.id desc limit 200`));
  return (
    <>
      <PageHeader title={user.orgKind === "supplier" ? "Activity" : "Audit trail"} subtitle="Append-only record of every procurement decision and action. It cannot be edited or deleted." />
      <Card padded={false}>
        <Table>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>What</Th><Th>Details</Th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}>
              <Td className="whitespace-nowrap text-muted">{dateTime(a.created_at)}</Td>
              <Td>{a.actor ?? "—"}<div className="text-xs text-muted">{a.actor_org}</div></Td>
              <Td>{titleCase(a.entity)} · <span className="font-medium">{titleCase(a.action)}</span></Td>
              <Td className="font-mono text-[11px] text-muted">{Object.entries(a.detail ?? {}).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}</Td>
            </tr>))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
