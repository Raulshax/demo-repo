import Link from "next/link";
import { Card, Field, Input, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CONTRACTOR_ROLES, requireUser } from "@/lib/auth";
import { rows, withActor } from "@/lib/db";
import { aed, date } from "@/lib/format";
import { createProject } from "../../actions/projects";

export const metadata = { title: "Projects" };

export default async function Projects() {
  const user = await requireUser(CONTRACTOR_ROLES);
  const projects = await withActor(user, (tx) => rows<{ id: string; code: string; name: string; location: string | null; status: string; budget_aed: number | null;
    end_date: string | null; drafts: number; open_reqs: number; committed: number }>(tx,
    `select p.id, p.code, p.name, p.location, p.status, p.budget_aed, p.end_date,
            (select count(*)::int from requirements r where r.project_id = p.id and r.status = 'draft') as drafts,
            (select count(*)::int from requirements r where r.project_id = p.id and r.status in ('confirmed','in_rfq')) as open_reqs,
            (select coalesce(sum(total),0) from purchase_orders po where po.project_id = p.id and po.status <> 'cancelled') as committed
     from projects p order by p.status = 'completed', p.created_at desc`));
  const canWrite = user.role !== "contractor_exec";
  return (
    <>
      <PageHeader title="Projects" subtitle="Each project holds its procurement documents, requirements, RFQs and orders." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Project</Th><Th>Location</Th><Th>Status</Th><Th right>Committed</Th><Th right>Budget</Th><Th>Requirements</Th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <Td><Link href={`/projects/${p.id}`} className="font-medium text-ink hover:text-accent">{p.name}</Link><div className="text-xs text-muted">{p.code} · ends {date(p.end_date)}</div></Td>
                  <Td className="text-muted">{p.location}</Td>
                  <Td><StatusBadge status={p.status} /></Td>
                  <Td right>{aed(p.committed)}</Td>
                  <Td right className="text-muted">{aed(p.budget_aed)}</Td>
                  <Td className="text-xs text-muted">{p.drafts ? <span className="text-ai">{p.drafts} to review</span> : null}{p.drafts && p.open_reqs ? " · " : ""}{p.open_reqs ? `${p.open_reqs} open` : ""}{!p.drafts && !p.open_reqs ? "—" : ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {canWrite && (
          <Card title="New project">
            <form action={createProject} className="space-y-3">
              <Field label="Project name"><Input name="name" required placeholder="Dubai Villa Project" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code"><Input name="code" required placeholder="DVP-05" /></Field>
                <Field label="Emirate"><Select name="emirate" defaultValue="Dubai">{["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain"].map((e) => <option key={e}>{e}</option>)}</Select></Field>
              </div>
              <Field label="Site location"><Input name="location" placeholder="Al Barari, Dubai" /></Field>
              <Field label="Client"><Input name="client_name" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start"><Input name="start_date" type="date" /></Field>
                <Field label="End"><Input name="end_date" type="date" /></Field>
              </div>
              <Field label="Budget (AED)"><Input name="budget_aed" inputMode="decimal" /></Field>
              <SubmitButton className="w-full">Create project</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
