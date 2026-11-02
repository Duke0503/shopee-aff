/**
 * The optional customer code field of the converter (Story 7.6): shown when the customer presses
 * the "enter DP code" link (home_code_toggle) or a code is refused; loaded only then, so Home's first load stays small. An
 * unknown code is said under it; the hint names /id as a copy chip.
 */
import { Input, Label } from "@cashback/ui";

import { webText } from "../labels";
import { CommandHint } from "../shell/command-hint";
import { FieldError } from "./link-fields";

export function CodeField({ value, onChange, error }: { readonly value: string; readonly onChange: (v: string) => void; readonly error: string | undefined }) {
  return (
    <div className="flex flex-col gap-1.5" data-link-code>
      <Label htmlFor="link-code" className="text-[15px] font-semibold">
        {webText("link_code_label")}
      </Label>
      <Input
        id="link-code"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={32}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={`${error === undefined ? "" : "link-code-error "}link-code-hint`}
        className="h-12 rounded-xl bg-card px-4 text-base font-medium tracking-wide uppercase md:text-[17px]"
      />
      {error !== undefined && <FieldError id="link-code-error" text={error} />}
      <CommandHint id="link-code-hint" template={webText("link_code_hint")} command={webText("command_id")} />
    </div>
  );
}
