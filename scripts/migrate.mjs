// Roda as migrations do Drizzle como etapa do build (Vercel), condicionada à
// presença de DATABASE_URL — em CI sem banco o build segue sem migrar.
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL ausente — pulando migrations.");
  process.exit(0);
}

console.log("[migrate] Aplicando migrations com drizzle-kit migrate…");
execSync("pnpm drizzle-kit migrate", { stdio: "inherit" });
