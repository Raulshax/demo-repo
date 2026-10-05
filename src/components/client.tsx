"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ComponentProps, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, cx } from "./ui";

export function SubmitButton({ children, pendingText, ...props }: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? pendingText ?? "Working…" : children}
    </Button>
  );
}

export function ConfirmButton({ message, ...props }: ComponentProps<typeof Button> & { message: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}
      onClick={(e) => { if (!confirm(message)) e.preventDefault(); }} />
  );
}

/** Shows ?ok= / ?error= messages set by server actions, then clears them from the URL. */
export function Flash() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ok = params.get("ok");
  const error = params.get("error");
  const [shown, setShown] = useState<{ ok: string | null; error: string | null }>({ ok, error });
  useEffect(() => {
    if (ok || error) {
      setShown({ ok, error });
      const next = new URLSearchParams(params.toString());
      next.delete("ok"); next.delete("error");
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    }
  }, [ok, error, params, pathname, router]);
  if (!shown.ok && !shown.error) return null;
  return (
    <div role="status" className={cx(
      "mb-4 flex items-start justify-between gap-3 border px-3 py-2 text-sm",
      shown.error ? "border-danger/30 bg-danger-soft text-danger" : "border-success/30 bg-success-soft text-success")}>
      <span>{shown.error ?? shown.ok}</span>
      <button type="button" className="text-xs opacity-70 hover:opacity-100" onClick={() => setShown({ ok: null, error: null })}>Dismiss</button>
    </div>
  );
}

export function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="text-xs text-accent hover:underline"
      onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function PrintButton() {
  return <Button type="button" variant="secondary" onClick={() => window.print()} className="no-print">Print</Button>;
}

export function SelectAll({ name, formId }: { name: string; formId?: string }) {
  return (
    <input type="checkbox" aria-label="Select all" className="h-4 w-4 accent-[var(--accent)]"
      onChange={(e) => {
        const root = formId ? document.getElementById(formId) : document;
        root?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => { if (!c.disabled) c.checked = e.target.checked; });
      }} />
  );
}
