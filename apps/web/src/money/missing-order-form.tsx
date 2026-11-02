/**
 * The missing-order form (Story 7.4, FR-14, pen.dev Gc1Zb): first the three self-checks that
 * explain most missing orders (opened inside Zalo, another cashback link clicked later, a link with
 * no customer code), each a box the customer ticks if it applies; then the order id (Shopee's or
 * TikTok Shop's form, spaces removed and upper-cased as typed), the day of the purchase (today by
 * default), the product link and a note, both optional. Each broken rule is said under its field,
 * by the page first and by the server again. The answer replaces the form: received, already
 * reported, or already in the customer's orders with the way to open it.
 */
import { CUSTOMER_PATHS, MISSING_ORDER_ID, MISSING_ORDER_NOTE_MAX, MISSING_ORDER_URL_MAX, type MissingOrderRequest, type MissingOrderResponse } from "@cashback/contracts";
import { systemClock, vnToday } from "@cashback/core";
import { Button, buttonVariants, CheckIcon, cn, Input, Label, Textarea } from "@cashback/ui";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";

import { formErrorOf, serverFieldErrors } from "../api/field-errors";
import { errorText, webText, type WebKey } from "../labels";
import { CircleAlertIcon } from "../shell/site-icons";
import { useReportMissingOrder } from "./money.queries";

const FIELDS = ["orderId", "purchasedOn", "productUrl"] as const;
type Field = (typeof FIELDS)[number];
type Errors = Partial<Record<Field, string>>;
type Checks = MissingOrderRequest["checks"];

const CHECKS: readonly (readonly [keyof Checks, WebKey, WebKey])[] = [
  ["openedInZalo", "missing_check_zalo", "missing_check_zalo_hint"],
  ["otherCashbackLink", "missing_check_other", "missing_check_other_hint"],
  ["guestLink", "missing_check_guest", "missing_check_guest_hint"],
];

/** The order id as the server reads it: no spaces or dashes, upper case. */
export const normaliseOrderId = (typed: string): string => typed.replace(/[\s-]+/g, "").toUpperCase();

function FieldError({ id, text }: { readonly id: string; readonly text: string | undefined }) {
  if (text === undefined) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-meta font-medium text-destructive">
      <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
      {text}
    </p>
  );
}

