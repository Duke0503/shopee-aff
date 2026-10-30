/**
 * Architecture boundaries checked in CI (AD-1, AD-4, code.md §1).
 *   - no import cycles, every import resolves
 *   - packages/money and packages/core have no framework, database or app imports
 *   - a server module reaches another module only through its index.ts, and only along
 *     the edges of the spine's dependency diagram (apps/server/src/modules/module-edges.json)
 *   - module domain/ code imports only its own domain/, packages/money and packages/core
 *   - module http/ code never touches its module's repositories, adapters or schema
 *   - platform/ never imports a module
 *   - the frontends never import packages/money
 *   - nothing imports the reference/ code of the earlier v2 attempt
 */
const { $comment: _comment, ...MODULE_EDGES } = require("./apps/server/src/modules/module-edges.json");

const MODULES = "^apps/server/src/modules/";

/** One rule per module: any other module outside its allowed edges is forbidden. */
const moduleEdgeRules = Object.entries(MODULE_EDGES).map(([module, allowed]) => ({
  name: `module-edges-${module}`,
  severity: "error",
  comment: `${module} may import only ${allowed.length ? allowed.join(", ") : "no other module"} (spine dependency diagram).`,
  from: { path: `${MODULES}${module}/` },
  to: { path: `${MODULES}[^/]+/`, pathNot: `${MODULES}(${[module, ...allowed].join("|")})/` },
}));

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
      from: { path: `${MODULES}([^/]+)/` },
      to: {
        path: `${MODULES}[^/]+/`,
        pathNot: [`${MODULES}$1/`, `${MODULES}[^/]+/index\\.ts$`],
      },
    },
    ...moduleEdgeRules,
    {
      name: "domain-stays-pure",
      severity: "error",
      comment: "domain/ imports only its own domain/, packages/money and packages/core: no framework, no I/O, no other module.",
      from: { path: `${MODULES}([^/]+)/domain/` },
      to: { pathNot: [`${MODULES}$1/domain/`, "^packages/(money|core)/src/"] },
    },
    {
      name: "http-calls-commands-and-queries",
      severity: "error",
      comment: "http/ calls its module's commands and queries; it never touches a repository, an adapter or the schema.",
      from: { path: `${MODULES}([^/]+)/http/` },
      to: { path: [`${MODULES}$1/[^/]+\\.(repository|adapter)\\.ts$`, `${MODULES}$1/schema\\.ts$`] },
    },
    {
      name: "platform-never-imports-a-module",
      severity: "error",
      comment: "Modules reach platform through its ports; platform never depends on a module.",
      from: { path: "^apps/server/src/platform/" },
      to: { path: MODULES },
    },
    {
      name: "frontends-never-import-money",
      severity: "error",
      comment: "Money is computed only on the server (code.md §4); the frontends show stored amounts.",
      from: { path: "^apps/(web|admin)/" },
      to: { path: "^packages/money/" },
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
    // node_modules stays in the graph (not followed) so the rules can see a framework import.
    exclude: { path: "(^|/)(dist|coverage)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "default"] },
  },
};
