/**
 * Reading identity from the live copy (Story 2.2): customers, aliases, the code counter and the
 * bank fields on each customer row, mapped to the identity import with every time converted by
 * its column rule. Ids, codes and aliases pass through unchanged. Rows are read in key order.
 */
import type BetterSqlite3 from "better-sqlite3";

import { CUSTOMER_ROLES, lastFour, type CustomerRole, type IdentityImport, type ImportedAlias, type ImportedBankAccount, type ImportedCustomer, type ImportedCustomerStatus } from "../modules/identity/index";
import type { ImportReport } from "./import-report";
import { convertLiveTime } from "./live-time";
import { blank } from "./live-values";

interface LiveCustomer {
  customer_id: string;
  zalo_user_id: string | null;
  private_chat_id: string | null;
  display_name: string | null;
  bank_name: string | null;
  bank_account: string | null;
  account_holder: string | null;
  consent_at: unknown;
  status: string;
  created_at: unknown;
  password_hash: string | null;
  password_set_at: unknown;
  failed_logins: number | null;
  locked_until: unknown;
  role: string | null;
  last_login_at: unknown;
  customer_code: string | null;
}

interface LiveAlias {
  alias: string;
  customer_id: string;
  created_at: unknown;
  note: string | null;
}

const STATUSES: Record<string, ImportedCustomerStatus> = { active: "ACTIVE", disabled: "DISABLED" };
/** Identity keeps live text as it is; codes and Zalo ids are normalised on their own. */
const kept = (value: string | null | undefined): string | null => blank(value, { trim: false });

/**
 * The live guest account's id (repository.py:554; is_house at 642-645 also accepts role
 * 'house'). It is used only here, to map the live row to role HOUSE; after the import the role
 * is the one source of truth for guests.
 */
export const LIVE_HOUSE_CUSTOMER_ID = "HOUSE";

function mapRole(row: LiveCustomer, report: ImportReport): CustomerRole {
  if (row.customer_id === LIVE_HOUSE_CUSTOMER_ID) return "HOUSE";
  const role = (row.role ?? "user").toUpperCase();
  if ((CUSTOMER_ROLES as readonly string[]).includes(role)) return role as CustomerRole;
  report.notes.push({ kind: "unknown_customer_role", table: "customers", key: row.customer_id, detail: row.role ?? "" });
  return "USER";
}

/** Codes trimmed and upper case, Zalo ids trimmed; every change is recorded (values only for codes). */
function normalised(row: LiveCustomer, report: ImportReport): { code: string | null; zalo: string | null } {
  const rawCode = kept(row.customer_code);
  const code = rawCode === null ? null : rawCode.trim().toUpperCase();
  if (rawCode !== null && code !== rawCode) report.normalised.push({ table: "customers", key: row.customer_id, column: "customer_code", from: rawCode, to: code ?? "" });
  const rawZalo = kept(row.zalo_user_id);
  const zalo = rawZalo === null ? null : rawZalo.trim();
  if (rawZalo !== null && zalo !== rawZalo) report.normalised.push({ table: "customers", key: row.customer_id, column: "zalo_user_id" });
  return { code, zalo };
}

/** Normalised Zalo ids and codes shared by two live rows: the import stops before writing (duplicate_identity). */
function findDuplicates(customers: readonly ImportedCustomer[], report: ImportReport): void {
  for (const column of ["zalo_user_id", "customer_code"] as const) {
    const owners = new Map<string, string[]>();
    for (const c of customers) {
      const value = column === "zalo_user_id" ? c.zaloUserId : c.customerCode;
      if (value !== null) owners.set(value, [...(owners.get(value) ?? []), c.customerId]);
    }
    for (const keys of owners.values()) if (keys.length > 1) report.duplicates.push({ column, keys });
  }
}

function mapStatus(row: LiveCustomer, report: ImportReport): ImportedCustomerStatus {
  const status = STATUSES[row.status];
  if (status) return status;
  // Imported as DISABLED (cannot sign in) and listed for the owner, never treated as active.
  report.notes.push({ kind: "unknown_customer_status", table: "customers", key: row.customer_id, detail: row.status });
  return "DISABLED";
}

