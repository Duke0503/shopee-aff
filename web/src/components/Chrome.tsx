import { useQuery } from "@tanstack/react-query"
import { Icon } from "@/lib/icons"
import { BrandLogo } from "@/components/BrandLogo"
import { ThemeToggle } from "@/components/ThemeToggle"
import { UserProfileMenu } from "@/components/UserProfileMenu"
import { useT } from "@/lib/labels"
import { fetchMe } from "@/lib/api"
import { navigate, type Route } from "@/routes"
import { cn } from "@/lib/utils"

/**
 * The bar across the top of every public page.
 *
 * Sign-in lives here as one quiet button rather than as the page you
 * land on: most people arriving from a Zalo group are deciding whether
 * this is worth using, and a password field is not an answer to that.
 */
const ZALO_GROUP_URL = "https://zalo.me/g/645qel4gnwism4gagqxh"

export function Header({ current }: { current: Route }) {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  })

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-surface-container-lowest/90 backdrop-blur-xl border-b border-border/40 shadow-[0_1px_8px_rgba(0,0,0,0.04)] transition-all">
        <div className="h-14 sm:h-18 md:h-20 max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-12 flex items-center justify-between gap-1.5 sm:gap-6">
          <button
            onClick={() => navigate("home")}
            className="flex items-center gap-1.5 sm:gap-3 group text-left cursor-pointer shrink-0 min-w-0"
          >
            <BrandLogo className="size-7 sm:size-9 md:size-10 rounded-xl shadow-[0_2px_8px_rgba(0,105,72,0.2)] shrink-0" />
            <span className="font-extrabold text-sm sm:text-lg md:text-xl text-on-surface tracking-tight leading-none group-hover:text-primary transition-colors whitespace-nowrap">
              Hoàn Tiền DP
            </span>
          </button>

          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center gap-2">
            <button
              onClick={() => navigate("guide")}
              className={cn(
                "font-body-md text-body-md px-3.5 py-2 rounded-xl transition-all cursor-pointer font-medium",
                current === "guide"
                  ? "text-primary font-bold bg-primary/10 shadow-2xs"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
              )}
            >
              Hướng Dẫn
            </button>
            <button
              onClick={() => navigate("orders")}
              className={cn(
                "font-body-md text-body-md px-3.5 py-2 rounded-xl transition-all cursor-pointer font-medium",
                current === "orders"
                  ? "text-primary font-bold bg-primary/10 shadow-2xs"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
              )}
            >
              Đơn Hàng Của Tôi
            </button>
            <a
              href={ZALO_GROUP_URL}
              target="_blank"
              rel="noreferrer"
              className="font-body-md text-body-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container px-3.5 py-2 rounded-xl transition-all cursor-pointer font-medium"
            >
              Cộng Đồng Zalo
            </a>
          </nav>

          {/* Action buttons + Theme Toggle */}
          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
            <ThemeToggle />
            {me ? (
              <UserProfileMenu me={me} />
            ) : (
              current !== "login" && (
                <button
                  type="button"
                  onClick={() => navigate("login")}
                  className="inline-flex items-center justify-center text-xs sm:text-sm font-bold bg-primary text-on-primary px-2.5 py-1.5 sm:px-5 sm:py-2.5 rounded-lg sm:rounded-xl hover:bg-primary-container shadow-[0_2px_10px_rgba(0,105,72,0.2)] transition-all cursor-pointer whitespace-nowrap active:scale-95"
                >
                  Đăng Nhập
                </button>
              )
            )}
          </div>
        </div>
      </header>

      <BottomNav current={current} />
    </>
  )
}

export function BottomNav({ current }: { current: Route }) {
  const t = useT()

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 flex items-center justify-around border-t border-border/40 bg-card/85 backdrop-blur-xl px-3 pt-1.5 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] sm:hidden"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
      aria-label="Mobile navigation"
    >
      <button
        type="button"
        onClick={() => navigate("home")}
        className={cn(
          "flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px] font-medium transition-all active:scale-95 cursor-pointer",
          current === "home"
            ? "text-primary font-bold"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <div className={cn("p-1 rounded-xl transition-colors", current === "home" && "bg-primary/10")}>
          <Icon.home className={cn("size-5", current === "home" && "text-primary")} />
        </div>
        <span>{t("nav_home")}</span>
      </button>

      <button
        type="button"
        onClick={() => navigate("orders")}
        className={cn(
          "flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px] font-medium transition-all active:scale-95 cursor-pointer",
          current === "orders"
            ? "text-primary font-bold"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <div className={cn("p-1 rounded-xl transition-colors", current === "orders" && "bg-primary/10")}>
          <Icon.order className={cn("size-5", current === "orders" && "text-primary")} />
        </div>
        <span>{t("nav_orders_short")}</span>
      </button>

      <button
        type="button"
        onClick={() => navigate("guide")}
        className={cn(
          "flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px] font-medium transition-all active:scale-95 cursor-pointer",
          current === "guide"
            ? "text-primary font-bold"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <div className={cn("p-1 rounded-xl transition-colors", current === "guide" && "bg-primary/10")}>
          <Icon.guide className={cn("size-5", current === "guide" && "text-primary")} />
        </div>
        <span>{t("nav_guide_short")}</span>
      </button>

      <a
        href={ZALO_GROUP_URL}
        target="_blank"
        rel="noreferrer"
        className="flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px] font-medium transition-all active:scale-95 cursor-pointer text-muted-foreground hover:text-foreground"
      >
        <div className="p-1 rounded-xl transition-colors">
          <span className="material-symbols-outlined text-[20px] text-[#0068ff]">groups</span>
        </div>
        <span className="text-[#0068ff] font-semibold">Nhóm Zalo</span>
      </a>
    </nav>
  )
}

export function Footer() {
  const t = useT()
  return (
    <footer className="text-muted-foreground mt-16 border-t py-8 pb-24 text-center text-xs sm:pb-8">
      {t("home_footer")}
    </footer>
  )
}
