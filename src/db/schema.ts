import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Better Auth (usuário admin único)
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Domínio: notas, cache de datas e jobs de apuração
// ---------------------------------------------------------------------------

/**
 * Nota de corretagem persistida. Funciona como cache: uma vez buscada na API
 * do BTG, a nota nunca é buscada de novo. `rawPayload` guarda o JSON bruto
 * para auditoria/reprocessamento; `normalized` guarda a NormalizedNote usada
 * pelo motor de apuração.
 */
export const brokerageNote = pgTable(
  "brokerage_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountNumber: text("account_number").notNull(),
    tradeDate: date("trade_date", { mode: "string" }).notNull(),
    market: text("market", {
      enum: ["bov", "option", "bmf", "loan"],
    }).notNull(),
    noteNumber: text("note_number").notNull(),
    normalized: jsonb("normalized").notNull(),
    rawPayload: jsonb("raw_payload").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brokerage_note_unique").on(
      t.accountNumber,
      t.tradeDate,
      t.market,
      t.noteNumber,
    ),
  ],
);

/**
 * Controle de cache por (conta + data): marca datas já consultadas na API e o
 * desfecho, para nunca repetir requisições de datas já resolvidas.
 * `sem_notas` corresponde ao 404 "Não há valores publicados para esta data".
 */
export const fetchedDate = pgTable(
  "fetched_date",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountNumber: text("account_number").notNull(),
    tradeDate: date("trade_date", { mode: "string" }).notNull(),
    outcome: text("outcome", {
      enum: ["com_notas", "sem_notas", "erro"],
    }).notNull(),
    errorMessage: text("error_message"),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fetched_date_unique").on(t.accountNumber, t.tradeDate)],
);

export const apuracaoJob = pgTable("apuracao_job", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountNumber: text("account_number").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  status: text("status", {
    enum: [
      "pendente",
      "buscando",
      "calculando",
      "concluido",
      "erro",
      "cancelado",
    ],
  })
    .notNull()
    .default("pendente"),
  totalDates: integer("total_dates").notNull().default(0),
  processedDates: integer("processed_dates").notNull().default(0),
  errorMessage: text("error_message"),
  result: jsonb("result"),
  alerts: jsonb("alerts"),
  /** Lock/heartbeat do processamento retomável: renovado a cada data buscada. */
  lockedAt: timestamp("locked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
