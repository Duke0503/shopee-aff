/**
 * Code chip (the "C" chip) (UX-DR3, wireframe section 0): the one way any identifier is shown on both
 * surfaces, a customer code, an order id, a share code. The whole chip is one button that copies
 * the code and confirms the copy for two seconds (EXPERIENCE.md Copy). A long code truncates
 * instead of pushing its column wider. On touch screens an invisible 44 px tall tap area keeps
 * the target size without making every card line 44 px tall.
 */
import { useEffect, useRef, useState } from "react";

import { CheckIcon, CopyIcon } from "../icons";
import { uiText } from "../labels";
import { cn } from "../lib/utils";

export const COPIED_FOR_MS = 2000;

export interface CodeChipProps {
  readonly code: string;
  readonly className?: string;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CodeChip({ code, className }: CodeChipProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async (): Promise<void> => {
    if (!(await copy(code))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      aria-label={uiText("code_copy", { code })}
      title={code}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-sm bg-muted px-1.5 font-mono text-meta font-medium text-foreground outline-none",
        "hover:bg-border focus-visible:ring-3 focus-visible:ring-ring/50",
        // On touch screens the tap area grows to 44 px tall around the 24 px chip.
        "relative coarse:after:absolute coarse:after:inset-x-0 coarse:after:-inset-y-2.5 coarse:after:content-['']",
        className,
      )}
    >
      <span className="truncate">{code}</span>
      {copied ? <CheckIcon aria-hidden className="size-3.5 shrink-0 text-primary" /> : <CopyIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
      <span role="status" className="sr-only">
        {copied ? uiText("code_copied") : ""}
      </span>
    </button>
  );
}
