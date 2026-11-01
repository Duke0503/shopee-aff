// @vitest-environment jsdom
/**
 * Story 4.22: the payout record job opens page 1 of the payout record page, waits in the worker
 * until the table has loaded, and answers the six fields of each row's rendered record, as they
 * were. The page script runs on a copy of the antd table structure (jsdom, React props stood in
 * for by a fiber-shaped property); the job runs on a fake page driver. No network, no browser.
 */
import { bridgePayoutRecordJobSchema, bridgePayoutRecordValueSchema, type BridgePayoutRecordJob } from "@cashback/contracts";
import { describe, expect, it } from "vitest";

import { jobWorker } from "../src/bridge-loop";
import type { PageDriver } from "../src/bridge-tab";
import { readPayoutTable, type PayoutLook, type PayoutTableInput } from "../src/page-scripts";
import { runPayoutRecordJob } from "../src/payout-record-job";
import { PAYOUT_EMPTY, PAYOUT_FIELDS, PAYOUT_FIXED_COPIES, PAYOUT_LOADING, PAYOUT_RECORD_URL, PAYOUT_ROW } from "../src/shopee-page";

const TABLE: PayoutTableInput = { row: PAYOUT_ROW, fixedCopies: PAYOUT_FIXED_COPIES, idField: "payoutId", empty: PAYOUT_EMPTY, loading: PAYOUT_LOADING, maxRows: 50, fields: PAYOUT_FIELDS };
const JOB: BridgePayoutRecordJob = { ticket: "a".repeat(32), kind: "payout_record", timeoutMs: 90_000 };
const PAID = { payoutId: "880011", payoutPaymentStatus: 10, totalPaymentAmount: "89020000000", eligibleTotalAmount: "100000000000", payoutCreatedTime: 1_761_955_200, payArrivalTime: 1_762_041_600 };

function withProps(el: Element, props: Record<string, unknown>): void {
  (el as unknown as Record<string, unknown>)["__reactFiber$test"] = { memoizedProps: { className: "row" }, return: { memoizedProps: props, return: null } };
}

function fakePayoutPage(looks: PayoutLook[]): PageDriver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    prepare: async () => void calls.push("prepare"),
    href: async () => PAYOUT_RECORD_URL,
    open: async (url) => void calls.push(`open ${url}`),
    run: async <A, R>(_func: (arg: A) => R): Promise<R> => {
      calls.push("look");
      return (looks.length > 1 ? looks.shift() : looks[0]) as R;
    },
  };
}

const look = (over: Partial<PayoutLook> & Pick<PayoutLook, "state">): PayoutLook => ({ href: PAYOUT_RECORD_URL, passwordBox: false, ...over }) as PayoutLook;
const noWait = async () => undefined;

