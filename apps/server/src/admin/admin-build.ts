/**
 * The admin desk's built pages on the public listener, admin host only (AD-21, D48; Story 4.4),
 * so production runs one server process for both hosts. Cloudflare Access guards the whole admin
 * host; the staff API keeps its own checks. Absent when there is no staff access config or no
 * build in apps/admin/dist.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ServerConfig } from "../platform/config/env.config";
import { REPOSITORY_ROOT } from "../platform/config/env.config";
import type { PublicRoutes } from "../platform/http/servers";
import { staticBuildRoutes } from "../platform/http/static-site";
import type { Logger } from "../platform/log/logger";

export const ADMIN_DIST = join(REPOSITORY_ROOT, "apps", "admin", "dist");

export function adminBuildRoutes(config: Pick<ServerConfig, "staffAccess">, options: { readonly dist?: string; readonly logger?: Logger } = {}): PublicRoutes[] {
  if (config.staffAccess === null) return [];
  const dist = options.dist ?? ADMIN_DIST;
  if (!existsSync(join(dist, "index.html"))) {
    options.logger?.warn({ dist }, "platform.admin.build_absent");
    return [];
  }
  return [staticBuildRoutes({ kind: "desk", root: dist, host: config.staffAccess.adminHost })];
}
