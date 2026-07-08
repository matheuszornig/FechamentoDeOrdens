import { describe, expect, it, vi } from "vitest";
import { BtgClient } from "./client";
import { RateLimiter } from "./rate-limiter";

const TOKEN_URL =
  "https://api.btgpactual.com/iaas-auth/api/v1/authorization/oauth2/accesstoken";

function tokenResponse(token = "tok-1") {
  return new Response("", {
    status: 200,
    headers: {
      access_token: token,
      "x-id-pactual": "pactual-1",
      Expires: "900",
    },
  });
}

function notesResponse(
  payload: unknown = { bov: [], option: [], bmf: [], loan: [] },
) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "x-id-pactual": "pactual-2",
    },
  });
}

function makeClient(fetchFn: typeof fetch, now?: () => number) {
  const noopSleep = async () => {};
  return new BtgClient({
    clientId: "id",
    clientSecret: "secret",
    fetchFn,
    // Limite alto: os testes de rate limit ficam em rate-limiter.test.ts.
    rateLimiter: new RateLimiter(10_000, 60_000, now ?? Date.now, noopSleep),
    sleep: noopSleep,
    now,
  });
}

describe("BtgClient.getToken", () => {
  it("lê o token dos HEADERS da resposta e envia Basic auth + form body", async () => {
    const fetchFn = vi.fn(async () => tokenResponse());
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const token = await client.getToken();

    expect(token.accessToken).toBe("tok-1");
    expect(token.xIdPactual).toBe("pactual-1");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(TOKEN_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("id:secret", "latin1").toString("base64")}`,
    );
    expect(headers.expires_in).toBe("900");
    expect(headers["x-id-partner-request"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(init.body)).toContain("grant_type=client_credentials");
  });

  it("cacheia o token e renova ~60s antes de expirar", async () => {
    let now = 0;
    const fetchFn = vi.fn(async () =>
      tokenResponse(`tok-${fetchFn.mock.calls.length}`),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch, () => now);

    await client.getToken();
    await client.getToken();
    expect(fetchFn).toHaveBeenCalledTimes(1); // cache válido

    now = 900_000 - 61_000;
    await client.getToken();
    expect(fetchFn).toHaveBeenCalledTimes(1); // ainda dentro da margem

    now = 900_000 - 59_000; // a menos de 60s do vencimento → renova
    await client.getToken();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("falha se a resposta não tiver o header access_token", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = makeClient(fetchFn as unknown as typeof fetch);
    await expect(client.getToken()).rejects.toThrow(/access_token/);
  });
});

describe("BtgClient.fetchNotes", () => {
  it("envia access_token como header próprio e UUID novo a cada requisição", async () => {
    const partnerIds: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) return tokenResponse();
      const headers = init?.headers as Record<string, string>;
      partnerIds.push(headers["x-id-partner-request"]);
      expect(headers.access_token).toBe("tok-1");
      expect(headers.Authorization).toBeUndefined();
      expect(JSON.parse(String(init?.body))).toEqual({
        date: "2026-01-05",
        accountNumber: "12345",
      });
      return notesResponse();
    });
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await client.fetchNotes("12345", "2026-01-05");
    await client.fetchNotes("12345", "2026-01-05");

    expect(partnerIds).toHaveLength(2);
    expect(partnerIds[0]).not.toBe(partnerIds[1]); // UUID novo por requisição
    expect(new Set(partnerIds).size).toBe(2);
  });

  it("trata 404 como dia sem notas (não é erro, sem retry)", async () => {
    let notesCalls = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return tokenResponse();
      notesCalls += 1;
      return new Response("Não há valores publicados para esta data", {
        status: 404,
      });
    });
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const result = await client.fetchNotes("12345", "2026-01-05");
    expect(result).toEqual({ kind: "empty" });
    expect(notesCalls).toBe(1);
  });

  it("renova o token e repete uma única vez em 401", async () => {
    let tokenCalls = 0;
    let notesCalls = 0;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) {
        tokenCalls += 1;
        return tokenResponse(`tok-${tokenCalls}`);
      }
      notesCalls += 1;
      const headers = init?.headers as Record<string, string>;
      if (notesCalls === 1) {
        expect(headers.access_token).toBe("tok-1");
        return new Response("", { status: 401 });
      }
      expect(headers.access_token).toBe("tok-2");
      return notesResponse();
    });
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const result = await client.fetchNotes("12345", "2026-01-05");
    expect(result.kind).toBe("notes");
    expect(tokenCalls).toBe(2);
    expect(notesCalls).toBe(2);
  });

  it("faz retry com backoff exponencial em 429/5xx", async () => {
    const sleeps: number[] = [];
    let notesCalls = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return tokenResponse();
      notesCalls += 1;
      if (notesCalls === 1) return new Response("", { status: 429 });
      if (notesCalls === 2) return new Response("", { status: 503 });
      return notesResponse();
    });
    const client = new BtgClient({
      clientId: "id",
      clientSecret: "secret",
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(10_000, 60_000, Date.now, async () => {}),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const result = await client.fetchNotes("12345", "2026-01-05");
    expect(result.kind).toBe("notes");
    expect(sleeps).toEqual([500, 1000]); // backoff exponencial
  });

  it("desiste após esgotar os retries em 5xx", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return tokenResponse();
      return new Response("", { status: 500 });
    });
    const client = new BtgClient({
      clientId: "id",
      clientSecret: "secret",
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(10_000, 60_000, Date.now, async () => {}),
      sleep: async () => {},
      maxRetries: 2,
    });
    await expect(client.fetchNotes("12345", "2026-01-05")).rejects.toThrow(
      /500/,
    );
  });
});
