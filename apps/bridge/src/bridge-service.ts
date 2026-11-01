/**
 * The service worker's wiring (Story 5.3). Chrome may stop an extension service worker when it is
 * idle and starts it again on an event, and the browser itself may restart; so the loop is started
 * on install, on browser start, when the settings change, and by a keep-alive alarm every 30
 * seconds, which also re-marks the bridge tab as not discardable. At most one loop runs at a time,
 * so there is never more than one job in hand. A job lost to a stop is given out again by the
 * server, which sends the job out back to the next poll of this same instance.
 */
import { INSTANCE_KEY, instanceIdOf, newInstanceId, parseSettings, SETTINGS_KEYS, type ConnectedSettings } from "./bridge-settings";
import { runBridgeLoop, jobWorker, type LoopDeps, type LoopEnd } from "./bridge-loop";
import { chromePageDriver, keepAlive, type Wait } from "./bridge-tab";
import type { ChromeApi } from "./chrome-api.types";
import { serverClient, type Fetch } from "./server-client";
import { shopeeFoodResolver, shortLinkResolver, type FollowLink } from "./short-link";

export const KEEPALIVE_ALARM = "cashback-bridge-keepalive";
/** Chrome's shortest alarm period. */
export const KEEPALIVE_MINUTES = 0.5;

export interface ServiceDeps {
  readonly chrome: ChromeApi;
  readonly fetch: Fetch;
  /** The browser's own request to a returned short link, followed to its target (Story 5.4). */
  readonly follow: FollowLink;
  readonly wait: Wait;
  /** `crypto.getRandomValues` in the worker. */
  readonly randomBytes: (length: number) => Uint8Array;
  log(event: string, detail?: Record<string, unknown>): void;
}

/** The settings with this profile's instance id, made and stored the first time. */
async function loadConnected(deps: ServiceDeps): Promise<ConnectedSettings | null> {
  const stored = await deps.chrome.storage.local.get([...SETTINGS_KEYS, INSTANCE_KEY]);
  const settings = parseSettings(stored);
  if (settings === null) return null;
  let instance = instanceIdOf(stored);
  if (instance === null) {
    instance = newInstanceId(deps.randomBytes);
    await deps.chrome.storage.local.set({ [INSTANCE_KEY]: instance });
  }
  return { ...settings, instance };
}

export interface BridgeService {
  /** Starts the loop unless it runs already; resolves when that loop ends. */
  start(): Promise<LoopEnd>;
  /** Registers every listener and the alarm; call once, synchronously, when the worker starts. */
  install(): void;
  isRunning(): boolean;
}

export function bridgeService(deps: ServiceDeps, stop: { readonly stopped: boolean } = { stopped: false }): BridgeService {
  const { chrome, wait } = deps;
  const page = chromePageDriver(chrome, wait);
  const loop: LoopDeps = {
    loadSettings: () => loadConnected(deps),
    client: (settings) => serverClient(settings, deps.fetch),
    work: jobWorker(page, wait, shortLinkResolver(deps.follow), shopeeFoodResolver(deps.follow)),
    wait,
    log: deps.log,
  };
  let running: Promise<LoopEnd> | null = null;
  const start = (): Promise<LoopEnd> => {
    running ??= runBridgeLoop(loop, stop)
      .catch((): LoopEnd => "stopped")
      .then((end) => {
        running = null;
        deps.log("bridge.loop.ended", { end });
        return end;
      });
    return running;
  };
  const keepTabAlive = async (): Promise<void> => {
    const id = page.tabId();
    if (id !== null) await keepAlive(chrome, id).catch(() => undefined);
  };
  return {
    start,
    isRunning: () => running !== null,
    install() {
      chrome.runtime.onStartup.addListener(() => void start());
      chrome.runtime.onInstalled.addListener(() => void start());
      chrome.storage.onChanged.addListener(() => void start());
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name !== KEEPALIVE_ALARM) return;
        void start();
        void keepTabAlive();
      });
      chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());
      void chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_MINUTES });
      void start();
    },
  };
}
