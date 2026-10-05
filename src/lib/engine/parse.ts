// Turns tabular BOQ rows (CSV/XLSX) or PDF text into raw procurement lines.

export interface RawLine {
  lineNo: number;
  ref: string | null;
  rawText: string;
  description: string;
  quantity: number;
  unit: string | null;
  brand: string | null;
  requiredDate: string | null;
  location: string | null;
  notes: string | null;
  section: string | null;
}

export interface ParseResult {
  lines: RawLine[];
  warnings: string[];
  headerRow: number | null;
  columns: Partial<Record<Col, number>>;
}

type Col = "ref" | "description" | "quantity" | "unit" | "brand" | "date" | "location" | "notes" | "spec";

const HEADER_SYNONYMS: Record<Col, RegExp> = {
  ref: /^(s\.?\s*no\.?|sr\.?\s*no\.?|item\s*no\.?|ref(erence)?|no\.?|#|item\s*ref|boq\s*ref|code|item)$/,
  description: /^(description|item\s*description|material|materials|particulars|details|scope|description of (work|item)s?)$/,
  quantity: /^(qty\.?|quantity|quantities|req(uired)?\.?\s*qty|total\s*qty)$/,
  unit: /^(unit|units|uom|u\.o\.m\.?|unit of measure)$/,
  brand: /^(brand|make|manufacturer|approved\s*make|preferred\s*brand|brand\s*\/\s*make)$/,
  date: /^(required\s*(date|by)|delivery\s*date|need(ed)?\s*by|date\s*required|required\s*on|rfd)$/,
  location: /^(location|area|zone|floor|level|block|building)$/,
  notes: /^(remarks?|notes?|comments?)$/,
  spec: /^(spec(ification)?s?|size|rating|size\s*\/\s*rating|rating\s*\/\s*size|dimensions?)$/,
};

const clean = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, " ").trim());

