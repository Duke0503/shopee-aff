/**
 * The receipt page's own CSS (DESIGN.md receipt-card, status-badge, masked-account, money-lg;
 * responsive type scale), on the custom properties of packages/ui tokens.css. Phone first: one
 * centred column with the phone gutter, body 15 px, nothing under 12 px; tablet and desktop only
 * widen the gutter and the type one step. No web font: the fallback stack renders Vietnamese.
 */
export const RECEIPT_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--foreground);font-family:var(--font-family);font-size:15px;line-height:1.5}
.page{max-width:440px;margin:0 auto;padding:24px var(--gutter-phone) 40px}
.brand{display:flex;align-items:center;gap:8px;margin:0 0 16px;font-size:16px;font-weight:700}
.brand-mark{display:block;width:28px;height:28px;object-fit:contain}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--rounded-xl);padding:20px}
.card-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}
h1{margin:0;font-size:18px;font-weight:700;line-height:1.3}
.badge{display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:var(--rounded-full);font-size:12px;font-weight:500;line-height:1.35;white-space:nowrap}
.badge-done{background:var(--status-done-soft);color:var(--status-done)}
.badge-rejected{background:var(--status-rejected-soft);color:var(--status-rejected)}
.voided{margin:16px 0 0;padding:12px;border-radius:var(--rounded-md);background:var(--status-rejected-soft);color:var(--status-rejected);font-size:14px;font-weight:500;line-height:1.45}
.amount-label{margin:20px 0 4px;font-size:13px;color:var(--muted-foreground)}
.amount{margin:0;font-size:32px;font-weight:700;line-height:1.15;letter-spacing:-0.01em;color:var(--money);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.card-voided .amount{color:var(--muted-foreground);text-decoration:line-through}
.facts{margin:20px 0 0;border-top:1px solid var(--border)}
.fact{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:var(--row-comfortable);padding:8px 0;border-bottom:1px solid var(--border)}
.fact:last-child{border-bottom:0;padding-bottom:0}
dt{color:var(--muted-foreground);font-size:14px}
dd{margin:0;min-width:0;font-weight:600;text-align:right;overflow-wrap:anywhere}
.figure{font-variant-numeric:tabular-nums}
.masked{font-family:var(--font-code);font-size:14px;font-weight:500}
.code-chip{display:inline-flex;align-items:center;gap:6px;min-height:36px;max-width:100%;padding:0 10px;border:1px solid var(--border);border-radius:var(--rounded-md);background:var(--muted);color:var(--foreground);font-family:var(--font-code);font-size:14px;font-weight:500;cursor:pointer}
.code-chip svg{flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;color:var(--muted-foreground)}
.code-chip:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.note{margin:16px 4px 0;font-size:13px;line-height:1.45;color:var(--muted-foreground)}
.card-missing .body{margin:8px 0 0;color:var(--muted-foreground)}
@media (min-width:768px){
  body{font-size:16px}
  .page{padding:48px var(--gutter-tablet) 48px}
  .card{padding:24px}
  h1{font-size:20px}
  .amount-label,.note{font-size:14px}
}
@media (min-width:1280px){
  .page{padding-top:80px}
}
`;
