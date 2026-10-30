/** EMVCo QR text (VietQR) split into its `id + length + value` fields, for the payload tests. */
export function tlv(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < text.length; ) {
    const id = text.slice(i, i + 2);
    const length = Number(text.slice(i + 2, i + 4));
    out.push([id, text.slice(i + 4, i + 4 + length)]);
    i += 4 + length;
  }
  return out;
}

