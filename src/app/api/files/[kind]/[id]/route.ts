import { getSession } from "@/lib/auth";
import { one, withActor } from "@/lib/db";

// Streams a stored file. Row Level Security decides whether the caller may read it.
export async function GET(_: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const user = await getSession();
  if (!user) return new Response("Unauthorised", { status: 401 });
  const table = kind === "document" ? "documents" : kind === "delivery" ? "delivery_documents" : null;
  if (!table || !/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const file = await withActor(user, (tx) => one<{ filename: string; mime_type: string; content: Buffer }>(tx,
    `select filename, mime_type, content from ${table} where id = $1`, [id]));
  if (!file) return new Response("Not found", { status: 404 });
  const safeType = /^(application\/pdf|image\/(png|jpeg|webp)|text\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/.test(file.mime_type)
    ? file.mime_type : "application/octet-stream";
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": safeType,
      "Content-Disposition": `${safeType.startsWith("image/") || safeType === "application/pdf" ? "inline" : "attachment"}; filename="${encodeURIComponent(file.filename)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
