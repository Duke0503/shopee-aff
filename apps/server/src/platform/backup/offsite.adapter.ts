/**
 * The off-site copy (AD-26, D36, Story 8.2): age encrypts the archive to the owner's public key
 * and rclone copies it to the owner's Google Drive. Both are external executables found by the
 * absolute paths in the env file (docs/operations/backup-and-alerts-runbook.md); nothing is
 * downloaded or installed by the server. They run without a shell, with a timeout, and outside any
 * transaction. Only the private key can decrypt the copy, and it never is on the VPS.
 *
 * A failure names the tool, the step and the exit code; the tools' own output is not logged,
 * because rclone may print the remote's address. Tests pass a fake runner, so no test reaches
 * Google Drive. Where age and rclone are not installed, the Drive webhook copy
 * (drive-webhook.adapter.ts, owner decision 2026-11-03) takes their place.
 */
import { spawn } from "node:child_process";

export interface OffsiteConfig {
  /** Absolute path of `age.exe`. */
  readonly agePath: string;
  /** The owner's age public key, `age1...`. */
  readonly ageRecipient: string;
  /** Absolute path of `rclone.exe`. */
  readonly rclonePath: string;
  /** The rclone remote and folder, `gdrive:cashback-backups/prod`. */
  readonly rcloneRemote: string;
  /** rclone's config file, when it is not in rclone's default place. */
  readonly rcloneConfig: string | null;
}

export interface ExecutableResult {
  /** The exit code, or null when the run was stopped (timeout, abort) or could not start. */
  readonly code: number | null;
  readonly stdout: string;
}

export type RunExecutable = (file: string, args: readonly string[], options: { readonly timeoutMs: number; readonly signal?: AbortSignal }) => Promise<ExecutableResult>;

export interface OffsiteStore {
  encrypt(input: string, output: string, signal?: AbortSignal): Promise<void>;
  upload(file: string, name: string, signal?: AbortSignal): Promise<void>;
  /** The file names in the remote folder. */
  list(signal?: AbortSignal): Promise<string[]>;
  remove(name: string, signal?: AbortSignal): Promise<void>;
}

/** `send`, `response` and `too_large` are the Drive webhook's steps (drive-webhook.adapter.ts). */
export type OffsiteStep = "encrypt" | "upload" | "list" | "remove" | "send" | "response" | "too_large";

export class OffsiteError extends Error {
  constructor(
    readonly step: OffsiteStep,
    /** The tool's exit code, or the webhook's HTTP status; null when it did not finish. */
    readonly code: number | null,
    unit: "exit code" | "status" = "exit code",
  ) {
    super(`off-site ${step} failed${code === null ? " (did not finish)" : ` (${unit} ${code})`}`);
    this.name = "OffsiteError";
  }
}

const STDOUT_LIMIT = 1 << 20;

/** Runs `file` with `args`, no shell, no window; resolves with the exit code, never rejects. */
export const spawnExecutable: RunExecutable = (file, args, options) =>
  new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    const child = spawn(file, [...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"], ...(options.signal ? { signal: options.signal } : {}) });
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, options.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < STDOUT_LIMIT) stdout += chunk.toString("utf8");
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });

const ENCRYPT_TIMEOUT_MS = 30 * 60_000;
const UPLOAD_TIMEOUT_MS = 60 * 60_000;
const SMALL_TIMEOUT_MS = 5 * 60_000;

/** `remote:folder` joined with a file name. */
export const remotePath = (remote: string, name: string): string => (remote.endsWith(":") || remote.endsWith("/") ? `${remote}${name}` : `${remote}/${name}`);

export function offsiteStore(config: OffsiteConfig, run: RunExecutable = spawnExecutable): OffsiteStore {
  const configArgs = config.rcloneConfig === null ? [] : ["--config", config.rcloneConfig];
  const check = async (step: OffsiteStep, file: string, args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<string> => {
    const result = await run(file, args, signal ? { timeoutMs, signal } : { timeoutMs });
    if (result.code !== 0) throw new OffsiteError(step, result.code);
    return result.stdout;
  };
  return {
    encrypt: async (input, output, signal) => void (await check("encrypt", config.agePath, ["--encrypt", "--recipient", config.ageRecipient, "--output", output, input], ENCRYPT_TIMEOUT_MS, signal)),
    upload: async (file, name, signal) => void (await check("upload", config.rclonePath, ["copyto", file, remotePath(config.rcloneRemote, name), ...configArgs], UPLOAD_TIMEOUT_MS, signal)),
    list: async (signal) =>
      (await check("list", config.rclonePath, ["lsf", "--files-only", config.rcloneRemote, ...configArgs], SMALL_TIMEOUT_MS, signal))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    remove: async (name, signal) => void (await check("remove", config.rclonePath, ["deletefile", remotePath(config.rcloneRemote, name), ...configArgs], SMALL_TIMEOUT_MS, signal)),
  };
}
