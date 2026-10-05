"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth";

export async function loginAction(_: string | null, fd: FormData): Promise<string | null> {
  const role = await login(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
  if (!role) return "Invalid email or password.";
  redirect(role === "platform_admin" ? "/admin" : "/dashboard");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
