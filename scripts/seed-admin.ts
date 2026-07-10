/**
 * Cria o usuário admin único (ADMIN_EMAIL / ADMIN_PASSWORD) contra a
 * DATABASE_URL informada. Idempotente: se o e-mail já existe, não faz nada.
 *
 * Uso: DATABASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm seed:admin
 */
import { neon } from "@neondatabase/serverless";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/db/schema";

async function main() {
  const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, BETTER_AUTH_SECRET } =
    process.env;
  if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      "Defina DATABASE_URL, ADMIN_EMAIL e ADMIN_PASSWORD no ambiente.",
    );
  }
  if (ADMIN_PASSWORD.length < 8) {
    throw new Error("ADMIN_PASSWORD deve ter pelo menos 8 caracteres.");
  }

  const db = drizzle(neon(DATABASE_URL), { schema });

  const existing = await db
    .select({ id: schema.user.id, role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.email, ADMIN_EMAIL));
  if (existing.length > 0) {
    // Idempotente também para a promoção: garante role=admin (necessário ao
    // plugin admin — gestão de usuários em /usuarios).
    if (existing[0].role !== "admin") {
      await db
        .update(schema.user)
        .set({ role: "admin" })
        .where(eq(schema.user.id, existing[0].id));
      console.log(`[seed] Usuário ${ADMIN_EMAIL} promovido a admin.`);
      return;
    }
    console.log(`[seed] Usuário ${ADMIN_EMAIL} já existe — nada a fazer.`);
    return;
  }

  // Instância local com cadastro habilitado só para o seed; o app em produção
  // roda com disableSignUp: true.
  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    secret: BETTER_AUTH_SECRET ?? "seed-only-secret",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  });

  await auth.api.signUpEmail({
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Admin" },
  });
  await db
    .update(schema.user)
    .set({ role: "admin" })
    .where(eq(schema.user.email, ADMIN_EMAIL));
  console.log(`[seed] Usuário admin ${ADMIN_EMAIL} criado com sucesso.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
