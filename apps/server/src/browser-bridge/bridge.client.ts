/**
 * Talks to the loopback bridge that drives the Chrome extension. Ports the
 * `HttpBridge` client of `shopee/browser_bridge.py`: the server asks, the
 * extension runs the job, the bridge returns the value or an error.
 */
export interface BridgeJobRequest {
  action: string;
  params: Record<string, unknown>;
  timeoutMs?: number;
}

export interface BridgeClient {
  execute(job: BridgeJobRequest): Promise<unknown>;
  connected(): Promise<boolean>;
}

export class HttpBridgeClient implements BridgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private get headers(): Record<string, string> {
    return { "content-type": "application/json", "x-bridge-token": this.token };
  }

  async execute(job: BridgeJobRequest): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/execute`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ action: job.action, params: job.params, timeout_ms: job.timeoutMs }),
    });
    const data = (await response.json()) as { ok?: boolean; value?: unknown; error?: string };
    if (!response.ok || !data.ok) {
      throw new Error(data.error ?? `bridge error ${response.status}`);
    }
    return data.value;
  }

  async connected(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/status`, { headers: this.headers });
      const data = (await response.json()) as { connected?: boolean };
      return Boolean(data.connected);
    } catch {
      return false;
    }
  }
}
