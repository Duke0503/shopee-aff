import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Icon } from "@/lib/icons"
import { useT } from "@/lib/labels"
import { cn } from "@/lib/utils"

interface PreviewData {
  found: boolean
  name?: string
  price?: number
  price_formatted?: string
  shopee_rate?: number
  shopee_part_formatted?: string
  seller_rate?: number
  seller_part_formatted?: string
  commission_formatted?: string
  cashback_formatted?: string
  is_capped?: boolean
}

const ZALO_GROUP_URL = "https://zalo.me/g/645qel4gnwism4gagqxh"

export function LinkGenerator() {
  const t = useT()
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => fetch("/api/me").then((r) => (r.ok ? r.json() : null)),
  })

  const [url, setUrl] = React.useState("")
  const [customerId, setCustomerId] = React.useState("")
  const [loadingPreview, setLoadingPreview] = React.useState(false)
  const [preview, setPreview] = React.useState<PreviewData | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  const [converting, setConverting] = React.useState(false)
  const [affiliateUrl, setAffiliateUrl] = React.useState("")
  const [copied, setCopied] = React.useState(false)
  const [errorText, setErrorText] = React.useState("")

  const activeCustomerId = me?.customer_id || customerId.trim().toUpperCase()

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setLoadingPreview(true)
    setNotFound(false)
    setPreview(null)
    setAffiliateUrl("")
    setErrorText("")

    try {
      const res = await fetch("/api/shopee/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (data.ok && data.found) {
        setPreview(data)
      } else {
        setNotFound(true)
      }
    } catch {
      setNotFound(true)
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleCreate = async () => {
    if (!activeCustomerId) {
      setErrorText(t("link_gen_err_id"))
      return
    }

    setConverting(true)
    setErrorText("")

    try {
      const res = await fetch("/api/shopee/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          customer_id: activeCustomerId,
        }),
      })
      const data = await res.json()
      if (!data.ok) {
        if (data.error === "customer_not_found") {
          setErrorText(t("link_gen_err_id_not_found"))
        } else if (data.error === "rate_limited" || data.error === "web_busy") {
          setErrorText(t("link_gen_err_busy"))
        } else {
          setErrorText(t("link_gen_err_id"))
        }
        setConverting(false)
        return
      }

      if (data.ready && data.affiliate_url) {
        setAffiliateUrl(data.affiliate_url)
        setConverting(false)
      } else if (data.request_id) {
        // Poll for completion
        let tries = 0
        const poll = setInterval(async () => {
          tries += 1
          if (tries > 12) {
            clearInterval(poll)
            setConverting(false)
            return
          }
          try {
            const pollRes = await fetch(`/api/shopee/link-status?request_id=${data.request_id}`)
            const pollData = await pollRes.json()
            if (pollData.ok && pollData.ready && pollData.affiliate_url) {
              setAffiliateUrl(pollData.affiliate_url)
              clearInterval(poll)
              setConverting(false)
            }
          } catch {
            // keep polling
          }
        }, 2000)
      } else {
        setConverting(false)
      }
    } catch {
      setErrorText(t("link_gen_err_id"))
      setConverting(false)
    }
  }

  const handleCopy = () => {
    if (!affiliateUrl) return
    navigator.clipboard.writeText(affiliateUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Raycast / Linear Style Command Capsule */}
      <form onSubmit={handleCheck} className="relative group">
        <div className="command-bar relative flex items-center gap-2 rounded-2xl p-2 sm:p-2.5 transition-all duration-200 focus-within:ring-2 focus-within:ring-foreground/15 focus-within:border-foreground/40 bg-card/90 backdrop-blur-md">
          <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary shrink-0 transition-colors">
            <Icon.link className="size-4.5" />
          </div>

          <div className="relative flex-1 min-w-0">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("link_gen_cmd_placeholder")}
              className={cn(
                "w-full bg-transparent text-sm sm:text-base text-foreground placeholder:text-muted-foreground/70 outline-none border-none py-1.5 pl-1 font-normal tracking-tight",
                url ? "pr-8 sm:pr-9" : "pr-1",
              )}
            />
            {url && (
              <button
                type="button"
                onClick={() => {
                  setUrl("")
                  setPreview(null)
                  setNotFound(false)
                  setAffiliateUrl("")
                }}
                className="absolute right-1 sm:right-1.5 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center rounded-full bg-muted/80 text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-all shrink-0"
                aria-label="Clear link"
              >
                <Icon.close className="size-3.5" />
              </button>
            )}
          </div>

          <Button
            type="submit"
            disabled={!url.trim() || loadingPreview}
            className="h-10 sm:h-11 rounded-xl px-4 sm:px-5 font-semibold text-xs sm:text-sm shrink-0 shadow-xs gap-1.5 active:scale-[0.98]"
          >
            {loadingPreview ? (
              <>
                <Icon.busy className="size-3.5 animate-spin" />
                <span>{t("link_gen_checking")}</span>
              </>
            ) : (
              <>
                <span>{t("link_gen_cmd_btn")}</span>
                <span className="hidden sm:inline-block font-mono text-[11px] opacity-70 bg-primary-foreground/15 px-1.5 py-0.5 rounded text-primary-foreground">
                  ↵
                </span>
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Not found state */}
      {notFound && (
        <div className="mt-3.5 flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs sm:text-sm text-destructive animate-in fade-in slide-in-from-top-2 duration-200">
          <Icon.warning className="size-4.5 shrink-0" />
          <span>{t("link_gen_not_found")}</span>
        </div>
      )}

      {/* Unfolded Financial Receipt Slip (Preview) */}
      {preview && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border/90 bg-card p-5 sm:p-6 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-300 space-y-4.5">
          {/* Product Information */}
          <div className="space-y-1.5 border-b border-border/50 pb-4">
            <div className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
              {t("link_gen_product_label")}
            </div>
            <div className="text-base font-semibold leading-snug line-clamp-2 text-foreground">
              {preview.name}
            </div>
            <div className="text-sm font-medium pt-0.5 flex items-center gap-2">
              <span className="text-muted-foreground">{t("link_gen_price_label")}:</span>
              <span className="font-semibold text-foreground tnum">{preview.price_formatted}</span>
            </div>
          </div>

          {/* Financial Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-1 text-xs sm:text-sm">
            <div className="rounded-xl bg-muted/40 border border-border/40 p-3 flex flex-col justify-between">
              <div className="text-muted-foreground text-xs">{t("link_gen_commission_est")}</div>
              <div className="font-semibold text-foreground mt-1 tnum text-base sm:text-lg">
                {preview.commission_formatted}
              </div>
            </div>
            <div className="rounded-xl bg-success-soft/30 border border-success/30 p-3 flex flex-col justify-between">
              <div className="text-foreground text-xs font-semibold">{t("link_gen_cashback_est")}</div>
              <div className="text-success text-xl sm:text-2xl font-bold tnum tracking-tight mt-0.5">
                {preview.cashback_formatted}
              </div>
            </div>
          </div>

          {/* Transparent Settlement Disclaimer */}
          <p className="text-muted-foreground text-[11px] leading-relaxed italic">
            {t("link_gen_disclaimer")}
          </p>

          {/* Actions / Conversion */}
          {!affiliateUrl && (
            <div className="pt-2 space-y-3.5">
              {!me && (
                <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
                  <div className="text-xs sm:text-sm font-semibold text-foreground flex items-center gap-2">
                    <Icon.warning className="size-4 text-warning" />
                    <span>{t("link_gen_need_id_alert")}</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
                    <Input
                      value={customerId}
                      onChange={(e) => setCustomerId(e.target.value)}
                      placeholder={t("link_gen_id_placeholder")}
                      className="h-10 uppercase font-mono rounded-lg bg-background/90 text-xs sm:text-sm"
                    />
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => window.open(ZALO_GROUP_URL, "_blank")}
                      className="h-10 gap-2 shrink-0 rounded-lg text-xs font-medium"
                    >
                      <Icon.chat className="size-3.5 text-primary" />
                      <span>{t("link_gen_btn_join_zalo")}</span>
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    {t("link_gen_id_help")}
                  </p>
                </div>
              )}

              {errorText && (
                <div className="text-destructive text-xs sm:text-sm flex items-center gap-2 font-medium bg-destructive/10 border border-destructive/20 p-3 rounded-lg">
                  <Icon.warning className="size-4 shrink-0" />
                  <span>{errorText}</span>
                </div>
              )}

              <Button
                onClick={handleCreate}
                disabled={converting || (!activeCustomerId && !me)}
                size="lg"
                className="w-full h-11 sm:h-12 text-sm sm:text-base font-semibold rounded-xl shadow-xs"
              >
                {converting ? (
                  <>
                    <Icon.busy className="size-4 animate-spin" />
                    <span>{t("link_gen_creating")}</span>
                  </>
                ) : (
                  <>
                    <Icon.open className="size-4" />
                    <span>{t("link_gen_btn_create")}</span>
                  </>
                )}
              </Button>
              {converting && (
                <p className="text-muted-foreground text-xs text-center animate-pulse">
                  {t("link_gen_waiting")}
                </p>
              )}
            </div>
          )}

          {affiliateUrl && (
            <div className="pt-2 space-y-3.5">
              <div className="rounded-xl bg-success/10 border border-success/30 p-4 space-y-3">
                <div className="text-success font-semibold text-xs sm:text-sm flex items-center gap-2">
                  <Icon.confirm className="size-4.5" />
                  <span>{t("link_gen_ready_title")}</span>
                </div>

                <div className="bg-background/90 border border-border/80 rounded-lg p-2.5 font-mono text-xs break-all text-muted-foreground select-all">
                  {affiliateUrl}
                </div>

                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    className="flex-1 gap-2 h-10 rounded-lg text-xs sm:text-sm font-medium"
                  >
                    {copied ? <Icon.confirm className="size-4 text-success" /> : <Icon.copy className="size-4" />}
                    <span>{copied ? t("link_gen_copied") : t("link_gen_copy")}</span>
                  </Button>
                  <Button
                    onClick={() => window.open(affiliateUrl, "_blank")}
                    className="flex-1 gap-2 h-10 rounded-lg text-xs sm:text-sm font-semibold"
                  >
                    <Icon.open className="size-4" />
                    <span>{t("link_gen_buy_now")}</span>
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-muted/10 p-3.5 space-y-2 text-xs">
                <div className="font-semibold text-foreground">
                  {t("link_gen_guide_title")}
                </div>
                <ul className="space-y-1.5 text-muted-foreground text-[11px] sm:text-xs">
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-primary shrink-0" />
                    <span>{t("link_gen_guide_1")}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-primary shrink-0" />
                    <span>{t("link_gen_guide_2")}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-primary shrink-0" />
                    <span>{t("link_gen_guide_3")}</span>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
