/**
 * `pnpm staff:seed | staff:password | staff:access | campaign:create | customer:merge ...` (Story 4.20): the
 * internal CLI's entry. It reads the internal token and port from the environment's config file,
 * calls the running server's internal listener on 127.0.0.1, asks every password without echo on
 * a terminal (or reads one line per answer from a pipe), and prints one JSON line. No secret is
 * ever an argument, printed or logged. See admin-cli.ts for the commands.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { loadConfig } from "../platform/config/env.config";
import { INTERNAL_TOKEN_HEADER } from "../platform/http/internal-token.guard";
import { LOOPBACK } from "../platform/http/servers";
import { CliIoError, runAdminCli, type CliIo } from "./admin-cli";

const ENTER = new Set(["\r", "\n", "\u0004"]);
const CANCEL = "\u0003";
const ERASE = new Set(["\u007f", "\b"]);

/** Reads one answer from the terminal in raw mode, echoing nothing. */
function hiddenAnswer(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (finish: () => void): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      finish();
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ENTER.has(ch)) return done(() => resolve(value));
        if (ch === CANCEL) return done(() => reject(new CliIoError("cancelled")));
        value = ERASE.has(ch) ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** One line per answer from a pipe, in order. */
function pipedAnswers(): (prompt: string) => Promise<string> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
  return async (prompt) => {
    process.stderr.write(prompt);
    const next = await lines.next();
    process.stderr.write("\n");
    if (next.done === true) throw new CliIoError("no_answer");
    return next.value;
  };
}

function io(token: string, port: number): CliIo {
  const base = `http://${LOOPBACK}:${port}`;
  const secret = process.stdin.isTTY ? hiddenAnswer : pipedAnswers();
  return {
    async call(method, path, body, headers) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { [INTERNAL_TOKEN_HEADER]: token, ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).catch(() => {
        throw new CliIoError("server_unreachable");
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    secret,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")) as unknown,
    print: (line) => void process.stdout.write(`${JSON.stringify(line)}\n`),
  };
}

let config: ReturnType<typeof loadConfig> | null = null;
try {
  config = loadConfig();
} catch {
  // A config error names keys only, but the line stays a reason code like every other failure.
  process.stdout.write(`${JSON.stringify({ ok: false, reason: "config" })}
`);
  process.exitCode = 1;
}
if (config !== null) process.exitCode = await runAdminCli(process.argv.slice(2), io(config.internalToken, config.internalPort));
process.stdin.unref?.();
