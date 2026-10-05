"use client";

import { useActionState, useRef } from "react";
import { Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { loginAction } from "./actions";

const DEMO = [
  { group: "Contractor - Falcon Crest Contracting", users: [
    ["omar@falconcrest.demo", "Procurement Engineer", "Uploads BOQs, runs RFQs, compares quotes"],
    ["sara@falconcrest.demo", "Procurement Manager", "Approves purchases (has a pending approval)"],
    ["daniel@falconcrest.demo", "Site Engineer", "Verifies deliveries on site (one arriving today)"],
    ["rajesh@falconcrest.demo", "Managing Director", "Executive view: spend, savings, performance"],
  ] },
  { group: "Suppliers", users: [
    ["sales@gulfcable.demo", "Gulf Cable & Electrical", "Has an RFQ quoted; sees only its own prices"],
    ["tenders@emswitch.demo", "Emirates Switchgear", "Has an RFQ waiting for a quote"],
    ["sales@blueline.demo", "Blue Line Pipes", "Has a new PO to confirm"],
    ["orders@coolpoint.demo", "Coolpoint Refrigeration", "Has a delivery out for verification"],
  ] },
  { group: "Other", users: [
    ["lena@meridianbuild.demo", "Meridian Build (2nd contractor)", "Proves tenant isolation"],
    ["admin@procureos.demo", "Platform Admin", "Organisations, disputes, platform analytics"],
  ] },
];

export function LoginForm() {
  const [error, action] = useActionState(loginAction, null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
      <form ref={formRef} action={action} className="space-y-4 rounded-lg border border-line bg-surface p-6">
        <div>
          <h2 className="text-lg font-semibold">Sign in</h2>
          <p className="text-sm text-muted">Use a demo account - password <code className="rounded bg-surface-2 px-1">Demo@2026</code></p>
        </div>
        {error && <div className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}
        <Field label="Email"><Input ref={emailRef} name="email" type="email" required autoComplete="username" /></Field>
        <Field label="Password"><Input ref={passRef} name="password" type="password" required autoComplete="current-password" /></Field>
        <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </form>
      <div className="space-y-5">
        {DEMO.map((g) => (
          <div key={g.group}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.group}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.users.map(([email, who, what]) => (
                <button key={email} type="button"
                  className="rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-accent"
                  onClick={() => {
                    if (emailRef.current && passRef.current) {
                      emailRef.current.value = email; passRef.current.value = "Demo@2026";
                      formRef.current?.requestSubmit();
                    }
                  }}>
                  <div className="text-sm font-medium text-ink">{who}</div>
                  <div className="text-xs text-muted">{what}</div>
                  <div className="mt-1 font-mono text-[11px] text-subtle">{email}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
