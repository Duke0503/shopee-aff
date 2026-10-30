import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { proofsDir } from "../../../shared/config/proofs-dir";
import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { nowLocalIso } from "../../identity";
import { proofForViewer } from "../application/proof.use-case";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function contentTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/**
 * A payout's bank screenshot. The bill page itself is public; this is not.
 * The customer it was sent to, or staff, get the picture — everyone else gets
 * the same 404, so guessing learns nothing.
 */
@Controller("api/proofs")
export class ProofController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(":billToken")
  async proof(
    @Param("billToken") billToken: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : null;
    const fileName = proofForViewer(this.db, { billToken, cookie, nowIso: nowLocalIso() });
    if (fileName === null) {
      reply.code(404).send("Not found");
      return;
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(join(proofsDir(), fileName));
    } catch {
      // The row promises an image we do not have. Say so the same way.
      reply.code(404).send("Not found");
      return;
    }

    reply
      .code(200)
      .header("Content-Type", contentTypeFor(fileName))
      .header("Cache-Control", "private, max-age=3600")
      .send(bytes);
  }
}
