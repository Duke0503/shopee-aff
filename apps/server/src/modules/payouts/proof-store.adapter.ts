/**
 * Where proof image files live (AD-21, AD-26, D49): `data/<env>/files/proofs/` under the data
 * directory, which the backup job copies with the ledger and which no listener serves as static
 * files. A file's name is 16 random bytes in hex plus the extension of its content type, chosen
 * here; nothing the browser sent ever becomes part of a path. A name is checked against that
 * shape and the resolved path against the directory before every read, so a path traversal has
 * nowhere to go. Files are written once (`wx`) and never overwritten.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import type { ProofStore } from "./payout-proof.command";

const NAME = /^[0-9a-f]{32}\.(jpg|png)$/;

export const proofFilesDir = (dataDir: string): string => join(dataDir, "files", "proofs");

export function fileProofStore(dir: string, newName: () => string = () => randomBytes(16).toString("hex")): ProofStore {
  const root = resolve(dir);
  const pathOf = (fileName: string): string | null => {
    if (!NAME.test(fileName)) return null;
    const path = resolve(root, fileName);
    return path.startsWith(root + sep) ? path : null;
  };
  return {
    write(bytes, contentType) {
      mkdirSync(root, { recursive: true });
      const fileName = `${newName()}${contentType === "image/png" ? ".png" : ".jpg"}`;
      const path = pathOf(fileName);
      if (path === null) throw new Error("proof store: a generated file name has the wrong shape");
      writeFileSync(path, bytes, { flag: "wx" });
      return fileName;
    },
    read(fileName) {
      const path = pathOf(fileName);
      if (path === null) return null;
      try {
        return readFileSync(path);
      } catch {
        return null;
      }
    },
    discard(fileName) {
      const path = pathOf(fileName);
      if (path !== null) rmSync(path, { force: true });
    },
  };
}
