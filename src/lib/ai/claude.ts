import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Claude reads messy procurement documents (scanned PDFs, free-form BOQs). Its output is
// then grounded by the deterministic normaliser against the material database, and
// always reviewed by a person before anything is sent to suppliers.

export const CLAUDE_MODEL = "claude-opus-5-5";

export function claudeEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const nullable = (type: "string" | "number") => ({ anyOf: [{ type }, { type: "null" }] });

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "warnings"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "description", "quantity", "unit", "brand", "required_date", "location", "notes", "section"],
        properties: {
          ref: nullable("string"),
          description: { type: "string" },
          quantity: { type: "number" },
          unit: nullable("string"),
          brand: nullable("string"),
          required_date: nullable("string"),
          location: nullable("string"),
          notes: nullable("string"),
          section: nullable("string"),
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

const ExtractionResult = z.object({
  items: z.array(z.object({
    ref: z.string().nullable(),
    description: z.string().min(1),
    quantity: z.number(),
    unit: z.string().nullable(),
    brand: z.string().nullable(),
    required_date: z.string().nullable(),
    location: z.string().nullable(),
    notes: z.string().nullable(),
    section: z.string().nullable(),
  })),
  warnings: z.array(z.string()),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

const SYSTEM = `You extract material procurement requirements from construction documents (BOQs, material schedules, procurement lists) for contractors in the UAE.

Return one item per purchasable material line that has a quantity. For each item:
- description: the material with its full specification exactly as written (sizes, cores, ratings, standards). Do not invent specifications that are not in the document.
- quantity: the numeric quantity to buy. Skip lines with no quantity, section headings, rates-only lines, subtotals and totals.
- unit: the unit as written (m, nos, m2, roll...).
- brand: approved make / brand if stated, otherwise null.
- required_date: ISO date YYYY-MM-DD if a required/delivery date is stated (dates in the UAE are day-first), otherwise null.
- location / notes / section: as stated, otherwise null.
Labour-only, services, provisional sums and preliminaries are not materials - skip them and mention them in warnings.
Add a warning for anything ambiguous (illegible quantities, units that need confirming, missing sizes).`;

export async function extractWithClaude(doc: { mimeType: string; bytes: Buffer; text: string | null; filename: string }) {
  const client = new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (doc.mimeType === "application/pdf") {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.bytes.toString("base64") } });
  } else {
    content.push({ type: "text", text: `<document filename="${doc.filename}">\n${doc.text ?? ""}\n</document>` });
  }
  content.push({ type: "text", text: "Extract the procurement requirements from this document." });

  const stream = client.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The AI declined to process this document.");
  if (message.stop_reason === "max_tokens") throw new Error("Document too long for a single extraction pass.");
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return { result: ExtractionResult.parse(JSON.parse(text)), model: message.model };
}
