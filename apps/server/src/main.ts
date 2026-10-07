import "reflect-metadata";

import { createInternalApp, createPublicApp } from "./create-app";

const HOST = "127.0.0.1";
const PUBLIC_PORT = 8901;
const INTERNAL_PORT = 8902;

async function main(): Promise<void> {
  const publicApp = await createPublicApp();
  await publicApp.listen(PUBLIC_PORT, HOST);

  const internalApp = await createInternalApp();
  await internalApp.listen(INTERNAL_PORT, HOST);
}

void main();
