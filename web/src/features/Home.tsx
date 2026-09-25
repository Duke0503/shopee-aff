import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Header } from "@/components/Chrome"
import { BrandLogo } from "@/components/BrandLogo"
import { navigate } from "@/routes"
import { vnd } from "@/lib/format"
import { fetchMe } from "@/lib/api"

const ZALO_GROUP_URL = "https://zalo.me/g/645qel4gnwism4gagqxh"

interface Deal {
  id: string
  name: string
  category: "all" | "tech" | "home" | "beauty"
  platform: "Shopee Mall" | "TikTok Shop"
  originalPrice: number
  salePrice: number
  cashback: number
  image: string
  url: string
}

const DEFAULT_DEALS: Deal[] = [
  // TECH
  {
    id: "deal_tech_1",
    name: "Bàn phím cơ RAINY75 Kết Nối 3 Mode, Full Nhôm CNC",
    category: "tech",
    platform: "Shopee Mall",
    originalPrice: 3200000,
    salePrice: 2800000,
    cashback: 227891,
    image: "/deals/deal_tech_1.jpg",
    url: "https://shopee.vn/product/201936061/25122217191",
  },
  {
    id: "deal_tech_2",
    name: "Tai nghe không dây Soundcore Liberty 5 Pro | Trợ lý AI",
    category: "tech",
    platform: "Shopee Mall",
    originalPrice: 4990000,
    salePrice: 4400000,
    cashback: 122491,
    image: "/deals/deal_tech_2.jpg",
    url: "https://shopee.vn/product/88231940/47212312754",
  },
  {
    id: "deal_tech_3",
    name: "Đồng hồ nam dây kim loại CASIO A158WA-1DF Vintage",
    category: "tech",
    platform: "Shopee Mall",
    originalPrice: 1250000,
    salePrice: 932880,
    cashback: 55061,
    image: "/deals/deal_tech_3.jpg",
    url: "https://shopee.vn/product/134786926/2087297602",
  },
  {
    id: "deal_tech_4",
    name: "Chuột không dây Gaming Dareu A918X Dual Mode Siêu Bền",
    category: "tech",
    platform: "Shopee Mall",
    originalPrice: 590000,
    salePrice: 465000,
    cashback: 41394,
    image: "/deals/deal_tech_4.jpg",
    url: "https://shopee.vn/product/201936061/21212284157",
  },
  // HOME
  {
    id: "deal_home_1",
    name: "[Shopee Mall] Bộ nồi chảo Tefal Cook Healthy 4 món chính hãng",
    category: "home",
    platform: "Shopee Mall",
    originalPrice: 1650000,
    salePrice: 1102000,
    cashback: 88160,
    image: "/deals/deal_home_1.jpg",
    url: "https://shopee.vn/product/1112014650/46266267207",
  },
  {
    id: "deal_home_2",
    name: "Ghế xếp thư giãn cao cấp Deli Boss QUI PHÚC Lưới Thoáng",
    category: "home",
    platform: "Shopee Mall",
    originalPrice: 1350000,
    salePrice: 950300,
    cashback: 94747,
    image: "/deals/deal_home_2.jpg",
    url: "https://shopee.vn/product/645415440/11984543680",
  },
  {
    id: "deal_home_3",
    name: "Combo 2 Thùng 24 hộp Sữa bột pha sẵn Grow Plus Nutifood",
    category: "home",
    platform: "Shopee Mall",
    originalPrice: 1580000,
    salePrice: 1356000,
    cashback: 105742,
    image: "/deals/deal_home_3.jpg",
    url: "https://shopee.vn/product/12948572/46051206534",
  },
  {
    id: "deal_home_4",
    name: "Sữa Bột Nguyên Kem A2 Organic Arla Đan Mạch 800g",
    category: "home",
    platform: "Shopee Mall",
    originalPrice: 820000,
    salePrice: 695000,
    cashback: 29697,
    image: "/deals/deal_home_4.jpg",
    url: "https://shopee.vn/product/80867946/54811538428",
  },
  // BEAUTY & FASHION
  {
    id: "deal_beauty_1",
    name: "Wilson Pleat Flow Dress 2.0 Váy Thể Thao Nữ Độc Quyền",
    category: "beauty",
    platform: "Shopee Mall",
    originalPrice: 3850000,
    salePrice: 3195000,
    cashback: 256022,
    image: "/deals/deal_beauty_1.jpg",
    url: "https://shopee.vn/product/1362431986/41704900008",
  },
  {
    id: "deal_beauty_2",
    name: "Hộp 20 Mặt Nạ Tế Bào Gốc Phục Hồi SRX Lipoderm Mask",
    category: "beauty",
    platform: "Shopee Mall",
    originalPrice: 1250000,
    salePrice: 910000,
    cashback: 132854,
    image: "/deals/deal_beauty_2.jpg",
    url: "https://shopee.vn/product/43719812/26122705700",
  },
  {
    id: "deal_beauty_3",
    name: "Balo Local Brand CEMMERY Da PVC Chống Nước Đựng Laptop",
    category: "beauty",
    platform: "Shopee Mall",
    originalPrice: 650000,
    salePrice: 517450,
    cashback: 62646,
    image: "/deals/deal_beauty_3.jpg",
    url: "https://shopee.vn/product/312488479/43554752818",
  },
  {
    id: "deal_beauty_4",
    name: "Combo 02 Chai Dầu Gội Antisol Sạch Gàu Nấm iCare Pharma",
    category: "beauty",
    platform: "TikTok Shop",
    originalPrice: 680000,
    salePrice: 530200,
    cashback: 29690,
    image: "/deals/deal_beauty_4.jpg",
    url: "https://shop.tiktok.com/view/product/1733045387782162219?region=VN&local=en",
  },
]

