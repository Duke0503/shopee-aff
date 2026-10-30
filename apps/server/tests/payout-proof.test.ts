/**
 * Story 4.9: proof images are staff-only bank screenshots, and the public receipt shows facts only
 * (FR-18, AD-21, D49, INV-13). An upload is judged by its bytes: only a JPEG or PNG that parses is
 * kept, re-written without metadata, under a random name in the files directory; it is served only
 * to staff and to the payout's own signed-in customer, with nosniff and the strict CSP. The
 * receipt page `/b/<token>` is server-rendered HTML with the customer code, the last four digits,
 * the amount, the date and the voided state, `noindex`, and never the proof or its URL.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { errorEnvelopeSchema, payoutProofResponseSchema } from "@cashback/contracts";
import pages from "@cashback/labels/vi/pages.json" with { type: "json" };
import { afterEach, describe, expect, it } from "vitest";

import { openSession, STAFF_SESSION_MS } from "../src/modules/identity/index";
import { commandAudit } from "../src/modules/operations/index";
import { fileProofStore, importPayouts, PNG_MAX_RAW, PROOF_MAX_BYTES, sanitizeProofImage, type ConfirmOutcome } from "../src/modules/payouts/index";
import { orientationSegment } from "../src/modules/payouts/proof-image";
import { escapeHtml, RECEIPT_CSP, receiptHtml } from "../src/pages/receipt.page";
import type { Ledger } from "../src/platform/db/ledger";
import { ACCESS_JWT_HEADER } from "../src/platform/http/access-jwt.guard";
import { IMAGE_CSP } from "../src/platform/http/image-response";
import { close, type Servers } from "../src/platform/http/servers";
import { CUSTOMER_SESSION_COOKIE, STAFF_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import { tempDir } from "./helpers/live-fixture";
import { closeLedgers } from "./helpers/order-ledger";
import { addBank, addOrder, CLOCK, confirmClaim, MINH, nameOf, openClaim, payoutLedger } from "./helpers/payout-ledger";
import { accessJwt, ADMIN_HOST, deskServers, ORIGIN, PUBLIC_HOST } from "./helpers/staff-desk";
import { GPS_MARK, jpegWithGps, pngWithText } from "./helpers/proof-images";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

const SAMPLE_JPEG = readFileSync(new URL("./fixtures/proof-sample.jpg", import.meta.url));
const TOKEN = "rcpt_test_token_0001";

interface Desk {
  ledger: Ledger;
  servers: Servers;
  dir: string;
  payoutId: number;
}

/** Lan (P1) paid 115,216 into an account ending 3456, with the receipt token above. */
function recordedDesk(): Desk {
  const ledger = payoutLedger();
  addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
  addOrder(ledger, { id: "261001A0002", customer: "P1", cashback: 36000 });
  addBank(ledger, "P1", { number: "0071000123456" });
  const claim = openClaim(ledger, "P1");
  if (claim.kind !== "claimed") throw new Error("expected a claim");
  const outcome: ConfirmOutcome = confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash);
  if (outcome.kind !== "recorded") throw new Error("expected a payout");
  const dir = tempDir("cashback-proofs-");
  servers = deskServers(ledger, CLOCK, [], fileProofStore(dir));
  return { ledger, servers, dir, payoutId: outcome.payout.payoutId };
}

const staffCookie = (ledger: Ledger, staffId: string): string => `${STAFF_SESSION_COOKIE}=${ledger.tx((db) => openSession(db, { kind: "STAFF", staffId }, CLOCK, STAFF_SESSION_MS)).token}`;
const customerCookie = (ledger: Ledger, customerId: string): string => `${CUSTOMER_SESSION_COOKIE}=${ledger.tx((db) => openSession(db, { kind: "CUSTOMER", customerId }, CLOCK, null)).token}`;

function upload(d: Desk, bytes: Buffer, contentType = "image/png", cookie = staffCookie(d.ledger, "tuan")) {
  return d.servers.publicApp.inject({ method: "POST", url: `/api/admin/payouts/${d.payoutId}/proof`, headers: { host: ADMIN_HOST, origin: ORIGIN, cookie, [ACCESS_JWT_HEADER]: accessJwt(CLOCK), "content-type": contentType }, payload: bytes });
}

