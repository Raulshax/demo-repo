// Normalises a free-text procurement line against the central material database.
// Deterministic: same input, same output. Used directly and as the grounding step
// after AI extraction (the AI reads the document; this decides the catalogue match).

import { FAMILY_BY_ID, type Family, type SpecKey, detectFamily, guessCategory } from "./families";

export interface MaterialRef {
  id: string;
  sku: string;
  name: string;
  category_code: string;
  base_unit: string;
  spec: Record<string, string | number>;
}

export interface Normalised {
  materialId: string | null;
  materialName: string | null;
  sku: string | null;
  family: string | null;
  categoryCode: string | null;
  spec: Record<string, string | number>;
  quantity: number;
  unit: string;
  confidence: number;
  method: "exact" | "closest" | "family_only" | "category_only" | "unmatched";
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Specification extraction
// ---------------------------------------------------------------------------
const num = (s: string) => Number(s.replace(",", "."));

const FRACTIONS: Record<string, string> = {
  "0.25": "1/4", "0.375": "3/8", "0.5": "1/2", "0.625": "5/8", "0.75": "3/4", "0.875": "7/8",
};

export function extractSpec(text: string): Partial<Record<SpecKey, string | number>> {
  const t = text.toLowerCase().replace(/×/g, "x").replace(/²/g, "2");
  const spec: Partial<Record<SpecKey, string | number>> = {};
  let m: RegExpMatchArray | null;

  // "4C x 16mm", "4 core x 16 sq.mm", "4x16mm2", "4 x 16"
  if ((m = t.match(/\b([1-5])\s*(?:c|cores?)?\s*x\s*(\d+(?:[.,]\d+)?)\s*(?:mm2|mm\^?2|sq\.?\s*mm|sqmm|mm)?/))) {
    spec.cores = Number(m[1]);
    spec.size_mm2 = num(m[2]);
  }
  if (spec.cores === undefined && (m = t.match(/\b([1-5])\s*(?:c|cores?)\b/))) spec.cores = Number(m[1]);
  if (spec.size_mm2 === undefined && (m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:mm2|mm\^2|sq\.?\s*mm|sqmm|mm\s*sq)/)))
    spec.size_mm2 = num(m[1]);

  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:a|amps?)\b/))) spec.amp = num(m[1]);
  if ((m = t.match(/\b([1-4])\s*p(?:ole)?\b/))) spec.poles = Number(m[1]);
  else if (/\b(sp|single pole)\b/.test(t)) spec.poles = 1;
  else if (/\b(tp|tpn|triple pole|3 pole)\b/.test(t) && !/distribution|board|\bdb\b/.test(t)) spec.poles = 3;
  if ((m = t.match(/\b([1-4])\s*-?\s*g(?:ang)?\b/))) spec.gang = Number(m[1]);
  else if (/\b(single|one)\s*-?\s*gang\b/.test(t)) spec.gang = 1;
  else if (/\b(double|twin|two)\s*-?\s*gang\b/.test(t) || /\btwin\b/.test(t)) spec.gang = 2;
  if ((m = t.match(/(\d+)\s*-?\s*ways?\b/))) spec.ways = Number(m[1]);
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*tr\b/))) spec.tr = num(m[1]);
  if ((m = t.match(/(\d+)\s*w(?:att)?\b/))) spec.watt = Number(m[1]);
  if ((m = t.match(/\bm\s*(8|10|12|16|20)\b/))) spec.thread = `M${m[1]}`;
  if ((m = t.match(/\bpn\s*(\d+)/))) spec.pn = Number(m[1]);
  if ((m = t.match(/(\d+)\s*mm\s*(?:thk|thick|thickness)|(?:thk|thickness)\s*(\d+)\s*mm/)))
    spec.thickness_mm = Number(m[1] ?? m[2]);

  // inch sizes: 1/2", 3/4 inch, 0.5in, 1"
  if ((m = t.match(/(\d+\/\d+|\d+(?:\.\d+)?)\s*(?:"|''|”|inch(?:es)?\b|in\b)/))) {
    const v = m[1];
    spec.dia_in = FRACTIONS[v] ?? v;
  }
  // width for trays/ladders/diffusers: 300mm wide, 300x50, 600x600
  if ((m = t.match(/(\d{2,3})\s*(?:mm)?\s*x\s*(\d{2,3})\s*(?:mm)?/)) && !spec.size_mm2) spec.width_mm = Number(m[1]);
  else if ((m = t.match(/(\d{2,3})\s*mm\s*(?:wide|width|w)\b/))) spec.width_mm = Number(m[1]);

  // plain diameter in mm (pipes, conduits): "25mm", "dia 110", "ø32"
  if ((m = t.match(/(?:ø|dia\.?|diameter|od)\s*(\d{2,3})/)) || (m = t.match(/\b(\d{2,3})\s*mm\b(?!\s*(?:2|\^|sq|thk|thick|x|wide))/)))
    spec.dia_mm = Number(m[1]);

  return spec;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
const UNIT_ALIASES: Record<string, string> = {
  m: "m", mtr: "m", mtrs: "m", meter: "m", meters: "m", metre: "m", metres: "m", lm: "m", rm: "m", rmt: "m", "l.m": "m", "r.m": "m",
  km: "km",
  nos: "pcs", no: "pcs", "no.": "pcs", "nos.": "pcs", pcs: "pcs", pc: "pcs", piece: "pcs", pieces: "pcs", ea: "pcs", each: "pcs", unit: "pcs", units: "pcs", set: "pcs", sets: "pcs",
  m2: "m2", "m²": "m2", sqm: "m2", "sq.m": "m2", "sq m": "m2", sqmt: "m2",
  roll: "roll", rolls: "roll", coil: "coil", coils: "coil", drum: "drum", drums: "drum",
  bag: "bag", bags: "bag", pack: "pack", packs: "pack", pkt: "pack", box: "pack", boxes: "pack",
  kg: "kg", kgs: "kg", ltr: "l", l: "l", litre: "l", liter: "l",
  length: "length", lengths: "length", lot: "lot", ls: "lot",
};

export function normaliseUnit(raw: string | null | undefined): string {
  if (!raw) return "";
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return UNIT_ALIASES[k] ?? k;
}

/** Converts a quantity into the catalogue's base unit where the conversion is unambiguous. */
export function convertQuantity(qty: number, unit: string, baseUnit: string, family: string | null) {
  const warnings: string[] = [];
  if (!unit || unit === baseUnit) return { quantity: qty, unit: baseUnit || unit, warnings };
  if (baseUnit === "m" && unit === "km") return { quantity: qty * 1000, unit: "m", warnings };
  if (baseUnit === "m" && (unit === "coil" || unit === "roll") && (family === "wire_pvc" || family === "cable_xlpe")) {
    warnings.push(`Converted ${qty} ${unit} to metres assuming 100 m per ${unit} - confirm with site.`);
    return { quantity: qty * 100, unit: "m", warnings };
  }
  if (baseUnit === "m" && unit === "length" && /conduit|threaded/.test(family ?? "")) {
    warnings.push(`Converted ${qty} lengths to metres assuming 3 m lengths.`);
    return { quantity: qty * 3, unit: "m", warnings };
  }
  if (baseUnit === "m" && unit === "drum") {
    warnings.push("Quantity given in drums - drum length varies by size, enter metres before sending an RFQ.");
  } else {
    warnings.push(`Unit "${unit}" differs from catalogue unit "${baseUnit}".`);
  }
  return { quantity: qty, unit, warnings };
}

// ---------------------------------------------------------------------------
// Catalogue matching
// ---------------------------------------------------------------------------
function specEquals(a: string | number | undefined, b: string | number | undefined) {
  if (a === undefined || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function numericOf(v: string | number | undefined): number | null {
  if (v === undefined) return null;
  if (typeof v === "number") return v;
  if (/^\d+\/\d+$/.test(v)) { const [a, b] = v.split("/").map(Number); return a / b; }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normaliseLine(
  input: { description: string; quantity: number; unit?: string | null; spec?: Record<string, string | number> },
  catalog: MaterialRef[],
): Normalised {
  const text = input.description;
  const family = detectFamily(text);
  const extracted = { ...extractSpec(text), ...(input.spec ?? {}) } as Record<string, string | number>;
  // A bare "300mm" is read as a diameter; for width-keyed families (trays, ties, diffusers) it is the width.
  if (family?.keys.includes("width_mm") && extracted.width_mm === undefined && extracted.dia_mm !== undefined) extracted.width_mm = extracted.dia_mm;
  const unit = normaliseUnit(input.unit);
  const warnings: string[] = [];

  const base = (f: Family | null): Normalised => ({
    materialId: null, materialName: null, sku: null, family: f?.id ?? null,
    categoryCode: f?.category ?? guessCategory(text), spec: extracted,
    quantity: input.quantity, unit: unit || f?.unit || "", confidence: 0.2,
    method: f ? "family_only" : guessCategory(text) ? "category_only" : "unmatched", warnings,
  });

  if (!family) {
    warnings.push("No catalogue family recognised - classify manually or add to the material database.");
    return base(null);
  }

  const candidates = catalog.filter((m) => m.spec.family === family.id);
  if (candidates.length === 0) return { ...base(family), confidence: 0.35 };

  // Score each candidate on the family's identifying keys.
  const keys = family.keys;
  let best: MaterialRef | null = null;
  let bestScore = -Infinity;
  let exactKeys = 0;
  for (const c of candidates) {
    let score = 0;
    let exact = 0;
    for (const k of keys) {
      const want = extracted[k];
      const have = c.spec[k];
      if (want === undefined) continue;
      if (specEquals(want, have)) { score += 10; exact++; continue; }
      const wn = numericOf(want), hn = numericOf(have);
      if (wn !== null && hn !== null && hn > 0) score -= Math.abs(Math.log(wn / hn)) * 5;
      else score -= 5;
    }
    if (score > bestScore) { bestScore = score; best = c; exactKeys = exact; }
  }
  if (!best) return base(family);

  const providedKeys = keys.filter((k) => extracted[k] !== undefined);
  const missingKeys = keys.filter((k) => extracted[k] === undefined);
  let method: Normalised["method"] = "exact";
  let confidence = 0.95;

  if (keys.length > 0 && providedKeys.length === 0) {
    method = "closest";
    confidence = candidates.length === 1 ? 0.75 : 0.45;
    if (candidates.length > 1) warnings.push(`Size/rating not stated - please confirm (${keys.join(", ")}).`);
  } else if (exactKeys < providedKeys.length) {
    method = "closest";
    confidence = 0.5;
    warnings.push(`No exact catalogue item for the stated ${providedKeys.join("/")} - closest match proposed.`);
  } else if (missingKeys.length > 0) {
    confidence = 0.8;
    warnings.push(`Specification incomplete (${missingKeys.join(", ")}) - closest catalogue item assumed.`);
  }

  const conv = convertQuantity(input.quantity, unit, best.base_unit, family.id);
  warnings.push(...conv.warnings);
  if (conv.warnings.some((w) => w.startsWith("Unit"))) confidence = Math.min(confidence, 0.6);

  return {
    materialId: best.id,
    materialName: best.name,
    sku: best.sku,
    family: family.id,
    categoryCode: best.category_code,
    spec: { ...best.spec, ...pick(extracted, keys) },
    quantity: round3(conv.quantity),
    unit: conv.unit,
    confidence,
    method,
    warnings,
  };
}

function pick(o: Record<string, string | number>, keys: string[]) {
  return Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function familyLabel(id: string | null | undefined) {
  return id ? FAMILY_BY_ID[id]?.label ?? id : null;
}
