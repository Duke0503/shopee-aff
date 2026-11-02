/** The offline strip (EXPERIENCE.md Offline): a quiet line under the top bar while the browser has no network. */
import { WifiOffIcon } from "@cashback/ui";

import { webText } from "../labels";
import { useOnline } from "./use-online";

export function OfflineStrip() {
  if (useOnline()) return null;
  return (
    <p role="status" className="flex items-center justify-center gap-2 border-b border-border bg-foreground px-4 py-2 text-center text-meta text-background">
      <WifiOffIcon aria-hidden className="size-4 shrink-0" />
      {webText("offline")}
    </p>
  );
}
