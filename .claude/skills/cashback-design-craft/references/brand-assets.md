# Brand assets (inventory 2026-10-30)

The live brand is **Hoàn Tiền DP**: emerald green, the `logo-mark.webp` tile and a mascot with five
moods. Reuse these; never redraw them.

| Asset | Path | Use |
|---|---|---|
| Logo mark | `web/public/logo-mark.webp` (256x251) | Header mark (36 px tile, radius 12), share page, admin sidebar |
| Full logo | `web/public/logo.webp` (512x512) | Structured data only |
| Favicon | `web/public/favicon.ico` | Browser tab |
| Social image | `web/public/badge-80.webp` (800x754) | og:image, Zalo previews |
| Mascot moods | `web/public/mascot-{happy,shy,peeking,waiting,celebrating}.webp` | Sign in (shy while the password is hidden, peeking when shown, waiting on error, happy otherwise); empty and waiting states; celebrating for a paid order (unused today) |
| Zalo group avatar | `web/public/zalo-group-avatar.jpg` | Zalo community panel |
| Deal photos | `web/public/deals/deal_{beauty,home,tech}_1..4.jpg` | Deals; product thumbnails in mockups. Large files (up to 1 MB): compress before shipping |

Copies for pen.dev live in `docs/design/wireframe/images/`, referenced as `./images/<file>`.

## Brand colour and type

| Role | Value | Source |
|---|---|---|
| Brand / primary | `#059669` (hover `#047857`, deep `#065F46`, soft `#ECFDF5`) | `web/src/index.css`, `share_page.py` |
| Dark mode primary | `#10B981` / `#34D399` | same |
| Live font | Inter | `web/index.html` |
| Brand name | "Hoàn Tiền DP" (`open_brand`); site title "Hoàn Tiền Shopee & TikTok" (`brand`) | `resources/dashboard.vi.json` |
| Voice samples | "Bạn kiểm tra được, không phải tin suông", "Nói trước là điều kiện. Nói sau là bào chữa." | `home_trust_title`, `home_terms_lead` |
