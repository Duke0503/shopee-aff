import { escapeHtml } from "../../../shared/html";

export interface SharePageInput {
  productName: string;
  cashbackFormatted: string;
  buyHref: string;
  zaloUrl?: string;
}

/** A minimal, phone-first product page: everyone sees it before Shopee. */
export function renderSharePage(input: SharePageInput): string {
  const name = escapeHtml(input.productName || "San pham");
  const cashback = escapeHtml(input.cashbackFormatted);
  const buy = escapeHtml(input.buyHref);
  const zalo = input.zaloUrl ? `<a class="zalo" href="${escapeHtml(input.zaloUrl)}">Get a DP code on Zalo</a>` : "";
  return [
    "<!doctype html>",
    '<html lang="vi"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${name}</title></head>`,
    "<body>",
    "<main>",
    `<h1>${name}</h1>`,
    `<p class="cashback">Cashback about ${cashback}</p>`,
    `<a class="btn" href="${buy}">Buy on Shopee</a>`,
    zalo,
    "</main>",
    "</body></html>",
  ].join("\n");
}
