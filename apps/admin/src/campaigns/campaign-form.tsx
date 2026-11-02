/**
 * The create form of the campaign screen (wireframe Campaign desktop, FR-23, D22, Story 4.20):
 * the window typed in Vietnam time, its end exclusive, the slots, the bonus per slot, the minimum
 * order, the slots one customer may hold and the shops. Once every field is filled the server's
 * own preview reads the campaign back in one line ("20 slots, bonus, from, until before 00:00 on
 * 22/11"), or says what is wrong; create is the same command and is on only with a good preview.
 */
import type { CampaignInputBody } from "@cashback/contracts";
import { Button, cn, formatAmountDigits, formatMoney, Input, Label } from "@cashback/ui";
import { forwardRef, useId, useState, type ReactNode } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText, type AdminKey } from "../labels";
import { useCampaignPreview, useCreateCampaign } from "./campaigns.queries";

interface Draft {
  name: string;
  campaignId: string;
  startsAt: string;
  endsAt: string;
  slots: string;
  bonus: string;
  minOrderValue: string;
  perCustomer: string;
  platforms: readonly string[];
}

const CAMPAIGN_PLATFORMS_INPUT = ["shopee", "shopeefood", "tiktok", "lazada"] as const;
const EMPTY: Draft = { name: "", campaignId: "", startsAt: "", endsAt: "", slots: "", bonus: "", minOrderValue: "", perCustomer: "1", platforms: ["shopee"] };
const TIME = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/;
const digits = (text: string): number | null => (/\d/.test(text) ? Number(text.replace(/\D/g, "")) : null);

/** The command's input once every field is filled; null while one is missing. */
export function inputOf(d: Draft): CampaignInputBody | null {
  const slots = digits(d.slots);
  const bonus = digits(d.bonus);
  const minOrderValue = digits(d.minOrderValue) ?? 0;
  const perCustomer = digits(d.perCustomer) ?? 0;
  const name = d.name.trim();
  const campaignId = d.campaignId.trim();
  if (name === "" || campaignId === "" || !TIME.test(d.startsAt.trim()) || !TIME.test(d.endsAt.trim()) || slots === null || slots < 1 || bonus === null || d.platforms.length === 0) return null;
  const platforms = CAMPAIGN_PLATFORMS_INPUT.filter((p) => d.platforms.includes(p));
  return { campaignId, name, startsAt: d.startsAt.trim(), endsAt: d.endsAt.trim(), slots, bonus, minOrderValue, perCustomer, platforms, excludedCustomers: [] };
}

function Field({ id, label, hint, children }: { readonly id: string; readonly label: string; readonly hint?: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-meta font-semibold text-foreground/80">
        {label}
      </Label>
      {children}
      {hint !== undefined && <p id={`${id}-hint`} className="text-caption text-muted-foreground">{hint}</p>}
    </div>
  );
}

const INPUT = "h-11 rounded-lg text-[15px] md:h-10";
const errorOf = (error: unknown): string => (error instanceof ApiError ? errorText(error.messageKey, error.code) : errorText("error.internal", "internal"));

