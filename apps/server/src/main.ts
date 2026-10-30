/** Composition root: read config, build the two listeners, start them. */
import { systemClock } from "@cashback/core";

import { loadConfig } from "./platform/config/env.config";
import { buildServers, close, listen } from "./platform/http/servers";

const config = loadConfig();
const servers = buildServers({ clock: systemClock, internalToken: config.internalToken, logger: true });
await listen(servers, { public: config.publicPort, internal: config.internalPort });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void close(servers).then(() => process.exit(0));
  });
}
