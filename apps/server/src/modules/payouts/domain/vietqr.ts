/**
 * The VietQR payload (NAPAS 247 on EMVCo merchant-presented QR, FR-16, M-7): the text a banking
 * app reads to fill in a transfer to one account, for one amount, with one transfer content.
 * Built here from the server's own figures, never from the browser, and never by an outside image
 * service: the QR shows exactly the preview's amount.
 *
 * Fields, each `id + two-digit length + value`:
 *   00 "01" payload format; 01 "12" dynamic (it carries an amount);
 *   38 merchant account: 00 NAPAS GUID A000000727, 01 beneficiary (00 bank BIN, 01 account
 *      number), 02 service QRIBFTTA (transfer to an account);
 *   53 "704" dong; 54 the amount; 58 "VN"; 62 additional data: 08 the transfer content;
 *   63 CRC-16/CCITT-FALSE over everything before it, "6304" included, four upper-case hex digits.
 */

export interface VietQrInput {
  /** The 6-digit NAPAS bank identification number. */
  readonly bankBin: string;
  readonly accountNumber: string;
  /** Whole dong, above 0. */
  readonly amount: number;
  /** The transfer content the customer's bank statement shows: letters, digits and spaces. */
  readonly content: string;
}

export class VietQrError extends Error {
  constructor(readonly code: "bank_bin" | "account_number" | "amount" | "content") {
    super(`vietqr: invalid ${code}`);
    this.name = "VietQrError";
  }
}

const NAPAS_GUID = "A000000727";
const SERVICE_TO_ACCOUNT = "QRIBFTTA";
/** The longest transfer content every member bank keeps whole. */
export const VIETQR_CONTENT_MAX = 25;

function field(id: string, value: string): string {
  if (value.length > 99) throw new RangeError(`vietqr: field ${id} longer than 99`);
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC-16/CCITT-FALSE: polynomial 0x1021, initial 0xFFFF, no reflection, no final XOR. */
export function crc16Ccitt(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function checked(input: VietQrInput): VietQrInput {
  if (!/^\d{6}$/.test(input.bankBin)) throw new VietQrError("bank_bin");
  if (!/^[A-Za-z0-9]{4,30}$/.test(input.accountNumber)) throw new VietQrError("account_number");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new VietQrError("amount");
  if (!/^[A-Za-z0-9 ]{1,25}$/.test(input.content)) throw new VietQrError("content");
  return input;
}

export function vietQrPayload(raw: VietQrInput): string {
  const input = checked(raw);
  const beneficiary = field("00", input.bankBin) + field("01", input.accountNumber.toUpperCase());
  const account = field("00", NAPAS_GUID) + field("01", beneficiary) + field("02", SERVICE_TO_ACCOUNT);
  const body = [field("00", "01"), field("01", "12"), field("38", account), field("53", "704"), field("54", String(input.amount)), field("58", "VN"), field("62", field("08", input.content))].join("") + "6304";
  return body + crc16Ccitt(body);
}
