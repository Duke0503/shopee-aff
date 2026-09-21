import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Footer, Header } from "@/components/Chrome"
import { Mascot, type Mood } from "@/components/Mascot"
import { Reveal } from "@/components/Reveal"
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
 * next to the fields, because someone who does not know it has no way
 * in and no reason to guess.
 *
 * The bot covers its eyes while the password field has the cursor, and
 * lowers one paw when the reader asks to see what they typed. The joke
 * carries real work: this password is eight random characters that
 * arrived over Zalo, nearly everyone is copying it in by thumb and
 * mistyping it, so the field can be unmasked -- and a face that
 * visibly looks away while it is masked makes doing this on a bus feel
 * different from typing into a form.
 *
 * Every failure reads the same. Telling "no such account" apart from
 * "wrong password" would turn this form into a way to ask whether a
 * given Zalo id uses the service.
 */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useT()
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [typingPassword, setTypingPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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

  // It hides its eyes only while the password field has the cursor. A
  // face covering its eyes at a field nobody is typing in is a mascot
  // performing rather than a thing reacting.
  const mood: Mood = typingPassword
    ? showPassword
      ? "peeking"
      : "shy"
    : message
      ? "waiting"
      : "happy"

  return (
    <>
      <Header current="login" />

      <main className="mx-auto w-full max-w-md px-4 py-8 sm:px-6 sm:py-14">
        <div className="mb-6 text-center">
          <Mascot className="mx-auto size-24" mood={mood} />
          <h1 className="mt-3 text-2xl font-bold tracking-tight">
            {t("login_title")}
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {t("login_lead")}
          </p>
        </div>

        <Reveal delay={60}>
          <Card className="luxury-panel border border-border/80 shadow-md">
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
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      autoComplete="current-password"
                      autoCapitalize="off"
                      spellCheck={false}
                      className="pr-11"
                      onFocus={() => setTypingPassword(true)}
                      onBlur={() => setTypingPassword(false)}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      // Keep the cursor in the field, so the bot keeps
                      // its hands up and only moves one aside.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setShowPassword((shown) => !shown)}
                      aria-label={t(
                        showPassword ? "password_hide" : "password_show",
                      )}
                      className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 grid w-11 place-items-center"
                    >
                      {showPassword ? (
                        <Icon.conceal className="size-4" />
                      ) : (
                        <Icon.reveal className="size-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("login_password_hint")}
                  </p>
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
                      <Icon.busy className="animate-spin" />{" "}
                      {t("login_working")}
                    </>
                  ) : (
                    t("login_submit")
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </Reveal>

        <Card className="bg-secondary mt-4 border-0 shadow-none">
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