export function parseQuantity(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = clean(v).replace(/,/g, "");
  if (!s) return null;
  const m = s.match(/^-?\d+(\.\d+)?$/);
  return m ? Number(s) : null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = clean(v);
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  // UAE convention is day-first.
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) return iso(year(+m[3]), +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})[\s-]([a-z]{3,4})[a-z]*[\s-,]+(\d{2,4})$/i)) && MONTHS[m[2].toLowerCase()])
    return iso(year(+m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  if ((m = s.match(/^([a-z]{3,4})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/i)) && MONTHS[m[1].toLowerCase()])
    return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}
const year = (y: number) => (y < 100 ? 2000 + y : y);
function iso(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function detectHeader(rows: unknown[][]): { index: number; columns: Partial<Record<Col, number>> } | null {
  let best: { index: number; columns: Partial<Record<Col, number>>; score: number } | null = null;
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const columns: Partial<Record<Col, number>> = {};
    rows[r].forEach((cell, c) => {
      const v = clean(cell).toLowerCase().replace(/[:*]/g, "").trim();
      if (!v) return;
      for (const [col, re] of Object.entries(HEADER_SYNONYMS) as [Col, RegExp][]) {
        if (columns[col] === undefined && re.test(v)) { columns[col] = c; break; }
      }
    });
    // A lone "Item" column is the description when nothing else is.
    if (columns.description === undefined && columns.ref !== undefined && /^item$/.test(clean(rows[r][columns.ref]).toLowerCase())) {
      columns.description = columns.ref;
      delete columns.ref;
    }
    const score = Object.keys(columns).length;
    if (columns.description !== undefined && columns.quantity !== undefined && (!best || score > best.score))
      best = { index: r, columns, score };
  }
  return best ? { index: best.index, columns: best.columns } : null;
}

/** Infers columns when the sheet has no recognisable header. */
function inferColumns(rows: unknown[][]): Partial<Record<Col, number>> {
  const width = Math.max(...rows.map((r) => r.length), 0);
  const stats = Array.from({ length: width }, (_, c) => {
    const vals = rows.map((r) => clean(r[c])).filter(Boolean);
    return {
      c,
      numeric: vals.filter((v) => parseQuantity(v) !== null).length,
      avgLen: vals.reduce((a, v) => a + v.length, 0) / Math.max(vals.length, 1),
      unitLike: vals.filter((v) => /^(m|mtr|nos?|pcs|m2|sqm|lm|set|roll|bag|kg|ea|each|lot|length|coil|pack)\.?$/i.test(v)).length,
    };
  });
  const description = [...stats].sort((a, b) => b.avgLen - a.avgLen)[0]?.c;
  const unit = [...stats].sort((a, b) => b.unitLike - a.unitLike)[0];
  const quantity = stats.filter((s) => s.c !== description).sort((a, b) => b.numeric - a.numeric)[0]?.c;
  return { description, quantity, unit: unit && unit.unitLike > 0 ? unit.c : undefined };
}

export function parseRows(rows: unknown[][]): ParseResult {
  const warnings: string[] = [];
  const nonEmpty = rows.filter((r) => r.some((c) => clean(c)));
  const header = detectHeader(nonEmpty);
  const columns = header?.columns ?? inferColumns(nonEmpty);
  if (!header) warnings.push("No header row recognised - columns were inferred; please review carefully.");
  if (columns.description === undefined || columns.quantity === undefined)
    return { lines: [], warnings: [...warnings, "Could not find description and quantity columns."], headerRow: null, columns };

  const lines: RawLine[] = [];
  let section: string | null = null;
  const body = nonEmpty.slice(header ? header.index + 1 : 0);
  for (const row of body) {
    const get = (c: Col) => (columns[c] !== undefined ? row[columns[c]!] : undefined);
    const description = clean(get("description"));
    const specText = clean(get("spec"));
    const qty = parseQuantity(get("quantity"));
    if (!description) continue;
    if (qty === null || qty <= 0) {
      // Rows with text but no quantity are usually section headings in a BOQ.
      if (description.length < 80 && !/total|carried|brought|sub-?total/i.test(description)) section = description;
      continue;
    }
    if (/^(sub-?)?total|grand total|carried forward|brought forward/i.test(description)) continue;
    const fullDescription = specText && !description.toLowerCase().includes(specText.toLowerCase())
      ? `${description} ${specText}` : description;
    lines.push({
      lineNo: lines.length + 1,
      ref: clean(get("ref")) || null,
      rawText: row.map(clean).filter(Boolean).join(" | "),
      description: fullDescription,
      quantity: qty,
      unit: clean(get("unit")) || null,
      brand: clean(get("brand")) || null,
      requiredDate: parseDate(get("date")),
      location: clean(get("location")) || null,
      notes: clean(get("notes")) || null,
      section,
    });
  }
  if (lines.length === 0) warnings.push("No quantified lines found.");
  return { lines, warnings, headerRow: header?.index ?? null, columns };
}

const UNIT_RE = "(m|mtr|mtrs|rm|rmt|lm|nos?\\.?|pcs|pc|m2|sqm|set|sets|roll|rolls|coil|coils|bag|bags|kg|ea|each|lot|length|lengths|pack|packs|drum|drums|km)";

/** Parses lines of text (e.g. from a PDF) shaped like "1.2  Description ...  1,200  m  [Brand]". */
export function parseTextLines(text: string): ParseResult {
  const warnings: string[] = [];
  const lines: RawLine[] = [];
  let section: string | null = null;
  const re = new RegExp(
    `^\\s*(?<ref>(?:[A-Z]\\.?)?\\d+(?:\\.\\d+)*[a-z]?\\.?)?\\s+(?<desc>.+?)\\s+(?<qty>\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s*(?<unit>${UNIT_RE})\\b\\.?(?<rest>.*)$`,
    "i",
  );
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "  ").trimEnd();
    if (!line.trim()) continue;
    const m = (" " + line).match(re);
    if (m?.groups) {
      const desc = m.groups.desc.trim();
      const qty = parseQuantity(m.groups.qty);
      if (!qty || desc.length < 3) continue;
      // anything after the unit that is not a rate/amount is treated as brand/remarks
      const rest = m.groups.rest.trim().replace(/\b\d[\d,]*(\.\d+)?\b/g, "").trim();
      lines.push({
        lineNo: lines.length + 1, ref: m.groups.ref?.replace(/\.$/, "") ?? null, rawText: line.trim(),
        description: desc, quantity: qty, unit: m.groups.unit, brand: rest || null,
        requiredDate: null, location: null, notes: null, section,
      });
    } else if (/^[A-Z][A-Z0-9 &\-/,.()]{4,70}$/.test(line.trim())) {
      section = line.trim();
    }
  }
  if (lines.length === 0) warnings.push("No quantified lines recognised in the document text.");
  return { lines, warnings, headerRow: null, columns: {} };
}
