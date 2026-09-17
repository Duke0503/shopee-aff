import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { Icon } from "@/lib/icons"
import { changePassword } from "@/lib/api"
import { useT } from "@/lib/labels"

interface ChangePasswordModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChangePasswordModal({
  open,
  onOpenChange,
}: ChangePasswordModalProps) {
  const t = useT()
  const [current, setCurrent] = useState("")
  const [replacement, setReplacement] = useState("")

  const submit = useMutation({
    mutationFn: () => changePassword(current, replacement),
    onSuccess: (result) => {
      if (result.ok) {
        setCurrent("")
        setReplacement("")
        setTimeout(() => {
          onOpenChange(false)
        }, 1500)
      }
    },
  })

  const result = submit.data
  const message = result
    ? t(result.ok ? "password_ok" : `password_${result.message}`)
    : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/10 text-primary grid size-8 place-items-center rounded-lg">
              <Icon.password className="size-4" />
            </div>
            <DialogTitle>{t("password_title")}</DialogTitle>
          </div>
        </DialogHeader>

        <form
          className="mt-2 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="modal-current">{t("password_current")}</Label>
            <Input
              id="modal-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="modal-replacement">{t("password_new")}</Label>
            <Input
              id="modal-replacement"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              required
            />
          </div>

          {message && (
            <p
              className={
                result?.ok
                  ? "bg-success-soft text-success rounded-md p-2.5 text-xs font-medium"
                  : "bg-destructive-soft text-destructive rounded-md p-2.5 text-xs font-medium"
              }
            >
              {message}
            </p>
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
              disabled={submit.isPending || !current || replacement.length < 8}
            >
              {submit.isPending ? (
                <>
                  <Icon.busy className="mr-1.5 size-3.5 animate-spin" />
                  {t("password_working")}
                </>
              ) : (
                t("password_submit")
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
