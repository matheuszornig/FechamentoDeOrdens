import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: exigida apenas em generate/migrate
    url: process.env.DATABASE_URL!,
  },
});
