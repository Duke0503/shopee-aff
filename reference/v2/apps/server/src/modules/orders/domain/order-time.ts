/**
 * Turning any platform's date into this system's local timestamp.
 * Ports `ledger/repository.py::parse_order_time`. Vietnam is UTC+7 all year,
 * so an absolute instant is shifted and its UTC parts read back, giving the
 * naive local string the rest of the server writes.
 */

const VN_OFFSET_MS = 7 * 3_600_000;

const pad = (value: number): string => String(value).padStart(2, "0");

function vnNaive(date: Date): string {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
  );
}

function localParts(year: number, month: number, day: number, hour: number, minute: number, second: number): string {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const DMY_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const DMY_DASH = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const YMD_SLASH = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function withColon(offset: string): string {
  return offset.length === 5 && !offset.includes(":") ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset;
}

/** Any date/timestamp -> local `YYYY-MM-DDTHH:MM:SS`; unknown input becomes now. */
export function parseOrderTime(rawValue: unknown, orderId = ""): string {
  if (rawValue !== null && rawValue !== undefined) {
    const text = String(rawValue).trim();
    if (/^\d{10,13}$/.test(text)) {
      const milliseconds = (text.length === 13 ? Number(text) / 1000 : Number(text)) * 1000;
      const date = new Date(milliseconds);
      if (!Number.isNaN(date.getTime())) return vnNaive(date);
    }

    const iso = ISO_PATTERN.exec(text);
    if (iso) {
      const [, year, month, day, hour, minute, second, offset] = iso;
      if (offset) {
        const ms = Date.parse(offset === "Z" ? text : text.replace(offset, withColon(offset)));
        if (!Number.isNaN(ms)) return vnNaive(new Date(ms));
      } else {
        return localParts(Number(year), Number(month), Number(day), Number(hour ?? 0), Number(minute ?? 0), Number(second ?? 0));
      }
    }

    const head = text.slice(0, 19);
    for (const match of [DMY_SLASH.exec(head), DMY_DASH.exec(head)]) {
      if (match) {
        return localParts(Number(match[3]), Number(match[2]), Number(match[1]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0));
      }
    }
    const ymd = YMD_SLASH.exec(head);
    if (ymd) {
      return localParts(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), Number(ymd[4] ?? 0), Number(ymd[5] ?? 0), Number(ymd[6] ?? 0));
    }
  }

  // Fallback from a Shopee order SN prefix YYMMDD (e.g. 260911...).
  const sn = /^(\d{2})(\d{2})(\d{2})/.exec(orderId);
  if (sn) {
    const month = Number(sn[2]);
    const day = Number(sn[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return localParts(2000 + Number(sn[1]), month, day, 0, 0, 0);
    }
  }

  return vnNaive(new Date());
}
