// Fails when a change on main-v2 touches the production paths that only `main` owns
// (AD-3, Story 1.1). Usage: node scripts/ci/path-guard.mjs [baseRef]
import { execFileSync } from "node:child_process";

const PROTECTED = ["src/cashback/", "web/", "zalo_assistant/", "extension/", "resources/", ".github/workflows/deploy.yml"];
const base = process.argv[2] ?? process.env.GUARD_BASE ?? "origin/main-v2";

let files;
try {
  files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
} catch {
  console.error(`path-guard: cannot diff against ${base}`);
  process.exit(2);
}

const touched = files.filter((f) => PROTECTED.some((p) => f === p || f.startsWith(p)));
if (touched.length > 0) {
  console.error("path-guard: production paths are owned by main and must not change on main-v2:");
  for (const f of touched) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`path-guard: ok (${files.length} changed files checked against ${base})`);
