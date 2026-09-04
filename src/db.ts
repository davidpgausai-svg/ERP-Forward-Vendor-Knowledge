import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
