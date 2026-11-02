/**
 * One assistant per environment (production 2026-11-02: a second assistant on the same Zalo account
 * logged the first one out, and customers got error replies while the two kicked each other off).
 * Before it opens the Zalo session the assistant takes `assistant.lock` in its own data folder and
 * holds it for as long as it runs; a second one finds it held and exits without touching Zalo.
 *
 * On Windows (production) the lock is the file opened with no sharing at all (libuv's
 * `UV_FS_O_EXLOCK`, which Node does not name), an OS lock dropped when the process dies, so a crash
 * never leaves it behind and no PID is trusted, like the server's lock. Elsewhere (dev on macOS or
 * Linux) the file is created exclusively and holds the PID; a file whose PID is no longer alive is
 * taken over. The OS calls are injected, so both rules are tested without a second process.
 */
import { closeSync, constants, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

export const INSTANCE_LOCK_FILE = "assistant.lock";
/** libuv's flag for an open with no sharing (Windows only). */
export const UV_FS_O_EXLOCK = 0x10000000;

export const instanceLockPath = (dataDir: string): string => join(dataDir, INSTANCE_LOCK_FILE);

export interface InstanceLock {
  readonly path: string;
  release(): void;
}

export interface LockFiles {
  readonly platform: NodeJS.Platform;
  /** Opens `path` with `flags`; throws the OS error (EBUSY, EEXIST) when it cannot. */
  open(path: string, flags: number): number;
  write(fd: number, text: string): void;
  close(fd: number): void;
  read(path: string): string | null;
  remove(path: string): void;
  isAlive(pid: number): boolean;
  readonly pid: number;
}

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code;

function exclusiveOnWindows(path: string, files: LockFiles): InstanceLock | null {
  let fd: number;
  try {
    fd = files.open(path, constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | UV_FS_O_EXLOCK);
  } catch (error) {
    // A sharing violation: another process has the file open.
    if (errorCode(error) === "EBUSY") return null;
    throw error;
  }
  files.write(fd, `${files.pid}\n`);
  let held = true;
  return {
    path,
    release: () => {
      if (held) files.close(fd);
      held = false;
    },
  };
}

function pidFileElsewhere(path: string, files: LockFiles, retried = false): InstanceLock | null {
  let fd: number;
  try {
    fd = files.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    if (retried) return null;
    const holder = Number((files.read(path) ?? "").trim());
    if (Number.isInteger(holder) && holder > 0 && holder !== files.pid && files.isAlive(holder)) return null;
    files.remove(path);
    return pidFileElsewhere(path, files, true);
  }
  files.write(fd, `${files.pid}\n`);
  files.close(fd);
  return {
    path,
    release: () => {
      if (Number((files.read(path) ?? "").trim()) === files.pid) files.remove(path);
    },
  };
}

/** Takes the instance lock, or returns null when another assistant holds it. */
export function acquireInstanceLock(path: string, files: LockFiles = NODE_LOCK_FILES): InstanceLock | null {
  return files.platform === "win32" ? exclusiveOnWindows(path, files) : pidFileElsewhere(path, files);
}

export const NODE_LOCK_FILES: LockFiles = {
  platform: process.platform,
  open: (path, flags) => openSync(path, flags),
  write: (fd, text) => void writeSync(fd, text),
  close: (fd) => closeSync(fd),
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  remove: (path) => rmSync(path, { force: true }),
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return errorCode(error) === "EPERM";
    }
  },
  pid: process.pid,
};
