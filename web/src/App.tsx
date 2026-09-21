import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Home } from "@/features/Home"
import { fetchLabels, fetchSite } from "@/lib/api"
import { configure } from "@/lib/format"
import { LabelProvider } from "@/lib/labels"
import { TITLE_KEY, navigate, useRoute } from "@/routes"

const CustomerView = React.lazy(() =>
  import("@/features/CustomerView").then((m) => ({ default: m.CustomerView }))
)
const Guide = React.lazy(() =>
  import("@/features/Guide").then((m) => ({ default: m.Guide }))
)
const Login = React.lazy(() =>
  import("@/features/Login").then((m) => ({ default: m.Login }))
)
const Console = React.lazy(() =>
  import("@/features/Console").then((m) => ({ default: m.Console }))
)

export default function App() {
  const labels = useQuery({
    queryKey: ["labels"],
    queryFn: fetchLabels,
    staleTime: Infinity,
  })
  // The rate and the payout window appear inside the wording, so they
  // are substituted into every label rather than passed at each call
  // site and forgotten at one of them.
  const site = useQuery({
    queryKey: ["site"],
    queryFn: fetchSite,
    staleTime: Infinity,
  })
  const route = useRoute()
  const queryClient = useQueryClient()

  if (labels.data) configure(labels.data)

  const brand = labels.data?.brand ?? ""
  const screen = labels.data?.[TITLE_KEY[route]] ?? ""
  React.useEffect(() => {
    if (!brand) return
    document.title =
      screen && screen !== brand ? `${screen} · ${brand}` : brand
  }, [brand, screen])

  return (
    <LabelProvider
      value={labels.data ?? {}}
      defaults={site.data ? { ...site.data } : {}}
    >
      <React.Suspense fallback={null}>
        {route === "home" && <Home />}
        {route === "login" && (
          <Login
            onSignedIn={() => {
              queryClient.invalidateQueries({ queryKey: ["me"] })
              navigate("orders")
            }}
          />
        )}
        {route === "orders" && <CustomerView />}
        {route === "guide" && <Guide />}
        {route === "admin" && <Console />}
      </React.Suspense>
    </LabelProvider>
  )
}
