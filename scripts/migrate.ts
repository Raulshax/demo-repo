import { config } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  if (process.argv.includes("--reset")) {
    console.log("Resetting schema public");
    await client.query("drop schema if exists public cascade; create schema public;");
    await client.query("drop sequence if exists rfq_seq, po_seq, dn_seq");
  }
  const dir = path.resolve("db");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    console.log(`Applying ${file}`);
    await client.query("begin");
    await client.query(readFileSync(path.join(dir, file), "utf8"));
    await client.query("commit");
  }
  await client.end();
  console.log("Migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
