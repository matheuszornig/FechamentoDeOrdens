import { mapNotesPayload } from "./mapper";
import type { BtgService, FetchNotesResult } from "./types";

/**
 * Mock determinístico da API de notas do BTG, no formato REAL do payload
 * (bov, option, bmf com AJUPOS, loan). Ativado por BTG_USE_MOCK=true.
 *
 * Determinismo: o gerador é semeado por (conta + data) — a mesma consulta
 * sempre devolve as mesmas notas. ~30% dos dias retornam "404" (dia sem
 * notas) para exercitar o cache de FetchedDate.
 */

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-01-05" → "05/01/2026" */
function toBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const BOV_TICKERS: Array<[string, string, number]> = [
  ["PETR4", "PN", 38],
  ["VALE3", "ON", 62],
  ["ITUB4", "PN", 34],
  ["AMER3", "ON", 8],
  ["BBDC4", "PN", 15],
  ["WEGE3", "ON", 42],
];
const OPTION_TICKERS: Array<[string, string, number]> = [
  ["PETRE380", "PN 38,00", 1.4],
  ["VALEF620", "ON 62,00", 2.1],
];
const FUTURES: Array<[string, string]> = [
  ["CCMF25", "15/01/2027"],
  ["WINQ25", "18/08/2026"],
];
const LOAN_SYMBOLS = ["PETR4", "VALE3", "BBAS3"];

type MockTrade = {
  cV: string;
  specTitulo: string;
  quantidade: number;
  precoAjuste: number;
  valorOperacao: number;
  tipoMercado: string;
  obs: string;
};

/** Formato real: números viajam como string com decimal em ponto ("378.0"). */
const s = (n: number) => String(n);

