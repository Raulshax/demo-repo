import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { titleCase } from "@/lib/format";

// Wahid component kit: monochrome, square, JetBrains Mono labels, Archivo Narrow caps headlines.

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- layout
export function PageHeader({ title, subtitle, actions, crumbs }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[];
}) {
  return (
    <div className="mb-7">
      {crumbs && (
        <nav className="m mb-3 flex flex-wrap items-center gap-1 text-muted">
          <span>[</span>
          {crumbs.map((c, i) => (
            <span key={c.href + i} className="flex items-center gap-1">
              {i > 0 && <span className="text-subtle">/</span>}
              <Link href={c.href} className="hover:text-ink">{c.label}</Link>
            </span>
          ))}
          <span>]</span>
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-4">
        <div className="min-w-0">
          <h1 className="display text-balance text-[clamp(34px,4.6vw,68px)] leading-[0.92] text-ink">{title}</h1>
          {subtitle && <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true, subtitle }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; subtitle?: ReactNode;
}) {
  return (
    <section className={cx("border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="display text-[19px] leading-tight text-ink">{title}</h2>}
            {subtitle && <p className="m lc mt-1 text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

/** One KPI in a strip: top ink rule, mono label, big narrow-caps value. */
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "bad" | "neutral" }) {
  return (
    <div className="min-w-0 border-t border-ink pt-3 pr-4">
      <div className="m text-muted">{label}</div>
      <div className="display mt-2 text-[clamp(24px,2.6vw,38px)] leading-none tabular-nums text-ink">{value}</div>
      {hint && <div className={cx("mt-1.5 text-[12.5px]", tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : "text-muted")}>{hint}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start justify-center border border-dashed border-line-strong px-5 py-8">
      <div className="display text-[20px] text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- buttons
type Variant = "primary" | "secondary" | "ghost" | "danger" | "ai" | "light";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-surface border-ink hover:bg-accent-hover",
  secondary: "bg-transparent text-ink border-ink hover:bg-ink hover:text-surface",
  ghost: "bg-transparent text-muted border-transparent hover:text-ink",
  danger: "bg-danger text-white border-danger hover:opacity-90",
  ai: "bg-ink text-surface border-ink hover:bg-accent-hover",
  light: "bg-on text-[#111110] border-on hover:bg-white",
};
const btnBase = "inline-flex items-center justify-center gap-2 rounded-none border px-4 py-2.5 font-mono text-[11.5px] font-medium uppercase leading-none tracking-[.03em] transition-colors disabled:pointer-events-none disabled:opacity-35 whitespace-nowrap cursor-pointer";

export function Button({ variant = "primary", className, size, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: "sm" }) {
  return <button {...props} className={cx(btnBase, variants[variant], size === "sm" && "px-2.5 py-2 text-[10.5px]", className)} />;
}

export function ButtonLink({ variant = "primary", className, size, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" }) {
  return <Link {...props} className={cx(btnBase, variants[variant], size === "sm" && "px-2.5 py-2 text-[10.5px]", className)} />;
}

// ---------------------------------------------------------------- pills
type Tone = "neutral" | "accent" | "success" | "warn" | "danger" | "info" | "ai" | "onDark";
const tones: Record<Tone, string> = {
  neutral: "border-line-strong text-muted",
  accent: "border-ink text-ink",
  success: "border-success text-success",
  warn: "border-warn text-warn",
  danger: "border-danger text-danger",
  info: "border-ink text-ink",
  ai: "border-ink bg-ink text-surface",
  onDark: "border-[#6a6a65] text-on",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 border px-[7px] py-[3px] font-mono text-[10px] font-medium uppercase leading-[1.2] tracking-[.03em] whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

// Solid = needs action / done; outline = in progress; muted = inactive.
const STATUS_TONES: Record<string, Tone> = {
  draft: "neutral", confirmed: "accent", in_rfq: "accent", ordered: "ai", cancelled: "neutral",
  sent: "accent", closed: "neutral", awarded: "ai",
  recommended: "accent", invited: "accent", viewed: "accent", quoted: "ai", declined: "neutral", not_selected: "neutral",
  submitted: "accent", withdrawn: "neutral", accepted: "ai", rejected: "danger",
  pending: "warn", approved: "ai",
  issued: "warn", in_delivery: "accent", partially_delivered: "warn", delivered: "ai",
  scheduled: "neutral", dispatched: "accent", partially_accepted: "warn",
  matched: "success", mismatch: "danger", paid: "ai", disputed: "danger",
  open: "danger", supplier_responded: "warn", escalated: "danger", resolved: "neutral",
  active: "accent", planning: "neutral", on_hold: "warn", completed: "neutral", suspended: "danger",
  uploaded: "neutral", processing: "accent", extracted: "ai", failed: "danger",
};
const STATUS_LABEL: Record<string, string> = { in_rfq: "In RFQ", issued: "Awaiting confirmation", supplier_responded: "Supplier responded" };

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{STATUS_LABEL[status] ?? titleCase(status)}</Badge>;
}

export function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <Badge>Manual</Badge>;
  const tone: Tone = value >= 0.85 ? "accent" : value >= 0.6 ? "warn" : "danger";
  return <Badge tone={tone}>{Math.round(value * 100)}% match</Badge>;
}

// ---------------------------------------------------------------- tables
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13.5px]">{children}</table>
    </div>
  );
}
export function Th({ children, className, right }: { children?: ReactNode; className?: string; right?: boolean }) {
  return <th className={cx("border-b border-ink bg-surface px-3 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[.03em] text-muted whitespace-nowrap", right && "text-right", className)}>{children}</th>;
}
export function Td({ children, className, right, colSpan }: { children?: ReactNode; className?: string; right?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("border-b border-line px-3 py-[11px] align-top text-ink", right && "text-right tabular whitespace-nowrap", className)}>{children}</td>;
}

// ---------------------------------------------------------------- forms
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("grid gap-1.5", className)}>
      <span className="m text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-subtle">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-none border border-line-strong bg-bg px-2.5 py-2 text-ink placeholder:text-subtle focus:outline-[1.5px] focus:outline-ink focus:-outline-offset-1";
export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}
export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea rows={3} {...props} className={cx(inputCls, props.className)} />;
}

// ---------------------------------------------------------------- misc
export function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | "warn" | "success" }) {
  const color = tone === "warn" ? "bg-warn" : "bg-ink";
  return (
    <div className="h-[3px] w-full bg-line">
      <div className={cx("h-full", color)} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

/** AI recommendation: a black band, like Wahid's action bars. */
export function AiPanel({ title, children, footer }: { title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="bg-dark p-5 text-on">
      <div className="m flex items-center gap-2 text-on-muted"><SparkIcon /> [ AI recommendation ]</div>
      <div className="display mt-2 text-[clamp(22px,2.4vw,32px)] leading-[0.98] text-on">{title}</div>
      <div className="mt-3 max-w-[78ch] text-[14.5px] leading-relaxed text-[#D6D6D2]">{children}</div>
      {footer && <div className="m lc mt-4 border-t border-[#33332F] pt-3 text-on-muted">{footer}</div>}
    </section>
  );
}

export function SparkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2z" />
    </svg>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="border-b border-line py-2">
          <dt className="m text-muted">{k}</dt>
          <dd className="mt-0.5 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Wahid mark: four stacked bars (a BOQ). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cx("h-5 w-5", className)} aria-hidden>
      <rect width="20" height="20" fill="currentColor" opacity="0" />
      <rect x="0" y="1" width="20" height="3" fill="currentColor" />
      <rect x="0" y="6" width="14" height="4" fill="currentColor" />
      <rect x="0" y="12" width="20" height="2" fill="currentColor" />
      <rect x="0" y="16" width="20" height="4" fill="currentColor" />
    </svg>
  );
}

export const BRAND = "Wahid";
