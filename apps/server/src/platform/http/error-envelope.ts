/**
 * The one error envelope on every listener (AD-20). Unknown routes, thrown
 * errors and validation failures all become `{ error: { code, messageKey } }`
 * with the status from the single mapping; no stack trace leaves the server.
 */
import type { FastifyError, FastifyInstance } from "fastify";
import { ERROR_STATUS, type ErrorCode, type ErrorEnvelope } from "@cashback/contracts";

export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly messageKey: string,
    readonly fields?: Record<string, string>,
  ) {
    super(code);
  }
}

export function envelope(code: ErrorCode, messageKey: string, fields?: Record<string, string>): ErrorEnvelope {
  return { error: { code, messageKey, ...(fields ? { fields } : {}) } };
}

export function installErrorEnvelope(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => {
    void reply.status(ERROR_STATUS.not_found).send(envelope("not_found", "error.not_found"));
  });
  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      void reply.status(ERROR_STATUS[error.code]).send(envelope(error.code, error.messageKey, error.fields));
      return;
    }
    if (error.validation) {
      void reply.status(ERROR_STATUS.invalid_request).send(envelope("invalid_request", "error.invalid_request"));
      return;
    }
    request.log.error({ err: error }, "http.request.failed");
    void reply.status(ERROR_STATUS.internal).send(envelope("internal", "error.internal"));
  });
}
