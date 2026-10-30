import { describe, expect, it } from "vitest";
import { handleBankDetails, type BankDetails, type BankDeps } from "../src/bank-details";

const deps = (fail = false): { deps: BankDeps; saved: BankDetails[] } => {
  const saved: BankDetails[] = [];
  return {
    saved,
    deps: {
      saveBank: async (_customerId, details) => {
        if (fail) throw new Error("bank not matched");
        saved.push(details);
      },
    },
  };
};

describe("handleBankDetails", () => {
  it("ignores anything that is not a bank command", async () => {
    const { deps: d } = deps();
    expect(await handleBankDetails("xin chao", "C1", d)).toEqual({ kind: "not_a_command" });
  });

  it("asks for details when the command is bare", async () => {
    const { deps: d } = deps();
    expect(await handleBankDetails("/bank", "C1", d)).toEqual({ kind: "need_details" });
  });

  it("saves the bank, account and holder", async () => {
    const { deps: d, saved } = deps();
    const outcome = await handleBankDetails("/bank VCB 123456 LE VAN C", "C1", d);
    expect(outcome).toMatchObject({ kind: "saved" });
    expect(saved[0]).toEqual({ bankName: "VCB", bankAccount: "123456", accountHolder: "LE VAN C" });
  });

  it("allows a missing holder", async () => {
    const { deps: d, saved } = deps();
    await handleBankDetails("/bank VCB 123456", "C1", d);
    expect(saved[0]?.accountHolder).toBe("");
  });

  it("reports a bank the server could not match", async () => {
    const { deps: d } = deps(true);
    expect(await handleBankDetails("/bank unknown 1", "C1", d)).toEqual({ kind: "bank_not_matched" });
  });
});
