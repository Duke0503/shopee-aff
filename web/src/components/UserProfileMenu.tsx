import { useState, useRef, useEffect } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Icon } from "@/lib/icons"
import { Mascot } from "@/components/Mascot"
import { Button } from "@/components/ui/button"
import { BankModal } from "@/components/BankModal"
import { ChangePasswordModal } from "@/components/ChangePasswordModal"
import { logout, type Me } from "@/lib/api"
import { useT } from "@/lib/labels"
import { navigate } from "@/routes"

interface UserProfileMenuProps {
  me: Me
}

export function UserProfileMenu({ me }: UserProfileMenuProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [bankModalOpen, setBankModalOpen] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("keydown", handleKeyDown)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [dropdownOpen])

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(["me"], null)
      navigate("home")
    },
  })

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="hover:bg-secondary/70 flex items-center gap-2 rounded-full border px-2.5 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2"
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
        >
          <div className="bg-primary/10 text-primary grid size-6 place-items-center rounded-full text-xs font-bold">
            <Icon.user className="size-3.5" />
          </div>
          <span className="max-w-[110px] truncate sm:max-w-[150px]">
            {me.display_name || me.customer_id}
          </span>
          <Icon.expand
            className={`size-3.5 text-muted-foreground transition-transform ${
              dropdownOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {dropdownOpen && (
          <div className="bg-card border-border/80 absolute right-0 z-50 mt-2 w-72 origin-top-right rounded-xl border p-3 shadow-xl sm:w-80">
            {/* User Profile info */}
            <div className="flex items-center gap-3 border-b pb-3">
              <Mascot className="size-10 shrink-0" mood="happy" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">
                  {me.display_name || me.customer_id}
                </div>
                <div className="text-muted-foreground font-mono text-xs">
                  {me.customer_id}
                </div>
              </div>
            </div>

            {/* Bank Card Section */}
            <div className="mt-3 rounded-lg border bg-secondary/40 p-2.5">
              <div className="text-muted-foreground flex items-center justify-between text-[11px] font-medium">
                <span>{t("profile_bank_section")}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    me.has_bank
                      ? "bg-success/15 text-success"
                      : "bg-warning/15 text-warning"
                  }`}
                >
                  {me.has_bank ? t("bank_badge_set") : t("bank_badge_missing")}
                </span>
              </div>

              {me.has_bank ? (
                <div className="mt-2">
                  <div className="text-sm font-semibold">
                    {me.bank_name} &middot; <span className="font-mono font-normal">···{me.bank_account_tail}</span>
                  </div>
                  {me.account_holder && (
                    <div className="text-muted-foreground text-xs uppercase">
                      {me.account_holder}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary mt-2 h-7 w-full text-xs"
                    onClick={() => {
                      setDropdownOpen(false)
                      setBankModalOpen(true)
                    }}
                  >
                    <Icon.edit className="mr-1.5 size-3" />
                    {t("bank_action_edit")}
                  </Button>
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="text-warning text-xs leading-tight">
                    {t("profile_bank_not_set")}
                  </p>
                  <Button
                    size="sm"
                    className="h-8 w-full text-xs font-semibold"
                    onClick={() => {
                      setDropdownOpen(false)
                      setBankModalOpen(true)
                    }}
                  >
                    <Icon.bank className="mr-1.5 size-3.5" />
                    {t("bank_action_add")}
                  </Button>
                </div>
              )}
            </div>

            {/* Menu options */}
            <div className="mt-2 space-y-1 pt-1">
              <button
                type="button"
                className="hover:bg-secondary/80 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-left transition-colors"
                onClick={() => {
                  setDropdownOpen(false)
                  setPasswordModalOpen(true)
                }}
              >
                <Icon.password className="text-muted-foreground size-4" />
                <span>{t("profile_change_password")}</span>
              </button>
            </div>

            <div className="mt-2 border-t pt-2">
              <button
                type="button"
                disabled={signOut.isPending}
                className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-left transition-colors"
                onClick={() => signOut.mutate()}
              >
                <Icon.signOut className="size-4" />
                <span>{t("logout")}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <BankModal
        open={bankModalOpen}
        onOpenChange={setBankModalOpen}
        initialBankName={me.bank_name}
        initialHolder={me.account_holder}
      />

      <ChangePasswordModal
        open={passwordModalOpen}
        onOpenChange={setPasswordModalOpen}
      />
    </>
  )
}
