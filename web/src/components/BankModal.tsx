import { useState, useEffect } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { Icon } from "@/lib/icons"
import { updateBank } from "@/lib/api"
import { useT } from "@/lib/labels"

const POPULAR_BANKS = [
  "Vietcombank",
  "MB Bank",
  "Techcombank",
  "ACB",
  "VPBank",
  "BIDV",
  "VietinBank",
  "TPBank",
  "Agribank",
  "Sacombank",
  "HDBank",
  "VIB",
]

function normalizeHolder(val: string): string {
  return val
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toUpperCase()
}

interface BankModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialBankName?: string
  initialHolder?: string
}

export function BankModal({
  open,
  onOpenChange,
  initialBankName = "",
  initialHolder = "",
}: BankModalProps) {
  const t = useT()
  const queryClient = useQueryClient()

  const [bankName, setBankName] = useState(initialBankName)
  const [bankAccount, setBankAccount] = useState("")
  const [accountHolder, setAccountHolder] = useState(initialHolder)
  const [errorMsg, setErrorMsg] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  useEffect(() => {
    if (open) {
      setBankName(initialBankName)
      setBankAccount("")
      setAccountHolder(initialHolder)
      setErrorMsg("")
      setSuccessMsg("")
    }
  }, [open, initialBankName, initialHolder])

  const mutation = useMutation({
    mutationFn: () =>
      updateBank(bankName.trim(), bankAccount.trim(), accountHolder.trim()),
    onSuccess: (res) => {
      if (res.ok) {
        setSuccessMsg(t("bank_save_success"))
        setErrorMsg("")
        queryClient.invalidateQueries({ queryKey: ["me"] })
        setTimeout(() => {
          onOpenChange(false)
        }, 1200)
      } else {
        setErrorMsg(t("bank_save_error", { reason: res.message }))
      }
    },
    onError: (err) => {
      setErrorMsg(t("bank_save_error", { reason: String(err) }))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")
    setSuccessMsg("")

    const cleanAccount = bankAccount.replace(/[\s-]/g, "")
    if (!bankName.trim()) {
      setErrorMsg(t("bank_missing_name"))
      return
    }
    if (cleanAccount.length < 4 || cleanAccount.length > 30) {
      setErrorMsg(t("bank_invalid_account"))
      return
    }
    if (accountHolder.trim().length < 2) {
      setErrorMsg(t("bank_missing_holder"))
      return
    }

    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/10 text-primary grid size-8 place-items-center rounded-lg">
              <Icon.bank className="size-4" />
            </div>
            <DialogTitle>{t("bank_modal_title")}</DialogTitle>
          </div>
          <DialogDescription className="mt-1">
            {t("bank_modal_desc")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-3 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bankName">{t("bank_select_label")}</Label>
            <div className="flex flex-wrap gap-1.5 pb-1">
              {POPULAR_BANKS.map((b) => (
                <button
                  type="button"
                  key={b}
                  onClick={() => setBankName(b)}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                    bankName.toLowerCase() === b.toLowerCase()
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border/60 hover:bg-secondary/60 text-muted-foreground"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
            <Input
              id="bankName"
              value={bankName}
              placeholder={t("bank_select_placeholder")}
              onChange={(e) => setBankName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bankAccount">{t("bank_account_label")}</Label>
            <Input
              id="bankAccount"
              value={bankAccount}
              placeholder={t("bank_account_placeholder")}
              onChange={(e) =>
                setBankAccount(e.target.value.replace(/[^0-9a-zA-Z]/g, ""))
              }
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="accountHolder">{t("bank_holder_label")}</Label>
            <Input
              id="accountHolder"
              value={accountHolder}
              placeholder={t("bank_holder_placeholder")}
              onChange={(e) =>
                setAccountHolder(normalizeHolder(e.target.value))
              }
              required
            />
            <p className="text-muted-foreground text-[11px] leading-tight">
              {t("bank_holder_hint")}
            </p>
          </div>

          {errorMsg && (
            <div className="bg-destructive-soft text-destructive flex items-center gap-2 rounded-md p-2.5 text-xs">
              <Icon.warning className="size-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="bg-success-soft text-success flex items-center gap-2 rounded-md p-2.5 text-xs font-medium">
              <Icon.confirm className="size-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("btn_cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Icon.busy className="mr-1.5 size-3.5 animate-spin" />
                  {t("bank_saving")}
                </>
              ) : (
                t("bank_save_btn")
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
