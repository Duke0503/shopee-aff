import { isWithinResendWindow, resendCutoffLocal } from "../domain/reuse-policy";

/**
 * Whether to reuse an existing link or make a new one. Combines the resend
 * window with the provider check.
 *
 * A link is reused ONLY for the same customer for the same product spelling,
 * within the window. Everything else is a new request.
 */
export interface ExistingRequest {
  requestId: string;
  customerId: string;
  sourceUrl: string;
  status: string;
  createdAt: string;
}

export interface RequestLinkInput {
  sourceUrls: string[];
  customerId: string;
  attributionDays: number;
  nowIso: string;
}

export type RequestLinkDecision =
  | { kind: "reuse"; requestId: string }
  | { kind: "new"; platform: string }
  | { kind: "unsupported" };

/** `supportedPlatform` returns the platform for a URL, or null when unknown. */
export function decideRequestLink(
  input: RequestLinkInput,
  existing: ExistingRequest[],
  supportedPlatform: (url: string) => string | null,
): RequestLinkDecision {
  const candidates = [...new Set(input.sourceUrls.filter((url) => url !== ""))];
  const cutoff = resendCutoffLocal(Date.parse(input.nowIso), input.attributionDays);

  for (const url of candidates) {
    const match = existing
      .filter(
        (request) =>
          request.customerId === input.customerId &&
          request.sourceUrl === url &&
          request.status !== "failed" &&
          isWithinResendWindow(request.createdAt, cutoff),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (match) return { kind: "reuse", requestId: match.requestId };
  }

  for (const url of candidates) {
    const platform = supportedPlatform(url);
    if (platform) return { kind: "new", platform };
  }
  return { kind: "unsupported" };
}
