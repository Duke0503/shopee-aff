import * as React from "react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Icon } from "@/lib/icons"
import { useT } from "@/lib/labels"

const ZALO_GROUP_URL = "https://zalo.me/g/645qel4gnwism4gagqxh"

export function ZaloCommunityBanner() {
  const t = useT()
  const [qrDataUrl, setQrDataUrl] = React.useState<string>("")
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    QRCode.toDataURL(ZALO_GROUP_URL, {
      margin: 1,
      width: 240,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => {})
  }, [])

  const handleCopy = () => {
    navigator.clipboard.writeText(ZALO_GROUP_URL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="overflow-hidden border-2 bg-gradient-to-br from-card via-card to-primary/5 p-6 sm:p-8 shadow-sm">
      <div className="grid items-center gap-8 md:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-xs font-semibold text-primary">
            <Icon.chat className="size-3.5" />
            {t("zalo_community_badge")}
          </div>

          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
            {t("zalo_community_title")}
          </h2>

          <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
            {t("zalo_community_lead")}
          </p>

          <ul className="space-y-2 text-sm text-foreground/90 font-medium">
            <li className="flex items-center gap-2.5">
              <Icon.confirm className="size-4 text-success shrink-0" />
              <span>{t("zalo_community_step_1")}</span>
            </li>
            <li className="flex items-center gap-2.5">
              <Icon.confirm className="size-4 text-success shrink-0" />
              <span>{t("zalo_community_step_2")}</span>
            </li>
            <li className="flex items-center gap-2.5">
              <Icon.confirm className="size-4 text-success shrink-0" />
              <span>{t("zalo_community_step_3")}</span>
            </li>
          </ul>

          <div className="space-y-3 pt-2">
            <Button
              size="lg"
              className="h-12 w-full sm:w-auto gap-2 text-base font-semibold"
              onClick={() => window.open(ZALO_GROUP_URL, "_blank")}
            >
              <Icon.chat className="size-5" />
              {t("zalo_community_open_btn")}
            </Button>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border bg-background/90 p-2 text-xs">
              <div className="flex items-center gap-2 flex-1 px-1 overflow-hidden">
                <Icon.link className="size-3.5 text-muted-foreground shrink-0" />
                <span className="font-mono text-muted-foreground truncate select-all">
                  {ZALO_GROUP_URL}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="gap-1.5 shrink-0 h-8 text-xs font-medium"
              >
                {copied ? <Icon.confirm className="size-3 text-success" /> : <Icon.copy className="size-3" />}
                {copied ? t("zalo_community_copied_btn") : t("zalo_community_copy_btn")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center">
          <button
            type="button"
            onClick={() => window.open(ZALO_GROUP_URL, "_blank")}
            className="group relative flex flex-col items-center justify-center rounded-2xl border bg-background p-5 text-center shadow-xs transition-all hover:border-primary hover:shadow-md cursor-pointer"
          >
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Zalo Group QR"
                className="size-44 sm:size-48 rounded-xl border p-2 bg-white shadow-xs transition-transform group-hover:scale-105"
              />
            ) : (
              <div className="size-44 sm:size-48 rounded-xl border bg-muted/20 animate-pulse grid place-items-center">
                <Icon.qr className="size-10 text-muted-foreground" />
              </div>
            )}
            <p className="text-muted-foreground group-hover:text-primary mt-3 text-xs max-w-[210px] leading-relaxed transition-colors font-medium">
              {t("zalo_community_qr_hint")}
            </p>
          </button>
        </div>
      </div>
    </Card>
  )
}