function buildBovLikeNote(
  rand: () => number,
  tickers: Array<[string, string, number]>,
  isoDate: string,
  account: string,
  market: "VISTA" | "OPCAO",
  noteNumber: number,
) {
  const trades: MockTrade[] = [];
  const dayIndex = Number(isoDate.slice(8, 10));

  // Par de day trade: compra e venda casadas no mesmo pregão.
  const [dtTicker, dtSpec, dtBase] =
    tickers[Math.floor(rand() * tickers.length)];
  const dtQty = (Math.floor(rand() * 4) + 1) * 100;
  const dtBuy = round2(dtBase * (0.98 + rand() * 0.02));
  const dtSell = round2(dtBuy * (0.995 + rand() * 0.015));
  trades.push({
    cV: "C",
    specTitulo: `${dtTicker}\t${dtSpec}`,
    quantidade: dtQty,
    precoAjuste: dtBuy,
    valorOperacao: round2(dtQty * dtBuy),
    tipoMercado: market,
    obs: "D",
  });
  trades.push({
    cV: "V",
    specTitulo: `${dtTicker}\t${dtSpec}`,
    quantidade: dtQty,
    precoAjuste: dtSell,
    valorOperacao: round2(dtQty * dtSell),
    tipoMercado: market,
    obs: "D",
  });

  // Perna de swing: dias pares compram, ímpares vendem — posições abrem e
  // fecham ao longo do período.
  const [swTicker, swSpec, swBase] =
    tickers[(dayIndex + tickers.length - 1) % tickers.length];
  const swQty = (Math.floor(rand() * 3) + 1) * 100;
  const swPrice = round2(swBase * (0.97 + rand() * 0.06));
  trades.push({
    cV: dayIndex % 2 === 0 ? "C" : "V",
    specTitulo: `${swTicker}\t${swSpec}`,
    quantidade: swQty,
    precoAjuste: swPrice,
    valorOperacao: round2(swQty * swPrice),
    tipoMercado: market,
    obs: "",
  });

  // Linha-placeholder ocasional, como aparece na doc do BTG — o mapper ignora.
  if (rand() < 0.15) {
    trades.push({
      cV: "string",
      specTitulo: "string",
      quantidade: 0,
      precoAjuste: 0,
      valorOperacao: 0,
      tipoMercado: "string",
      obs: "string",
    });
  }

  const volume = trades.reduce((acc, t) => acc + t.valorOperacao, 0);

  // Consolidado por lado (formato real): compra e venda separados.
  const summarizedBySide = new Map<
    string,
    { qtdCompra: number; qtdVenda: number; valCompra: number; valVenda: number }
  >();
  for (const t of trades) {
    if (t.specTitulo === "string") continue;
    const cur = summarizedBySide.get(t.specTitulo) ?? {
      qtdCompra: 0,
      qtdVenda: 0,
      valCompra: 0,
      valVenda: 0,
    };
    if (t.cV === "V") {
      cur.qtdVenda += t.quantidade;
      cur.valVenda = round2(cur.valVenda + t.valorOperacao);
    } else {
      cur.qtdCompra += t.quantidade;
      cur.valCompra = round2(cur.valCompra + t.valorOperacao);
    }
    summarizedBySide.set(t.specTitulo, cur);
  }

  return {
    ticketInfo: {
      numeroNota: String(noteNumber),
      dataPregao: toBrDate(isoDate),
      dataLiqui: toBrDate(isoDate),
      numeroCliente: account,
      codCliente: `85-0 ${account}`,
      docCliente: "123.456.789-00",
      nomeCliente: "CLIENTE MOCK",
      bolsaDataEmol: s(round2(volume * 0.00005)),
      bolsaTextEmol: "D",
      clearDataTaxaLiq: s(round2(volume * 0.00025)),
      clearTextTaxaLiq: "D",
      clearDataTaxaReg: "0.0",
      clearTextTaxaReg: "D",
      correDataTotal: s(round2(4.5 + volume * 0.0001)),
      correTextTotal: "D",
      correDataIss: s(round2((4.5 + volume * 0.0001) * 0.05)),
      correTextIss: "D",
      correDataIrrf: s(round2(volume * 0.00005)),
      correTextIrrf: "D",
      correDataTTA: "0.1",
      correTextTTA: "D",
      corretDayTrade: "",
    },
    tradeList: trades.map((t) => ({
      cV: t.cV,
      dC: t.cV === "V" ? "C" : "D",
      negociacao: "1-BOVESPA",
      obs: t.obs,
      quantidade: t.specTitulo === "string" ? "string" : s(t.quantidade),
      precoAjuste: t.specTitulo === "string" ? "string" : s(t.precoAjuste),
      specTitulo: t.specTitulo,
      tipoMercado: t.tipoMercado,
      valorOperacao: t.specTitulo === "string" ? "string" : s(t.valorOperacao),
      valorOperacaoBigDecimal:
        t.specTitulo === "string" ? "string" : s(t.valorOperacao),
    })),
    summarizedTradeList: [...summarizedBySide.entries()].map(([titulo, v]) => ({
      titulo,
      quantidadeTotalCompra: s(v.qtdCompra),
      quantidadeTotalVenda: s(v.qtdVenda),
      valorTotalCompra: s(v.valCompra),
      valorTotalVenda: s(v.valVenda),
      precoMedioCompra: s(
        v.qtdCompra > 0 ? round2(v.valCompra / v.qtdCompra) : 0,
      ),
      precoMedioVenda: s(v.qtdVenda > 0 ? round2(v.valVenda / v.qtdVenda) : 0),
    })),
  };
}

