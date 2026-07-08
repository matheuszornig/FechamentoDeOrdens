import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, schema } from "@/db";

/**
 * URL base: BETTER_AUTH_URL quando definida; na Vercel, cai para as URLs
 * injetadas automaticamente (produção e deployment), dispensando configuração
 * manual do domínio.
 */
function resolveBaseUrl(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** Origens confiáveis: produção, deployment atual e branch (previews). */
function resolveTrustedOrigins(): string[] {
  return [
    resolveBaseUrl(),
    process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
    process.env.VERCEL_BRANCH_URL && `https://${process.env.VERCEL_BRANCH_URL}`,
  ].filter((origin): origin is string => Boolean(origin));
}

/**
 * Instância server-side do Better Auth. Cadastro desabilitado: o único
 * usuário admin é criado pelo seed (scripts/seed-admin.ts / workflow seed.yml).
 */
function createAuth() {
  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: resolveBaseUrl(),
    trustedOrigins: resolveTrustedOrigins(),
  });
}

let cached: ReturnType<typeof createAuth> | null = null;

export function getAuth(): ReturnType<typeof createAuth> {
  cached ??= createAuth();
  return cached;
}

export async function requireSession(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  if (!session) {
    return null;
  }
  return session;
}
