# D61 (production runs on a Windows Server VPS)

- Status: accepted
- Date: 2026-11-02
- Approved by: the project owner gave the VPS for the platform (2026-10-30); the plan is corrected to
  match the host that actually runs production.

## Context

AD-25, AD-29, the deployment diagram and Stories 8.4 and 8.5 assumed production runs on the
operator's Mac under launchd, with `pmset` and a FileVault reboot step. A read-only look at the host
on 2026-10-30 showed production runs on a Windows Server 2022 Datacenter VPS (2 vCPU, 4 GB), folder
`C:\Project\mmo`:

- the backend and the Zalo assistant are Task Scheduler tasks (`CashbackBackend`,
  `CashbackAssistant`) with a boot trigger, run whether the user is signed in or not, highest level;
- cloudflared is a Windows service (automatic start);
- the affiliate browser is Microsoft Edge with its own profile and the bridge extension, running in
  the signed-in desktop session;
- a GitHub Actions self-hosted runner service deploys `main`.

## Decision

The new platform's production host is the same Windows Server VPS. Host processes, no containers in
v1 (AD-25 otherwise unchanged):

- server and assistant as Task Scheduler tasks with a boot trigger (or Windows services), each
  started and stopped by scripts that act only on the PIDs they recorded; the server lock file
  refuses a second instance;
- cloudflared stays a Windows service; the tunnel exposes only the public listener;
- the affiliate Edge runs in the signed-in desktop session with its own profile, started by a
  log-on task; the VPS is set to sign the operator in automatically after a reboot (Windows
  auto-logon with the password kept in LSA secrets, never in a file), so the browser comes back
  without manual steps;
- power and sleep do not apply to a VPS; the risks are a provider outage, a Windows Update reboot
  and the desktop session not being signed in. Windows Update active hours and a restart window
  are set, and the external heartbeat (AD-29) catches every case;
- the new system runs beside the live one only for the shadow run and rehearsal, with different
  ports, folders and tasks, until the cutover switches the tunnel (AD-24, D40).

## Consequences

- AD-25 and AD-29 rules, `diagrams/c4-deployment.md`, and Stories 8.4 and 8.5 are rewritten for
  Windows (no `pmset`, FileVault or launchd).
- The cutover runbook (8.8) stops the live tasks `CashbackBackend` and `CashbackAssistant` and
  removes the old extension from the affiliate Edge profile before importing.
