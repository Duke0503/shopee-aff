/**
 * The share page's own CSS (DESIGN.md share page, money-figure-estimate, estimate-tag,
 * guest-warning, Zalo hand-off panel), on the custom properties of packages/ui tokens.css. Phone
 * first: one centred card of at most 480 px with the phone gutter, body 15 px, nothing under 12 px,
 * buttons at the comfortable control height; tablet and desktop widen the gutter, the top space
 * and the type one step. The product picture stays a thumbnail beside the name, a little larger
 * from the tablet up, so the cashback line and the button stay in view on every screen. No web font: the fallback stack renders Vietnamese.
 */
export const SHARE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--foreground);font-family:var(--font-family);font-size:15px;line-height:1.5}
.page{max-width:480px;margin:0 auto;padding:20px var(--gutter-phone) 40px}
.top{display:flex;align-items:center;gap:8px;margin:0 0 16px}
.brand{display:flex;align-items:center;gap:8px;margin:0;font-size:16px;font-weight:700}
.brand-mark{display:block;width:28px;height:28px;object-fit:contain}
.network{margin-left:auto;padding:2px 10px;border:1px solid var(--border);border-radius:var(--rounded-full);background:var(--card);color:var(--muted-foreground);font-size:12px;font-weight:600;white-space:nowrap}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--rounded-xl);padding:16px}
.product{display:flex;gap:12px;align-items:flex-start}
.thumb{flex:none;width:72px;height:72px;border-radius:var(--rounded-lg);border:1px solid var(--border);background:var(--muted);object-fit:cover}
.product-text{min-width:0}
h1{margin:0;font-size:16px;font-weight:600;line-height:1.4;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.price{margin:4px 0 0;font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
.cash{margin:16px 0 0;padding:12px 14px;border-radius:var(--rounded-lg);background:var(--money-soft)}
.cash-label{margin:0;font-size:13px;font-weight:600;color:var(--secondary-foreground)}
.cash-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;margin:2px 0 0}
.estimate{font-size:24px;font-weight:400;line-height:1.2;color:var(--money);font-variant-numeric:tabular-nums}
.estimate b{font-weight:700}
.estimate-tag{display:inline-flex;align-items:center;height:20px;padding:0 6px;border-radius:var(--rounded-sm);background:var(--muted);color:var(--muted-foreground);font-size:12px;font-weight:500}
.missing{font-size:24px;color:var(--muted-foreground)}
.rates{margin:10px 0 0;padding:10px 0 0;border-top:1px solid var(--border);list-style:none;font-size:13px;color:var(--muted-foreground)}
.rates li{display:flex;justify-content:space-between;gap:12px;padding:2px 0}
.rates span:last-child{flex:none;color:var(--foreground);font-variant-numeric:tabular-nums}
.small{margin:8px 0 0;font-size:13px;line-height:1.45;color:var(--muted-foreground)}
.panel{margin:16px 0 0;padding:12px 14px;border-radius:var(--rounded-lg);font-size:14px;line-height:1.45}
.panel strong{display:block;margin:0 0 2px;font-size:15px}
.panel p{margin:0}
.guest{background:var(--warning-soft);color:var(--warning);border-left:4px solid var(--warning)}
.handoff{background:var(--secondary);color:var(--secondary-foreground)}
.steps{margin:8px 0 0;padding-left:20px}
.steps li{margin:4px 0;font-weight:600}
.actions{display:grid;gap:8px;margin:16px 0 0}
.btn{display:flex;align-items:center;justify-content:center;min-height:var(--control-comfortable);padding:10px 16px;border-radius:var(--rounded-lg);border:1px solid transparent;background:var(--primary);color:var(--primary-foreground);font:inherit;font-size:16px;font-weight:600;text-align:center;text-decoration:none;cursor:pointer}
.btn-outline{background:var(--card);color:var(--foreground);border-color:var(--border)}
.btn:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.status{margin:12px 0 0;font-size:13px;color:var(--muted-foreground);text-align:center}
.share-url{display:block;margin:8px 0 0;padding:8px 10px;border-radius:var(--rounded-md);background:var(--card);color:var(--foreground);font-family:var(--font-code);font-size:13px;overflow-wrap:anywhere}
.body{margin:8px 0 0;color:var(--muted-foreground)}
@media (min-width:768px){
  body{font-size:16px}
  .page{padding:48px var(--gutter-tablet) 48px}
  .card{padding:24px}
  .product{gap:16px}
  .thumb{width:112px;height:112px}
  h1{font-size:18px}
  .price{font-size:20px}
  .estimate,.missing{font-size:28px}
}
@media (min-width:1280px){
  .page{padding-top:72px}
}
`;
