/**
 * A Vite build on the public listener (AD-21; Stories 7.1 and 4.4): the customer website at the
 * root of hoantiendp.com, and the admin desk under /admin/ on the admin host only. The build
 * folder is read once at start into memory (a few hundred kilobytes), so no request ever names a
 * path on disk. Hashed assets are cached for a year; the page itself never, so the next load picks
 * up a new build.
 *
 * Customer website (`kind: "site"`): one of its pages (`pagePaths`, and /index.html) gets the page
 * with 200; any other path without a file extension gets the same page with 404, which the website
 * shows as its not-found page. `/api/` and `/internal/` stay JSON 404s, the share and receipt pages
 * keep their own routes (the router prefers them over this catch-all), and on the admin host
 * nothing of it is served.
 *
 * Admin desk (`kind: "desk"`): registered only for the admin host (Cloudflare Access guards that
 * whole host); every path under /admin/ without an extension gets the desk's page, whose router
 * shows its own not-found page. Each build has its own CSP.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

import { HttpError } from "./error-envelope";
import type { PublicRoutes } from "./servers";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const CSP_BASE = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"];
/** Scripts only from this origin; fonts from Google Fonts; inline styles for the dialog layers. */
export const SITE_CSP = [...CSP_BASE, "img-src 'self' https: data:"].join("; ");
/** The desk also shows a chosen proof image before upload (a blob: URL). */
export const DESK_CSP = [...CSP_BASE, "img-src 'self' https: data: blob:"].join("; ");

const NOT_SERVED = /^\/(api|internal)(\/|$)/;

interface BuildFile {
  readonly body: Buffer;
  readonly type: string;
}

function filesUnder(root: string): Map<string, BuildFile> {
  const files = new Map<string, BuildFile>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(`/${relative(root, path).split(sep).join("/")}`, { body: readFileSync(path), type: TYPES[extname(name).toLowerCase()] ?? "application/octet-stream" });
    }
  };
  walk(root);
  return files;
}

export type StaticBuildOptions =
  | {
      readonly kind: "site";
      /** The website's build folder (apps/web/dist). */
      readonly root: string;
      /** The website's own pages, answered with 200. */
      readonly pagePaths: readonly string[];
      /** Hosts that never get the website (the admin host). */
      readonly otherHosts?: readonly string[];
    }
  | {
      readonly kind: "desk";
      /** The desk's build folder (apps/admin/dist), built with base /admin/. */
      readonly root: string;
      readonly host: string;
    };

const pathOf = (url: string): string => url.split("?")[0]?.split("#")[0] ?? "/";
const notFound = (): HttpError => new HttpError("not_found", "error.not_found");

function sendFile(reply: FastifyReply, path: string, file: BuildFile): FastifyReply {
  const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  return reply.header("content-type", file.type).header("cache-control", cache).header("x-content-type-options", "nosniff").send(file.body);
}

function sendPage(reply: FastifyReply, page: BuildFile, status: number, csp: string): FastifyReply {
  return reply.status(status).header("content-type", page.type).header("cache-control", "no-cache").header("content-security-policy", csp).header("x-content-type-options", "nosniff").header("referrer-policy", "strict-origin-when-cross-origin").send(page.body);
}

function readBuild(root: string): { files: Map<string, BuildFile>; page: BuildFile } {
  const files = filesUnder(root);
  const page = files.get("/index.html");
  if (page === undefined) throw new Error(`static build: no index.html in ${root}`);
  return { files, page };
}

function siteRoutes(options: Extract<StaticBuildOptions, { kind: "site" }>): PublicRoutes {
  const { files, page } = readBuild(options.root);
  const pages = new Set([...options.pagePaths, "/index.html"]);
  const otherHosts = new Set(options.otherHosts ?? []);
  return (app) => {
    app.get("/*", async (request, reply) => {
      const path = pathOf(request.url);
      if (NOT_SERVED.test(path) || otherHosts.has(request.hostname)) throw notFound();
      const file = path === "/index.html" ? undefined : files.get(path);
      if (file !== undefined) return sendFile(reply, path, file);
      if (path !== "/index.html" && extname(path) !== "") throw notFound();
      return sendPage(reply, page, pages.has(path) || pages.has(path.replace(/\/+$/, "")) ? 200 : 404, SITE_CSP);
    });
  };
}

const DESK_BASE = "/admin";

function deskRoutes(options: Extract<StaticBuildOptions, { kind: "desk" }>): PublicRoutes {
  const { files, page } = readBuild(options.root);
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const path = pathOf(request.url).slice(DESK_BASE.length) || "/";
    const file = path === "/index.html" ? undefined : files.get(path);
    if (file !== undefined) return sendFile(reply, path, file);
    if (path !== "/index.html" && extname(path) !== "") throw notFound();
    return sendPage(reply, page, 200, DESK_CSP);
  };
  return (app) => {
    app.get(DESK_BASE, { constraints: { host: options.host } }, handler);
    app.get(`${DESK_BASE}/*`, { constraints: { host: options.host } }, handler);
  };
}

export function staticBuildRoutes(options: StaticBuildOptions): PublicRoutes {
  return options.kind === "site" ? siteRoutes(options) : deskRoutes(options);
}
