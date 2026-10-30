/**
 * Architecture boundaries checked in CI (AD-1, code.md §1).
 *   - no import cycles, every import resolves
 *   - packages/money and packages/core have no framework, database or app imports
 *   - a server module reaches another module only through its index.ts
 *   - module domain/ code stays pure
 *   - nothing imports the reference/ code of the earlier v2 attempt
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    { name: "no-unresolvable", severity: "error", from: {}, to: { couldNotResolve: true } },
    {
      name: "pure-packages",
      severity: "error",
      comment: "money and core are pure: no Fastify, Drizzle, SQLite driver or app code.",
      from: { path: "^packages/(money|core)/src/" },
      to: { path: ["node_modules/(fastify|drizzle-orm|better-sqlite3)", "^apps/"] },
    },
    {
      name: "server-module-walls",
      severity: "error",
      comment: "A module may only reach another module through its index.ts.",
      from: { path: "^apps/server/src/modules/([^/]+)/" },
      to: {
        path: "^apps/server/src/modules/[^/]+/",
        pathNot: ["^apps/server/src/modules/$1/", "^apps/server/src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "domain-stays-pure",
      severity: "error",
      from: { path: "^apps/server/src/modules/[^/]+/domain/" },
      to: { path: ["node_modules/(fastify|drizzle-orm|better-sqlite3)", "^apps/server/src/platform/"] },
    },
    {
      name: "no-reference-code",
      severity: "error",
      comment: "reference/ is read-only history of the earlier v2 attempt.",
      from: {},
      to: { path: "^reference/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|coverage)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "default"] },
  },
};
