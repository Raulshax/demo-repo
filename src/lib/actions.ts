import "server-only";
import { redirect, unstable_rethrow } from "next/navigation";

export function fail(path: string, message: string): never {
  redirect(withParam(path, "error", message));
}

export function done(path: string, message: string): never {
  redirect(withParam(path, "ok", message));
}

function withParam(path: string, key: string, value: string) {
  const [base, hash] = path.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}${hash ? `#${hash}` : ""}`;
}

/** Runs an action body; converts thrown errors (incl. database policy violations) into a flash message. */
export async function attempt(path: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? friendly(err.message) : "Something went wrong";
    console.error(`[action ${path}]`, err);
    fail(path, message);
  }
}

function friendly(msg: string) {
  if (/row-level security/.test(msg)) return "You do not have permission to do that.";
  if (/permission denied/.test(msg)) return "You do not have permission to do that.";
  return msg;
}

export const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
export const optStr = (fd: FormData, key: string) => str(fd, key) || null;
export const numOf = (fd: FormData, key: string) => {
  const v = str(fd, key).replace(/,/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
