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
        <div className="h-20 max-w-7xl mx-auto px-6 lg:px-12 flex items-center justify-between gap-6">
          <button
            onClick={() => navigate("home")}
            className="flex items-center gap-3 group text-left cursor-pointer"
          >
            <BrandLogo className="size-11 rounded-xl shadow-[0_4px_12px_rgba(0,105,72,0.25)]" />
            <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight leading-none group-hover:text-primary transition-colors font-bold">
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
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {me ? (
              <UserProfileMenu me={me} />
            ) : (
              current !== "login" && (
                <button
                  type="button"
                  onClick={() => navigate("login")}
                  className="inline-flex items-center justify-center font-label-lg text-label-lg bg-primary text-on-primary px-5 py-2.5 rounded-xl hover:bg-primary-container shadow-[0_4px_14px_rgba(0,105,72,0.2)] transition-all cursor-pointer font-bold"
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
      className="fixed bottom-0 inset-x-0 z-30 flex items-center justify-around border-t bg-background/95 backdrop-blur px-2 pt-1.5 shadow-lg sm:hidden"
      style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom, 0px))" }}
      aria-label="Mobile navigation"
    >
      <button
        type="button"
        onClick={() => navigate("home")}
        className={cn(
          "flex flex-1 flex-col items-center gap-1 py-1 text-[11px] font-medium transition-colors",
          current === "home"
            ? "text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon.home className={cn("size-5", current === "home" && "text-primary")} />
        <span>{t("nav_home")}</span>
      </button>

      <button
        type="button"
        onClick={() => navigate("orders")}
        className={cn(
          "flex flex-1 flex-col items-center gap-1 py-1 text-[11px] font-medium transition-colors",
          current === "orders"
            ? "text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon.order className={cn("size-5", current === "orders" && "text-primary")} />
        <span>{t("nav_orders_short")}</span>
      </button>

      <button
        type="button"
        onClick={() => navigate("guide")}
        className={cn(
          "flex flex-1 flex-col items-center gap-1 py-1 text-[11px] font-medium transition-colors",
          current === "guide"
            ? "text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon.guide className={cn("size-5", current === "guide" && "text-primary")} />
        <span>{t("nav_guide_short")}</span>
      </button>
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
