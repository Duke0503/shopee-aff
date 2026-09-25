import * as React from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Icon } from "@/lib/icons"
import { vnd } from "@/lib/format"
import { cn } from "@/lib/utils"

interface Deal {
  id: string
  name: string
  category: "tech" | "home" | "beauty"
  platform: "Shopee Mall" | "TikTok Shop"
  originalPrice: number
  salePrice: number
  cashbackEst: number
  cashbackRate: string
  image: string
  sampleUrl: string
}

const DEALS: Deal[] = [
  {
    id: "1",
    name: "Màn hình Gaming Lenovo Legion R27q-30 27 inch 2K QHD 180Hz Fast IPS",
    category: "tech",
    platform: "Shopee Mall",
    originalPrice: 6590000,
    salePrice: 5490000,
    cashbackEst: 263000,
    cashbackRate: "6.0%",
    image: "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=500&auto=format&fit=crop&q=80",
    sampleUrl: "https://shopee.vn/product/88231940/23812948212",
  },
  {
    id: "2",
    name: "Củ sạc nhanh Anker GaNPrime 65W 3 cổng A2668 - Sạc nhanh đa thiết bị",
    category: "tech",
    platform: "Shopee Mall",
    originalPrice: 1250000,
    salePrice: 890000,
    cashbackEst: 57000,
    cashbackRate: "8.0%",
    image: "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=500&auto=format&fit=crop&q=80",
    sampleUrl: "https://shopee.vn/product/49281204/18293019284",
  },
  {
    id: "3",
    name: "Tai nghe chống ồn không dây Sony WH-1000XM5 Hi-Res Audio",
    category: "tech",
    platform: "Shopee Mall",
    originalPrice: 8490000,
    salePrice: 6990000,
    cashbackEst: 335000,
    cashbackRate: "6.0%",
    image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&auto=format&fit=crop&q=80",
    sampleUrl: "https://shopee.vn/product/38291048/19384729102",
  },
  {
    id: "4",
    name: "Robot hút bụi lau nhà Dreame D9 Max Gen 2 lực hút 6000Pa tự động",
    category: "home",
    platform: "Shopee Mall",
    originalPrice: 6990000,
    salePrice: 4890000,
    cashbackEst: 234000,
    cashbackRate: "6.0%",
    image: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=500&auto=format&fit=crop&q=80",
    sampleUrl: "https://shopee.vn/product/58291049/22910485918",
  },
  {
    id: "5",
    name: "Nồi chiên không dầu điện tử Philips HD9252 4.1L công nghệ Rapid Air",
    category: "home",
    platform: "Shopee Mall",
    originalPrice: 2490000,
    salePrice: 1590000,
    cashbackEst: 101000,
    cashbackRate: "8.0%",
    image: "https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=500&auto=format&fit=crop&q=80",
    sampleUrl: "https://shopee.vn/product/12948572/17492830192",
  },
  {
    id: "6",
    name: "Kem chống nắng kiểm soát dầu La Roche-Posay Anthelios UVmune 400 50ml",
    category: "beauty",
    platform: "Shopee Mall",
    originalPrice: 535000,
    salePrice: 419000,
    cashbackEst: 33500,
    cashbackRate: "10.0%",
    image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=500&auto=format&fit=crop&q=80",
    sampleUrl: "https://shopee.vn/product/91827401/16283948572",
  },
]

export function DealsSection({ onSelectDeal }: { onSelectDeal?: (url: string) => void }) {
  const [activeCategory, setActiveCategory] = React.useState<"all" | "tech" | "home" | "beauty">("all")

  const filteredDeals = activeCategory === "all"
    ? DEALS
    : DEALS.filter((d) => d.category === activeCategory)

  const handlePick = (deal: Deal) => {
    if (onSelectDeal) {
      onSelectDeal(deal.sampleUrl)
    } else {
      // scroll to top command bar
      window.scrollTo({ top: 0, behavior: "smooth" })
      const input = document.querySelector<HTMLInputElement>("input[type='text']")
      if (input) {
        input.value = deal.sampleUrl
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.focus()
      }
    }
  }

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
        {/* Header with Title and Category Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-border/60">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-2">
              <Icon.flash className="size-3.5" />
              <span>ƯU ĐÃI NỔI BẬT HÔM NAY</span>
            </div>
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground">
              Sản phẩm hoàn tiền cao được mua nhiều
            </h2>
            <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
              Mẫu sản phẩm có tỷ lệ hoa hồng cao từ sàn &mdash; nhận trọn vẹn 80% về tài khoản
            </p>
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-muted/40 p-1 border border-border/40 shrink-0">
            {[
              { id: "all", label: "Tất cả" },
              { id: "tech", label: "Công nghệ" },
              { id: "home", label: "Gia dụng" },
              { id: "beauty", label: "Làm đẹp" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveCategory(tab.id as any)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer",
                  activeCategory === tab.id
                    ? "bg-card text-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 3-Column Deals Grid */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredDeals.map((deal) => (
            <Card
              key={deal.id}
              className="luxury-panel group flex flex-col justify-between overflow-hidden rounded-2xl border border-border/70 p-4 transition-all hover:shadow-lg hover:border-primary/40 bg-card"
            >
              <div>
                {/* Responsive Image Container: NEVER CUT OFF */}
                <div className="relative aspect-4/3 sm:aspect-square w-full overflow-hidden rounded-xl bg-muted/30 p-3 flex items-center justify-center">
                  <img
                    src={deal.image}
                    alt={deal.name}
                    className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute top-2.5 left-2.5">
                    <span className="rounded-md bg-secondary text-secondary-foreground px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-2xs">
                      {deal.platform}
                    </span>
                  </div>
                  <div className="absolute bottom-2.5 right-2.5">
                    <span className="rounded-md bg-success/90 text-success-foreground px-2 py-0.5 text-[11px] font-bold tnum shadow-2xs">
                      Hoàn {deal.cashbackRate}
                    </span>
                  </div>
                </div>

                {/* Product Title */}
                <h3 className="mt-3.5 text-sm font-semibold text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                  {deal.name}
                </h3>

                {/* Pricing & Cashback Info */}
                <div className="mt-3 space-y-1 rounded-xl bg-muted/20 border border-border/40 p-2.5 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground text-[11px]">
                    <span>Giá niêm yết:</span>
                    <span className="line-through tnum">{vnd(deal.originalPrice)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Giá khuyến mãi:</span>
                    <span className="font-semibold tnum text-foreground">{vnd(deal.salePrice)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border/40 pt-1.5">
                    <span className="font-semibold text-success text-xs">Bạn nhận về (80%):</span>
                    <span className="font-bold tnum text-success text-sm sm:text-base">
                      +{vnd(deal.cashbackEst)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="mt-4 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePick(deal)}
                  className="w-full rounded-xl text-xs font-semibold group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all cursor-pointer"
                >
                  <Icon.link className="mr-1.5 size-3.5" />
                  <span>Dán link nhận hoàn tiền</span>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
