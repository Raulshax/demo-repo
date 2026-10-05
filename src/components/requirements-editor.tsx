"use client";

import { useMemo, useState } from "react";
import { Badge, ConfidenceBadge, StatusBadge, cx } from "./ui";
import { SubmitButton } from "./client";

export interface EditorRow {
  id: string; status: string; raw_text: string | null; description: string; material_id: string | null; category_code: string | null;
  quantity: number; unit: string; brand: string | null; required_date: string | null; location: string | null; notes: string | null;
  confidence: number | null; match_method: string | null;
}
export interface MaterialOption { id: string; name: string; category_code: string; base_unit: string }

const input = "w-full border border-line-strong bg-surface px-1.5 py-1 text-sm focus:border-accent focus:outline-none";

export function RequirementsEditor({ rows: initial, materials, categories, action, readOnly }: {
  rows: EditorRow[]; materials: MaterialOption[]; categories: Record<string, string>;
  action: (fd: FormData) => void | Promise<void>; readOnly?: boolean;
}) {
  const [rows, setRows] = useState(initial.map((r) => ({ ...r, include: r.status !== "cancelled" })));
  const grouped = useMemo(() => {
    const g: Record<string, MaterialOption[]> = {};
    for (const m of materials) (g[m.category_code] ??= []).push(m);
    return Object.entries(g).sort();
  }, [materials]);
  const update = (id: string, patch: Partial<EditorRow & { include: boolean }>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const editable = (r: EditorRow) => !readOnly && (r.status === "draft" || r.status === "confirmed");
  const lowConfidence = rows.filter((r) => r.include && r.status === "draft" && (r.confidence ?? 0) < 0.6).length;
  const drafts = rows.filter((r) => r.status === "draft").length;

  return (
    <form action={action}>
      <input type="hidden" name="rows" value={JSON.stringify(rows.filter(editable).map((r) => ({
        id: r.id, include: r.include, description: r.description, material_id: r.material_id, quantity: Number(r.quantity), unit: r.unit,
        brand: r.brand, required_date: r.required_date, location: r.location, notes: r.notes })))} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <th className="w-8 border-b border-line px-2 py-2"></th>
              <th className="border-b border-line px-2 py-2">Requirement (as extracted) → normalised material</th>
              <th className="w-24 border-b border-line px-2 py-2 text-right">Qty</th>
              <th className="w-20 border-b border-line px-2 py-2">Unit</th>
              <th className="w-28 border-b border-line px-2 py-2">Brand</th>
              <th className="w-36 border-b border-line px-2 py-2">Required by</th>
              <th className="w-28 border-b border-line px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const can = editable(r);
              const mat = materials.find((m) => m.id === r.material_id);
              return (
                <tr key={r.id} className={cx("align-top", !r.include && "opacity-45")}>
                  <td className="border-b border-line px-2 py-2">
                    {can && <input type="checkbox" aria-label="Include line" checked={r.include} onChange={(e) => update(r.id, { include: e.target.checked })} className="mt-1.5 h-4 w-4 accent-[var(--accent)]" />}
                  </td>
                  <td className="border-b border-line px-2 py-2">
                    {r.raw_text && <div className="mb-1 font-mono text-[11px] text-subtle">{r.raw_text}</div>}
                    {can ? <input className={input} value={r.description} onChange={(e) => update(r.id, { description: e.target.value })} aria-label="Description" />
                      : <div className="font-medium">{r.description}</div>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {can ? (
                        <select className={cx(input, "max-w-md")} value={r.material_id ?? ""} aria-label="Catalogue material"
                          onChange={(e) => { const m = materials.find((x) => x.id === e.target.value); update(r.id, { material_id: e.target.value || null, unit: m?.base_unit ?? r.unit, confidence: 1 }); }}>
                          <option value="">— Not in material database —</option>
                          {grouped.map(([cat, ms]) => (
                            <optgroup key={cat} label={categories[cat] ?? cat}>{ms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
                          ))}
                        </select>
                      ) : <span className="text-xs text-muted">{mat?.name ?? "Unmatched"}</span>}
                      <ConfidenceBadge value={r.confidence} />
                      {mat && <Badge>{categories[mat.category_code] ?? mat.category_code}</Badge>}
                    </div>
                    {r.notes && <div className="mt-1 text-xs text-warn">{r.notes}</div>}
                  </td>
                  <td className="border-b border-line px-2 py-2">
                    {can ? <input className={cx(input, "text-right")} inputMode="decimal" value={r.quantity} aria-label="Quantity"
                      onChange={(e) => update(r.id, { quantity: e.target.value as unknown as number })} /> : <div className="text-right tabular">{Number(r.quantity).toLocaleString()}</div>}
                  </td>
                  <td className="border-b border-line px-2 py-2">
                    {can ? <input className={input} value={r.unit} onChange={(e) => update(r.id, { unit: e.target.value })} aria-label="Unit" /> : r.unit}
                  </td>
                  <td className="border-b border-line px-2 py-2">
                    {can ? <input className={input} value={r.brand ?? ""} onChange={(e) => update(r.id, { brand: e.target.value })} aria-label="Brand" placeholder="Any" /> : r.brand ?? "Any"}
                  </td>
                  <td className="border-b border-line px-2 py-2">
                    {can ? <input type="date" className={input} value={r.required_date ?? ""} onChange={(e) => update(r.id, { required_date: e.target.value })} aria-label="Required by" /> : r.required_date ?? "—"}
                  </td>
                  <td className="border-b border-line px-2 py-2"><StatusBadge status={r.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && rows.some(editable) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2 px-4 py-3">
          <div className="text-xs text-muted">
            {lowConfidence > 0 ? <span className="text-warn">{lowConfidence} line(s) have a low-confidence match - check them before confirming. </span> : null}
            Unticked draft lines are discarded on confirm. Nothing is sent to suppliers until you create and send an RFQ.
          </div>
          <div className="flex gap-2">
            <SubmitButton name="intent" value="save" variant="secondary">Save changes</SubmitButton>
            <SubmitButton name="intent" value="confirm" pendingText="Confirming…">{drafts ? `Confirm ${rows.filter((r) => r.include && r.status === "draft").length} line(s)` : "Save & confirm"}</SubmitButton>
          </div>
        </div>
      )}
    </form>
  );
}
