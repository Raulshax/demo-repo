"use client";

import { useActionState, useRef } from "react";
import { Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { loginAction } from "./actions";

const DEMO = [
  { group: "Contractor · Falcon Crest Contracting", users: [
    ["omar@falconcrest.demo", "Procurement Engineer", "Uploads BOQs, runs RFQs, compares quotes"],
    ["sara@falconcrest.demo", "Procurement Manager", "Approves purchases (one is waiting)"],
    ["daniel@falconcrest.demo", "Site Engineer", "Verifies deliveries on site (one arriving today)"],
    ["rajesh@falconcrest.demo", "Managing Director", "Executive view: spend, savings, performance"],
  ] },
  { group: "Suppliers", users: [
    ["sales@gulfcable.demo", "Gulf Cable & Electrical", "Has quoted; sees only its own prices"],
    ["tenders@emswitch.demo", "Emirates Switchgear", "Has an RFQ waiting for a quote"],
    ["sales@blueline.demo", "Blue Line Pipes", "Has a new PO to confirm"],
    ["orders@coolpoint.demo", "Coolpoint Refrigeration", "Has a delivery out for verification"],
  ] },
  { group: "Other", users: [
    ["lena@meridianbuild.demo", "Meridian Build", "Second contractor: proves tenant isolation"],
    ["admin@procureos.demo", "Platform desk", "Organisations, disputes, network analytics"],
  ] },
];

export function LoginForm() {
  const [error, action] = useActionState(loginAction, null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="grid gap-10 lg:grid-cols-[380px_minmax(0,1fr)]">
      <form ref={formRef} action={action} className="space-y-4 self-start border border-line bg-surface p-6">
        <div>
          <h2 className="display text-[30px] leading-none">Sign in</h2>
          <p className="m lc mt-2 text-muted">Demo password <span className="bg-ink px-1 text-surface">Demo@2026</span></p>
        </div>
        {error && <div className="border-l-2 border-danger px-3 py-1.5 text-sm text-danger">{error}</div>}
        <Field label="Email"><Input ref={emailRef} name="email" type="email" required autoComplete="username" /></Field>
        <Field label="Password"><Input ref={passRef} name="password" type="password" required autoComplete="current-password" /></Field>
        <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </form>
      <div className="space-y-8">
        {DEMO.map((g) => (
          <div key={g.group}>
            <div className="m mb-0 border-b border-ink pb-2 text-ink">{g.group}</div>
            <div className="grid sm:grid-cols-2">
              {g.users.map(([email, who, what]) => (
                <button key={email} type="button"
                  className="group border-b border-line px-0 py-3 text-left sm:odd:border-r sm:odd:pr-4 sm:even:pl-4 hover:bg-surface"
                  onClick={() => {
                    if (emailRef.current && passRef.current) {
                      emailRef.current.value = email; passRef.current.value = "Demo@2026";
                      formRef.current?.requestSubmit();
                    }
                  }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[15px] font-semibold text-ink">{who}</span>
                    <span className="m text-muted group-hover:text-ink">Sign in →</span>
                  </div>
                  <div className="text-[13px] text-muted">{what}</div>
                  <div className="m lc mt-1 text-subtle">{email}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