describe("Story 4.22: the payout record page script", () => {
  it("answers only the six record fields of each row, as the page holds them, and nothing else of the record", () => {
    document.body.innerHTML = '<table><tbody><tr data-row-key="880011"><td>a</td></tr><tr data-row-key="880012"><td>b</td></tr></tbody></table>';
    const rows = document.querySelectorAll(PAYOUT_ROW);
    withProps(rows[0] as Element, { record: { ...PAID, bankAccount: "0123456789", accountType: 1 } });
    withProps(rows[1] as Element, { record: { ...PAID, payoutId: "880012", payoutPaymentStatus: 1, payArrivalTime: 0 } });
    const seen = readPayoutTable(TABLE);
    expect(seen.state).toBe("rows");
    expect(seen.state === "rows" ? seen.records : null).toEqual([PAID, { ...PAID, payoutId: "880012", payoutPaymentStatus: 1, payArrivalTime: 0 }]);
    expect(JSON.stringify(seen)).not.toContain("0123456789");
  });

  it("review 8: with antd fixed columns the duplicated rows of the fixed copies are skipped, and a batch found twice is kept once", () => {
    const second = { ...PAID, payoutId: "880012" };
    document.body.innerHTML = `<div class="ant-table">
      <div class="ant-table-scroll"><div class="ant-table-body"><table><tbody>
        <tr data-row-key="880011"><td>a</td></tr><tr data-row-key="880012"><td>b</td></tr><tr data-row-key="880011-again"><td>a</td></tr>
      </tbody></table></div></div>
      <div class="ant-table-fixed-left"><div class="ant-table-body-inner"><table><tbody><tr data-row-key="880011"><td>a</td></tr><tr data-row-key="880012"><td>b</td></tr></tbody></table></div></div>
      <div class="ant-table-fixed-right"><div class="ant-table-body-inner"><table><tbody><tr data-row-key="880011"><td>a</td></tr><tr data-row-key="880012"><td>b</td></tr></tbody></table></div></div>
    </div>`;
    const rows = Array.from(document.querySelectorAll(PAYOUT_ROW));
    expect(rows).toHaveLength(7);
    rows.forEach((r) => withProps(r, { record: r.getAttribute("data-row-key") === "880012" ? second : PAID }));
    const seen = readPayoutTable(TABLE);
    expect(seen.state === "rows" ? seen.records : seen.state).toEqual([PAID, second]);
    withProps(rows[2] as Element, { record: { ...PAID, totalPaymentAmount: "1" } });
    expect(readPayoutTable(TABLE).state).toBe("unreadable");
  });

  it("is waiting while the table loads, empty on the empty state, unreadable when a row has no record or a field of another kind", () => {
    document.body.innerHTML = '<div class="ant-spin-spinning"></div>';
    expect(readPayoutTable(TABLE).state).toBe("waiting");
    document.body.innerHTML = '<div class="ant-empty">No data</div>';
    expect(readPayoutTable(TABLE).state).toBe("empty");
    document.body.innerHTML = '<table><tbody><tr data-row-key="1"></tr></tbody></table>';
    expect(readPayoutTable(TABLE).state).toBe("unreadable");
    withProps(document.querySelector(PAYOUT_ROW) as Element, { record: { ...PAID, totalPaymentAmount: { value: 1 } } });
    expect(readPayoutTable(TABLE).state).toBe("unreadable");
  });
});

describe("Story 4.22: one payout record job", () => {
  it("AC5: the job holds no page parameter and the page is opened at page 1 with no query at all", async () => {
    expect(Object.keys(bridgePayoutRecordJobSchema.shape).sort()).toEqual(["kind", "ticket", "timeoutMs"]);
    expect(bridgePayoutRecordJobSchema.safeParse({ ...JOB, page: 2 }).success).toBe(false);
    const page = fakePayoutPage([look({ state: "waiting" }), look({ state: "rows", records: [PAID] })]);
    const answer = await runPayoutRecordJob(JOB, page, noWait);
    expect(answer).toEqual({ outcome: "value", value: { list: [PAID] } });
    expect(bridgePayoutRecordValueSchema.safeParse(answer.outcome === "value" ? answer.value : null).success).toBe(true);
    expect(page.calls).toEqual(["prepare", "open https://affiliate.shopee.vn/payment/payout_record", "look", "look"]);
  });

  it("AC4: answers a verification page as captcha and the login page as login_redirect; an empty table is no batches", async () => {
    expect(await runPayoutRecordJob(JOB, fakePayoutPage([look({ state: "waiting", href: "https://shopee.vn/verify/traffic/error" })]), noWait)).toEqual({ outcome: "failed", reason: "captcha" });
    expect(await runPayoutRecordJob(JOB, fakePayoutPage([look({ state: "waiting", passwordBox: true })]), noWait)).toEqual({ outcome: "failed", reason: "login_redirect" });
    expect(await runPayoutRecordJob(JOB, fakePayoutPage([look({ state: "waiting" })]), noWait)).toEqual({ outcome: "failed", reason: "page_not_ready" });
    expect(await runPayoutRecordJob(JOB, fakePayoutPage([look({ state: "unreadable" })]), noWait)).toEqual({ outcome: "failed", reason: "script_error" });
    expect(await runPayoutRecordJob(JOB, fakePayoutPage([look({ state: "empty" })]), noWait)).toEqual({ outcome: "value", value: { list: [] } });
  });

  it("the loop's worker sends a payout_record job to the payout record page", async () => {
    const page = fakePayoutPage([look({ state: "empty" })]);
    expect(await jobWorker(page, noWait)(JOB)).toEqual({ outcome: "value", value: { list: [] } });
    expect(page.calls).toContain(`open ${PAYOUT_RECORD_URL}`);
  });
});
