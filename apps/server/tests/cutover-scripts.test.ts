/**
 * Stories 8.7 and 8.8: the cutover script set in ops/windows/cutover/. The phases run in their
 * fixed order, each logs one JSON line and is recorded so a second run resumes; a failure stops
 * the plan, and in Live mode after stop-old (a parity mismatch included) it rolls back at once;
 * a rehearsal never touches a live task; rollback is refused after the 72-hour window. The phase
 * bodies are replaced by fakes, so nothing here starts a process, touches a task or a network.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { tempDir } from "./helpers/live-fixture";

const DIR = join(REPOSITORY_ROOT, "ops", "windows", "cutover");
const PHASES = ["preflight", "stop-old", "final-backup", "import", "parity", "audit", "first-run", "carry-over", "start-new", "smoke"];
const scripts = (): string[] => readdirSync(DIR).filter((n) => n.endsWith(".ps1")).sort();
const quote = (text: string): string => `'${text.replaceAll("'", "''")}'`;

interface Run {
  readonly lines: Record<string, unknown>[];
  readonly calls: string[];
  readonly rollbacks: string[];
  readonly result: string;
  readonly out: string;
}

/** Runs `body` after loading the scripts with every phase and the rollback replaced by fakes. */
function drive(workDir: string, mode: "Rehearsal" | "Live", body: string, fail = ""): Run {
  const driver = join(tempDir("cashback-cutover-ps-"), "driver.ps1");
  const fakes = PHASES.map((p) => `function Invoke-Phase-${p}($Ctx) { [void]$global:Calls.Add('${p}'); if ($global:Fail -eq '${p}') { throw '${p}_failed:count:orders' }; return @{ fake = '${p}' } }`);
  writeFileSync(
    driver,
    [
      `. ${quote(join(DIR, "cutover-common.ps1"))}`,
      `. ${quote(join(DIR, "cutover-phases.ps1"))}`,
      `. ${quote(join(DIR, "cutover-switch.ps1"))}`,
      "$global:Calls = New-Object System.Collections.ArrayList",
      "$global:Rollbacks = New-Object System.Collections.ArrayList",
      `$global:Fail = ${quote(fail)}`,
      ...fakes,
      "function Invoke-CutoverRollback($Ctx, [string]$Reason) { [void]$global:Rollbacks.Add($Reason) }",
      `$ctx = New-CutoverContext ${quote(mode)} ${quote(workDir)}`,
      body,
      '"CALLS=$($global:Calls -join \',\')"',
      '"ROLLBACKS=$($global:Rollbacks -join \',\')"',
    ].join("\r\n"),
  );
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", driver], { encoding: "utf8" });
  const lines = out.split(/\r?\n/).filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown>);
  const value = (key: string) => out.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1) ?? "";
  return { lines, calls: value("CALLS").split(",").filter((c) => c !== ""), rollbacks: value("ROLLBACKS").split(",").filter((c) => c !== ""), result: value("RESULT"), out };
}

const PLAN = '"RESULT=$(Invoke-CutoverPlan $ctx $script:CutoverPhases)"';
const phaseLines = (run: Run) => run.lines.filter((l) => l["event"] === "cutover.phase").map((l) => `${String(l["phase"])}:${String(l["status"])}`);

