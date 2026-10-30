import { defineConfig } from "drizzle-kit";

// Reads the table layout from a COPY of the live database (never the live file)
// and writes the Drizzle table descriptions into src/shared/database/schema.
// ADR-17: until Phase 6 only Python changes the real schema; this only mirrors it.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/shared/database/schema/index.ts",
  out: "./src/shared/database/schema",
  dbCredentials: {
    url: process.env.CASHBACK_DB_COPY ?? "./.data/cashback.readonly.db",
  },
});
