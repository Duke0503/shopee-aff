import * as React from "react"

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light"
    const saved = localStorage.getItem("theme")
    if (saved === "light" || saved === "dark") return saved
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })

  React.useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark")
      root.classList.add("dark")
    } else {
      root.setAttribute("data-theme", "light")
      root.classList.remove("dark")
    }
    localStorage.setItem("theme", theme)
  }, [theme])

  // Listen to system changes if user hasn't explicitly set a preference
  React.useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem("theme")) {
        setTheme(e.matches ? "dark" : "light")
      }
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  const toggle = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`p-2.5 rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all flex items-center justify-center cursor-pointer shrink-0 ${className || ""}`}
      title={theme === "dark" ? "Chuyển sang giao diện Sáng" : "Chuyển sang giao diện Tối"}
      aria-label="Toggle Theme"
    >
      {theme === "dark" ? (
        <span className="material-symbols-outlined text-xl text-amber-400">light_mode</span>
      ) : (
        <span className="material-symbols-outlined text-xl">dark_mode</span>
      )}
    </button>
  )
}
