/**
 * The part of the Chrome extension API the bridge uses, declared here instead of pulling in a
 * typings package: it keeps the extension's surface visible in one place, and the tests hand in a
 * fake of exactly this shape.
 */

export interface ChromeTab {
  readonly id?: number;
  readonly url?: string;
  readonly status?: string;
  readonly discarded?: boolean;
}

export interface ChromeEvent<A extends unknown[]> {
  addListener(listener: (...args: A) => void): void;
}

export interface InjectionResult<R> {
  readonly result?: R;
}

export interface ChromeApi {
  readonly tabs: {
    query(query: { url: string }): Promise<ChromeTab[]>;
    get(tabId: number): Promise<ChromeTab>;
    create(properties: { url: string; pinned: boolean; active: boolean }): Promise<ChromeTab>;
    update(tabId: number, properties: { url?: string; pinned?: boolean; autoDiscardable?: boolean }): Promise<ChromeTab | undefined>;
    reload(tabId: number): Promise<void>;
  };
  readonly scripting: {
    executeScript<A extends unknown[], R>(injection: { target: { tabId: number }; world: "MAIN"; func: (...args: A) => R; args: A }): Promise<InjectionResult<Awaited<R>>[]>;
  };
  readonly storage: {
    readonly local: {
      get(keys: readonly string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    readonly onChanged: ChromeEvent<[Record<string, unknown>, string]>;
  };
  readonly alarms: {
    create(name: string, info: { periodInMinutes: number }): Promise<void> | void;
    readonly onAlarm: ChromeEvent<[{ name: string }]>;
  };
  readonly runtime: {
    readonly onStartup: ChromeEvent<[]>;
    readonly onInstalled: ChromeEvent<[unknown]>;
    openOptionsPage(): Promise<void>;
  };
  readonly action: {
    readonly onClicked: ChromeEvent<[unknown]>;
  };
}
