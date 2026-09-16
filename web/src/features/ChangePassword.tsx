import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Icon } from "@/lib/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input, Label } from "@/components/ui/input"
import { changePassword } from "@/lib/api"
import { useT } from "@/lib/labels"

/**
 * The password the bot issued is eight random characters. Nobody wants
 * to keep typing that, and a customer who cannot change it will write
 * it down somewhere worse.
 */
export function ChangePassword() {
  const t = useT()
  const [current, setCurrent] = useState("")
  const [replacement, setReplacement] = useState("")

  const submit = useMutation({
    mutationFn: () => changePassword(current, replacement),
    onSuccess: (result) => {
      if (result.ok) {
        setCurrent("")
        setReplacement("")
      }
    },
  })

  const result = submit.data
  const message = result
    ? t(result.ok ? "password_ok" : `password_${result.message}`)
    : ""

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon.password className="size-4" />
          {t("password_title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="current">{t("password_current")}</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="replacement">{t("password_new")}</Label>
            <Input
              id="replacement"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
            />
          </div>
          {message && (
            <p
              className={
                result?.ok
                  ? "text-[var(--success)] text-sm"
                  : "text-[var(--destructive)] text-sm"
              }
            >
              {message}
            </p>
          )}
          <Button
            type="submit"
            variant="outline"
            disabled={submit.isPending || !current || replacement.length < 8}
          >
            {submit.isPending ? t("password_working") : t("password_submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