function Platforms({ chosen, onToggle }: { readonly chosen: readonly string[]; readonly onToggle: (p: string) => void }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-meta font-semibold text-foreground/80">{adminText("campaign_form_platforms")}</legend>
      <div className="flex min-w-0 flex-wrap gap-2">
        {CAMPAIGN_PLATFORMS_INPUT.map((p) => (
          <label key={p} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-checked:border-primary has-checked:bg-secondary md:h-9">
            <input type="checkbox" className="size-4 accent-primary" checked={chosen.includes(p)} onChange={() => onToggle(p)} />
            {adminText(`campaign_platform_${p}` as AdminKey)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The server's reading of the form in one line, its refusal, or what is still missing. */
function PreviewLine({ filled, current, good, preview }: { readonly filled: boolean; readonly current: boolean; readonly good: boolean; readonly preview: ReturnType<typeof useCampaignPreview>["query"] }) {
  const refused = current && preview.isError;
  return (
    <p data-campaign-preview aria-live="polite" className={cn("text-meta break-words", refused ? "text-status-rejected" : "text-primary")}>
      {!filled ? (
        <span className="text-muted-foreground">{adminText("campaign_fill")}</span>
      ) : refused ? (
        errorOf(preview.error)
      ) : preview.data !== undefined && good ? (
        adminText("campaign_preview", { slots: preview.data.slots, bonus: formatMoney(preview.data.bonus) ?? "", min: formatMoney(preview.data.minOrderValue) ?? "", time: preview.data.endsBefore.time, date: preview.data.endsBefore.date })
      ) : (
        <span className="text-muted-foreground">{adminText("campaign_previewing")}</span>
      )}
    </p>
  );
}

export const CampaignForm = forwardRef<HTMLInputElement, { readonly className?: string }>(function CampaignForm({ className }, firstRef) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [created, setCreated] = useState<string | null>(null);
  const input = inputOf(draft);
  const { query: preview, current } = useCampaignPreview(input);
  const create = useCreateCampaign();
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => {
    setCreated(null);
    const raw = event.target.value;
    // Money is typed as digits and shown with the dong grouping (20.000), as the wireframe reads it.
    const amount = digits(raw);
    const value = key === "bonus" || key === "minOrderValue" ? (amount === null ? "" : (formatAmountDigits(amount) ?? raw)) : raw;
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const togglePlatform = (p: string): void => setDraft((d) => ({ ...d, platforms: d.platforms.includes(p) ? d.platforms.filter((x) => x !== p) : [...d.platforms, p] }));
  const good = current && preview.data !== undefined && !preview.isError;
  const submit = (): void => {
    if (input === null) return;
    create.mutate(input, { onSuccess: (done) => { setCreated(done.name); setDraft(EMPTY); } });
  };
  const text = (key: AdminKey, field: keyof Draft, hint?: string, mode: "numeric" | "text" = "text", ref?: typeof firstRef, placeholder?: string) => (
    <Field id={`${id}-${field}`} label={adminText(key)} {...(hint === undefined ? {} : { hint })}>
      <Input ref={ref} id={`${id}-${field}`} value={draft[field] as string} inputMode={mode} autoComplete="off" placeholder={placeholder} className={INPUT} {...(hint === undefined ? {} : { "aria-describedby": `${id}-${field}-hint` })} onChange={set(field)} />
    </Field>
  );
  return (
    <section data-campaign-form aria-labelledby={`${id}-title`} className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5", className)}>
      <h2 id={`${id}-title`} className="text-lg font-bold">{adminText("campaign_form_title")}</h2>
      {text("campaign_form_name", "name", undefined, "text", firstRef)}
      {text("campaign_form_id", "campaignId", adminText("campaign_form_id_hint"))}
      {text("campaign_form_start", "startsAt", undefined, "text", undefined, adminText("campaign_form_time_hint"))}
      {text("campaign_form_end", "endsAt", undefined, "text", undefined, adminText("campaign_form_time_hint"))}
      <div className="grid min-w-0 grid-cols-2 gap-3">
        {text("campaign_form_slots", "slots", undefined, "numeric")}
        {text("campaign_form_bonus", "bonus", undefined, "numeric")}
      </div>
      {text("campaign_form_min", "minOrderValue", undefined, "numeric")}
      {text("campaign_form_per_customer", "perCustomer", undefined, "numeric")}
      <Platforms chosen={draft.platforms} onToggle={togglePlatform} />
      <PreviewLine filled={input !== null} current={current} preview={preview} good={good} />
      {create.isError && <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">{errorOf(create.error)}</p>}
      {created !== null && <p role="status" className="rounded-md bg-secondary p-3 text-sm break-words text-secondary-foreground">{adminText("campaign_created", { name: created })}</p>}
      <Button type="button" size="lg" className="h-11 w-full rounded-lg text-[15px] font-semibold" disabled={!good || create.isPending} aria-busy={create.isPending} onClick={submit}>
        {create.isPending ? adminText("campaign_creating") : adminText("campaign_create")}
      </Button>
    </section>
  );
});
