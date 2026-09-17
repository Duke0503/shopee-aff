import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Icon } from "@/lib/icons"
import { Mascot } from "@/components/Mascot"
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
export function Header({ current }: { current: Route }) {
  const t = useT()

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  })

  return (
    <>
      <header
        className="bg-background/85 sticky top-0 z-20 border-b backdrop-blur"
        style={{ top: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between gap-3 px-4 sm:px-6">
          <button
            onClick={() => navigate("home")}
            className="flex items-center gap-2 font-semibold min-w-0"
          >
            <Mascot className="size-8 shrink-0" />
            <span className="hidden font-bold sm:inline sm:text-base">
              {t("brand")}
            </span>
          </button>

          {/* Desktop navigation */}
          <nav className="hidden sm:flex items-center gap-2 shrink-0">
            {current !== "guide" && (
              <Button variant="ghost" size="sm" onClick={() => navigate("guide")}>
                <Icon.guide className="size-3.5 sm:mr-1" />
                <span>{t("nav_guide")}</span>
              </Button>
            )}
            {current !== "orders" && (
              <Button variant="ghost" size="sm" onClick={() => navigate("orders")}>
                <span>{t("nav_orders")}</span>
              </Button>
            )}
            {me ? (
              <UserProfileMenu me={me} />
            ) : (
              current !== "login" && (
                <Button size="sm" onClick={() => navigate("login")}>
                  <Icon.signIn /> {t("nav_login")}
                </Button>
              )
            )}
          </nav>

          {/* Mobile header right: only profile / sign-in */}
          <div className="flex sm:hidden items-center shrink-0">
            {me ? (
              <UserProfileMenu me={me} />
            ) : (
              current !== "login" && (
                <Button size="sm" onClick={() => navigate("login")}>
                  <Icon.signIn className="size-3.5" />
                  <span className="text-xs">{t("nav_login")}</span>
                </Button>
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
