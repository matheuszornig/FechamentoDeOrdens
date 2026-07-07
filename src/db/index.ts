import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Conexão via driver HTTP serverless do Neon — usado em todos os ambientes
 * (dev, preview e produção), sem banco local.
 */
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não configurada");
  }
  return drizzle(neon(url), { schema });
}

let cached: ReturnType<typeof createDb> | null = null;

export function getDb() {
  cached ??= createDb();
  return cached;
}

export { schema };
