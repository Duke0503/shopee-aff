/**
 * How the server tells the outside world something happened. The backend
 * never talks to Zalo itself: customer chat always goes through the assistant
 * (`/api/notify`, `/api/broadcast`), and owner alerts go to Telegram. Swapping
 * this for a fake is how the notify jobs are tested.
 */
export interface DeliveryPort {
  /** A private Zalo message to one customer. True only when delivered. */
  sendPrivate(zaloUserId: string, text: string): Promise<boolean>;
  /** A group announcement, by group id. */
  sendGroup(groupId: string, text: string): Promise<boolean>;
  /** An owner alert. Falls back to the shared Telegram chat when unset. */
  sendTelegram(text: string, channel?: "dev" | "business"): Promise<boolean>;
}

/** What one notify pass did: how many messages went out and how many waited. */
export interface NotifyResult {
  sent: number;
  failed: number;
}

/** The injection token for the delivery port. */
export const DELIVERY_PORT = Symbol("DELIVERY_PORT");
/** The injection token for the loaded message file. */
export const MESSAGES = Symbol("MESSAGES");

export interface HttpDeliveryConfig {
  /** The assistant's own HTTP server, always this machine. */
  assistantUrl: string;
  /** Shared secret; the assistant refuses a call without it. */
  assistantToken: string;
  telegramToken?: string;
  telegramDevChatId?: string;
  telegramBusinessChatId?: string;
  telegramChatId?: string;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * The real delivery: HTTP to the assistant for Zalo, and the Telegram Bot API
 * for owner alerts. Every call can fail; a failure is reported as `false` so
 * the caller leaves the row unmarked and tries again next pass.
 */
export class HttpDelivery implements DeliveryPort {
  constructor(private readonly config: HttpDeliveryConfig) {}

  sendPrivate(zaloUserId: string, text: string): Promise<boolean> {
    return this.postAssistant("/api/notify", {
      targetId: zaloUserId,
      type: "user",
      message: text,
    });
  }

  sendGroup(groupId: string, text: string): Promise<boolean> {
    return this.postAssistant("/api/broadcast", { group: groupId, message: text });
  }

  async sendTelegram(text: string, channel: "dev" | "business" = "business"): Promise<boolean> {
    const token = this.config.telegramToken;
    const chatId =
      channel === "dev"
        ? this.config.telegramDevChatId ?? this.config.telegramChatId
        : this.config.telegramBusinessChatId ?? this.config.telegramChatId;
    if (!token || !chatId) return false;
    try {
      const response = await this.fetchImpl()(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  private async postAssistant(path: string, body: unknown): Promise<boolean> {
    try {
      const response = await this.fetchImpl()(`${this.config.assistantUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-assistant-token": this.config.assistantToken,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) return false;
      const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      return payload?.ok !== false;
    } catch {
      return false;
    }
  }

  private fetchImpl(): typeof fetch {
    return this.config.fetchImpl ?? fetch;
  }
}
