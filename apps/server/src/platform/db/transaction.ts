/**
 * The one transaction helper (AD-2, code.md §5, review M6). Every write runs in
 * `BEGIN IMMEDIATE`, so the write lock is taken before the first read and two commands
 * never interleave. `fn` is synchronous: a better-sqlite3 transaction given an async
 * function commits when the promise is returned, and the rest of the code would run
 * outside the transaction it appears to be in. So a returned thenable rolls back and
 * throws, and lint rejects an `async` callback before it gets that far.
 *
 * `fn` gets a handle bound to this one transaction: once the transaction has ended,
 * every use of it throws, so code that runs after an `await` (or keeps the handle)
 * can never write outside a transaction by accident.
 */
import type BetterSqlite3 from "better-sqlite3";

/** Attempts at `BEGIN IMMEDIATE`; each one waits up to the busy timeout. */
const BEGIN_ATTEMPTS = 2;

/** Another connection held the write lock past the busy timeout and one retry. */
export class LedgerBusyError extends Error {
  readonly code = "ledger_busy";
  constructor(options?: ErrorOptions) {
    super("ledger_busy", options);
    this.name = "LedgerBusyError";
  }
}

export class AsyncTransactionError extends Error {
  readonly code = "async_transaction";
  constructor() {
    super("tx(fn): fn returned a thenable; a transaction must be synchronous and await nothing");
    this.name = "AsyncTransactionError";
  }
}

export class TransactionEndedError extends Error {
  readonly code = "transaction_ended";
  constructor() {
    super("tx(fn): the transaction handle was used after its transaction ended");
    this.name = "TransactionEndedError";
  }
}

/** The connection as seen by one transaction: usable only while it is open. */
function scopedClient(sqlite: BetterSqlite3.Database, isOpen: () => boolean): BetterSqlite3.Database {
  return new Proxy(sqlite, {
    get(target, property) {
      if (!isOpen()) throw new TransactionEndedError();
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export function isBusy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"));
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function begin(sqlite: BetterSqlite3.Database): void {
  for (let attempt = 1; ; attempt++) {
    try {
      sqlite.exec("BEGIN IMMEDIATE");
      return;
    } catch (error) {
      if (!isBusy(error)) throw error;
      if (attempt >= BEGIN_ATTEMPTS) throw new LedgerBusyError({ cause: error });
    }
  }
}

/** Runs `fn` in one transaction; `handleFor` builds its handle over the scoped connection. */
export function runTransaction<D, T>(sqlite: BetterSqlite3.Database, handleFor: (client: BetterSqlite3.Database) => D, fn: (db: D) => T): T {
  if (sqlite.inTransaction) throw new Error("tx(fn): nested transaction; one command is one transaction");
  begin(sqlite);
  let open = true;
  try {
    const result = fn(handleFor(scopedClient(sqlite, () => open)));
    if (isThenable(result)) {
      // The callback already failed the transaction; keep its later rejection from crashing the process.
      result.then(undefined, () => undefined);
      throw new AsyncTransactionError();
    }
    sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
    throw isBusy(error) ? new LedgerBusyError({ cause: error }) : error;
  } finally {
    open = false;
  }
}
