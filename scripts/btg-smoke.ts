/**
 * Smoke test do cliente BTG real (ignora BTG_USE_MOCK): obtém o token OAuth e
 * busca as notas de uma conta/data, imprimindo um resumo do mapeamento.
 *
 * Uso: pnpm tsx scripts/btg-smoke.ts <conta> <data-ISO>
 * Ex.: pnpm tsx scripts/btg-smoke.ts 004121241 2026-07-07
 */
import { BtgClient } from "../src/lib/btg/client";

async function main() {
  const [conta, data] = process.argv.slice(2);
  if (!conta || !data) {
    throw new Error("Uso: pnpm tsx scripts/btg-smoke.ts <conta> <data-ISO>");
  }

  const client = new BtgClient();

  console.log("[1/2] Obtendo token OAuth…");
  const token = await client.getToken();
  console.log(
    `  ok: access_token=${token.accessToken.slice(0, 16)}… ` +
      `x-id-pactual=${token.xIdPactual || "(vazio)"} ` +
      `expira em ${Math.round((token.expiresAt - Date.now()) / 1000)}s`,
  );

  console.log(`[2/2] Buscando notas de ${conta} em ${data}…`);
  const result = await client.fetchNotes(conta, data);
  if (result.kind === "empty") {
    console.log("  404 — dia sem notas publicadas para esta conta.");
    return;
  }
  console.log(`  ok: ${result.notes.length} nota(s) normalizada(s)`);
  for (const note of result.notes) {
    const custos = Object.values(note.costs).reduce((a, b) => a + b, 0);
    console.log(
      `  - [${note.market}] nota ${note.noteNumber} ${note.date}: ` +
        `${note.trades.length} negócio(s), ${note.adjustments.length} ajuste(s), ` +
        `${note.loanLines.length} linha(s) de aluguel, custos R$ ${custos.toFixed(2)}, ` +
        `IRRF R$ ${note.irrf.toFixed(2)}`,
    );
    for (const t of note.trades) {
      console.log(
        `      ${t.side === "buy" ? "C" : "V"} ${t.quantity} ${t.ticker} @ ${t.price} (R$ ${t.grossValue.toFixed(2)})${t.dayTradeHint ? " [DT]" : ""}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
