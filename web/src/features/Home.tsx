import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Header } from "@/components/Chrome"
import { BrandLogo } from "@/components/BrandLogo"
import { navigate } from "@/routes"
import { vnd } from "@/lib/format"
import { fetchMe } from "@/lib/api"

const ZALO_GROUP_URL = "https://zalo.me/g/645qel4gnwism4gagqxh"


export function Home() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  })

  const [inputUrl, setInputUrl] = React.useState("")
  const [toastMessage, setToastMessage] = React.useState<string | null>(null)
  const [converting, setConverting] = React.useState(false)
  const [convertedData, setConvertedData] = React.useState<{
    affiliateUrl: string
    house: boolean
    name?: string
    priceFormatted?: string
    commissionFormatted?: string
    cashbackFormatted?: string
    ratePercent?: string
    isCapped?: boolean
  } | null>(null)
  const [errorState, setErrorState] = React.useState<{
    type: "web_busy" | "not_in_affiliate" | "invalid_url" | "error"
    message: string
  } | null>(null)
  const [copied, setCopied] = React.useState(false)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  const handlePaste = async () => {
    try {
      if (navigator.clipboard) {
        const text = await navigator.clipboard.readText()
        if (text) {
          setInputUrl(text)
          setConvertedData(null)
          setErrorState(null)
          showToast("Đã dán liên kết từ bộ nhớ tạm!")
          return
        }
      }
    } catch {
      // fallback
    }
    showToast("Vui lòng dùng phím tắt Ctrl+V để dán link.")
  }

  const handleConvert = async (forceCustomerId?: string) => {
    const raw = inputUrl.trim()
    if (!raw) {
      showToast("Vui lòng dán link sản phẩm Shopee hoặc TikTok Shop!")
      return
    }

    setConverting(true)
    setErrorState(null)
    setConvertedData(null)

    // 1. Lấy thông tin thật của sản phẩm từ preview (không dùng số giả)
    let previewInfo: any = null
    try {
      const pRes = await fetch("/api/shopee/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw }),
      })
      const pData = await pRes.json()
      if (pData.ok && pData.found) {
        previewInfo = pData
      }
    } catch {
      // preview không bắt buộc thành công để tiếp tục
    }

    // 2. Chuẩn bị payload: chưa đăng nhập thì KHÔNG gửi customer_id (backend tự gán HOUSE)
    const effectiveCustomerId = forceCustomerId !== undefined ? forceCustomerId : (me?.customer_id || undefined)
    const payload: { url: string; customer_id?: string } = { url: raw }
    if (effectiveCustomerId) {
      payload.customer_id = effectiveCustomerId
    }

    try {
      const res = await fetch("/api/shopee/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        if (res.status === 429 || data.error === "web_busy") {
          setErrorState({
            type: "web_busy",
            message: "Hệ thống web đã đạt giới hạn tạo link mới trong giờ để bảo vệ hạ tầng. Vui lòng vào nhóm Zalo để dán link và lấy link ngay không bị giới hạn!",
          })
          setConverting(false)
          return
        }
        if (data.no_affiliate || data.error === "product_not_in_affiliate") {
          setErrorState({
            type: "not_in_affiliate",
            message: data.message || "Người bán của sản phẩm này hiện không tham gia chương trình tiếp thị liên kết (Affiliate).",
          })
          setConverting(false)
          return
        }
        setErrorState({
          type: "error",
          message: data.message || "Không thể tạo link hoàn tiền cho liên kết này. Vui lòng kiểm tra lại đường link.",
        })
        setConverting(false)
        return
      }

      let affUrl = data.affiliate_url
      const isHouse = Boolean(data.house)

      // Nếu chưa ready ngay thì poll link-status (tối đa 15 lần ~ 22s)
      if (!affUrl && data.request_id) {
        let tries = 0
        const maxTries = 15
        while (tries < maxTries && !affUrl) {
          await new Promise((r) => setTimeout(r, 1500))
          tries++
          try {
            const statusRes = await fetch(`/api/shopee/link-status?request_id=${data.request_id}`)
            const statusData = await statusRes.json()
            if (statusData.failed) {
              setErrorState({
                type: "error",
                message: "Không lấy được link hoàn tiền từ sàn. Bạn hãy thử lại sau ít phút hoặc gửi link vào nhóm Zalo nhé!",
              })
              setConverting(false)
              return
            }
            if (statusData.ok && statusData.ready && statusData.affiliate_url) {
              affUrl = statusData.affiliate_url
              break
            }
          } catch {
            // tiếp tục poll
          }
        }
      }

      if (!affUrl) {
        setErrorState({
          type: "error",
          message: "Hệ thống đang bận tạo link. Vui lòng thử lại hoặc gửi link vào nhóm Zalo để nhận link ngay lập tức!",
        })
        setConverting(false)
        return
      }

      setConvertedData({
        affiliateUrl: affUrl,
        house: isHouse,
        name: previewInfo?.name,
        priceFormatted: previewInfo?.price_formatted || (previewInfo?.price ? vnd(previewInfo.price) : undefined),
        commissionFormatted: previewInfo?.commission_formatted || (previewInfo?.total_commission ? vnd(previewInfo.total_commission) : undefined),
        cashbackFormatted: previewInfo?.cashback_formatted || (previewInfo?.cashback ? vnd(previewInfo.cashback) : undefined),
        ratePercent: previewInfo?.rate_percent || "80%",
        isCapped: previewInfo?.is_capped,
      })

      if (isHouse) {
        showToast("⚠️ Link khách vãng lai đã tạo. Vào nhóm Zalo lấy mã để kích hoạt hoàn 80%!")
      } else {
        showToast("✅ Đã tạo link hoàn tiền 80% cho tài khoản của bạn!")
      }
    } catch {
      setErrorState({
        type: "error",
        message: "Có lỗi kết nối máy chủ. Vui lòng kiểm tra lại kết nối mạng.",
      })
    } finally {
      setConverting(false)
    }
  }

  const handleCopy = (linkToCopy: string, isGuest: boolean) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(linkToCopy)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
    if (isGuest) {
      showToast("Đã sao chép link mua thường (Không nhận hoàn tiền)!")
    } else {
      showToast("Đã sao chép link mua hàng nhận hoàn tiền 80%!")
    }
  }



  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen flex flex-col">
      {/* HEADER: Shared Unified Navigation Bar */}
      <Header current="home" />

      {/* MAIN CONTENT */}
      <main className="w-full pt-14 sm:pt-18 md:pt-20 bg-background flex-1">
        <div className="flex flex-col w-full">
          {/* HERO SECTION - CLEAN MODERN FINTECH */}
          <div className="relative w-full overflow-hidden">
            {/* Ambient Mesh Aura Glow */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[760px] h-[400px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/15 via-emerald-500/5 to-transparent blur-3xl opacity-70" />
              <div className="absolute top-1/4 -right-16 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute top-1/3 -left-16 w-72 h-72 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
            </div>

            {/* HERO SECTION CONTENT & SMART LINK CONVERTER */}
            <section className="relative max-w-7xl mx-auto px-3 sm:px-6 lg:px-12 pt-2 sm:pt-8 pb-8 sm:pb-16 flex flex-col items-center text-center">
              {/* Top Pill Tag */}
              <div className="inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1 sm:py-1.5 rounded-full bg-primary/10 dark:bg-primary/15 border border-primary/20 shadow-2xs backdrop-blur-sm">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[10px] sm:text-xs text-primary font-bold tracking-wider uppercase">
                  MUA SẮM TIẾT KIỆM · HOÀN TIỀN TỰ ĐỘNG 80%
                </span>
              </div>

              {/* Main Dynamic Headline */}
              <h1 className="mt-2.5 sm:mt-5 max-w-4xl text-xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-snug sm:leading-snug text-foreground">
                Dán link Shopee · TikTok Shop
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-400">
                  Nhận lại 80% hoa hồng
                </span>
              </h1>

              {/* Explanatory Subtitle */}
              <p className="mt-1.5 sm:mt-3 max-w-xl text-xs sm:text-base text-muted-foreground leading-relaxed font-normal px-2">
                Chuyển thẳng về tài khoản ngân hàng sau khi đơn giao thành công. Miễn phí 100%, không cần đăng ký.
              </p>

              {/* Smart Link Input Box & Converter Engine */}
              <div className="mt-4 sm:mt-8 w-full max-w-2xl">
                {/* Platform Indicator Badges */}
                <div className="flex items-center justify-center gap-1.5 sm:gap-2 mb-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#ee4d2d]/10 text-[#ee4d2d] text-[10px] sm:text-[11px] font-bold border border-[#ee4d2d]/20">
                    <span className="size-1.5 rounded-full bg-[#ee4d2d]" />
                    Shopee
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-900/10 dark:bg-white/10 text-neutral-900 dark:text-white text-[10px] sm:text-[11px] font-bold border border-neutral-900/20 dark:border-white/20">
                    <span className="size-1.5 rounded-full bg-neutral-900 dark:bg-white" />
                    TikTok Shop
                  </span>
                  <span className="text-[10px] sm:text-[11px] text-muted-foreground">
                    • Hoàn 80% Napas 24/7
                  </span>
                </div>

                {/* Input Card */}
                <div className="p-1 sm:p-2 rounded-2xl bg-card border border-border/80 shadow-lg flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 transition-all focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary/60">
                  <div className="relative flex-1 w-full flex items-center pl-2.5 sm:pl-3.5 pr-1.5">
                    <span className="material-symbols-outlined text-muted-foreground text-lg sm:text-xl flex-shrink-0">
                      link
                    </span>
                    <input
                      type="text"
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="Dán link Shopee hoặc TikTok Shop..."
                      className="w-full bg-transparent px-2 py-2 sm:py-3 text-xs sm:text-base text-foreground placeholder:text-muted-foreground focus:outline-none font-medium min-w-0"
                    />
                    <button
                      type="button"
                      onClick={handlePaste}
                      title="Dán từ bộ nhớ tạm"
                      className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-[11px] sm:text-xs flex items-center gap-1 transition-colors flex-shrink-0 cursor-pointer font-semibold shadow-2xs active:scale-95"
                    >
                      <span className="material-symbols-outlined text-xs sm:text-sm">content_paste</span>
                      <span>Dán</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleConvert()}
                    disabled={converting}
                    className="w-full sm:w-auto px-5 py-2.5 sm:py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs sm:text-base flex items-center justify-center gap-1.5 sm:gap-2 shadow-md transition-all active:scale-95 flex-shrink-0 cursor-pointer font-bold"
                  >
                    {converting ? (
                      <>
                        <span className="material-symbols-outlined text-sm sm:text-base animate-spin">refresh</span>
                        <span>Đang xử lý...</span>
                      </>
                    ) : (
                      <>
                        <span>Lấy Link Hoàn Tiền 80%</span>
                        <span className="material-symbols-outlined text-sm sm:text-base">arrow_forward</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Error Banner (e.g. Web Rate Limit / Not in Affiliate) */}
                {errorState && (
                  <div className="mt-5 p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#131b2e] shadow-2xl border-2 border-amber-400 dark:border-amber-500/60 flex flex-col gap-3.5 text-left">
                    <div className="flex items-start gap-3">
                      <div className="size-10 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-2xl">
                          {errorState.type === "web_busy" ? "schedule" : "error"}
                        </span>
                      </div>
                      <div>
                        <h4 className="font-bold text-base text-slate-900 dark:text-white">
                          {errorState.type === "web_busy" ? "Hệ thống web đã đạt giới hạn tạo link mới" : "Thông báo tạo link"}
                        </h4>
                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                          {errorState.message}
                        </p>
                      </div>
                    </div>
                    {errorState.type === "web_busy" && (
                      <div className="pt-2 flex flex-wrap items-center gap-3">
                        <a
                          href={ZALO_GROUP_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="px-5 py-3 rounded-xl bg-[#0068ff] hover:bg-[#0057d9] text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-md hover:shadow-lg transition-all cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-lg">groups</span>
                          <span>👉 Vào Nhóm Zalo Lấy Link Ngay (Không Giới Hạn)</span>
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* DUAL-STATE RESULT CARD: SOLID, HIGH-CONTRAST & ULTRA-CLEAR */}
                {convertedData && (
                  convertedData.house ? (
                    /* STATE 1: GUEST / KHÁCH VÃNG LAI (HOUSE ACCOUNT) */
                    <div className="mt-5 p-5 sm:p-7 rounded-2xl bg-white dark:bg-[#131b2e] shadow-2xl border-2 border-amber-400 dark:border-amber-500/60 flex flex-col gap-4 text-left">
                      {/* Alert banner if user just logged in */}
                      {me && (
                        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-xs text-slate-800 dark:text-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-lg shrink-0">account_circle</span>
                            <span>
                              Bạn đã đăng nhập: <strong className="text-slate-900 dark:text-white">{me.display_name || me.customer_code || me.customer_id}</strong>! Link dưới đây vẫn là link vãng lai (không hoàn tiền).
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleConvert(me.customer_id)}
                            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shrink-0 cursor-pointer shadow-xs transition-transform active:scale-95"
                          >
                            Tạo lại link cho tài khoản của tôi
                          </button>
                        </div>
                      )}

                      {/* Header badge & title */}
                      <div className="flex items-start gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4">
                        <div className="size-11 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                          <span className="material-symbols-outlined text-2xl font-bold">warning</span>
                        </div>
                        <div className="flex flex-col">
                          <div className="inline-flex items-center gap-1.5 w-fit px-2.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 font-bold text-[11px] uppercase tracking-wider">
                            Chế độ khách vãng lai
                          </div>
                          <h4 className="font-extrabold text-base sm:text-lg text-slate-900 dark:text-white mt-1.5 leading-snug">
                            Link này mua được nhưng CHƯA ĐƯỢC TÍCH LŨY HOÀN TIỀN CHO BẠN
                          </h4>
                        </div>
                      </div>

                      {/* Warning text & real product breakdown */}
                      <div className="space-y-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        <p>
                          Vì bạn chưa đăng nhập tài khoản Zalo, hệ thống chưa có thông tin STK ngân hàng để chuyển khoản 80% hoa hồng cho bạn. Đơn mua lúc này sẽ không được tính hoàn tiền và <strong className="text-slate-900 dark:text-white font-semibold">không thể liên kết lại sau khi mua</strong>.
                        </p>

                        {convertedData.name && (
                          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0c1322] border border-slate-200/80 dark:border-slate-800 text-xs sm:text-sm">
                            <div className="font-bold text-slate-900 dark:text-white line-clamp-1">
                              📦 {convertedData.name}
                            </div>
                            {convertedData.priceFormatted && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-400 text-xs">
                                <span>Giá: <strong className="text-slate-900 dark:text-white tnum">{convertedData.priceFormatted}</strong></span>
                                {convertedData.cashbackFormatted && (
                                  <span>• Khoản hoàn bạn đang bỏ lỡ: <strong className="text-amber-600 dark:text-amber-400 font-bold text-sm tnum">+{convertedData.cashbackFormatted}</strong></span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Primary Actions: Join Zalo for ID or Login */}
                      <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <a
                          href={ZALO_GROUP_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 px-5 py-3.5 rounded-xl bg-[#0068ff] hover:bg-[#0057d9] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-transform active:scale-95 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-lg">groups</span>
                          <span>👉 Vào Nhóm Zalo Lấy Mã Đăng Nhập (/id &amp; /matkhau)</span>
                        </a>

                        <button
                          type="button"
                          onClick={() => navigate("login")}
                          className="px-5 py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs sm:text-sm border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                        >
                          Đã có mã? Đăng Nhập
                        </button>
                      </div>

                      {/* Subtle Secondary: Copy plain link without cashback */}
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 dark:text-slate-400">Nếu bạn vẫn muốn mua ngay không cần nhận lại tiền hoàn:</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(convertedData.affiliateUrl, true)}
                          className="text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">{copied ? "done" : "content_copy"}</span>
                          <span>{copied ? "Đã sao chép link thường!" : "Sao chép link mua thường"}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* STATE 2: AUTHENTICATED USER (TIED TO ME.CUSTOMER_ID) */
                    <div className="mt-5 p-5 sm:p-7 rounded-2xl bg-white dark:bg-[#131b2e] shadow-2xl border-2 border-emerald-500 dark:border-emerald-500/70 flex flex-col gap-4 text-left">
                      {/* Header badge & title */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4">
                        <div className="flex items-start gap-3">
                          <div className="size-11 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="material-symbols-outlined text-2xl font-bold">check_circle</span>
                          </div>
                          <div>
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 font-bold text-[11px] uppercase tracking-wider">
                              Đã kích hoạt hoàn 80%
                            </div>
                            <h4 className="font-extrabold text-base sm:text-lg text-slate-900 dark:text-white mt-1.5 leading-snug">
                              Link hoàn tiền gắn với tài khoản của bạn đã sẵn sàng!
                            </h4>
                          </div>
                        </div>
                        <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 font-medium sm:text-right shrink-0">
                          Tài khoản: <strong className="text-emerald-600 dark:text-emerald-400">{me?.display_name || me?.customer_code || me?.customer_id}</strong>
                        </div>
                      </div>

                      {/* Real Product & Cashback Breakdown */}
                      <div className="space-y-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        {convertedData.name && (
                          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0c1322] border border-slate-200/80 dark:border-slate-800">
                            <div className="font-bold text-slate-900 dark:text-white line-clamp-1">
                              📦 {convertedData.name}
                            </div>
                            {convertedData.priceFormatted && (
                              <div className="mt-1 flex items-center gap-3 text-slate-600 dark:text-slate-400 text-xs">
                                <span>Giá: <strong className="text-slate-900 dark:text-white tnum">{convertedData.priceFormatted}</strong></span>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-3">
                          {convertedData.cashbackFormatted ? (
                            <span className="text-sm">
                              • Ước tính nhận về:{" "}
                              <strong className="text-emerald-600 dark:text-emerald-400 font-black text-lg sm:text-xl tnum">
                                +{convertedData.cashbackFormatted}
                              </strong>{" "}
                              tiền mặt ({convertedData.ratePercent} hoa hồng{convertedData.commissionFormatted ? ` sàn: ${convertedData.commissionFormatted}` : ""})
                            </span>
                          ) : (
                            <span className="text-sm">• Áp dụng tỷ lệ hoàn tiền: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">80%</strong> hoa hồng sàn</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          💡 Đơn hàng từ link này sẽ tự động ghi nhận vào ví của bạn. Sau khi nhận hàng thành công, bot Zalo sẽ báo tin nhắn ting ting và tự động chuyển khoản về STK ngân hàng 24/7.
                        </p>
                      </div>

                      {/* Main Action: Copy Link */}
                      <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleCopy(convertedData.affiliateUrl, false)}
                          className="w-full px-6 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transition-transform active:scale-95 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-xl">{copied ? "done" : "content_copy"}</span>
                          <span>{copied ? "Đã Sao Chép Link!" : "👉 Sao Chép Link Mua Hàng Nhận Hoàn Tiền 80%"}</span>
                        </button>
                      </div>
                    </div>
                  )
                )}

                {/* 3 Cohesive Trust Badges (Modern SaaS Pill Design) */}
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 text-xs">
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-secondary/70 dark:bg-card border border-border/80 text-foreground font-medium shadow-2xs">
                    <span className="material-symbols-outlined text-emerald-500 text-base">verified</span>
                    <span>Áp dụng Shopee &amp; TikTok Shop</span>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-secondary/70 dark:bg-card border border-border/80 text-foreground font-medium shadow-2xs">
                    <span className="material-symbols-outlined text-emerald-500 text-base">bolt</span>
                    <span>Chuyển khoản tự động 24/7</span>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-secondary/70 dark:bg-card border border-border/80 text-foreground font-medium shadow-2xs">
                    <span className="material-symbols-outlined text-emerald-500 text-base">savings</span>
                    <span>0đ phí duy trì trọn đời</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* HOW IT WORKS: 3 SIMPLE STEPS */}
          <section className="w-full bg-surface-container-low py-16">
            <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col items-center">
              <div className="text-center max-w-2xl mb-12">
                <span className="font-label-md text-label-md font-bold text-primary uppercase tracking-widest">
                  Tiết Kiệm Thông Minh
                </span>
                <h2 className="mt-2 font-headline-lg text-headline-lg text-on-surface tracking-tight">
                  Quy trình 3 bước nhận tiền hoàn đơn giản
                </h2>
                <p className="mt-3 font-body-md text-body-md text-on-surface-variant">
                  Chỉ mất chưa đầy 30 giây để kích hoạt tính năng hoàn tiền cho mọi đơn hàng của bạn.
                </p>
              </div>

              {/* 3 Bento Cards with Consistent Styling */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
                {/* Step 1 */}
                <div className="relative bg-surface-container-lowest p-7 sm:p-8 rounded-2xl shadow-xs hover:shadow-md transition-all border border-border/60 hover:border-primary/40 flex flex-col justify-between group">
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <div className="w-13 h-13 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                        <span className="material-symbols-outlined text-2xl">content_copy</span>
                      </div>
                      <span className="font-headline-sm text-headline-sm text-outline-variant font-extrabold tracking-widest tnum">
                        01
                      </span>
                    </div>
                    <span className="font-label-md text-label-md text-primary font-bold uppercase tracking-wider">
                      Bước 1
                    </span>
                    <h3 className="mt-1 font-headline-sm text-headline-sm text-on-surface font-bold">
                      Copy link sản phẩm
                    </h3>
                    <p className="mt-3 font-body-md text-body-md text-on-surface-variant leading-relaxed">
                      Sao chép link từ ứng dụng Shopee hoặc TikTok Shop món hàng bạn muốn mua như bình thường.
                    </p>
                  </div>
                  <div className="mt-8 pt-4 border-t border-border/40 flex items-center gap-2 text-on-surface-variant font-label-sm text-label-sm">
                    <span className="material-symbols-outlined text-base text-primary">bolt</span>
                    <span>Hỗ trợ mọi link sản phẩm chính hãng</span>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="relative bg-surface-container-lowest p-7 sm:p-8 rounded-2xl shadow-xs hover:shadow-md transition-all border border-border/60 hover:border-primary/40 flex flex-col justify-between group">
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <div className="w-13 h-13 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                        <span className="material-symbols-outlined text-2xl">add_link</span>
                      </div>
                      <span className="font-headline-sm text-headline-sm text-outline-variant font-extrabold tracking-widest tnum">
                        02
                      </span>
                    </div>
                    <span className="font-label-md text-label-md text-primary font-bold uppercase tracking-wider">
                      Bước 2
                    </span>
                    <h3 className="mt-1 font-headline-sm text-headline-sm text-on-surface font-bold">
                      Dán link lấy mã hoàn tiền
                    </h3>
                    <p className="mt-3 font-body-md text-body-md text-on-surface-variant leading-relaxed">
                      Dán vào Hoàn Tiền DP để nhận link mua hàng tích hợp mã hoàn 80% và bấm mở mua hàng.
                    </p>
                  </div>
                  <div className="mt-8 pt-4 border-t border-border/40 flex items-center gap-2 text-on-surface-variant font-label-sm text-label-sm">
                    <span className="material-symbols-outlined text-base text-primary">lock_open</span>
                    <span>Không yêu cầu cung cấp mật khẩu</span>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="relative bg-surface-container-lowest p-7 sm:p-8 rounded-2xl shadow-xs hover:shadow-md transition-all border border-border/60 hover:border-primary/40 flex flex-col justify-between group">
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <div className="w-13 h-13 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                        <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
                      </div>
                      <span className="font-headline-sm text-headline-sm text-outline-variant font-extrabold tracking-widest tnum">
                        03
                      </span>
                    </div>
                    <span className="font-label-md text-label-md text-primary font-bold uppercase tracking-wider">
                      Bước 3
                    </span>
                    <h3 className="mt-1 font-headline-sm text-headline-sm text-on-surface font-bold">
                      Nhận thông báo Zalo &amp; Tiền về STK
                    </h3>
                    <p className="mt-3 font-body-md text-body-md text-on-surface-variant leading-relaxed">
                      Sau khi nhận hàng thành công, bot Zalo gửi tin nhắn ting ting và tự động chuyển 80% hoa hồng về STK ngân hàng 24/7.
                    </p>
                  </div>
                  <div className="mt-8 pt-4 border-t border-border/40 flex items-center gap-2 text-primary font-label-sm text-label-sm font-bold">
                    <span className="material-symbols-outlined text-base">verified</span>
                    <span>Chuyển tiền tự động Napas 24/7 tức thì</span>
                  </div>
                </div>
              </div>
            </div>
          </section>



          {/* LIVE SIMULATION & STATS BENTO */}
          <section className="w-full bg-surface-container-low py-16">
            <div className="max-w-7xl mx-auto px-6 lg:px-12">
              <div className="p-8 lg:p-12 rounded-3xl bg-surface-container-lowest shadow-md flex flex-col lg:flex-row items-center justify-between gap-10 border border-border/30">
                <div className="max-w-xl">
                  <div className="flex items-center gap-3">
                    <span className="p-2.5 rounded-xl bg-primary-fixed text-primary flex items-center justify-center">
                      <span className="material-symbols-outlined text-2xl font-bold">verified_user</span>
                    </span>
                    <span className="font-label-lg text-label-lg text-primary font-bold uppercase tracking-wider">
                      Minh Bạch Tuyệt Đối
                    </span>
                  </div>
                  <h2 className="mt-4 font-headline-lg text-headline-lg text-on-surface tracking-tight">
                    Cách Hoàn Tiền DP tính toán khoản tiền hoàn của bạn
                  </h2>
                  <p className="mt-3 font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
                    Chúng tôi giữ lại 20% phí duy trì máy chủ hạ tầng và giải ngân đến{" "}
                    <span className="font-bold text-on-surface">80% toàn bộ hoa hồng</span> sàn affiliate chi trả trực tiếp vào tài khoản ngân hàng của bạn.
                  </p>
                  <div className="mt-8 space-y-4">
                    <div className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-primary text-xl flex-shrink-0 mt-0.5">
                        check_circle
                      </span>
                      <p className="font-body-md text-body-md text-on-surface">
                        Tra cứu mã đơn hàng trực tiếp bằng mã vận đơn hoặc link đơn Shopee/TikTok.
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-primary text-xl flex-shrink-0 mt-0.5">
                        check_circle
                      </span>
                      <p className="font-body-md text-body-md text-on-surface">
                        Rút tiền từ 10.000đ về bất kỳ ngân hàng nào thuộc hệ thống Napas 24/7 không tính phí.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right Visual: Clean Fintech Split Calculator Metric */}
                <div className="w-full lg:w-[460px] bg-surface-container p-6 rounded-2xl flex flex-col gap-5 border border-border/30">
                  <span className="font-label-md text-label-md text-on-surface font-bold uppercase tracking-wider">
                    Cơ chế phân bổ hoa hồng
                  </span>
                  <div className="w-full h-4 rounded-full bg-surface-container-high flex overflow-hidden">
                    <div className="h-full bg-primary rounded-l-full" style={{ width: "80%" }}></div>
                    <div className="h-full bg-surface-container-highest" style={{ width: "20%" }}></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm flex flex-col">
                      <span className="font-label-sm text-label-sm text-primary font-bold uppercase">
                        Bạn Nhận Được
                      </span>
                      <span className="font-display-lg text-display-lg text-primary font-black mt-1">
                        80%
                      </span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant mt-1">
                        Chuyển STK ngân hàng
                      </span>
                    </div>
                    <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm flex flex-col">
                      <span className="font-label-sm text-label-sm text-on-surface-variant font-bold uppercase">
                        Phí Vận Hành DP
                      </span>
                      <span className="font-display-lg text-display-lg text-on-surface-variant font-black mt-1">
                        20%
                      </span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant mt-1">
                        Duy trì server &amp; bot 24/7
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-outline font-label-sm text-label-sm">
                    <span className="material-symbols-outlined text-base">lock</span>
                    <span>Bảo chứng bởi tiêu chuẩn bảo mật dữ liệu SSL 256-bit</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* COMMUNITY ZALO CARD (REDESIGNED: NO FAKE QR, 100% DIRECT 1-CLICK ACTION) */}
          <section id="zalo-community" className="w-full py-16 sm:py-20 bg-background">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12">
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0068ff]/8 via-surface-container-lowest to-emerald-500/5 p-8 sm:p-12 lg:p-14 border border-[#0068ff]/25 shadow-xl flex flex-col lg:flex-row items-center justify-between gap-10">
                {/* Subtle Decorative Ambient Background Glows */}
                <div className="absolute -top-24 -left-24 w-80 h-80 bg-[#0068ff]/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -right-24 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

                {/* Left Side: Value Proposition & Guarantees */}
                <div className="relative z-10 flex-1 max-w-2xl">
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0068ff]/10 text-[#0068ff] font-label-sm text-label-sm font-bold uppercase tracking-wider mb-4 border border-[#0068ff]/20">
                    <span className="material-symbols-outlined text-base">forum</span>
                    <span>Cộng Đồng Thành Viên Zalo 1:1</span>
                  </div>
                  <h2 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
                    Gia nhập nhóm Zalo để nhận hoàn tiền 80%
                  </h2>
                  <p className="mt-4 font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
                    Hơn 50 thành viên thật đang trao đổi kinh nghiệm săn sale, chia sẻ voucher ẩn và đối soát tiền hoàn minh bạch mỗi ngày. Chỉ cần vào nhóm, Admin sẽ cấp ngay mã định danh DP cho riêng bạn.
                  </p>

                  {/* 3 Pillars of Trust */}
                  <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 rounded-2xl bg-surface-container-lowest border border-border/50 shadow-xs flex flex-col gap-1.5">
                      <div className="size-9 rounded-xl bg-[#0068ff]/10 text-[#0068ff] flex items-center justify-center">
                        <span className="material-symbols-outlined text-xl">support_agent</span>
                      </div>
                      <span className="font-label-md text-label-md font-bold text-on-surface">Admin hỗ trợ 1:1</span>
                      <span className="text-xs text-on-surface-variant">Kiểm tra đơn hàng bị sót và giải ngân trực tiếp</span>
                    </div>

                    <div className="p-4 rounded-2xl bg-surface-container-lowest border border-border/50 shadow-xs flex flex-col gap-1.5">
                      <div className="size-9 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                        <span className="material-symbols-outlined text-xl">bolt</span>
                      </div>
                      <span className="font-label-md text-label-md font-bold text-on-surface">Chuyển khoản 24/7</span>
                      <span className="text-xs text-on-surface-variant">Tự động nhận tiền qua Napas247 tức thì</span>
                    </div>

                    <div className="p-4 rounded-2xl bg-surface-container-lowest border border-border/50 shadow-xs flex flex-col gap-1.5">
                      <div className="size-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                        <span className="material-symbols-outlined text-xl">notifications_active</span>
                      </div>
                      <span className="font-label-md text-label-md font-bold text-on-surface">Báo đơn tự động</span>
                      <span className="text-xs text-on-surface-variant">Nhận tin nhắn Zalo riêng ngay khi có đơn mới</span>
                    </div>
                  </div>
                </div>

                {/* Right Side: High-Conversion Direct Action Card */}
                <div className="relative z-10 w-full lg:w-96 flex-shrink-0 bg-surface-container-lowest p-6 sm:p-7 rounded-2xl shadow-xl border border-border/60 flex flex-col items-center text-center">
                  {/* Community Header Indicator */}
                  <div className="w-full flex items-center justify-between pb-4 mb-5 border-b border-border/40">
                    <div className="flex items-center gap-2">
                      <span className="relative flex size-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full size-2.5 bg-emerald-500"></span>
                      </span>
                      <span className="text-xs font-bold text-emerald-600">Đang hoạt động</span>
                    </div>
                    <span className="text-xs font-semibold text-on-surface-variant">50 thành viên</span>
                  </div>

                  {/* Real Zalo Group Avatar */}
                  <div className="relative mb-3 group">
                    <div className="size-24 rounded-2xl overflow-hidden shadow-lg border-2 border-white ring-2 ring-[#0068ff]/30 bg-[#0068ff]/5 flex items-center justify-center transition-transform group-hover:scale-105 duration-300">
                      <img
                        src="/zalo-group-avatar.jpg"
                        alt="Avatar nhóm Zalo Hoàn Tiền Shopee"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {/* Official Zalo badge */}
                    <div className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full bg-[#0068ff] text-white flex items-center justify-center shadow-md ring-2 ring-white text-[10px] font-black tracking-tight">
                      Zalo
                    </div>
                  </div>

                  <h3 className="font-headline-sm text-headline-sm text-on-surface font-extrabold flex items-center justify-center gap-1.5">
                    <span>Hoàn Tiền Shopee</span>
                    <span className="material-symbols-outlined text-[#0068ff] text-xl fill-1" title="Nhóm chính thức">verified</span>
                  </h3>
                  <p className="mt-1 text-xs text-on-surface-variant leading-relaxed max-w-[280px]">
                    Nhóm Zalo hỗ trợ chính thức • Nhận mã DP cá nhân &amp; đối soát hoàn tiền 1:1
                  </p>

                  {/* Primary 1-Click Action Button */}
                  <a
                    href={ZALO_GROUP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-6 w-full py-4 rounded-xl bg-[#0068ff] hover:bg-[#0057d9] text-white font-bold text-sm sm:text-base transition-all shadow-lg hover:shadow-[0_8px_25px_rgba(0,104,255,0.4)] flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                  >
                    <span>Tham Gia Nhóm Zalo Ngay</span>
                    <span className="material-symbols-outlined text-lg">arrow_forward</span>
                  </a>

                  {/* 2-Step Onboarding Instruction */}
                  <div className="mt-5 w-full p-3.5 rounded-xl bg-surface-container-low/70 border border-border/30 text-left flex flex-col gap-2">
                    <div className="flex items-start gap-2 text-xs text-on-surface">
                      <span className="size-4 rounded-full bg-[#0068ff] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                      <span>Vào nhóm và xem các đơn hoàn tiền mới nhất</span>
                    </div>
                    <div className="flex items-start gap-2 text-xs text-on-surface">
                      <span className="size-4 rounded-full bg-[#0068ff] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                      <span>Nhắn tin cho Admin cú pháp <strong className="font-mono text-primary font-bold">/id</strong> để lấy mã cá nhân</span>
                    </div>
                  </div>

                  <span className="mt-4 text-[11px] text-on-surface-variant font-medium">
                    100% Miễn phí tham gia • Bảo mật thông tin thành viên
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* FOOTER: Clean SaaS / FinTech Structure without Fake Bank Partnerships */}
      <footer className="w-full bg-surface-container-lowest pt-16 pb-12 shadow-[0_-1px_12px_rgba(0,0,0,0.03)] border-t border-border/50">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col gap-12">
          {/* Main 4-column footer content */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-12">
            {/* Col 1: Brand Info (2 spans on desktop) */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <BrandLogo className="size-10 rounded-xl" />
                <span className="font-headline-sm text-headline-sm font-bold text-on-surface tracking-tight">
                  Hoàn Tiền DP
                </span>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed max-w-sm">
                Nền tảng mua sắm hoàn tiền tự động 80% hoa hồng tiếp thị liên kết từ Shopee &amp; TikTok Shop. Minh bạch trong từng đơn hàng và chuyển tiền trực tiếp về tài khoản ngân hàng của bạn.
              </p>
              <div className="inline-flex items-center gap-2 text-xs text-primary font-semibold">
                <span className="size-2 rounded-full bg-primary" />
                <span>Hệ thống đối soát &amp; chuyển khoản tự động 24/7</span>
              </div>
            </div>

            {/* Col 2: Navigation & Tools */}
            <div className="flex flex-col gap-3">
              <span className="font-label-md text-label-md font-bold uppercase tracking-wider text-on-surface">
                Tiện ích &amp; Hướng dẫn
              </span>
              <div className="flex flex-col gap-2.5 text-sm text-on-surface-variant">
                <button onClick={() => navigate("guide")} className="hover:text-primary transition-colors text-left cursor-pointer">
                  Quy trình 3 bước nhận tiền
                </button>
                <button onClick={() => navigate("guide")} className="hover:text-primary transition-colors text-left cursor-pointer">
                  Cơ chế tính hoa hồng 80%
                </button>
                <button onClick={() => navigate("orders")} className="hover:text-primary transition-colors text-left cursor-pointer">
                  Tra cứu đơn hàng của tôi
                </button>
                <button onClick={() => navigate("guide")} className="hover:text-primary transition-colors text-left cursor-pointer">
                  Câu hỏi thường gặp (FAQ)
                </button>
              </div>
            </div>

            {/* Col 3: Policy & Transparency */}
            <div className="flex flex-col gap-3">
              <span className="font-label-md text-label-md font-bold uppercase tracking-wider text-on-surface">
                Minh bạch tài chính
              </span>
              <div className="flex flex-col gap-2.5 text-sm text-on-surface-variant">
                <button onClick={() => navigate("guide")} className="hover:text-primary transition-colors text-left cursor-pointer">
                  Cơ chế phân bổ 80 : 20
                </button>
                <button onClick={() => navigate("guide")} className="hover:text-primary transition-colors text-left cursor-pointer">
                  Thời gian sàn đối soát
                </button>
                <button onClick={() => navigate("guide")} className="hover:text-primary transition-colors text-left cursor-pointer">
                  Điều kiện đơn hợp lệ
                </button>
                <button onClick={() => navigate("guide")} className="hover:text-primary transition-colors text-left cursor-pointer">
                  Cam kết bảo mật tài khoản
                </button>
              </div>
            </div>

            {/* Col 4: Community & Support */}
            <div className="flex flex-col gap-3">
              <span className="font-label-md text-label-md font-bold uppercase tracking-wider text-on-surface">
                Hỗ trợ &amp; Cộng đồng
              </span>
              <div className="flex flex-col gap-2.5 text-sm text-on-surface-variant">
                <a
                  href={ZALO_GROUP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-primary transition-colors inline-flex items-center gap-1.5 cursor-pointer font-medium text-primary"
                >
                  <span className="material-symbols-outlined text-base">groups</span>
                  <span>Nhóm Zalo hỗ trợ 1:1</span>
                </a>
                <span className="text-xs text-on-surface-variant">
                  Nhắn tin riêng Admin: gõ <strong className="text-on-surface font-mono">/id</strong> để lấy mã khách hàng
                </span>
                <span className="text-xs text-on-surface-variant">
                  Thời gian hỗ trợ: 24/7 trực tuyến
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Copyright & Legal Links */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-border/50 text-xs text-on-surface-variant">
            <span>© 2025 Hoàn Tiền DP (hoantiendp.com) · Dịch vụ tiếp thị liên kết Shopee &amp; TikTok Shop độc lập.</span>
            <div className="flex items-center gap-6">
              <button onClick={() => navigate("guide")} className="hover:text-primary transition-colors cursor-pointer">
                Điều khoản dịch vụ
              </button>
              <button onClick={() => navigate("guide")} className="hover:text-primary transition-colors cursor-pointer">
                Chính sách bảo mật
              </button>
              <button onClick={() => navigate("guide")} className="hover:text-primary transition-colors cursor-pointer">
                Quy chế hoạt động
              </button>
            </div>
          </div>
        </div>
      </footer>

      {/* FLOATING STICKY ZALO COMMUNITY BUTTON (Desktop only) */}
      <a
        href={ZALO_GROUP_URL}
        target="_blank"
        rel="noreferrer"
        className="hidden md:flex fixed bottom-6 right-6 z-40 group items-center gap-2 px-4 py-2.5 rounded-full bg-[#0068ff] hover:bg-[#0057d9] text-white font-bold text-xs shadow-2xl hover:shadow-[0_8px_25px_rgba(0,104,255,0.45)] transition-all transform hover:-translate-y-0.5 active:scale-95 cursor-pointer border-2 border-white/20"
        title="Tham gia nhóm Zalo Hoàn Tiền DP"
      >
        <span className="relative flex size-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
          <span className="relative inline-flex rounded-full size-2.5 bg-emerald-300"></span>
        </span>
        <span className="material-symbols-outlined text-lg">groups</span>
        <span>Nhóm Zalo Nhận Tiền 24/7</span>
      </a>

      {/* QUICK TOAST NOTIFICATION */}
      <div
        className={`fixed bottom-6 right-6 z-50 bg-inverse-surface text-inverse-on-surface px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 transition-all duration-300 pointer-events-none ${
          toastMessage ? "translate-y-0 opacity-100" : "translate-y-24 opacity-0"
        }`}
      >
        <span className="material-symbols-outlined text-primary-fixed">check_circle</span>
        <span className="font-body-md-medium text-body-md-medium">{toastMessage}</span>
      </div>
    </div>
  )
}
