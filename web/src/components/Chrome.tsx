import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Icon } from "@/lib/icons"
import { Mascot } from "@/components/Mascot"
import { UserProfileMenu } from "@/components/UserProfileMenu"
import { useT } from "@/lib/labels"
import { fetchMe } from "@/lib/api"
import { navigate, type Route } from "@/routes"

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
    <header className="bg-background/85 sticky top-0 z-20 border-b backdrop-blur"
            style={{ top: "env(safe-area-inset-top, 0px)" }}>
      <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between gap-3 px-4 sm:px-6">
        <button
          onClick={() => navigate("home")}
          className="flex items-center gap-1.5 font-semibold min-w-0 sm:gap-2"
        >
          <Mascot className="size-7 shrink-0 sm:size-8" />
          <span className="truncate text-sm sm:text-base">{t("brand")}</span>
        </button>

        <nav className="flex items-center gap-1 shrink-0 sm:gap-2">
          {current !== "guide" && (
            <Button variant="ghost" size="sm" onClick={() => navigate("guide")}>
              <Icon.guide className="size-3.5 sm:mr-1" />
              <span className="hidden sm:inline">{t("nav_guide")}</span>
              <span className="sm:hidden">{t("nav_guide_short")}</span>
            </Button>
          )}
          {current !== "orders" && (
            <Button variant="ghost" size="sm" onClick={() => navigate("orders")}>
              <span className="hidden sm:inline">{t("nav_orders")}</span>
              <span className="sm:hidden">{t("nav_orders_short")}</span>
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
      </div>
    </header>
  )
}

export function Footer() {
  const t = useT()
  return (
    <footer className="text-muted-foreground mt-16 border-t py-8 text-center text-xs">
      {t("home_footer")}
    </footer>
  )
}
