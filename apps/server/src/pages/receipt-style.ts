/**
 * The receipt page's own CSS (pen.dev Ju4U9 phone, QQxS4 desktop and JC1Ei voided; DESIGN.md
 * receipt-card, status-badge, masked-account, money-lg), on the custom properties of packages/ui tokens.css. Phone first: one
 * centred column with the phone gutter, body 15 px, nothing under 12 px; tablet and desktop only
 * widen the gutter and the type one step. No web font: the fallback stack renders Vietnamese.
 */
export const RECEIPT_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--foreground);font-family:var(--font-family);font-size:15px;line-height:1.5}
.page{max-width:492px;margin:0 auto;padding:16px var(--gutter-phone) 40px}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 20px;font-size:16px;font-weight:700}
.brand-mark{display:block;width:28px;height:28px;object-fit:contain}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--rounded-xl);padding:20px 16px 12px}
.card-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}
h1{margin:0;font-size:17px;font-weight:600;line-height:1.3}
.badge{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:var(--rounded-full);font-size:13px;font-weight:500;line-height:1.35;white-space:nowrap}
.badge-done{background:var(--status-done-soft);color:var(--status-done)}
.badge-rejected{background:var(--status-rejected-soft);color:var(--status-rejected)}
.voided{margin:8px 0 0;color:var(--destructive);font-size:14px;line-height:1.45}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.amount{margin:12px 0 0;font-size:36px;font-weight:700;line-height:1.15;letter-spacing:-0.01em;color:var(--money);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.card-voided .amount{color:var(--muted-foreground)}
.facts{margin:16px 0 0;padding:8px 0 0;border-top:1px solid var(--border)}
.fact{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:var(--touch-target);padding:2px 0}
dt{color:var(--muted-foreground);font-size:15px}
dd{margin:0;min-width:0;font-weight:600;text-align:right;overflow-wrap:anywhere}
.figure{font-variant-numeric:tabular-nums}
.masked{font-variant-numeric:tabular-nums}
.code-chip{position:relative;display:inline-flex;align-items:center;gap:6px;min-height:28px;max-width:100%;padding:0 0 0 6px;border:0;border-radius:var(--rounded-md);background:none;color:var(--foreground);font:inherit;font-weight:600;cursor:pointer}
.code-chip::after{content:"";position:absolute;inset:-8px 0}
.code-chip svg{flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;color:var(--muted-foreground)}
.code-chip:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.note{margin:20px 0 0;font-size:14px;line-height:1.45;color:var(--muted-foreground)}
.card-missing .body{margin:8px 0 0;color:var(--muted-foreground)}
.card-missing{padding-bottom:20px}
@media (min-width:768px){
  body{font-size:16px}
  .page{padding:24px var(--gutter-tablet) 48px}
  .brand{justify-content:center;margin-bottom:40px}
  .card{padding:24px 20px 14px}
}
`;
