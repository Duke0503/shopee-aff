import { Zalo } from "zca-js";
import fs from "node:fs/promises";

async function main() {
  const credentials = JSON.parse(await fs.readFile("./credentials.json", "utf-8"));
  const zalo = new Zalo({ logging: true });
  const api = await zalo.login(credentials);

  console.log("=== DEBUG LISTENER RUNNING ===");

  api.listener.on("connected", () => console.log("WebSocket Connected"));
  api.listener.on("message", (msg) => {
    console.log(">>> MESSAGE RECEIVED <<<");
    console.log("Type:", msg.type);
    console.log("ThreadId:", msg.threadId, typeof msg.threadId);
    console.log("Data keys:", Object.keys(msg.data));
    console.log("MsgType:", msg.data.msgType);
    console.log("Content type:", typeof msg.data.content);
    console.log("Content:", JSON.stringify(msg.data.content));
    console.log("Full data:", JSON.stringify(msg.data, null, 2));
  });

  api.listener.on("group_event", (e) => {
    console.log(">>> GROUP EVENT <<<", e);
  });

  api.listener.start({ retryOnClose: true });
}

main().catch(console.error);
