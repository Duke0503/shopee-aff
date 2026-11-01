/**
 * The options page: the server URL and the bridge token, checked with the same rule the worker
 * uses (127.0.0.1 only) before they are stored in this profile. The token is never shown back.
 */
import { parseSettings, SETTINGS_KEYS } from "./bridge-settings";
import type { ChromeApi } from "./chrome-api.types";

declare const chrome: ChromeApi;

const form = document.querySelector<HTMLFormElement>("#settings");
const status = document.querySelector<HTMLElement>("#status");
const serverUrl = document.querySelector<HTMLInputElement>("#serverUrl");

void chrome.storage.local.get(SETTINGS_KEYS).then((stored) => {
  if (serverUrl !== null && typeof stored["serverUrl"] === "string") serverUrl.value = stored["serverUrl"];
  if (status !== null) status.textContent = parseSettings(stored) === null ? "Not set up yet." : "Saved settings are in use.";
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const values = { serverUrl: String(data.get("serverUrl") ?? ""), token: String(data.get("token") ?? "") };
  const settings = parseSettings(values);
  if (settings === null) {
    if (status !== null) status.textContent = "Not saved: the URL must be http://127.0.0.1:<port> and the token at least 32 characters.";
    return;
  }
  void chrome.storage.local.set({ serverUrl: settings.serverOrigin, token: settings.token }).then(() => {
    if (status !== null) status.textContent = "Saved. The bridge connects within 30 seconds.";
    form.reset();
    if (serverUrl !== null) serverUrl.value = settings.serverOrigin;
  });
});
