/**
 * Serving a stored proof image (AD-21, D49, INV-13). The content type is the one the server
 * stored after re-writing the file, never a guess from its bytes: `nosniff` stops a browser from
 * reading it as anything else, and the CSP (no script, no frame, a sandbox) leaves even a file
 * that somehow held markup inert. It is never cached by a shared cache, never framed, never
 * loaded by another site, and its URL is not passed on as a referrer.
 */
import type { FastifyReply } from "fastify";

export const IMAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'none'; frame-ancestors 'none'; sandbox";

export function sendImage(reply: FastifyReply, image: { readonly contentType: "image/jpeg" | "image/png"; readonly bytes: Buffer; readonly name: string }): Buffer {
  void reply
    .header("content-type", image.contentType)
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", IMAGE_CSP)
    .header("cache-control", "private, no-store")
    .header("content-disposition", `inline; filename="${image.name}"`)
    .header("cross-origin-resource-policy", "same-origin")
    .header("referrer-policy", "no-referrer");
  return image.bytes;
}
