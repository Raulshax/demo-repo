export const aed = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? "—" : `AED ${Number(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const num = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const price = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? "—" : `${(Number(n) * 100).toFixed(digits)}%`;

export function date(d: string | Date | null | undefined) {
  if (!d) return "—";
  const v = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return v.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" });
}

export function dateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  const v = typeof d === "string" ? new Date(d) : d;
  return v.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
}

export function daysFromToday(d: string | null | undefined) {
  if (!d) return null;
  const target = new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((target - today) / 86400000);
}

export const titleCase = (s: string | null | undefined) =>
  (s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
