/**
 * The share page's own CSS (pen.dev vOeyy Android, BRAHc iPhone, E2RWg real browser and u7Gna guest; DESIGN.md
 * money-figure-estimate, estimate-tag, guest-warning), on the custom properties of packages/ui
 * tokens.css. Phone first: one 460 px column on the page background, no card: the brand line, the
 * product picture large and centred with its name, then the soft green cashback box with the
 * amount centred, then the action. Body 15 px, nothing under 12 px, buttons 48 px. Tablet and
 * desktop centre the brand line and add top space. No web font: the fallback stack renders
 * Vietnamese.
 */
export const SHARE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--foreground);font-family:var(--font-family);font-size:15px;line-height:1.5}
.page{max-width:492px;margin:0 auto;padding:16px var(--gutter-phone) 40px}
.top{display:flex;align-items:center;gap:8px;margin:0 0 24px}
.brand{display:flex;align-items:center;gap:10px;margin:0;font-size:16px;font-weight:700}
.brand-mark{display:block;width:28px;height:28px;object-fit:contain}
.product{display:flex;flex-direction:column;gap:8px}
.thumb{display:block;width:160px;height:160px;margin:0 auto 8px;border-radius:var(--rounded-xl);background:var(--muted);object-fit:cover}
h1{margin:0;font-size:18px;font-weight:600;line-height:1.35;text-align:center;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.price{margin:4px 0 0;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.cash{margin:20px 0 0;padding:16px;border-radius:var(--rounded-xl);background:var(--money-soft);color:var(--secondary-foreground)}
.cash-label{margin:0;font-size:15px}
.cash-line{margin:2px 0 0;text-align:center}
.estimate{font-size:32px;font-weight:700;line-height:1.2;letter-spacing:-0.01em;color:var(--money);font-variant-numeric:tabular-nums}
.estimate-tag{font-weight:500}
.missing{font-size:32px;color:var(--muted-foreground)}
.cash-note{margin:4px 0 0;font-size:13px;line-height:1.45}
.rates{margin:10px 0 0;padding:10px 0 0;border-top:1px solid color-mix(in srgb,var(--secondary-foreground) 15%,transparent);list-style:none;font-size:13px}
.rates li{display:flex;justify-content:space-between;gap:12px;padding:2px 0}
.rates span:last-child{flex:none;font-variant-numeric:tabular-nums}
.small{margin:8px 0 0;font-size:13px;line-height:1.45}
.panel{margin:20px 0 0;padding:16px;border-radius:var(--rounded-xl);font-size:15px;line-height:1.45}
.panel strong{display:block;margin:0 0 4px;font-size:17px;line-height:1.35}
.panel p{margin:0}
.guest,.safari{background:var(--warning-soft);color:var(--warning)}
.safari h1{margin:0 0 4px;font-size:17px;font-weight:700;text-align:left}
.guest .btn{display:inline-flex;margin:12px 0 0;width:auto;min-height:var(--touch-target);padding:8px 16px;font-size:15px}
.wait{display:flex;align-items:center;gap:12px;margin:20px 0 0;padding:14px 16px;border:1px solid var(--border);border-radius:var(--rounded-xl);background:var(--card)}
.spinner{flex:none;width:18px;height:18px;border:2px solid var(--money-soft);border-top-color:var(--primary);border-radius:50%;animation:spin 0.9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spinner{animation:none}}
.steps{margin:20px 0 0;padding:0;list-style:none;counter-reset:step}
.steps li{display:flex;align-items:flex-start;gap:12px;margin:0 0 16px;counter-increment:step}
.steps li::before{content:counter(step);flex:none;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--foreground);color:var(--card);font-size:13px;font-weight:700}
.mascot{display:block;height:112px;width:auto;margin:4px auto 0}
.actions{display:grid;gap:8px;margin:20px 0 0}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:10px 16px;border-radius:var(--rounded-xl);border:1px solid transparent;background:var(--primary);color:var(--primary-foreground);font:inherit;font-size:16px;font-weight:600;text-align:center;text-decoration:none;cursor:pointer}
.btn svg,.wait svg{flex:none;width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.btn-outline{background:var(--card);color:var(--foreground);border-color:var(--border)}
.btn:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.status{margin:12px 0 0;font-size:13px;color:var(--muted-foreground)}
.share-url{display:block;margin:8px 0 0;color:var(--muted-foreground);font-size:13px;text-align:center;overflow-wrap:anywhere}
.missing-page{text-align:center}
.missing-page .body{margin:8px 0 0;color:var(--muted-foreground)}
.missing-page .mascot{height:140px;margin:24px auto 16px}
.missing-page h1{font-size:22px;font-weight:700}
@media (min-width:768px){
  body{font-size:16px}
  .page{padding:24px var(--gutter-tablet) 48px}
  .top{justify-content:center;margin-bottom:40px}
  h1{font-size:19px}
}
@media (min-width:1280px){
  .page{padding-top:24px}
}
`;
