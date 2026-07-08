/**
 * Inspeciona e (com --yes) apaga os dados de domínio: notas, cache de datas e
 * jobs. Necessário ao trocar BTG_USE_MOCK de true para false no mesmo banco —
 * o cache de FetchedDate marcaria as datas do mock como resolvidas e a API
 * real nunca seria consultada. Não toca nas tabelas de auth (admin preservado).
 *
 * Uso:
 *   DATABASE_URL=... pnpm tsx scripts/clear-data.ts        # só mostra contagens
 *   DATABASE_URL=... pnpm tsx scripts/clear-data.ts --yes  # apaga tudo
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Defina DATABASE_URL no ambiente.");
  const sql = neon(url);

  const [counts] = await sql`select
    (select count(*)::int from brokerage_note) as notas,
    (select count(*)::int from fetched_date) as datas,
    (select count(*)::int from apuracao_job) as jobs`;
  const contas = await sql`select distinct account_number from fetched_date order by 1`;
  console.log("[clear-data] contagens:", counts);
  console.log(
    "[clear-data] contas com cache:",
    contas.map((c) => c.account_number),
  );

  if (!process.argv.includes("--yes")) {
    console.log("[clear-data] nada apagado — rode com --yes para limpar.");
    return;
  }

  await sql`delete from apuracao_job`;
  await sql`delete from fetched_date`;
  await sql`delete from brokerage_note`;
  console.log("[clear-data] notas, cache de datas e jobs apagados.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
