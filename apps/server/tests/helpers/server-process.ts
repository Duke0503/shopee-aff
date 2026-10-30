/**
 * Starts the real server entry point in a child process with its own home directory,
 * so startup tests read a real `~/.config/cashback/dev.env` and a real lock file.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_DIR = fileURLToPath(new URL("../..", import.meta.url));
const MAIN = join(SERVER_DIR, "src", "main.ts");

export interface Sandbox {
  home: string;
  dataDir: string;
}

/** A home directory holding `.config/cashback/dev.env` with the given lines. */
export function sandbox(envLines: string[]): Sandbox {
  const home = mkdtempSync(join(tmpdir(), "cashback-home-"));
  const dataDir = join(home, "data", "dev");
  mkdirSync(join(home, ".config", "cashback"), { recursive: true });
  writeFileSync(join(home, ".config", "cashback", "dev.env"), [...envLines, `DATA_DIR=${dataDir.replaceAll("\\", "/")}`].join("\n"));
  return { home, dataDir };
}

export interface RunningServer {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

export function startServer(box: Sandbox): RunningServer {
  const child = spawn(process.execPath, ["--import", "tsx", MAIN], {
    cwd: SERVER_DIR,
    // eslint-disable-next-line no-restricted-properties -- the child needs the test's PATH and system variables
    env: { ...process.env, HOME: box.home, USERPROFILE: box.home, CASHBACK_ENV: "dev" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  child.stdout?.on("data", (chunk: Buffer) => (text += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (text += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  return { child, output: () => text, exited };
}

/** Resolves once the output contains `marker`, or rejects if the process exits first. */
export async function waitFor(server: RunningServer, marker: string, timeoutMs = 20_000): Promise<void> {
  const started = performance.now();
  while (!server.output().includes(marker)) {
    if (server.child.exitCode !== null) throw new Error(`server exited before "${marker}":\n${server.output()}`);
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for "${marker}":\n${server.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function randomPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}
