/** Guide (Story 7.1 shell; the steps and money rules come with Story 7.7). Open to everyone. */
import { webText } from "../labels";
import { CommandHint } from "../shell/command-hint";
import { PageTitle } from "../shell/page-title";

export function GuidePage() {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5 px-4 pt-6 md:px-6 md:pt-10">
      <PageTitle>{webText("guide_title")}</PageTitle>
      <CommandHint className="rounded-xl border border-border bg-card p-5 text-[15px]" template={webText("guide_pending")} command={webText("command_help")} />
    </div>
  );
}
