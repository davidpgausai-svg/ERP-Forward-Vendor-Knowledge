import { readFile } from "node:fs/promises";
import { closeDatabase, pool } from "./db.js";

async function migrate(): Promise<void> {
  const sql = await readFile(
    new URL("../migrations/0001_metadata_only.sql", import.meta.url),
    "utf8",
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('erp-forward-vendor-knowledge-migrations'))");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(JSON.stringify({ event: "vendor-knowledge.migration.complete", migration: "0001_metadata_only" }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  await migrate();
} finally {
  await closeDatabase();
}