export function Home() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  })

  const [inputUrl, setInputUrl] = React.useState("")
  const [activeCategory, setActiveCategory] = React.useState<"all" | "tech" | "home" | "beauty">("all")
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

  const prefillDeal = (url: string) => {
    setInputUrl(url)
    setConvertedData(null)
    setErrorState(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
    showToast("Đã chọn deal! Bấm 'Lấy Link Hoàn Tiền 80%' để kích hoạt.")
  }

  // Featured Hot Deals from API with fallback to DEFAULT_DEALS
  const { data: dealsData } = useQuery<{ ok: boolean; deals: Deal[] }>({
    queryKey: ["deals", activeCategory],
    queryFn: async () => {
      const res = await fetch(`/api/deals?category=${activeCategory}`)
      if (!res.ok) throw new Error("Failed to load deals")
      return res.json()
    },
    staleTime: 60_000,
  })

  const displayDeals: Deal[] = React.useMemo(() => {
    if (dealsData?.deals && dealsData.deals.length > 0) {
      return dealsData.deals
    }
    return activeCategory === "all"
      ? DEFAULT_DEALS
      : DEFAULT_DEALS.filter((d) => d.category === activeCategory)
  }, [dealsData, activeCategory])

  const carouselRef = React.useRef<HTMLDivElement>(null)
  const [isCarouselPaused, setIsCarouselPaused] = React.useState(false)
  const [activeDealIndex, setActiveDealIndex] = React.useState(0)
  const touchResumeTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  // Auto-scroll effect: every 3.5s scroll by one card width
  React.useEffect(() => {
    if (isCarouselPaused || displayDeals.length <= 1) return

    const interval = setInterval(() => {
      const container = carouselRef.current
      if (!container) return
      const maxScroll = container.scrollWidth - container.clientWidth
      if (container.scrollLeft >= maxScroll - 15) {
        container.scrollTo({ left: 0, behavior: "smooth" })
      } else {
        const card = container.firstElementChild as HTMLElement
        const step = card ? card.offsetWidth + 16 : 320
        container.scrollBy({ left: step, behavior: "smooth" })
      }
    }, 3500)

    return () => clearInterval(interval)
  }, [isCarouselPaused, displayDeals.length])

  // Track active index based on scroll position for dots indicator
  const handleCarouselScroll = () => {
    const container = carouselRef.current
    if (!container) return
    const card = container.firstElementChild as HTMLElement
    const step = card ? card.offsetWidth + 16 : 320
    const index = Math.round(container.scrollLeft / step)
    setActiveDealIndex(Math.min(Math.max(0, index), displayDeals.length - 1))
  }

  // Scroll manually by N cards
  const scrollCarousel = (direction: -1 | 1) => {
    const container = carouselRef.current
    if (!container) return
    const card = container.firstElementChild as HTMLElement
    const step = (card ? card.offsetWidth + 16 : 320) * direction
    container.scrollBy({ left: step, behavior: "smooth" })
  }

  // Jump to specific deal index
  const scrollToIndex = (index: number) => {
    const container = carouselRef.current
    if (!container) return
    const card = container.firstElementChild as HTMLElement
    const step = card ? card.offsetWidth + 16 : 320
    container.scrollTo({ left: index * step, behavior: "smooth" })
    setActiveDealIndex(index)
  }

  // When category changes, reset carousel scroll to 0
  const handleCategoryChange = (cat: "all" | "tech" | "home" | "beauty") => {
    setActiveCategory(cat)
    setActiveDealIndex(0)
    carouselRef.current?.scrollTo({ left: 0, behavior: "smooth" })
  }

  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen flex flex-col">
      {/* HEADER: Shared Unified Navigation Bar */}
      <Header current="home" />

      {/* MAIN CONTENT */}
      <main className="w-full pt-20 bg-background flex-1">
        <div className="flex flex-col w-full">
          {/* HERO SECTION WITH FESTIVE MID-AUTUMN BACKGROUND */}
          <div className="relative w-full overflow-hidden">
            {/* Mid-Autumn Festive Background Wallpaper (Desktop 16:9 & Mobile 9:16) - Vivid & High Definition */}
            <div
              className="pointer-events-none absolute inset-0 hidden sm:block bg-cover bg-center bg-no-repeat opacity-95 transition-opacity"
              style={{ backgroundImage: "url('/hero-bg-pc.jpg')" }}
            />
            <div
              className="pointer-events-none absolute inset-0 block sm:hidden bg-cover bg-top bg-no-repeat opacity-95 transition-opacity"
              style={{ backgroundImage: "url('/hero-bg-mobile.jpg')" }}
            />

            {/* Subtle atmospheric vignette: keeps lanterns and moon shining vibrant while guaranteeing 100% text readability */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#050b18]/60 via-[#070e22]/40 to-background/90 dark:to-background transition-colors" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background via-background/60 to-transparent" />

            {/* Subtle Ambient Glow Elements */}
            <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[780px] h-[380px] bg-gradient-to-tr from-primary-fixed/20 via-primary-container/10 to-transparent blur-3xl pointer-events-none rounded-full" />
            <div className="absolute top-96 right-10 w-96 h-96 bg-tertiary-fixed/15 blur-3xl pointer-events-none rounded-full" />

            {/* HERO SECTION CONTENT & SMART LINK CONVERTER */}
            <section className="relative max-w-7xl mx-auto px-6 lg:px-12 pt-8 pb-16 flex flex-col items-center text-center">
              {/* Top Pill Tag - Honest & Modest with Festive Gold Glow */}
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/45 backdrop-blur-md border border-amber-400/40 shadow-md">
                <span className="size-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_#f59e0b]" />
                <span className="font-label-md text-label-md text-amber-300 font-bold tracking-wider uppercase">
                  MUA SẮM TIẾT KIỆM · HOÀN TIỀN TỰ ĐỘNG 80%
                </span>
              </div>

              {/* Main Dynamic Headline - Radiant White & High Contrast */}
              <h1 className="mt-6 max-w-4xl font-display-lg text-display-lg text-white font-extrabold tracking-tight leading-tight drop-shadow-md">
                Dán link Shopee hoặc TikTok Shop để nhận lại{" "}
                <span className="text-emerald-400 font-black drop-shadow-[0_2px_14px_rgba(16,185,129,0.45)]">80% hoa hồng</span> về tài khoản ngân hàng
              </h1>

              {/* Explanatory Subtitle - Luminous Slate White */}
              <p className="mt-5 max-w-2xl font-body-lg text-body-lg text-slate-100 leading-relaxed drop-shadow-sm font-normal">
                Không mất phí, không cần đăng ký phức tạp. Nhận ngay 80% số tiền hoa hồng của sàn chuyển thẳng về tài khoản ngân hàng của bạn sau khi đơn hàng thành công.
              </p>

              {/* Smart Link Input Box & Converter Engine */}
              <div className="mt-10 w-full max-w-3xl">
                <div className="p-2 sm:p-2.5 rounded-2xl bg-white dark:bg-[#131b2e] shadow-2xl flex flex-col sm:flex-row items-center gap-2.5 transition-all focus-within:ring-2 focus-within:ring-primary/40 border border-white/20">
                  <div className="relative flex-1 w-full flex items-center pl-4 pr-2">
                    <span className="material-symbols-outlined text-slate-400 text-xl flex-shrink-0">
                      link
                    </span>
                    <input
                      type="text"
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="Dán link sản phẩm Shopee hoặc TikTok Shop tại đây..."
                      className="w-full bg-transparent px-3 py-3 font-body-md-medium text-body-md-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handlePaste}
                      title="Dán từ bộ nhớ tạm"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-label-sm text-label-sm flex items-center gap-1 transition-colors flex-shrink-0 cursor-pointer font-medium"
                    >
                      <span className="material-symbols-outlined text-sm">content_paste</span>
                      <span>Dán</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleConvert()}
                    disabled={converting}
                    className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-lg text-label-lg flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95 flex-shrink-0 cursor-pointer font-bold"
                  >
                    {converting ? (
                      <>
                        <span className="material-symbols-outlined text-lg animate-spin">refresh</span>
                        <span>Đang xử lý...</span>
                      </>
                    ) : (
                      <>
                        <span>Lấy Link Hoàn Tiền 80%</span>
                        <span className="material-symbols-outlined text-lg">arrow_forward</span>
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
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/45 backdrop-blur-md border border-white/20 text-white font-medium shadow-md">
                    <span className="material-symbols-outlined text-emerald-400 text-base">verified</span>
                    <span>Áp dụng Shopee &amp; TikTok Shop</span>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/45 backdrop-blur-md border border-white/20 text-white font-medium shadow-md">
                    <span className="material-symbols-outlined text-emerald-400 text-base">bolt</span>
                    <span>Chuyển khoản tự động 24/7</span>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/45 backdrop-blur-md border border-white/20 text-white font-medium shadow-md">
                    <span className="material-symbols-outlined text-emerald-400 text-base">savings</span>
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

          {/* CURATED HIGH-CASHBACK DEALS TODAY (HORIZONTAL AUTO-SCROLL CAROUSEL) */}
          <section className="w-full py-14 sm:py-18 bg-background overflow-hidden">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 flex flex-col">
              {/* Header with Title and Single-row Clean Pill Tabs */}
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-7">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0068ff] uppercase tracking-wider mb-2">
                    <span className="material-symbols-outlined text-sm">local_fire_department</span>
                    <span>Deal hot hoa hồng cao nhất hôm nay</span>
                  </div>
                  <h2 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
                    Sản phẩm hoàn tiền hôm nay
                  </h2>
                  <p className="mt-1.5 font-body-md text-body-md text-on-surface-variant">
                    Chọn sản phẩm để lấy link mua hàng và nhận lại 80% hoa hồng về tài khoản.
                  </p>
                </div>

                {/* Clean, Non-wrapping Pill Tabs & Navigation Chevrons */}
                <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none w-full lg:w-auto justify-between lg:justify-end">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {[
                      { id: "all", label: "Tất cả" },
                      { id: "tech", label: "Công nghệ" },
                      { id: "home", label: "Gia dụng" },
                      { id: "beauty", label: "Làm đẹp" },
                    ].map((tab) => {
                      const isActive = activeCategory === tab.id
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => handleCategoryChange(tab.id as any)}
                          className={`px-4 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                            isActive
                              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm"
                              : "bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Desktop Prev / Next Carousel Arrow Buttons */}
                  <div className="hidden sm:flex items-center gap-1.5 ml-2 border-l border-border/50 pl-3">
                    <button
                      type="button"
                      onClick={() => scrollCarousel(-1)}
                      className="size-9 rounded-full border border-border/60 bg-surface-container-lowest hover:bg-surface-container text-on-surface flex items-center justify-center transition-all active:scale-95 cursor-pointer shadow-2xs"
                      title="Sản phẩm trước"
                    >
                      <span className="material-symbols-outlined text-lg">chevron_left</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollCarousel(1)}
                      className="size-9 rounded-full border border-border/60 bg-surface-container-lowest hover:bg-surface-container text-on-surface flex items-center justify-center transition-all active:scale-95 cursor-pointer shadow-2xs"
                      title="Sản phẩm tiếp theo"
                    >
                      <span className="material-symbols-outlined text-lg">chevron_right</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* HORIZONTAL AUTO-SCROLL CAROUSEL TRACK */}
              <div className="relative w-full">
                <div
                  ref={carouselRef}
                  onMouseEnter={() => setIsCarouselPaused(true)}
                  onMouseLeave={() => setIsCarouselPaused(false)}
                  onTouchStart={() => {
                    setIsCarouselPaused(true)
                    if (touchResumeTimeoutRef.current) clearTimeout(touchResumeTimeoutRef.current)
                  }}
                  onTouchEnd={() => {
                    touchResumeTimeoutRef.current = setTimeout(() => setIsCarouselPaused(false), 5000)
                  }}
                  onScroll={handleCarouselScroll}
                  className="flex gap-4 sm:gap-5 overflow-x-auto scroll-smooth snap-x snap-mandatory py-2 px-1"
                  style={{
                    scrollbarWidth: "none",
                    msOverflowStyle: "none",
                    WebkitOverflowScrolling: "touch",
                  }}
                >
                  {displayDeals.map((deal) => {
                    const cleanName = deal.name.replace(/^\[Shopee Mall\]\s*/i, "")
                    return (
                      <div
                        key={deal.id}
                        className="w-[78vw] sm:w-[290px] shrink-0 snap-start bg-surface-container-lowest rounded-2xl overflow-hidden shadow-xs hover:shadow-lg transition-all duration-300 flex flex-col group border border-border/60 hover:border-[#0068ff]/40"
                      >
                        {/* Image Container with Subtle, Non-Intrusive Chips */}
                        <div className="relative w-full h-48 sm:h-52 bg-white dark:bg-slate-900/30 flex items-center justify-center p-4 overflow-hidden border-b border-border/20">
                          <img
                            src={deal.image}
                            alt={cleanName}
                            referrerPolicy="no-referrer"
                            className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />

                          {/* Subtle Brand Tag */}
                          <div className="absolute top-2.5 left-2.5">
                            <span className="px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 text-[10px] font-bold border border-rose-200/60 dark:border-rose-900/60 uppercase tracking-wider">
                              {deal.platform}
                            </span>
                          </div>

                          {/* Subtle Cashback Chip */}
                          <div className="absolute top-2.5 right-2.5">
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold border border-emerald-200/60 dark:border-emerald-900/60 flex items-center gap-1 shadow-2xs">
                              <span>⚡ Hoàn 80%</span>
                            </span>
                          </div>
                        </div>

                        {/* Card Content */}
                        <div className="p-4 flex flex-col flex-1 justify-between">
                          <div>
                            {/* Product Name */}
                            <h3
                              className="font-semibold text-xs sm:text-sm text-on-surface group-hover:text-[#0068ff] transition-colors line-clamp-2 h-9 leading-snug"
                              title={cleanName}
                            >
                              {cleanName}
                            </h3>

                            {/* Price Breakdown */}
                            <div className="mt-2.5 flex items-baseline gap-2">
                              <span className="font-extrabold text-sm sm:text-base text-on-surface tnum">
                                {vnd(deal.salePrice)}
                              </span>
                              {deal.originalPrice > deal.salePrice && (
                                <span className="text-xs text-outline line-through tnum">
                                  {vnd(deal.originalPrice)}
                                </span>
                              )}
                            </div>

                            {/* Sleek, Elegant Cashback Callout */}
                            <div className="mt-3 p-2.5 rounded-xl bg-emerald-500/8 dark:bg-emerald-500/12 border border-emerald-500/20 flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
                                <span className="material-symbols-outlined text-base">savings</span>
                                <span>Tiền hoàn về:</span>
                              </div>
                              <span className="font-extrabold text-sm sm:text-base text-emerald-600 dark:text-emerald-400 tnum">
                                +{vnd(deal.cashback)}
                              </span>
                            </div>
                          </div>

                          {/* Clean, High-Contrast Action Button */}
                          <button
                            type="button"
                            onClick={() => prefillDeal(deal.url)}
                            className="mt-3.5 w-full py-2.5 rounded-xl bg-[#0068ff] hover:bg-[#0057d9] text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-98"
                          >
                            <span>Lấy link hoàn tiền</span>
                            <span className="material-symbols-outlined text-sm">arrow_forward</span>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Mobile Dots Indicator & Hint */}
              <div className="mt-5 flex flex-col items-center justify-center gap-2">
                <div className="flex items-center gap-1.5 flex-wrap justify-center max-w-full">
                  {displayDeals.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => scrollToIndex(idx)}
                      className={`h-1.5 rounded-full transition-all cursor-pointer ${
                        activeDealIndex === idx
                          ? "w-5 bg-[#0068ff]"
                          : "w-1.5 bg-border hover:bg-outline"
                      }`}
                      aria-label={`Trượt tới sản phẩm ${idx + 1}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-on-surface-variant font-medium">
                  <span className="material-symbols-outlined text-xs text-[#0068ff]">swipe</span>
                  <span>Vuốt sang để xem thêm deal</span>
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

      {/* FLOATING STICKY ZALO COMMUNITY BUTTON */}
      <a
        href={ZALO_GROUP_URL}
        target="_blank"
        rel="noreferrer"
        className="fixed bottom-20 sm:bottom-6 left-6 z-40 group flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-[#0068ff] hover:bg-[#0057d9] text-white font-bold text-xs shadow-2xl hover:shadow-[0_8px_25px_rgba(0,104,255,0.45)] transition-all transform hover:-translate-y-0.5 active:scale-95 cursor-pointer border-2 border-white/20"
        title="Tham gia nhóm Zalo Hoàn Tiền DP"
      >
        <span className="relative flex size-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
          <span className="relative inline-flex rounded-full size-2.5 bg-emerald-300"></span>
        </span>
        <span className="material-symbols-outlined text-lg">groups</span>
        <span className="hidden sm:inline">Nhóm Zalo Nhận Tiền 24/7</span>
        <span className="sm:hidden">Zalo 80%</span>
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
