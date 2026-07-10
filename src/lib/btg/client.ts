import { mapNotesPayload, mapPositionPayload } from "./mapper";
import { RateLimiter } from "./rate-limiter";
import type {
  BtgService,
  FetchNotesResult,
  FetchPositionResult,
} from "./types";

const TOKEN_PATH = "/iaas-auth/api/v1/authorization/oauth2/accesstoken";
const NOTES_PATH = "/iaas-brokerage-notes/api/v1/brokerage-notes/account";
const POSITION_PATH = "/iaas-api-position/api/v1/position";

export type BtgToken = {
  accessToken: string;
  xIdPactual: string;
  expiresAt: number;
};

export interface BtgClientOptions {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  /** Injetável para testes. */
  fetchFn?: typeof fetch;
  rateLimiter?: RateLimiter;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
}

/**
 * Cliente real da API do BTG Pactual.
 *
 * Particularidades do contrato (ver Panejamento.md):
 * - OAuth2 client_credentials com Basic em latin1; o token vem nos HEADERS da
 *   resposta (`access_token`, `x-id-pactual`, `Expires`), não no body.
 * - Token expira em 900s; cache em memória com renovação ~60s antes.
 * - Notas: `access_token` vai como header próprio (NÃO Authorization: Bearer)
 *   e `x-id-partner-request` é um UUID v4 novo a cada requisição.
 * - 404 = dia sem notas (não é erro). 401 = renovar token e repetir uma vez.
 *   429/5xx = retry com backoff exponencial.
 * - TLS sempre validado.
 */
export class BtgClient implements BtgService {
  private token: BtgToken | null = null;
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchFn: typeof fetch;
  private readonly rateLimiter: RateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxRetries: number;

  constructor(options: BtgClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ??
      process.env.BTG_API_URL ??
      "https://api.btgpactual.com";
    this.clientId = options.clientId ?? process.env.BTG_CLIENT_ID ?? "";
    this.clientSecret =
      options.clientSecret ?? process.env.BTG_CLIENT_SECRET ?? "";
    this.fetchFn = options.fetchFn ?? fetch;
    // Limite oficial: 60 req/min. Margem de segurança: 50/min.
    this.rateLimiter = options.rateLimiter ?? new RateLimiter(50, 60_000);
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.maxRetries = options.maxRetries ?? 4;
  }

  async getToken(forceRefresh = false): Promise<BtgToken> {
    if (
      !forceRefresh &&
      this.token &&
      this.now() < this.token.expiresAt - 60_000
    ) {
      return this.token;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error("BTG_CLIENT_ID/BTG_CLIENT_SECRET não configurados");
    }

    // O par client_id:client_secret é codificado em ISO-8859-1 antes do base64.
    const basic = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
      "latin1",
    ).toString("base64");

    const res = await this.fetchFn(`${this.baseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        expires_in: "900",
        "x-id-partner-request": crypto.randomUUID(),
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!res.ok) {
      // O corpo costuma trazer o motivo (ex.: invalid_client) — ajuda a
      // distinguir credencial errada de ambiente errado.
      const body = await res.text().catch(() => "");
      throw new Error(
        `Falha ao obter token BTG: ${res.status}${body ? ` — ${body.slice(0, 300)}` : ""}`,
      );
    }

    // O BTG retorna o token nos HEADERS da resposta, não no body.
    const accessToken = res.headers.get("access_token");
    const xIdPactual = res.headers.get("x-id-pactual") ?? "";
    if (!accessToken) {
      throw new Error("Resposta OAuth sem header access_token");
    }

    this.token = {
      accessToken,
      xIdPactual,
      expiresAt: this.now() + 900_000,
    };
    return this.token;
  }

  async fetchNotes(
    accountNumber: string,
    isoDate: string,
  ): Promise<FetchNotesResult> {
    let attempt = 0;
    let renewedOn401 = false;

    for (;;) {
      await this.rateLimiter.acquire();
      const token = await this.getToken();

      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}${NOTES_PATH}`, {
          method: "POST",
          headers: {
            // Header próprio `access_token`, NÃO `Authorization: Bearer`.
            access_token: token.accessToken,
            // Fluxo real observado (script de referência do parceiro): o
            // x-id-partner-request das notas é o x-id-pactual devolvido junto
            // com o token — não um UUID aleatório como a doc sugeria.
            "x-id-partner-request": token.xIdPactual || crypto.randomUUID(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ date: isoDate, accountNumber }),
        });
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        await this.sleep(this.backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (res.status === 200) {
        const raw: unknown = await res.json();
        const xIdPactual = res.headers.get("x-id-pactual");
        if (xIdPactual) {
          console.log(
            `[btg] notas ${accountNumber}/${isoDate} x-id-pactual=${xIdPactual}`,
          );
        }
        return {
          kind: "notes",
          raw,
          notes: mapNotesPayload(raw, accountNumber, isoDate),
        };
      }

      // 404 "Não há valores publicados para esta data" — dia sem notas, não é erro.
      if (res.status === 404) {
        return { kind: "empty" };
      }

      // Token expirado: renova e repete uma única vez.
      if (res.status === 401 && !renewedOn401) {
        renewedOn401 = true;
        await this.getToken(true);
        continue;
      }

      if (
        (res.status === 429 || res.status >= 500) &&
        attempt < this.maxRetries
      ) {
        await this.sleep(this.backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new Error(
        `API BTG retornou ${res.status} para ${accountNumber}/${isoDate}`,
      );
    }
  }

  /**
   * Posição da conta em uma data (D-1 do período apurado) — endpoint
   * iaas-api-position, mesma autenticação das notas (access_token +
   * x-id-partner-request). 404/204 = sem posição publicada (não é erro).
   */
  async fetchPosition(
    accountNumber: string,
    isoDate: string,
  ): Promise<FetchPositionResult> {
    let attempt = 0;
    let renewedOn401 = false;

    for (;;) {
      await this.rateLimiter.acquire();
      const token = await this.getToken();

      let res: Response;
      try {
        res = await this.fetchFn(
          `${this.baseUrl}${POSITION_PATH}/${accountNumber}`,
          {
            method: "POST",
            headers: {
              access_token: token.accessToken,
              "x-id-partner-request": token.xIdPactual || crypto.randomUUID(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ date: isoDate }),
          },
        );
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        await this.sleep(this.backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (res.status === 200) {
        const raw: unknown = await res.json();
        return { kind: "position", raw, positions: mapPositionPayload(raw) };
      }

      if (res.status === 404 || res.status === 204) {
        return { kind: "empty" };
      }

      if (res.status === 401 && !renewedOn401) {
        renewedOn401 = true;
        await this.getToken(true);
        continue;
      }

      if (
        (res.status === 429 || res.status >= 500) &&
        attempt < this.maxRetries
      ) {
        await this.sleep(this.backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new Error(
        `API BTG (posição) retornou ${res.status} para ${accountNumber}/${isoDate}`,
      );
    }
  }

  private backoffMs(attempt: number): number {
    return 500 * 2 ** attempt;
  }
}
