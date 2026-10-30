/**
 * The VietQR image (DESIGN.md qr-panel, M-7): the server's EMVCo payload drawn as an SVG in the
 * browser, one path of dark modules on a white well with a quiet zone, so no outside image service
 * ever sees the account or the amount. The browser draws exactly the text it was given; it never
 * builds or changes a payload. Medium error correction keeps it readable from a second phone.
 */
import { useMemo } from "react";
import { encode } from "uqr";

/** Modules of quiet zone on each side (EMVCo asks for at least 4). */
export const QR_QUIET_ZONE = 4;

/** The SVG path of the dark modules of `payload`, and the side of the square in modules. */
export function qrPath(payload: string): { readonly d: string; readonly size: number } {
  const qr = encode(payload, { ecc: "M", border: QR_QUIET_ZONE });
  const parts: string[] = [];
  qr.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
    }),
  );
  return { d: parts.join(""), size: qr.size };
}

export function VietQrCode({ payload, label, className }: { readonly payload: string; readonly label: string; readonly className?: string }) {
  const { d, size } = useMemo(() => qrPath(payload), [payload]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className={className}>
      <rect width={size} height={size} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