function CheckRow({ name, title, hint, checked, onChange }: { readonly name: string; readonly title: string; readonly hint: string; readonly checked: boolean; readonly onChange: (checked: boolean) => void }) {
  return (
    <li className="border-b border-border py-3.5 first:pt-1">
      <label htmlFor={`check-${name}`} className="flex cursor-pointer items-start gap-1">
        {/* The real box is 44 px and transparent over the drawn 22 px one, so the tap target meets the rule. */}
        <span className="relative -mt-2.5 -ml-2.5 flex size-11 shrink-0 items-center justify-center">
          <input id={`check-${name}`} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-labelledby={`check-${name}-title`} aria-describedby={`check-${name}-hint`} className="peer absolute inset-0 size-11 cursor-pointer opacity-0" />
          <span aria-hidden className={cn("flex size-[22px] items-center justify-center rounded-md border-2 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50", checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card")}>
            {checked && <CheckIcon className="size-3.5" strokeWidth={3} />}
          </span>
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span id={`check-${name}-title`} className="text-[15px] font-semibold">
            {title}
          </span>
          <span id={`check-${name}-hint`} className="text-meta text-muted-foreground">
            {hint}
          </span>
        </span>
      </label>
    </li>
  );
}

function SelfChecks({ checks, onChange }: { readonly checks: Checks; readonly onChange: (next: Checks) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{webText("missing_checks_label")}</legend>
      <ul className="flex flex-col">
        {CHECKS.map(([key, title, hint]) => (
          <CheckRow key={key} name={key} title={webText(title)} hint={webText(hint)} checked={checks[key]} onChange={(checked) => onChange({ ...checks, [key]: checked })} />
        ))}
      </ul>
    </fieldset>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly error: string | undefined;
  readonly hint?: string;
  readonly children: (describedBy: string | undefined) => ReactNode;
}

function FormField({ id, label, error, hint, children }: FieldProps) {
  const described = [error === undefined ? null : `${id}-error`, hint === undefined ? null : `${id}-hint`].filter((x): x is string => x !== null).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
      </Label>
      {children(described === "" ? undefined : described)}
      <FieldError id={`${id}-error`} text={error} />
      {hint !== undefined && (
        <p id={`${id}-hint`} className={error === undefined ? "text-meta text-muted-foreground" : "sr-only"}>
          {hint}
        </p>
      )}
    </div>
  );
}

const FIELD = "h-12 rounded-xl bg-card px-4 text-base md:text-[17px]";

function checkForm(orderId: string, purchasedOn: string): Errors {
  const errors: Errors = {};
  if (orderId === "") errors.orderId = webText("missing_order_id_required");
  else if (!MISSING_ORDER_ID.test(orderId)) errors.orderId = errorText("error.missing_order.order_id_rule", "invalid_request");
  if (purchasedOn === "") errors.purchasedOn = webText("missing_date_required");
  return errors;
}

const ANSWERS: Readonly<Record<MissingOrderResponse["result"], readonly [WebKey, WebKey]>> = {
  received: ["missing_received_title", "missing_received_body"],
  already_reported: ["missing_already_reported_title", "missing_already_reported_body"],
  already_recorded: ["missing_already_recorded_title", "missing_already_recorded_body"],
};

function Answer({ answer, onAnother }: { readonly answer: MissingOrderResponse; readonly onAnother: () => void }) {
  const [title, body] = ANSWERS[answer.result];
  const action = cn(buttonVariants({ variant: "outline" }), "h-11 px-4 text-[15px]");
  return (
    <section role="status" data-missing-answer={answer.result} className="flex flex-col items-start gap-3 rounded-xl border border-primary/25 bg-secondary p-4">
      <h2 className="text-lg font-semibold text-secondary-foreground">{webText(title, { orderId: answer.orderId })}</h2>
      <p className="text-[15px]">{webText(body)}</p>
      <div className="flex flex-wrap gap-2">
        {answer.result === "already_recorded" ? (
          <Link to={CUSTOMER_PATHS.orderDetail} search={{ ma: answer.orderId }} className={cn(buttonVariants(), "h-11 px-4 text-[15px]")}>
            {webText("missing_open_order")}
          </Link>
        ) : (
          <Link to={CUSTOMER_PATHS.myMoney} className={action}>
            {webText("missing_done_back")}
          </Link>
        )}
        <Button type="button" variant="ghost" className="h-11 px-4 text-[15px]" onClick={onAnother}>
          {webText("missing_another")}
        </Button>
      </div>
    </section>
  );
}

export function MissingOrderForm() {
  const report = useReportMissingOrder();
  const today = vnToday(systemClock);
  const [checks, setChecks] = useState<Checks>({ openedInZalo: false, otherCashbackLink: false, guestLink: false });
  const [orderId, setOrderId] = useState("");
  const [purchasedOn, setPurchasedOn] = useState<string>(today);
  const [productUrl, setProductUrl] = useState("");
  const [note, setNote] = useState("");
  const [local, setLocal] = useState<Errors>({});

  if (report.data !== undefined) {
    return (
      <Answer
        answer={report.data}
        onAnother={() => {
          report.reset();
          setOrderId("");
          setProductUrl("");
          setNote("");
        }}
      />
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const errors = checkForm(orderId, purchasedOn);
    setLocal(errors);
    if (Object.keys(errors).length > 0) return;
    report.mutate({ orderId, purchasedOn, productUrl: productUrl.trim(), note: note.trim(), checks });
  };
  const errors: Errors = { ...(report.isError ? serverFieldErrors(report.error, FIELDS) : {}), ...local };
  const formError = Object.keys(local).length === 0 && report.isError ? formErrorOf(report.error, FIELDS) : null;

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5" data-missing-form>
      <SelfChecks checks={checks} onChange={setChecks} />
      <FormField id="missing-order-id" label={webText("missing_order_id")} error={errors.orderId} hint={webText("missing_order_id_hint")}>
        {(describedBy) => (
          <Input id="missing-order-id" value={orderId} maxLength={40} inputMode="text" autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} placeholder={webText("missing_order_id_placeholder")} onChange={(e) => setOrderId(normaliseOrderId(e.target.value))} aria-invalid={errors.orderId !== undefined} aria-describedby={describedBy} className={FIELD} />
        )}
      </FormField>
      <FormField id="missing-date" label={webText("missing_date")} error={errors.purchasedOn}>
        {(describedBy) => <Input id="missing-date" type="date" value={purchasedOn} max={today} onChange={(e) => setPurchasedOn(e.target.value)} aria-invalid={errors.purchasedOn !== undefined} aria-describedby={describedBy} className={FIELD} />}
      </FormField>
      <FormField id="missing-link" label={webText("missing_link")} error={errors.productUrl}>
        {(describedBy) => <Input id="missing-link" type="url" inputMode="url" value={productUrl} maxLength={MISSING_ORDER_URL_MAX} placeholder={webText("missing_link_placeholder")} onChange={(e) => setProductUrl(e.target.value)} aria-invalid={errors.productUrl !== undefined} aria-describedby={describedBy} className={FIELD} />}
      </FormField>
      <FormField id="missing-note" label={webText("missing_note")} error={undefined}>
        {() => <Textarea id="missing-note" value={note} maxLength={MISSING_ORDER_NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} className="min-h-24 rounded-xl bg-card px-4 py-3 text-base md:text-[17px]" />}
      </FormField>
      {formError !== null && (
        <p role="alert" className="rounded-lg bg-destructive/8 px-3 py-2.5 text-[15px] font-medium text-destructive">
          {formError}
        </p>
      )}
      <Button type="submit" className="h-[52px] w-full rounded-xl text-base font-semibold" disabled={report.isPending}>
        {webText(report.isPending ? "missing_submitting" : "missing_submit")}
      </Button>
    </form>
  );
}