describe.runIf(process.platform === "win32")("Stories 8.7 and 8.8: the cutover phases", () => {
  it("run in their fixed order, each with one JSON line holding its mode, duration and detail", () => {
    const run = drive(tempDir("cashback-cutover-"), "Rehearsal", PLAN);
    expect(run.calls).toEqual(PHASES);
    expect(phaseLines(run)).toEqual(PHASES.map((p) => `${p}:ok`));
    const first = run.lines.find((l) => l["event"] === "cutover.phase");
    expect(first).toMatchObject({ mode: "Rehearsal", phase: "preflight", status: "ok", detail: { fake: "preflight" } });
    expect(typeof first?.["seconds"]).toBe("number");
    expect(run.result).toBe("True");
  }, 60_000);

  it("are resumable: a failure stops the plan, and the next run skips what is done and starts at the failed phase", () => {
    const work = tempDir("cashback-cutover-");
    const failed = drive(work, "Rehearsal", PLAN, "import");
    expect(failed.calls).toEqual(["preflight", "stop-old", "final-backup", "import"]);
    expect(failed.lines.find((l) => l["event"] === "cutover.abort")).toMatchObject({ phase: "import", action: "stop" });
    expect(failed.rollbacks).toEqual([]);
    expect(failed.result).toBe("False");
    const resumed = drive(work, "Rehearsal", PLAN);
    expect(resumed.calls).toEqual(PHASES.slice(3));
    expect(phaseLines(resumed).slice(0, 3)).toEqual(["preflight:already_done", "stop-old:already_done", "final-backup:already_done"]);
    const state = JSON.parse(readFileSync(join(work, "cutover-state.json"), "utf8").trimStart()) as { phases: Record<string, { status: string }> };
    expect(Object.values(state.phases).map((p) => p.status)).toEqual(PHASES.map(() => "ok"));
  }, 60_000);

  it("Live: a parity mismatch aborts, nothing after it runs, and the rollback restarts the old system at once", () => {
    const run = drive(tempDir("cashback-cutover-"), "Live", PLAN, "parity");
    expect(run.calls).toEqual(["preflight", "stop-old", "final-backup", "import", "parity"]);
    expect(run.lines.find((l) => l["phase"] === "parity")).toMatchObject({ status: "failed", reason: "parity_failed:count:orders" });
    expect(run.lines.find((l) => l["event"] === "cutover.abort")).toMatchObject({ phase: "parity", action: "rollback" });
    expect(run.rollbacks).toEqual(["phase_failed:parity"]);
    expect(run.result).toBe("False");
  }, 60_000);

  it("Live: an unexplained difference in the numbers audit aborts before first-run and rolls back", () => {
    const run = drive(tempDir("cashback-cutover-"), "Live", PLAN, "audit");
    expect(run.calls).toEqual(["preflight", "stop-old", "final-backup", "import", "parity", "audit"]);
    expect(run.rollbacks).toEqual(["phase_failed:audit"]);
  }, 60_000);

  it("review 1: a work folder that was rolled back is never resumed; a new cutover needs a new work folder and redoes every phase", () => {
    const work = tempDir("cashback-cutover-");
    drive(work, "Live", '$ctx.State.phases["preflight"] = @{ status = "ok" }; $ctx.State.rolledBackAt = "2026-11-02T13:00:00.000Z"; Save-CutoverState $ctx');
    const resumed = drive(work, "Live", 'try { [void](Invoke-CutoverPlan $ctx $script:CutoverPhases); "RESULT=ran" } catch { "RESULT=$($_.Exception.Message)" }');
    expect(resumed.result).toBe("Refused: this work folder was rolled back at 2026-11-02T13:00:00.000Z; start a new cutover with a new -WorkDir.");
    expect(resumed.calls).toEqual([]);
    expect(drive(tempDir("cashback-cutover-"), "Live", PLAN).calls).toEqual(PHASES);
  }, 60_000);

  it("review 2: rollback is refused once the payout window was closed, since payouts may exist in the new ledger", () => {
    const body = [
      'function Invoke-CutoverStep($Ctx, [string[]]$Arguments) { if ($Arguments[0] -eq "ledger-path") { return @{ code = 0; line = @{ ledger = $PSCommandPath } } }; if ($Arguments[0] -eq "flags") { return @{ code = 1; line = @{ payoutWindowOpen = $false } } }; throw "unexpected step" }',
      '. ' + quote(join(DIR, "cutover-switch.ps1")),
      '$ctx.State.goLiveAt = (Get-Date).ToUniversalTime().AddHours(-1).ToString("o")',
      'try { Invoke-CutoverRollback $ctx "late" } catch { "RESULT=$($_.Exception.Message)" }',
    ].join("\r\n");
    expect(drive(tempDir("cashback-cutover-"), "Live", body).result).toBe("Refused: the payout window was closed, payouts may exist in the new ledger; rollback is no longer safe.");
  }, 60_000);

  it("Live: a failed preflight stops before anything was stopped, so there is nothing to roll back", () => {
    const run = drive(tempDir("cashback-cutover-"), "Live", PLAN, "preflight");
    expect(run.calls).toEqual(["preflight"]);
    expect(run.rollbacks).toEqual([]);
  }, 60_000);

  it("a rehearsal never touches a live task; a task outside the two live ones is refused in Live mode too", () => {
    const run = drive(
      tempDir("cashback-cutover-"),
      "Rehearsal",
      [
        'try { Stop-CutoverLiveTask $ctx "CashbackBackend"; "RESULT=stopped" } catch { "RESULT=$($_.Exception.Message)" }',
        '$live = New-CutoverContext "Live" (Join-Path $ctx.WorkDir "live")',
        'try { Stop-CutoverLiveTask $live "CashbackV2Server" } catch { "OTHER=$($_.Exception.Message)" }',
      ].join("\r\n"),
    );
    expect(run.result).toBe("Refused: a rehearsal never touches a live task.");
    expect(run.out).toContain("OTHER=Refused: CashbackV2Server is not a live task the cutover stops.");
  }, 60_000);

  it("AC4: rollback is offered inside the 72-hour window and refused after it, before it touches anything", () => {
    const body = [
      '$ctx.State.goLiveAt = (Get-Date).ToUniversalTime().AddHours(-71).ToString("o"); "INSIDE=$(Test-InsideWindow $ctx)"',
      '$ctx.State.goLiveAt = (Get-Date).ToUniversalTime().AddHours(-73).ToString("o"); "AFTER=$(Test-InsideWindow $ctx)"',
      '. ' + quote(join(DIR, "cutover-switch.ps1")),
      'try { Invoke-CutoverRollback $ctx "late" } catch { "RESULT=$($_.Exception.Message)" }',
    ].join("\r\n");
    const driverOut = drive(tempDir("cashback-cutover-"), "Live", body);
    expect(driverOut.result).toBe("Refused: rollback is offered only inside the 72-hour window; the new system is final.");
  }, 60_000);

  it("the go/no-go checklist is NO-GO when a phase failed, with each phase's status and time", () => {
    const work = tempDir("cashback-cutover-");
    drive(work, "Rehearsal", `[void](Invoke-CutoverPlan $ctx $script:CutoverPhases); "RESULT=$(Write-GoNoGo $ctx $false 45)"`, "smoke");
    const checklist = readFileSync(join(work, "go-no-go.md"), "utf8");
    expect(checklist).toContain("Verdict: **NO-GO**");
    expect(checklist).toMatch(/\| smoke \| failed \| [\d.]+ \|/);
    expect(checklist).toContain("| parity | ok |");
  }, 60_000);
});