function customerOf(row: LiveCustomer, report: ImportReport): ImportedCustomer {
  const time = (column: string, value: unknown) => convertLiveTime(value, { table: "customers", column, key: row.customer_id }, report).instant;
  if (!/^[A-Za-z0-9]+$/.test(row.customer_id)) report.notes.push({ kind: "customer_id_not_alphanumeric", table: "customers", key: row.customer_id });
  const { code, zalo } = normalised(row, report);
  return {
    customerId: row.customer_id,
    customerCode: code,
    role: mapRole(row, report),
    status: mapStatus(row, report),
    zaloUserId: zalo,
    privateChatId: kept(row.private_chat_id),
    displayName: kept(row.display_name),
    passwordHash: kept(row.password_hash),
    passwordSetAt: time("password_set_at", row.password_set_at),
    failedSignIns: row.failed_logins ?? 0,
    lockedUntil: time("locked_until", row.locked_until),
    lastSignInAt: time("last_login_at", row.last_login_at),
    createdAt: time("created_at", row.created_at),
  };
}

function bankAccountOf(row: LiveCustomer, report: ImportReport): ImportedBankAccount | null {
  const number = kept(row.bank_account);
  if (number === null) {
    // A bank or holder without a number is not an account: nothing to pay to, listed for the owner.
    if (kept(row.bank_name) !== null || kept(row.account_holder) !== null) {
      report.notes.push({ kind: "bank_account_incomplete", table: "customers", key: row.customer_id, detail: "no account number" });
    }
    return null;
  }
  const four = lastFour(number);
  if (kept(row.bank_name) === null || kept(row.account_holder) === null) {
    report.notes.push({ kind: "bank_account_incomplete", table: "customers", key: row.customer_id, detail: `...${four}` });
  }
  const consentAt = convertLiveTime(row.consent_at, { table: "customers", column: "consent_at", key: row.customer_id }, report).instant;
  if (consentAt === null) report.notes.push({ kind: "bank_consent_missing", table: "customers", key: row.customer_id, detail: `...${four}` });
  return { customerId: row.customer_id, bankName: kept(row.bank_name), accountNumber: number, holderName: kept(row.account_holder), consentAt };
}

/** Reads every live alias once: the ones whose customer exists are imported, all count for the counter. */
function aliasesOf(source: BetterSqlite3.Database, customerIds: ReadonlySet<string>, report: ImportReport): { imported: ImportedAlias[]; all: string[] } {
  const rows = source.prepare("SELECT alias, customer_id, created_at, note FROM customer_aliases ORDER BY alias").all() as LiveAlias[];
  const imported: ImportedAlias[] = [];
  for (const row of rows) {
    if (!customerIds.has(row.customer_id)) {
      report.notes.push({ kind: "alias_target_missing", table: "customer_aliases", key: row.alias });
      continue;
    }
    const createdAt = convertLiveTime(row.created_at, { table: "customer_aliases", column: "created_at", key: row.alias }, report).instant;
    imported.push({ alias: row.alias, customerId: row.customer_id, createdAt, note: row.note });
  }
  return { imported, all: rows.map((r) => r.alias) };
}

/** Reads identity from the live copy; check `report.duplicates` before writing it. */
export function readLiveIdentity(source: BetterSqlite3.Database, report: ImportReport): IdentityImport {
  const rows = source.prepare("SELECT * FROM customers ORDER BY customer_id").all() as LiveCustomer[];
  const customers = rows.map((row) => customerOf(row, report));
  findDuplicates(customers, report);
  const bankAccounts = rows.map((row) => bankAccountOf(row, report)).filter((b): b is ImportedBankAccount => b !== null);
  const aliases = aliasesOf(source, new Set(rows.map((r) => r.customer_id)), report);
  const counter = source.prepare("SELECT last FROM customer_code_counter WHERE id = 1").get() as { last: number } | undefined;
  return { customers, aliases: aliases.imported, bankAccounts, counterLast: counter?.last ?? 0, retiredAliases: aliases.all };
}
