/**
 * The service worker's wiring (Story 5.3). Chrome may stop an extension service worker when it is
 * idle and starts it again on an event, and the browser itself may restart; so the loop is started
 * on install, on browser start, when the settings change, and by a keep-alive alarm every 30
 * seconds, which also re-marks the bridge tab as not discardable. At most one loop runs at a time,
 * so there is never more than one job in hand. A job lost to a stop is given out again by the
 * server, which sends the job out back to the next poll of this same instance. A tab leaving
 * Shopee's verification page is told to the server (verification-watch.ts), so a captcha hold ends at
 * once.
 */
import { INSTANCE_KEY, instanceIdOf, newInstanceId, parseSettings, SETTINGS_KEYS, type ConnectedSettings } from "./bridge-settings";
import { runBridgeLoop, jobWorker, type LoopDeps, type LoopEnd } from "./bridge-loop";
import { chromePageDriver, keepAlive, type Wait } from "./bridge-tab";
import type { ChromeApi } from "./chrome-api.types";
import { serverClient, type Fetch } from "./server-client";
import { shopeeFoodResolver, shortLinkResolver, type FollowLink } from "./short-link";
import { verificationWatch, type VerificationWatch } from "./verification-watch";

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
  /**
   * The settings the deployment wrote next to the build (`bridge-config.json`, never in the
   * repository), used when the profile has none, so no one has to type the token by hand.
   */
  readonly deployedSettings?: () => Promise<Record<string, unknown> | null>;
}

/** The stored settings, or the deployment's file stored once when the profile has none yet. */
async function settingsOf(deps: ServiceDeps, stored: Record<string, unknown>): Promise<ReturnType<typeof parseSettings>> {
  const settings = parseSettings(stored);
  if (settings !== null || deps.deployedSettings === undefined) return settings;
  const deployed = parseSettings((await deps.deployedSettings().catch(() => null)) ?? {});
  if (deployed === null) return null;
  await deps.chrome.storage.local.set({ serverUrl: deployed.serverOrigin, token: deployed.token });
  deps.log("bridge.settings.from_deployment");
  return deployed;
}

/** The settings with this profile's instance id, made and stored the first time. */
async function loadConnected(deps: ServiceDeps): Promise<ConnectedSettings | null> {
  const stored = await deps.chrome.storage.local.get([...SETTINGS_KEYS, INSTANCE_KEY]);
  const settings = await settingsOf(deps, stored);
  if (settings === null) return null;
  let instance = instanceIdOf(stored);
  if (instance === null) {
    instance = newInstanceId(deps.randomBytes);
    await deps.chrome.storage.local.set({ [INSTANCE_KEY]: instance });
  }
  return { ...settings, instance };
}

/** One post, never retried: a post that fails leaves the hold to end by itself. */
async function tellCleared(deps: ServiceDeps): Promise<void> {
  try {
    const settings = await loadConnected(deps);
    if (settings === null) return;
    deps.log("bridge.verification.told", { cleared: await serverClient(settings, deps.fetch).verificationCleared() });
  } catch {
    deps.log("bridge.verification.not_told");
  }
}

/** The watcher knows a job is in hand, and is told where it ended before its answer is posted. */
function watchingJobs(chrome: ChromeApi, page: { tabId(): number | null }, watch: VerificationWatch, worker: LoopDeps["work"]): LoopDeps["work"] {
  return async (job) => {
    watch.jobStarted();
    try {
      return await worker(job);
    } finally {
      const id = page.tabId();
      const tab = id === null ? null : await chrome.tabs.get(id).catch(() => null);
      await watch.jobEnded(id, tab?.url ?? null);
    }
  };
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
  const watch = verificationWatch(chrome, () => tellCleared(deps));
  const work = watchingJobs(chrome, page, watch, jobWorker(page, wait, shortLinkResolver(deps.follow), shopeeFoodResolver(deps.follow)));
  const loop: LoopDeps = {
    loadSettings: () => loadConnected(deps),
    client: (settings) => serverClient(settings, deps.fetch),
    work,
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
      chrome.tabs.onUpdated.addListener((tabId, change) => void (change.url !== undefined && watch.tabMoved(tabId, change.url)));
      chrome.tabs.onRemoved.addListener((tabId) => void watch.tabClosed(tabId));
      chrome.runtime.onStartup.addListener(() => {
        void watch.forgetAll();
        void start();
      });
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