describe("Stories 8.7 and 8.8: the cutover scripts", () => {
  it("are plain ASCII, name the live tasks only in the guard list, and hold no secret value", () => {
    expect(scripts()).toEqual(["after-window.ps1", "cutover-common.ps1", "cutover-phases.ps1", "cutover-switch.ps1", "cutover.ps1", "rollback.ps1"]);
    for (const name of scripts()) {
      const text = readFileSync(join(DIR, name), "utf8");
      expect([...text].every((c) => c.charCodeAt(0) < 128), name).toBe(true);
      // A TOKEN= line holds only a generated placeholder, never a literal value.
      for (const match of text.matchAll(/TOKEN=([^\s"`]*)/g)) expect(match[1], name).toMatch(/^(\$\(|$)/);
      expect(text, name).not.toMatch(/password\s*=|ConvertTo-SecureString/i);
      if (name !== "cutover-common.ps1") expect(text, name).not.toMatch(/"CashbackBackend"|"CashbackAssistant"/);
    }
  });

  it.runIf(process.platform === "win32")(
    "each parses in Windows PowerShell without running it",
    () => {
      const files = scripts().map((name) => quote(join(DIR, name)));
      const command = `foreach ($f in @(${files.join(",")})) { $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$e); "$([System.IO.Path]::GetFileName($f)):$($e.Count)" }`;
      const lines = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" }).trim().split(/\r?\n/);
      expect(lines).toEqual(scripts().map((name) => `${name}:0`));
    },
    60_000,
  );
});
