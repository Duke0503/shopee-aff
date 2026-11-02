/**
 * A sentence that names a chat command (/id, /matkhau, /sodu, /help): the command is a code chip
 * the customer can copy straight into Zalo (every code is a copyable chip, CLAUDE.md design work).
 * The label holds `{command}` where the chip goes.
 */
import { CodeChip, cn } from "@cashback/ui";

export function CommandHint({ template, command, id, className }: { readonly template: string; readonly command: string; readonly id?: string; readonly className?: string }) {
  const [before = "", after = ""] = template.split("{command}");
  return (
    <p id={id} className={cn("text-meta text-muted-foreground", className)}>
      {before}
      <CodeChip code={command} className="mx-0.5 align-middle" />
      {after}
    </p>
  );
}
