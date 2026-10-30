// eslint.config.mjs — guardrails from docs/rules/code.md (AD-3, NFR-9).
//   - file names: kebab-case with an optional role suffix (§2)
//   - size: 400 lines per server/package .ts file, 300 per frontend file, 60 per function (§3)
//   - money: no Math.round / toFixed / legacy rounding in packages/money (§4)
//   - time: no Date.now() or new Date() outside packages/core/src/time (§7)
//   - config: no process.env outside apps/server/src/platform/config (§9)
import js from "@eslint/js";
import checkFile from "eslint-plugin-check-file";
import tseslint from "typescript-eslint";

const ROLES = [
  "routes", "command", "query", "repository", "list", "adapter", "port", "job", "guard",
  "schema", "types", "config", "test", "page", "queries",
];
const KEBAB = "+([a-z])*([a-z0-9])*(-+([a-z0-9]))";
const FILE_NAME_PATTERN = `${KEBAB}*(.@(${ROLES.join("|")}))`;

const SIZE_400 = ["error", { max: 400, skipBlankLines: true, skipComments: true }];
const SIZE_300 = ["error", { max: 300, skipBlankLines: true, skipComments: true }];
const FN_60 = ["error", { max: 60, skipBlankLines: true, skipComments: true }];

const NO_CLOCK = [
  { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: "Use a Clock from @cashback/core (code.md §7)." },
  { selector: "NewExpression[callee.name='Date']", message: "Only packages/core/src/time creates dates (code.md §7)." },
];
const NO_ROUNDING = [
  { selector: "CallExpression[callee.object.name='Math'][callee.property.name='round']", message: "Money rounds only with roundHalfUp (code.md §4)." },
  { selector: "CallExpression[callee.property.name='toFixed']", message: "Money is whole dong; never toFixed (code.md §4)." },
  { selector: "Identifier[name='legacyRoundHalfEven']", message: "Half-even rounding was retired by D34." },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**", "**/node_modules/**", "**/coverage/**",
      // Production code on main and its tooling: never linted or changed from here.
      "src/**", "web/**", "zalo_assistant/**", "extension/**", "resources/**", "tests/**",
      "scripts/**", "nginx/**", "ops/**",
      // Reference only: the earlier v2 attempt (AD-3 disposition table).
      "reference/**",
      "docs/**", "_bmad/**", "_bmad-output/**", ".claude/**", ".git/**", ".venv/**",
      "**/*.d.ts", "**/*.cjs", "**/*.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    plugins: { "check-file": checkFile },
    rules: {
      "check-file/filename-naming-convention": ["error", { "**/*.{ts,tsx}": FILE_NAME_PATTERN }, { ignoreMiddleExtensions: false }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "max-lines-per-function": FN_60,
      "max-lines": SIZE_400,
      "no-restricted-syntax": ["error", ...NO_CLOCK, ...NO_ROUNDING],
      "no-restricted-properties": ["error", { object: "process", property: "env", message: "Read configuration through platform/config (code.md §9)." }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}"],
    rules: { "max-lines": SIZE_300 },
  },
  {
    files: ["packages/core/src/time/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", ...NO_ROUNDING] },
  },
  {
    files: ["apps/server/src/platform/config/**/*.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: ["**/tests/**/*.ts", "**/*.test.ts"],
    rules: { "max-lines": "off", "max-lines-per-function": "off" },
  },
);
