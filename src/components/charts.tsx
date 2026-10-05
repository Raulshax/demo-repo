"use client";

import { useRef, useState } from "react";

const fmtAed = (n: number) => `AED ${Math.round(n).toLocaleString("en-US")}`;
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);

function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div role="tooltip" className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-sm"
      style={{ left: x, top: y - 8 }}>{children}</div>
  );
}

/** Ranked horizontal bars (magnitude, single hue) with direct value labels and hover detail. */
export function BarList({ data, valueLabel = fmtAed }: { data: { label: string; value: number; detail?: string }[]; valueLabel?: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <ul className="space-y-2" onPointerLeave={() => setHover(null)}>
      {data.map((d, i) => (
        <li key={d.label} className="grid grid-cols-[140px_1fr_96px] items-center gap-3 text-sm" onPointerEnter={() => setHover(i)}
          tabIndex={0} onFocus={() => setHover(i)} aria-label={`${d.label}: ${valueLabel(d.value)}`}>
          <span className="truncate text-muted">{d.label}</span>
          <span className="relative h-4">
            <span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.max((d.value / max) * 100, 0.5)}%`, background: "var(--series-1)", opacity: hover === null || hover === i ? 1 : 0.55 }} />
          </span>
          <span className="text-right tabular text-ink">{valueLabel(d.value)}{hover === i && d.detail && <span className="block text-[11px] text-muted">{d.detail}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

/** Monthly columns (single series). */
export function Columns({ data, height = 180 }: { data: { label: string; value: number }[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const W = 640, H = height, pad = { l: 44, r: 8, t: 8, b: 22 };
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return (
    <div ref={ref} className="relative" onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Monthly spend">
        {ticks.map((t) => (
          <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--subtle)">{compact(t)}</text></g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * bw + 2, h = H - pad.b - y(d.value);
          return (
            <g key={d.label}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent"
                onPointerMove={() => { const r = ref.current!.getBoundingClientRect(); setTip({ i, x: ((x + bw / 2) / W) * r.width, y: (y(d.value) / H) * r.height }); }} />
              {d.value > 0 && <path d={roundedTop(x, y(d.value), bw - 4, h, 4)} fill="var(--series-1)" opacity={tip && tip.i !== i ? 0.55 : 1} pointerEvents="none" />}
              <text x={x + (bw - 4) / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--subtle)">{d.label}</text>
            </g>
          );
        })}
      </svg>
      {tip && <Tip x={tip.x} y={tip.y}><strong className="tabular">{fmtAed(data[tip.i].value)}</strong> <span className="text-muted">{data[tip.i].label}</span></Tip>}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Market median line vs the contractor's own purchase prices (dots), with crosshair tooltip. */
export function PriceTrend({ market, paid, unit }: { market: { month: string; value: number }[]; paid: { date: string; value: number; supplier: string }[]; unit: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hi, setHi] = useState<number | null>(null);
  if (market.length < 2) return <p className="text-sm text-muted">Not enough price history yet.</p>;
  const W = 640, H = 220, pad = { l: 48, r: 12, t: 12, b: 24 };
  const vals = [...market.map((m) => m.value), ...paid.map((p) => p.value)];
  const lo = Math.min(...vals) * 0.95, hiV = Math.max(...vals) * 1.05;
  const months = market.map((m) => m.month);
  const xOf = (i: number) => pad.l + (i / (months.length - 1)) * (W - pad.l - pad.r);
  const yOf = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hiV - lo));
  const path = market.map((m, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(m.value).toFixed(1)}`).join(" ");
  const paidPts = paid.map((p) => ({ ...p, i: Math.max(0, months.indexOf(p.date.slice(0, 7))) })).filter((p) => months.includes(p.date.slice(0, 7)));
  const ticks = [lo, (lo + hiV) / 2, hiV];
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    setHi(Math.max(0, Math.min(months.length - 1, Math.round(((sx - pad.l) / (W - pad.l - pad.r)) * (months.length - 1)))));
  };
  const hiPaid = hi === null ? [] : paidPts.filter((p) => p.i === hi);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: "var(--series-1)" }} />Network market median</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--series-2)" }} />Your purchase prices</span>
      </div>
      <div ref={ref} className="relative" onPointerMove={onMove} onPointerLeave={() => setHi(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Price trend">
          {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={yOf(t)} y2={yOf(t)} stroke="var(--grid)" />
            <text x={pad.l - 6} y={yOf(t) + 4} textAnchor="end" fontSize="10" fill="var(--subtle)">{t.toFixed(t < 20 ? 2 : 0)}</text></g>)}
          {months.map((m, i) => (i % 2 === 0 || i === months.length - 1) && (
            <text key={m} x={xOf(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--subtle)">{new Date(m + "-01").toLocaleDateString("en-GB", { month: "short" })}</text>))}
          <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hi !== null && <line x1={xOf(hi)} x2={xOf(hi)} y1={pad.t} y2={H - pad.b} stroke="var(--border-strong)" />}
          {paidPts.map((p, k) => <circle key={k} cx={xOf(p.i)} cy={yOf(p.value)} r="4.5" fill="var(--series-2)" stroke="var(--surface)" strokeWidth="2" />)}
          <text x={xOf(months.length - 1) - 4} y={yOf(market[market.length - 1].value) - 8} textAnchor="end" fontSize="11" fill="var(--text)">{market[market.length - 1].value.toFixed(2)}</text>
        </svg>
        {hi !== null && (
          <Tip x={(xOf(hi) / W) * (ref.current?.getBoundingClientRect().width ?? W)} y={(yOf(market[hi].value) / H) * (ref.current?.getBoundingClientRect().height ?? H)}>
            <div className="font-medium">{new Date(months[hi] + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
            <div><strong className="tabular">{market[hi].value.toFixed(2)}</strong> <span className="text-muted">market median / {unit}</span></div>
            {hiPaid.map((p, k) => <div key={k}><strong className="tabular">{p.value.toFixed(2)}</strong> <span className="text-muted">you paid · {p.supplier}</span></div>)}
          </Tip>
        )}
      </div>
    </div>
  );
}
