#!/usr/bin/env bash
# Launch a Chrome that exists only to run the cashback extension (macOS).
#
# The Mac counterpart of start-browser.ps1: its own profile, the extension
# loaded, and -- the part that matters -- Chrome told not to throttle or
# freeze its own tabs. Without these flags a tab Chrome thinks is hidden
# has its timers slowed to once a minute, and link generation times out
# on every job ("execute_script_timeout" in the backend log).
#
# The profile is persistent, so the Shopee login survives restarts. Log in
# once, on the first run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXTENSION="$ROOT/extension"
PROFILE="$ROOT/.browser-profile"

BROWSER=""
for candidate in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
  if [ -x "$candidate" ]; then BROWSER="$candidate"; break; fi
done
[ -n "$BROWSER" ] || { echo "No Chrome or Edge found in /Applications." >&2; exit 1; }
[ -f "$EXTENSION/manifest.json" ] || { echo "Extension not found at $EXTENSION" >&2; exit 1; }
[ -f "$EXTENSION/background/base_url.js" ] || {
  echo "base_url.js is missing. Run: uv run cashback setup-token" >&2; exit 1; }

NEW=0
[ -d "$PROFILE" ] || { mkdir -p "$PROFILE"; NEW=1; }

# macOS App Nap also slows an app whose windows are all hidden. Chrome
# honours this switch per user; harmless if already set.
defaults write com.google.Chrome NSAppSleepDisabled -bool YES 2>/dev/null || true

echo "Browser : $BROWSER"
echo "Profile : $PROFILE"
echo "Loading : $EXTENSION"
"$BROWSER" \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXTENSION" \
  --disable-extensions-except="$EXTENSION" \
  --no-first-run \
  --no-default-browser-check \
  --disable-sync \
  --disable-background-networking \
  --disable-component-update \
  --disable-features=Translate,OptimizationHints,MediaRouter,IntensiveWakeUpThrottling \
  --renderer-process-limit=2 \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  "https://affiliate.shopee.vn/offer/custom_link" \
  "https://shopee.vn/" >/dev/null 2>&1 &

if [ "$NEW" = 1 ]; then
  echo
  echo "FIRST RUN -- this profile has never logged in."
  echo "Sign in to Shopee in the window that just opened, then keep it open."
else
  echo
  echo "Running. The extension reconnects to the bridge within ~30s."
fi
echo "Quit any other Chrome started on this profile first: flags only apply to a fresh launch."
