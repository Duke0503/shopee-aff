import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";
import { AssistantTokenGuard } from "./shared/guards/assistant-token.guard";

const ADAPTER_OPTIONS = { logger: false } as const;

/** Public listener (8901): customer and admin routes, reached only via the router. */
export async function createPublicApp(): Promise<NestFastifyApplication> {
  return NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), ADAPTER_OPTIONS);
}

/** Internal listener (8902): assistant-only routes, every call needs the token. */
export async function createInternalApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    ADAPTER_OPTIONS,
  );
  app.useGlobalGuards(new AssistantTokenGuard());
  return app;
}
