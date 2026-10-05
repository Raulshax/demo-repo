import "server-only";
import type { MaterialRef } from "@/lib/engine/normalize";
import { rows, type Tx } from "@/lib/db";

export async function loadCatalog(tx: Tx): Promise<MaterialRef[]> {
  return rows<MaterialRef>(tx, "select id, sku, name, category_code, base_unit, spec from materials where active order by sku");
}

/** Network median unit price per material (anonymised; falls back to the catalogue benchmark). */
export async function benchmarks(tx: Tx, materialIds: (string | null)[]): Promise<Record<string, number>> {
  const ids = [...new Set(materialIds.filter(Boolean))] as string[];
  if (!ids.length) return {};
  const out: Record<string, number> = {};
  for (const m of await rows<{ id: string; benchmark_price_aed: number | null }>(tx, "select id, benchmark_price_aed from materials where id = any($1)", [ids]))
    if (m.benchmark_price_aed) out[m.id] = m.benchmark_price_aed;
  for (const b of await rows<{ material_id: string; median: number; last_90d_median: number | null }>(tx, "select * from material_benchmarks($1)", [ids]))
    out[b.material_id] = Math.round((b.last_90d_median ?? b.median) * 100) / 100;
  return out;
}
