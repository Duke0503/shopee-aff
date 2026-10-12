import { fileURLToPath } from "node:url";

import { Module } from "@nestjs/common";

import { ALERT_COOLDOWN, AlertCooldown } from "./alert-cooldown";
import { DELIVERY_PORT, HttpDelivery, MESSAGES } from "./delivery";
import { loadMessages, type Messages } from "./messages";

/** Default message file, resolved next to the source so cwd does not matter. */
const DEFAULT_MESSAGES_PATH = fileURLToPath(
  new URL("../../../../resources/messages.vi.json", import.meta.url),
);

/**
 * The delivery side of the app: wording loaded once and the port that actually
 * sends (assistant for Zalo, Telegram for owner alerts). Jobs import this
 * module; it never imports a business module, so it cannot create a cycle.
 */
@Module({
  providers: [
    {
      provide: MESSAGES,
      useFactory: (): Messages =>
        loadMessages(process.env.MESSAGES_PATH ?? DEFAULT_MESSAGES_PATH),
    },
    {
      provide: DELIVERY_PORT,
      useFactory: (): HttpDelivery =>
        new HttpDelivery({
          assistantUrl: process.env.ASSISTANT_URL ?? "http://127.0.0.1:8891",
          assistantToken: process.env.ASSISTANT_TOKEN ?? "",
          telegramToken: process.env.TELEGRAM_BOT_TOKEN,
          telegramDevChatId: process.env.TELEGRAM_DEV_CHAT_ID,
          telegramBusinessChatId: process.env.TELEGRAM_BUSINESS_CHAT_ID,
          telegramChatId: process.env.TELEGRAM_CHAT_ID,
        }),
    },
    {
      provide: ALERT_COOLDOWN,
      useFactory: (): AlertCooldown => new AlertCooldown(),
    },
  ],
  exports: [MESSAGES, DELIVERY_PORT, ALERT_COOLDOWN],
})
export class NotificationsModule {}
