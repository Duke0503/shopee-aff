import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Icon } from "@/lib/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input, Label } from "@/components/ui/input"
import { login } from "@/lib/api"
import { useT } from "@/lib/labels"

/**
 * Signing in with what the bot already knows.
 *
 * There is no sign-up, no email and no phone number: the bot has the one
 * fact that matters, which is that this person controls this Zalo
 * account. /id gives them their code, /matkhau issues a password.
 *
 * Every failure reads the same to the visitor. Telling "no such account"
 * apart from "wrong password" would turn this form into a way to ask
 * whether a given Zalo id uses the service.
 */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useT()
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")

  const attempt = useMutation({
    mutationFn: () => login(name.trim(), password),
    onSuccess: (result) => {
      if (result.ok) onSignedIn()
    },
  })

  const failure = attempt.data && !attempt.data.ok ? attempt.data.message : ""
  const message =
    failure === "locked"
      ? t("login_locked")
      : failure
        ? t("login_bad_credentials")
        : attempt.error
          ? t("login_error", { reason: String(attempt.error) })
          : ""

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <header className="mb-6 text-center">
        <h1 className="text-xl font-bold">{t("me_title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("me_subtitle")}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon.signIn className="size-4" />
            {t("login_title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              attempt.mutate()
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("login_name")}</Label>
              <Input
                id="name"
                value={name}
                autoComplete="username"
                onChange={(event) => setName(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("login_name_hint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">{t("login_password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("login_password_hint")}
              </p>
            </div>

            {message && (
              <p className="text-[var(--destructive)] text-sm">{message}</p>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={attempt.isPending || !name.trim() || !password}
            >
              {attempt.isPending ? t("login_working") : t("login_submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
