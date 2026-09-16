import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import App from "./App"
import "./index.css"

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // The ledger changes when reconciliation runs, roughly hourly, and
      // when the operator acts. Polling every half minute keeps a page
      // left open overnight honest without hammering SQLite.
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
      retry: 1,
    },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
