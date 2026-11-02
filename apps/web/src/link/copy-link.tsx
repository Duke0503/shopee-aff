/** The copy button (link_copy) under a made link: copies the share address and says so for two seconds. */
import { Button, CheckIcon, cn, CopyIcon } from "@cashback/ui";
import { useEffect, useRef, useState } from "react";

import { webText } from "../labels";

export function CopyLink({ url, className }: { readonly url: string; readonly className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button type="button" variant="outline" className={cn("bg-card", className)} onClick={() => void copy()}>
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {webText(copied ? "link_copied" : "link_copy")}
    </Button>
  );
}
