import { useState, type ReactElement } from "react";

import { Button, colors, spacing } from "@mmo/ui";

import { label, useLabels, type Labels } from "../../shared/lib/labels";
import { vnd } from "../../shared/lib/money";
import { useRecordTransfer } from "./customers.queries";

export interface RecordTransferProps {
  customerId: string;
  /** The code we write into the bank memo, e.g. `DP00012`. */
  customerCode: string | null;
  name: string;
  /** What the server says the customer can be paid now. */
  readyVnd: number;
  payableCount: number;
  /** Only the owner may record a transfer; the server refuses anyone else. */
  canRecord: boolean;
  /** Called after a transfer is recorded, so the page reloads its figures. */
  onRecorded: () => void;
}

/** The memo, the bank's transaction code, and the button that records it all. */
function Form(props: RecordTransferProps & { labels: Labels }): ReactElement {
  const labels = props.labels;
  const { busy, error, recordedVnd, record } = useRecordTransfer();
  const [note, setNote] = useState(props.customerCode ?? "");
  const [transferCode, setTransferCode] = useState("");

  const submit = (): void => {
    void record({
      customerId: props.customerId,
      amountVnd: props.readyVnd,
      note,
      transferCode,
    }).then((done) => {
      if (!done) return;
      setTransferCode("");
      props.onRecorded();
    });
  };

  return (
    <section
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        marginTop: spacing.lg,
        padding: spacing.md,
      }}
    >
      <h3 style={{ margin: `0 0 ${spacing.sm}px` }}>{label(labels, "admin_transfer_title")}</h3>
      <p>
        {label(labels, "admin_transfer_amount")}: <strong>{vnd(props.readyVnd, labels)}</strong>{" "}
        <span style={{ color: colors.muted }}>
          ({label(labels, "admin_transfer_orders", { count: props.payableCount })})
        </span>
      </p>
      <label style={{ display: "block", marginBottom: spacing.sm }}>
        {label(labels, "admin_transfer_note")}
        <input value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <label style={{ display: "block", marginBottom: spacing.sm }}>
        {label(labels, "admin_transfer_code")}
        <input value={transferCode} onChange={(event) => setTransferCode(event.target.value)} />
      </label>
      {error !== "" ? (
        <p style={{ color: colors.brand }}>
          {label(labels, "admin_transfer_failed", { reason: error })}
        </p>
      ) : null}
      {recordedVnd !== null ? (
        <p style={{ color: colors.muted }}>
          {label(labels, "admin_transfer_done", {
            amount: vnd(recordedVnd, labels),
            name: props.name,
          })}
        </p>
      ) : null}
      <Button onClick={submit} disabled={busy}>
        {label(labels, busy ? "admin_transfer_working" : "admin_transfer_submit")}
      </Button>
    </section>
  );
}

/**
 * Recording a transfer the owner has already made in their banking app.
 *
 * The screen never adds anything up: it shows the amount the server said the
 * customer is owed and sends it back as an assertion. If the payout no longer
 * comes to that figure the server refuses, instead of quietly recording another
 * amount. The orders covered are worked out on the server, the same way the
 * customer's own balance is.
 */
export function RecordTransfer(props: RecordTransferProps): ReactElement {
  const labels = useLabels();

  if (!props.canRecord) {
    return <p style={{ color: colors.muted }}>{label(labels, "admin_transfer_owner_only")}</p>;
  }
  if (props.readyVnd <= 0) {
    return <p style={{ color: colors.muted }}>{label(labels, "admin_transfer_nothing")}</p>;
  }
  return <Form {...props} labels={labels} />;
}