function buildBmfNote(
  rand: () => number,
  isoDate: string,
  account: string,
  noteNumber: number,
) {
  const [future, vencimento] = FUTURES[Math.floor(rand() * FUTURES.length)];
  const qty = Math.floor(rand() * 5) + 1;
  const buy = round2(60 + rand() * 10);
  const sell = round2(buy * (0.998 + rand() * 0.006));

  const tradeList = [
    // Day trade casado de futuro — entra no matching normal.
    {
      mercadoria: future,
      cV: "C",
      dC: "D",
      quantidade: qty,
      precoAjuste: buy,
      valorOperacao: round2(qty * buy * 450),
      vencimento,
      tipoNegocio: "NORMAL",
    },
    {
      mercadoria: future,
      cV: "V",
      dC: "D",
      quantidade: qty,
      precoAjuste: sell,
      valorOperacao: round2(qty * sell * 450),
      vencimento,
      tipoNegocio: "NORMAL",
    },
    // Ajuste diário de posição carregada — fora do matching.
    {
      mercadoria:
        FUTURES[(Math.floor(rand() * FUTURES.length) + 1) % FUTURES.length][0],
      cV: rand() < 0.5 ? "C" : "V",
      dC: "",
      quantidade: 2,
      precoAjuste: 0,
      valorOperacao: round2((rand() - 0.45) * 800),
      vencimento,
      tipoNegocio: "AJUPOS",
    },
  ];

  const fees = round2(2 + rand() * 6);
  return {
    financialSummary: {
      bmf_fee: -round2(fees * 0.3),
      registry_fee: -round2(fees * 0.2),
      operational_fee: -round2(fees * 0.4),
      iss: -round2(fees * 0.05),
      pis: -round2(fees * 0.01),
      cofins: -round2(fees * 0.03),
      cvm179_fee: -round2(fees * 0.01),
      total_fees: -fees,
      daytrade_adjustment: round2(qty * (sell - buy) * 450),
      position_adjustment: tradeList[2].valorOperacao,
      total_net: 0,
    },
    ticketInfo: {
      numeroNota: String(noteNumber),
      dataPregao: toBrDate(isoDate),
      codCliente: account,
      tradeList,
    },
  };
}

function buildLoanNote(
  rand: () => number,
  isoDate: string,
  account: string,
  noteNumber: number,
) {
  const movements = LOAN_SYMBOLS.filter(() => rand() < 0.6).map((symbol) => {
    const doador = rand() < 0.5;
    const remuneration = round2(rand() * 15);
    return {
      symbol,
      contract_side: doador ? "Doador" : "Tomador",
      quantity: (Math.floor(rand() * 5) + 1) * 100,
      fee: doador ? 0 : round2(rand() * 8),
      remuneration: doador ? remuneration : 0,
      irrf: doador ? round2(remuneration * 0.15) : 0,
    };
  });
  if (movements.length === 0) return null;
  return {
    client: { account_number: account },
    financial_summary: {},
    invoice_number: noteNumber,
    movement_date: `${isoDate}T00:00:00`,
    movements,
  };
}

/** Payload no formato real, ou null para dias "404 — sem notas". */
export function generateMockPayload(
  accountNumber: string,
  isoDate: string,
): unknown | null {
  const seed = hashString(`${accountNumber}|${isoDate}`);
  const rand = mulberry32(seed);

  // ~30% dos dias não têm notas (exercita o cache de datas vazias).
  if (rand() < 0.3) return null;

  const noteBase = 100_000 + Math.floor(rand() * 900_000);
  const payload: Record<string, unknown[]> = {
    loan: [],
    bmf: [],
    bov: [],
    option: [],
  };

  payload.bov.push(
    buildBovLikeNote(
      rand,
      BOV_TICKERS,
      isoDate,
      accountNumber,
      "VISTA",
      noteBase,
    ),
  );
  if (rand() < 0.3) {
    payload.option.push(
      buildBovLikeNote(
        rand,
        OPTION_TICKERS,
        isoDate,
        accountNumber,
        "OPCAO",
        noteBase + 1,
      ),
    );
  }
  if (rand() < 0.35) {
    payload.bmf.push(buildBmfNote(rand, isoDate, accountNumber, noteBase + 2));
  }
  if (rand() < 0.2) {
    const loan = buildLoanNote(rand, isoDate, accountNumber, noteBase + 3);
    if (loan) payload.loan.push(loan);
  }

  return payload;
}

export class MockBtgService implements BtgService {
  async fetchNotes(
    accountNumber: string,
    isoDate: string,
  ): Promise<FetchNotesResult> {
    const payload = generateMockPayload(accountNumber, isoDate);
    if (payload === null) return { kind: "empty" };
    return {
      kind: "notes",
      raw: payload,
      notes: mapNotesPayload(payload, accountNumber, isoDate),
    };
  }
}
