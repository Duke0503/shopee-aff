/**
 * The off-site copy through the Google Drive webhook (owner decision 2026-11-03): age and rclone
 * (AD-26) are not on the VPS, so the daily archive goes to the Google Apps Script web app the live
 * system already posts proof images to (GDRIVE_WEBHOOK_URL). It is the live contract: one POST of
 * JSON `{ filename, mimeType, base64, token }`, the token from GDRIVE_SECRET_TOKEN (may be empty),
 * answered with JSON that may carry `drive_url` or `url`.
 *
 * The archive is encrypted first with AES-256-GCM (archive-cipher.ts), so Drive only holds
 * `cashback-<env>-<Vietnam date>-<HHMM>.tar.enc`. Apps Script refuses bodies over about 50 MB, so
 * a payload over 45 MB is refused before anything is read or sent (`too_large`, its own alert;
 * the local copy stays). Each attempt has a 120 s limit and a failed one is tried once more after
 * a pause; a timed-out attempt may still have landed, so Drive can hold a duplicate, never less.
 *
 * The webhook can neither list nor delete: the Drive folder's retention is the owner's
 * (docs/operations/backup-and-alerts-runbook.md); local retention is unchanged. The URL, the token
 * and the key are never logged or put in an error; a failure names the step and the HTTP status.
 */
import { readFile, stat } from "node:fs/promises";
import { formatVnTime, vnDateOf } from "@cashback/core";

import { ENCRYPTION_OVERHEAD, encryptArchive } from "./archive-cipher";
import { archiveInstant } from "./backup-retention";
import { OffsiteError } from "./offsite.adapter";

export interface DriveWebhookConfig {
  /** The Apps Script web app's `/exec` URL; a secret. */
  readonly url: string;
  /** GDRIVE_SECRET_TOKEN; empty when the script checks none. */
  readonly token: string;
}

export interface WebhookRequest {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly redirect: "follow";
  readonly signal: AbortSignal;
}

export interface WebhookResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type WebhookPost = (url: string, request: WebhookRequest) => Promise<WebhookResponse>;

export interface DriveWebhookStore {
  readonly kind: "drive_webhook";
  /** The Drive file name of a local archive. */
  remoteName(archiveName: string): string;
  /** Encrypts the archive and sends it; throws an OffsiteError naming the step. */
  send(archive: string, remoteName: string, signal?: AbortSignal): Promise<void>;
}

export interface DriveWebhookOptions {
  readonly env: "dev" | "prod";
  /** The 32-byte key BACKUP_ENCRYPTION_KEY holds. */
  readonly key: Buffer;
  /** Tests replace the HTTP call; nothing in a test reaches Google. */
  readonly post?: WebhookPost;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly onRetry?: (failed: OffsiteError) => void;
}

/** Apps Script takes about 50 MB per request; the JSON body stays under this. */
export const MAX_PAYLOAD_BYTES = 45 * 1024 * 1024;
export const WEBHOOK_TIMEOUT_MS = 120_000;
export const WEBHOOK_RETRY_DELAY_MS = 10_000;
export const WEBHOOK_ATTEMPTS = 2;
export const WEBHOOK_MIME_TYPE = "application/octet-stream";
export const DRIVE_SUFFIX = ".tar.enc";

const base64Length = (bytes: number): number => 4 * Math.ceil(bytes / 3);

/** The JSON body's size for an archive of `archiveBytes`, known before anything is read. */
export function payloadBytes(archiveBytes: number, filename: string, token: string): number {
  const envelope = JSON.stringify({ filename, mimeType: WEBHOOK_MIME_TYPE, base64: "", token });
  return Buffer.byteLength(envelope, "utf8") + base64Length(archiveBytes + ENCRYPTION_OVERHEAD);
}

/** `cashback-prod-2026-11-03-0300.tar.enc` for the archive written at 03:00 Vietnam time. */
export function driveFileName(env: string, archiveName: string): string {
  const at = archiveInstant(archiveName);
  if (at === null) return `cashback-${env}-${archiveName.replace(/\.tar$/, "")}${DRIVE_SUFFIX}`;
  return `cashback-${env}-${vnDateOf(at)}-${formatVnTime(at).replace(":", "")}${DRIVE_SUFFIX}`;
}

/** A 2xx answer whose JSON does not say it failed. */
async function verdict(response: WebhookResponse): Promise<OffsiteError | null> {
  if (response.status < 200 || response.status > 299) return new OffsiteError("send", response.status, "status");
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    return new OffsiteError("response", response.status, "status");
  }
  if (typeof body !== "object" || body === null) return new OffsiteError("response", response.status, "status");
  const answer = body as Record<string, unknown>;
  if (answer["ok"] === false || answer["success"] === false || (typeof answer["error"] === "string" && answer["error"] !== "")) return new OffsiteError("response", response.status, "status");
  return null;
}

function abortable<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => {
      controller.abort();
      reject(new OffsiteError("send", null, "status"));
    };
    const timer = setTimeout(stop, timeoutMs);
    const onAbort = (): void => stop();
    if (outer?.aborted) stop();
    outer?.addEventListener("abort", onAbort, { once: true });
    work(controller.signal).then(resolve, reject).finally(() => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    });
  });
}

const pause = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

export function driveWebhookStore(config: DriveWebhookConfig, options: DriveWebhookOptions): DriveWebhookStore {
  const post: WebhookPost = options.post ?? ((url, request) => fetch(url, request));
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const attempt = async (body: string, signal?: AbortSignal): Promise<void> => {
    const failed = await abortable(
      async (inner) => {
        let response: WebhookResponse;
        try {
          response = await post(config.url, { method: "POST", headers: { "Content-Type": "application/json" }, body, redirect: "follow", signal: inner });
        } catch {
          // A network error's message may name the host; only the step is kept.
          return new OffsiteError("send", null, "status");
        }
        return verdict(response);
      },
      timeoutMs,
      signal,
    );
    if (failed !== null) throw failed;
  };
  return {
    kind: "drive_webhook",
    remoteName: (archiveName) => driveFileName(options.env, archiveName),
    async send(archive, remoteName, signal) {
      const size = (await stat(archive)).size;
      if (payloadBytes(size, remoteName, config.token) > MAX_PAYLOAD_BYTES) throw new OffsiteError("too_large", null);
      let body: string;
      try {
        const encrypted = encryptArchive(await readFile(archive), options.key);
        body = JSON.stringify({ filename: remoteName, mimeType: WEBHOOK_MIME_TYPE, base64: encrypted.toString("base64"), token: config.token });
      } catch {
        throw new OffsiteError("encrypt", null);
      }
      for (let n = 1; ; n++) {
        try {
          return await attempt(body, signal);
        } catch (error) {
          const failed = error instanceof OffsiteError ? error : new OffsiteError("send", null, "status");
          if (n >= WEBHOOK_ATTEMPTS || signal?.aborted) throw failed;
          options.onRetry?.(failed);
          await pause(options.retryDelayMs ?? WEBHOOK_RETRY_DELAY_MS, signal);
        }
      }
    },
  };
}
