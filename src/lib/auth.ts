import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, schema } from "@/db";

let cached: ReturnType<typeof betterAuth> | null = null;

/**
 * Instância server-side do Better Auth. Cadastro desabilitado: o único
 * usuário admin é criado pelo seed (scripts/seed-admin.ts / workflow seed.yml).
 */
export function getAuth() {
  cached ??= betterAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
  });
  return cached;
}

export async function requireSession(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  if (!session) {
    return null;
  }
  return session;
}
