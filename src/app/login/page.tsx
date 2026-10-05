import { redirect } from "next/navigation";
import { BRAND, LogoMark } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="min-h-screen">
      <section className="bg-dark text-on">
        <div className="mx-auto max-w-[1360px] px-[clamp(16px,3.2vw,48px)]">
          <div className="flex h-[72px] items-center justify-between">
            <div className="flex items-center gap-2.5">
              <LogoMark />
              <span className="text-[17px] font-bold uppercase tracking-[.06em] [font-stretch:125%] [font-variation-settings:'wdth'_125]">{BRAND}</span>
            </div>
            <span className="m text-on-muted">[ Procurement desk · Dubai · MEP &amp; fit-out ]</span>
          </div>
          <h1 className="display pt-16 pb-10 text-[clamp(50px,9.4vw,150px)] leading-[0.88] font-semibold">
            Send the BOQ.<br />We buy it better.
          </h1>
          <div className="grid gap-5 border-t border-[#4a4a46] py-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["01", "AI reads your BOQ and normalises every line to the material database"],
              ["02", "3–5 suppliers recommended per RFQ; quotes compared like-for-like"],
              ["03", "Manager approval issues the PO - AI recommends, people decide"],
              ["04", "Site verifies by OTP or QR; invoices matched to what arrived"],
            ].map(([n, t]) => (
              <div key={n}>
                <div className="m text-on-muted">↗ {n}</div>
                <p className="mt-2 text-[14px] leading-snug text-on">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-[1360px] px-[clamp(16px,3.2vw,48px)] py-12">
        <LoginForm />
      </div>
    </main>
  );
}
