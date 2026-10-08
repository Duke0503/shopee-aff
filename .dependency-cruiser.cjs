/**
 * Architecture boundaries, checked by a program (ADR-10).
 *   - no import cycles
 *   - `domain/` stays plain TypeScript (no NestJS, no Drizzle)
 *   - a server module reaches another module only through its `index.ts`
 *   - frontend imports go DOWN the Feature-Sliced layers
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A cycle makes every change riskier.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable",
      severity: "error",
      comment: "Every import must resolve.",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "domain-stays-pure",
      severity: "error",
      comment: "domain/ is plain TypeScript: no NestJS, no Drizzle, no SQLite driver.",
      from: { path: "^apps/server/src/modules/[^/]+/domain/" },
      to: { path: "node_modules/(@nestjs|drizzle-orm|better-sqlite3)" },
    },
    {
      name: "server-module-walls",
      severity: "error",
      comment: "A server module may only reach another module through its index.ts.",
      from: { path: "^apps/server/src/modules/([^/]+)/" },
      to: {
        path: "^apps/server/src/modules/[^/]+/",
        pathNot: ["^apps/server/src/modules/$1/", "^apps/server/src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "fsd-shared-is-a-leaf",
      severity: "error",
      from: { path: "^apps/(web|admin)/src/shared/" },
      to: { path: "^apps/(web|admin)/src/(entities|features|pages)/" },
    },
    {
      name: "fsd-entities-stay-low",
      severity: "error",
      from: { path: "^apps/(web|admin)/src/entities/" },
      to: { path: "^apps/(web|admin)/src/(features|pages)/" },
    },
    {
      name: "fsd-features-stay-below-pages",
      severity: "error",
      from: { path: "^apps/(web|admin)/src/features/" },
      to: { path: "^apps/(web|admin)/src/pages/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(node_modules|/dist/|/coverage/|/\\.data/|/tests?/|\\.spec\\.|\\.test\\.)" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
