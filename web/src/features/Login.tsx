import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Footer, Header } from "@/components/Chrome"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input, Label } from "@/components/ui/input"
import { Icon } from "@/lib/icons"
import { login } from "@/lib/api"
import { useT } from "@/lib/labels"
import { navigate } from "@/routes"

/**
 * Signing in with what the bot already knows.
 *
 * No sign-up, no email, no phone number: the bot holds the one fact
 * that matters, which is that this person controls this Zalo account.
 * /id gives them their code, /matkhau issues a password. That is said
 * on the page, next to the fields, because someone who does not know it
 * has no way to get in and no reason to guess.
 *
 * Every failure reads the same. Telling "no such account" apart from
 * "wrong password" would turn this form into a way to ask whether a
 * given Zalo id uses the service.
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

  const ready = name.trim().length > 0 && password.length > 0

  return (
    <>
      <Header current="login" />

      <main className="mx-auto w-full max-w-md px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-7 text-center">
          <span className="bg-primary-soft text-primary mx-auto grid size-12 place-items-center rounded-xl">
            <Icon.signIn className="size-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            {t("login_title")}
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {t("login_lead")}
          </p>
        </div>

        <Card>
          <CardContent className="pt-5">
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault()
                if (ready) attempt.mutate()
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="name">{t("login_name")}</Label>
                <Input
                  id="name"
                  value={name}
                  autoComplete="username"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(event) => setName(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {t("login_name_hint")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t("login_password")}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              {message && (
                <p className="bg-destructive-soft text-destructive flex gap-2 rounded-md p-3 text-sm">
                  <Icon.warning className="mt-0.5 size-4 shrink-0" />
                  <span>{message}</span>
                </p>
              )}

              {/* Disabled has to LOOK disabled. The old button stayed a
                  confident blue while doing nothing, which reads as the
                  site being broken rather than the form being empty. */}
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={attempt.isPending || !ready}
              >
                {attempt.isPending ? (
                  <>
                    <Icon.busy className="animate-spin" /> {t("login_working")}
                  </>
                ) : (
                  t("login_submit")
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-secondary mt-4 border-0">
          <CardContent className="pt-4">
            <h2 className="text-sm font-semibold">{t("login_help_title")}</h2>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {t("login_help_body")}
            </p>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <Button variant="ghost" size="sm" onClick={() => navigate("home")}>
            {t("login_back")}
          </Button>
        </div>
      </main>

      <Footer />
    </>
  )
}
