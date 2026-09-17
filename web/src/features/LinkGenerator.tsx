import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Icon } from "@/lib/icons"
import { useT } from "@/lib/labels"

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
    <Card className="overflow-hidden border-2 p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 text-primary grid size-10 place-items-center rounded-xl">
          <Icon.link className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            {t("link_gen_title")}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs sm:text-sm">
            {t("link_gen_lead")}
          </p>
        </div>
      </div>

      <form onSubmit={handleCheck} className="mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("link_gen_placeholder")}
              className="h-12 sm:h-12 text-sm sm:text-base pr-10 rounded-xl"
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
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 p-1"
              >
                <Icon.close className="size-4" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={!url.trim() || loadingPreview}
            className="h-12 sm:h-12 w-full sm:w-auto rounded-xl px-6 font-semibold"
          >
            {loadingPreview ? (
              <>
                <Icon.busy className="size-4 animate-spin" />
                {t("link_gen_checking")}
              </>
            ) : (
              <>
                <Icon.order className="size-4" />
                {t("link_gen_btn_check")}
              </>
            )}
          </Button>
        </div>
      </form>

      {notFound && (
        <div className="bg-destructive/10 text-destructive mt-4 flex items-center gap-2.5 rounded-lg p-3.5 text-sm">
          <Icon.warning className="size-4 shrink-0" />
          <span>{t("link_gen_not_found")}</span>
        </div>
      )}

      {preview && (
        <div className="mt-6 space-y-5 rounded-xl border bg-muted/20 p-5">
          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
              {t("link_gen_product_label")}
            </div>
            <div className="text-base font-semibold leading-snug line-clamp-2">
              {preview.name}
            </div>
            <div className="text-sm font-medium">
              <span className="text-muted-foreground">{t("link_gen_price_label")}: </span>
              <span>{preview.price_formatted}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-y py-3 text-xs sm:text-sm">
            <div>
              <div className="text-muted-foreground">{t("link_gen_shopee_rate")} {preview.shopee_rate}%</div>
              <div className="font-semibold text-foreground">
                {preview.shopee_part_formatted} {preview.is_capped ? t("link_gen_capped") : ""}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("link_gen_seller_rate")} {preview.seller_rate}%</div>
              <div className="font-semibold text-foreground">
                {preview.seller_part_formatted}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
            <div className="text-muted-foreground text-sm font-medium">
              {t("link_gen_cashback_est")}:
            </div>
            <div className="text-success text-2xl sm:text-3xl font-bold">
              {preview.cashback_formatted}
            </div>
          </div>

          {!affiliateUrl && (
            <div className="border-t pt-5 space-y-4">
              {!me && (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Icon.warning className="size-4 text-warning" />
                    {t("link_gen_need_id_alert")}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                    <div className="flex-1">
                      <Input
                        value={customerId}
                        onChange={(e) => setCustomerId(e.target.value)}
                        placeholder={t("link_gen_id_placeholder")}
                        className="h-11 sm:h-11 uppercase font-mono rounded-lg"
                      />
                    </div>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => window.open(ZALO_GROUP_URL, "_blank")}
                      className="h-11 sm:h-11 gap-2 shrink-0 rounded-lg font-medium"
                    >
                      <Icon.chat className="size-4 text-primary" />
                      {t("link_gen_btn_join_zalo")}
                    </Button>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {t("link_gen_id_help")}
                  </div>
                </div>
              )}

              {errorText && (
                <div className="text-destructive text-sm flex items-center gap-1.5 font-medium">
                  <Icon.warning className="size-4" />
                  {errorText}
                </div>
              )}

              <Button
                onClick={handleCreate}
                disabled={converting || (!activeCustomerId && !me)}
                size="lg"
                className="w-full h-12 text-base font-semibold"
              >
                {converting ? (
                  <>
                    <Icon.busy className="size-4 animate-spin" />
                    {t("link_gen_creating")}
                  </>
                ) : (
                  <>
                    <Icon.open className="size-4" />
                    {t("link_gen_btn_create")}
                  </>
                )}
              </Button>
              {converting && (
                <p className="text-muted-foreground text-xs text-center">
                  {t("link_gen_waiting")}
                </p>
              )}
            </div>
          )}

          {affiliateUrl && (
            <div className="border-t pt-5 space-y-4">
              <div className="rounded-lg bg-success/10 border border-success/20 p-4 space-y-3">
                <div className="text-success font-semibold text-sm flex items-center gap-2">
                  <Icon.confirm className="size-5" />
                  {t("link_gen_ready_title")}
                </div>

                <div className="bg-card border rounded-md p-2.5 font-mono text-xs break-all text-muted-foreground">
                  {affiliateUrl}
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    className="flex-1 gap-2"
                  >
                    {copied ? <Icon.confirm className="size-4 text-success" /> : <Icon.copy className="size-4" />}
                    {copied ? t("link_gen_copied") : t("link_gen_copy")}
                  </Button>
                  <Button
                    onClick={() => window.open(affiliateUrl, "_blank")}
                    className="flex-1 gap-2"
                  >
                    <Icon.open className="size-4" />
                    {t("link_gen_buy_now")}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4 space-y-2 text-xs">
                <div className="font-semibold text-foreground">
                  {t("link_gen_guide_title")}
                </div>
                <ul className="space-y-1.5 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <span className="size-1 rounded-full bg-primary" />
                    {t("link_gen_guide_1")}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1 rounded-full bg-primary" />
                    {t("link_gen_guide_2")}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1 rounded-full bg-primary" />
                    {t("link_gen_guide_3")}
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
