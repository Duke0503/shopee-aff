/**
 * The key a public sign-in is throttled under (AD-18, INV-7): an HMAC of the caller's address,
 * never the address itself, so no IP address is stored. Both listeners bind to 127.0.0.1 and
 * `trustProxy` stays off; a request whose socket is loopback came through the Cloudflare tunnel,
 * so its `CF-Connecting-IP` names the real caller. From any other socket the header is ignored
 * and the socket address is used. The key is used only for rate limits, never to decide who
 * someone is.
 */
import { createHmac } from "node:crypto";
import type { FastifyRequest } from "fastify";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
/** An IPv4 or IPv6 address as Cloudflare writes it. */
const ADDRESS = /^[0-9A-Fa-f:.]{2,45}$/;
export const CLIENT_KEY_HEX = 32;

/** The caller's address, as far as the server can tell. */
export function clientAddress(request: Pick<FastifyRequest, "headers" | "socket">): string {
  const socket = request.socket.remoteAddress ?? "";
  const forwarded = request.headers["cf-connecting-ip"];
  if (LOOPBACK.has(socket) && typeof forwarded === "string" && ADDRESS.test(forwarded)) return forwarded.toLowerCase();
  return socket;
}

/** Keys requests with `secret`; the same address always gives the same 32 hex characters. */
export function clientKeyer(secret: string): (request: Pick<FastifyRequest, "headers" | "socket">) => string {
  return (request) => createHmac("sha256", secret).update(clientAddress(request)).digest("hex").slice(0, CLIENT_KEY_HEX);
}