const staffGet = (d: Desk, url: string, cookie: string) => d.servers.publicApp.inject({ method: "GET", url, headers: { host: ADMIN_HOST, cookie, [ACCESS_JWT_HEADER]: accessJwt(CLOCK) } });
const publicGet = (d: Desk, url: string, cookie?: string) => d.servers.publicApp.inject({ method: "GET", url, headers: { host: PUBLIC_HOST, ...(cookie === undefined ? {} : { cookie }) } });
const codeOf = (body: string) => errorEnvelopeSchema.parse(JSON.parse(body)).error.messageKey;
const files = (dir: string): string[] => readdirSync(dir);

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>');
const HTML_AS_PNG = Buffer.from("<!doctype html><html><body><script>alert(document.cookie)</script></body></html>");
const GIF = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

describe("Story 4.9 acceptance criteria", () => {
  it("AC1: a GIF, an SVG or an HTML file renamed .png is refused, and nothing is stored", async () => {
    const d = recordedDesk();
    for (const [bytes, type] of [[GIF, "image/png"], [SVG, "image/png"], [HTML_AS_PNG, "image/png"], [HTML_AS_PNG, "image/jpeg"]] as const) {
      const res = await upload(d, bytes, type);
      expect(res.statusCode).toBe(400);
      expect(codeOf(res.body)).toBe("error.proof.not_an_image");
    }
    for (const type of ["image/gif", "image/svg+xml", "text/html"]) expect((await upload(d, type === "image/gif" ? GIF : SVG, type)).statusCode).toBe(415);
    expect(d.ledger.sqlite.prepare("SELECT count(*) AS n FROM payout_proofs").get()).toEqual({ n: 0 });
    expect(files(d.dir)).toEqual([]);
  });

  it("AC1: a JPEG with GPS EXIF is stored re-written without EXIF, keeping the picture's coded data", async () => {
    const d = recordedDesk();
    const withGps = jpegWithGps(SAMPLE_JPEG);
    expect(withGps.includes(GPS_MARK)).toBe(true);
    const res = await upload(d, withGps, "image/jpeg");
    expect(res.statusCode).toBe(200);
    expect(payoutProofResponseSchema.parse(res.json())).toEqual({ payoutId: d.payoutId, byteSize: expect.any(Number), width: 48, height: 32, uploadedAt: CLOCK.now(), replaced: false });
    const [name = ""] = files(d.dir);
    expect(name).toMatch(/^[0-9a-f]{32}\.jpg$/);
    const stored = readFileSync(`${d.dir}/${name}`);
    expect(stored.includes(GPS_MARK)).toBe(false);
    expect(stored.includes(Buffer.from("Exif"))).toBe(false);
    expect(stored.includes(Buffer.from("ICC_PROFILE"))).toBe(false);
    expect([stored[0], stored[1], stored.at(-2), stored.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    // Re-reading the stored file changes nothing more: it already holds only the picture.
    const again = await sanitizeProofImage(stored);
    expect(again.kind === "image" && again.bytes.equals(stored)).toBe(true);
    const row = d.ledger.sqlite.prepare("SELECT file_name, content_type, byte_size, sha256, width, height, uploaded_by FROM payout_proofs").get();
    expect(row).toEqual({ file_name: name, content_type: "image/jpeg", byte_size: stored.length, sha256: createHash("sha256").update(stored).digest("hex"), width: 48, height: 32, uploaded_by: "tuan" });
    const audit = d.ledger.sqlite.prepare("SELECT actor_id, payload FROM audit_entries WHERE event = 'payouts.proof.recorded'").all() as { actor_id: string; payload: string }[];
    expect(audit.map((a) => a.actor_id)).toEqual(["tuan"]);
    expect(JSON.parse(audit[0]?.payload ?? "{}")).toMatchObject({ payoutId: d.payoutId, sha256: row && (row as { sha256: string }).sha256 });
  });

  it("AC2: /b/<token> without a session shows only the customer code, the last four digits, the amount and the date, is noindex, and never the proof or its URL", async () => {
    const d = recordedDesk();
    expect((await upload(d, jpegWithGps(SAMPLE_JPEG), "image/jpeg")).statusCode).toBe(200);
    const res = await publicGet(d, `/b/${TOKEN}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toBe(RECEIPT_CSP);
    // The only image is the brand's logo mark, inlined; nothing else may load.
    expect(RECEIPT_CSP).toContain("img-src data:;");
    const html = res.body;
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('data-receipt="paid"');
    expect([...html.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1]?.slice(0, 23))).toEqual(["data:image/webp;base64,"]);
    for (const fact of ["DP00012", "3456", "115.216", "30/10 19:00"]) expect(html).toContain(fact);
    const visible = html.replace(/data:image\/webp;base64,[^"]+/g, "");
    for (const secret of ["0071000123456", "NGUYEN THI LAN", escapeHtml(nameOf("P1")), nameOf("P1"), "proof", "/api/", "P1", "Vietcombank"]) expect(visible, secret).not.toContain(secret);
  });

  it("AC3: a voided payout's receipt shows the voided label (status_payout_voided) with the void date", async () => {
    const d = recordedDesk();
    d.ledger.sqlite.prepare("UPDATE payouts SET status = 'VOIDED', voided_at = '2026-10-31T02:30:00.000Z', void_reason = 'test', voided_by = 'minh'").run();
    const res = await publicGet(d, `/b/${TOKEN}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-receipt="voided"');
    expect(res.body).toContain(pages.receipt_voided);
    expect(res.body).toContain("31/10 09:30");
  });

  it("AC4: an unknown token, an old row-number link and a malformed token get the plain receipt-not-found page with 404, like any missing page", async () => {
    const d = recordedDesk();
    const missingRoute = await publicGet(d, "/no/such/page");
    for (const url of ["/b/unknown_token_000000000000", "/b/1", "/b/%3Cscript%3E"]) {
      const res = await publicGet(d, url);
      expect(res.statusCode, url).toBe(missingRoute.statusCode);
      expect(res.body).toContain('data-receipt="missing"');
      expect(res.body).toContain(pages.receipt_not_found);
      expect(res.body).not.toContain("<script>alert");
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
  });

  it("AC5: the proof is 404 without a staff session or the owner's customer session; with one it is the image with nosniff and the strict CSP", async () => {
    const d = recordedDesk();
    d.ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('P9', 'DP00099', 'USER', 'ACTIVE')").run();
    expect((await upload(d, pngWithText(), "image/png")).statusCode).toBe(200);
    const mine = `/api/me/payouts/${d.payoutId}/proof`;
    const staff = `/api/admin/payouts/${d.payoutId}/proof`;
    const staffToken = staffCookie(d.ledger, "minh");
    for (const cookie of [undefined, customerCookie(d.ledger, "P9"), staffToken.replace(STAFF_SESSION_COOKIE, CUSTOMER_SESSION_COOKIE), `${CUSTOMER_SESSION_COOKIE}=not-a-token`]) {
      expect((await publicGet(d, mine, cookie)).statusCode).toBe(404);
    }
    expect((await publicGet(d, staff, staffToken)).statusCode).toBe(404);
    expect((await publicGet(d, `/api/me/payouts/999/proof`, customerCookie(d.ledger, "P1"))).statusCode).toBe(404);
    for (const res of [await publicGet(d, mine, customerCookie(d.ledger, "P1")), await staffGet(d, staff, staffCookie(d.ledger, "tuan"))]) {
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-security-policy"]).toBe(IMAGE_CSP);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.rawPayload.subarray(1, 4).toString("latin1")).toBe("PNG");
      expect(res.rawPayload.includes(Buffer.from("Author"))).toBe(false);
    }
  });

  it("AC6: an imported live bill token opens its payout", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "260901L0001", customer: "P2", status: "PAID", cashback: 42000 });
    const live = "q3Xv9TzM0bW1sKp7Yc2RfH8nLd4GjA6e";
    ledger.tx((db) =>
      importPayouts(
        db,
        { payouts: [{ payoutId: 41, customerId: "P2", transferAmount: 42000, transferReference: "DP00031", receiptToken: live, bankLastFour: "7788", recordedAt: "2026-09-12T03:00:00.000Z", recordedBy: null, note: null, proofRef: "proofs/live-41.jpg" }], items: [{ payoutId: 41, kind: "ORDER", orderId: "260901L0001", awardId: null, amount: 42000 }] },
        commandAudit(db, CLOCK, MINH),
      ),
    );
    servers = deskServers(ledger, CLOCK);
    const res = await servers.publicApp.inject({ method: "GET", url: `/b/${live}`, headers: { host: PUBLIC_HOST } });
    expect(res.statusCode).toBe(200);
    for (const fact of ["DP00031", "7788", "42.000", "12/09 10:00"]) expect(res.body).toContain(fact);
    expect(res.body).not.toContain("live-41");
  });
});

describe("proof upload rules (D49, INV-13)", () => {
  it("a PNG keeps its pixels and loses its text chunks; a truncated file, a bad CRC and a decompression bomb are refused", async () => {
    const clean = await sanitizeProofImage(pngWithText());
    expect(clean).toMatchObject({ kind: "image", contentType: "image/png", width: 3, height: 2 });
    if (clean.kind !== "image") return;
    expect(clean.bytes.includes(Buffer.from("tEXt"))).toBe(false);
    expect(clean.bytes.includes(Buffer.from("Author"))).toBe(false);
    const truncated = pngWithText().subarray(0, 40);
    const badCrc = Buffer.from(pngWithText());
    badCrc[29] = (badCrc[29] ?? 0) ^ 0xff;
    expect(await sanitizeProofImage(truncated)).toEqual({ kind: "refused", code: "malformed" });
    expect(await sanitizeProofImage(badCrc)).toEqual({ kind: "refused", code: "malformed" });
    expect(await sanitizeProofImage(SAMPLE_JPEG.subarray(0, SAMPLE_JPEG.length - 200))).toEqual({ kind: "refused", code: "malformed" });
    expect(await sanitizeProofImage(pngWithText({ width: 30_000, height: 1 }))).toEqual({ kind: "refused", code: "too_large" });
    // 2000 x 2000 RGBA claimed (16 MB of rows), with image data that inflates past it.
    expect(await sanitizeProofImage(pngWithText({ width: 2000, height: 2000, data: deflateSync(Buffer.alloc(20_000_000)) }))).toEqual({ kind: "refused", code: "malformed" });
  });

  it("anything after a JPEG's end marker (a polyglot tail) is dropped", async () => {
    const tail = Buffer.concat([SAMPLE_JPEG, Buffer.from("<html><script>alert(1)</script></html>")]);
    const clean = await sanitizeProofImage(tail);
    expect(clean.kind).toBe("image");
    if (clean.kind === "image") expect(clean.bytes.includes(Buffer.from("<script>"))).toBe(false);
  });

  it("an employee may upload; a netting-only or voided payout takes no proof; a second upload replaces the row and keeps both hashes in the audit", async () => {
    const d = recordedDesk();
    expect((await upload(d, SAMPLE_JPEG, "image/jpeg")).statusCode).toBe(200);
    const second = await upload(d, pngWithText(), "image/png");
    expect(second.json()).toMatchObject({ replaced: true });
    expect(d.ledger.sqlite.prepare("SELECT content_type FROM payout_proofs").all()).toEqual([{ content_type: "image/png" }]);
    expect(files(d.dir)).toHaveLength(2);
    const payloads = (d.ledger.sqlite.prepare("SELECT payload FROM audit_entries WHERE event = 'payouts.proof.recorded' ORDER BY id").all() as { payload: string }[]).map((r) => JSON.parse(r.payload) as Record<string, unknown>);
    expect(payloads[1]?.["replacedSha256"]).toBe(payloads[0]?.["sha256"]);
    d.ledger.sqlite.prepare("UPDATE payouts SET status = 'VOIDED', voided_at = ?, void_reason = 'x', voided_by = 'minh'").run(CLOCK.now());
    const refused = await upload(d, SAMPLE_JPEG, "image/jpeg");
    expect([refused.statusCode, codeOf(refused.body)]).toEqual([409, "error.proof.payout_voided"]);
    expect(files(d.dir)).toHaveLength(2);
    expect((await upload({ ...d, payoutId: 999 }, SAMPLE_JPEG, "image/jpeg")).statusCode).toBe(404);
  });

  it("a stored file name never comes from the request, and a path outside the files directory is never read", () => {
    const dir = tempDir("cashback-proofs-");
    const store = fileProofStore(dir, () => "0123456789abcdef0123456789abcdef");
    expect(store.write(Buffer.from("x"), "image/png")).toBe("0123456789abcdef0123456789abcdef.png");
    for (const name of ["../ledger.sqlite", "..\\ledger.sqlite", "/etc/passwd", "0123456789abcdef0123456789abcdef.png/../../x", "0123456789ABCDEF0123456789ABCDEF.png"]) expect(store.read(name), name).toBeNull();
    expect(store.read("0123456789abcdef0123456789abcdef.png")?.toString()).toBe("x");
    expect(() => fileProofStore(dir, () => "../../escape").write(Buffer.from("x"), "image/png")).toThrow(/wrong shape/);
  });
});

describe("Sprint 16 code review", () => {
  it("review 3: a JPEG with Orientation 6 and a GPS position keeps only a fresh EXIF block holding Orientation 6", async () => {
    const clean = await sanitizeProofImage(jpegWithGps(SAMPLE_JPEG, 6));
    if (clean.kind !== "image") throw new Error("expected an image");
    expect(clean.bytes.includes(GPS_MARK)).toBe(false);
    expect(clean.bytes.subarray(2, 2 + orientationSegment(6).length).equals(orientationSegment(6))).toBe(true);
    expect(clean.bytes.indexOf(Buffer.from("Exif"))).toBe(clean.bytes.lastIndexOf(Buffer.from("Exif")));
    // Orientation 1 (upright) needs no block at all.
    const upright = await sanitizeProofImage(jpegWithGps(SAMPLE_JPEG, 1));
    expect(upright.kind === "image" && upright.bytes.includes(Buffer.from("Exif"))).toBe(false);
  });

  it("review 4: an upload over 8 MB is refused as error.proof.too_large, not a bare invalid request", async () => {
    const d = recordedDesk();
    const res = await upload(d, Buffer.alloc(PROOF_MAX_BYTES + 1, 0xff), "image/jpeg");
    expect([res.statusCode, codeOf(res.body)]).toEqual([400, "error.proof.too_large"]);
    expect(files(d.dir)).toEqual([]);
  });

  it("review 5: a PNG larger than 4096 x 8192 or past the 40 MB row cap is refused as too_large before it is inflated", async () => {
    expect(await sanitizeProofImage(pngWithText({ width: 5000, height: 5000 }))).toEqual({ kind: "refused", code: "too_large" });
    expect(await sanitizeProofImage(pngWithText({ width: 9000, height: 100 }))).toEqual({ kind: "refused", code: "too_large" });
    // 4096 x 8192 RGBA fits the sides but its rows (128 MB) pass the cap.
    expect(PNG_MAX_RAW).toBe(40 * 1024 * 1024);
    expect(await sanitizeProofImage(pngWithText({ width: 4096, height: 8192, data: Buffer.from([0x78, 0x9c]) }))).toEqual({ kind: "refused", code: "too_large" });
  });

  it("review 6: an upload to a voided, netting-only or unknown payout is refused before the image is read or written", async () => {
    const d = recordedDesk();
    d.ledger.sqlite.prepare("UPDATE payouts SET status = 'VOIDED', voided_at = ?, void_reason = 'x', voided_by = 'minh'").run(CLOCK.now());
    const voided = await upload(d, HTML_AS_PNG, "image/png");
    expect([voided.statusCode, codeOf(voided.body)]).toEqual([409, "error.proof.payout_voided"]);
    const unknown = await upload({ ...d, payoutId: 999 }, HTML_AS_PNG, "image/png");
    expect([unknown.statusCode, codeOf(unknown.body)]).toEqual([404, "error.proof.payout_not_found"]);
    expect(files(d.dir)).toEqual([]);
  });

  it("review 7: a voided receipt without a void time (or a time paid) still says voided, without a time, and never fails", () => {
    const html = receiptHtml({ payoutId: 1, customerCode: "DP00012", bankLastFour: null, amount: 1000, recordedAt: null, voided: true, voidedAt: null }, CLOCK);
    expect(html).toContain('data-receipt="voided"');
    expect(html).toContain(pages.receipt_voided_no_time);
    expect(html).toContain(pages.value_missing);
  });
});
