import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-accent"><Logo /><span className="text-lg font-semibold text-ink">ProcureOS</span></div>
        <h1 className="mt-4 max-w-2xl text-2xl font-semibold tracking-tight">
          The AI procurement operating system for construction.
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          From project demand to the best supplier, best price, completed delivery and procurement intelligence. AI recommends - people approve.
        </p>
      </div>
      <LoginForm />
    </main>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <path d="M9 22V10h7.5a4.5 4.5 0 010 9H13" stroke="white" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21.5" cy="22" r="2" fill="white" />
    </svg>
  );
}
