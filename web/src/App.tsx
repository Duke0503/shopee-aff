import { useQuery } from "@tanstack/react-query"
import { Icon } from "@/lib/icons"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PayoutCard } from "@/features/PayoutCard"
import { PipelineTable } from "@/features/PipelineTable"
import { CustomerView } from "@/features/CustomerView"
import { Home } from "@/features/Home"
import { Login } from "@/features/Login"
import { fetchLabels, fetchSite, fetchSnapshot } from "@/lib/api"
import { configure, shortDate, vnd } from "@/lib/format"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { LabelProvider, useT } from "@/lib/labels"
import { TITLE_KEY, navigate, useRoute } from "@/routes"

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
  useEffect(() => {
    if (!brand) return
    document.title =
      screen && screen !== brand ? `${screen} · ${brand}` : brand
  }, [brand, screen])

  return (
    <LabelProvider
      value={labels.data ?? {}}
      defaults={site.data ? { ...site.data } : {}}
    >
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
      {route === "admin" && <Console />}
    </LabelProvider>
  )
}

function Tile({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode
  label: string
  value: string
  note?: string
}) {
  return (
    <Card className="p-3.5">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </div>
      <div className="tnum mt-1 text-xl font-bold sm:text-2xl">{value}</div>
      {note && <div className="text-muted-foreground text-[11px]">{note}</div>}
    </Card>
  )
}

function Console() {
  const t = useT()
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["payouts"],
    queryFn: fetchSnapshot,
  })

  if (isLoading) {
    return <Shell><p className="text-muted-foreground text-sm">{t("loading")}</p></Shell>
  }
  if (error || !data) {
    return (
      <Shell>
        <p className="text-[var(--destructive)] text-sm">
          {t("load_failed", { reason: String(error) })}
        </p>
      </Shell>
    )
  }

  const { totals } = data
  const empty =
    !data.ready.length && !data.no_bank.length && !data.pipeline.length

  return (
    <Shell
      subtitle={t("subtitle", { time: shortDate(data.generated_at) })}
      onRefresh={() => refetch()}
      refreshing={isFetching}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          icon={<Icon.owed className="size-3.5" />}
          label={t("summary_owed")}
          value={vnd(totals.owed)}
          note={t("summary_customers", { count: totals.owed_customers })}
        />
        <Tile
          icon={<Icon.payable className="size-3.5" />}
          label={t("summary_ready")}
          value={vnd(totals.ready)}
          note={t("summary_customers", { count: data.ready.length })}
        />
        <Tile
          icon={<Icon.bank className="size-3.5" />}
          label={t("summary_no_bank")}
          value={vnd(totals.no_bank)}
          note={t("summary_customers", { count: data.no_bank.length })}
        />
        <Tile
          icon={<Icon.pending className="size-3.5" />}
          label={t("summary_pipeline")}
          value={vnd(totals.pipeline)}
          note={t("summary_orders", { count: totals.pipeline_orders })}
        />
      </div>

      {empty ? (
        <p className="text-muted-foreground mt-8 text-sm">{t("nothing_at_all")}</p>
      ) : (
        <Tabs defaultValue="ready" className="mt-6">
          <TabsList>
            <TabsTrigger value="ready">
              {t("tab_ready")} ({data.ready.length})
            </TabsTrigger>
            <TabsTrigger value="no_bank">
              {t("tab_no_bank")} ({data.no_bank.length})
            </TabsTrigger>
            <TabsTrigger value="pipeline">
              {t("tab_pipeline")} ({data.pipeline.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ready">
            <Hint text={t("section_ready_hint")} />
            <CardGrid entries={data.ready} empty={t("nothing_ready")} />
          </TabsContent>

          <TabsContent value="no_bank">
            <Hint text={t("section_no_bank_hint")} />
            <CardGrid entries={data.no_bank} empty={t("nothing_no_bank")} />
          </TabsContent>

          <TabsContent value="pipeline">
            <Hint text={t("section_pipeline_hint")} />
            {data.pipeline.length ? (
              <PipelineTable rows={data.pipeline} />
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("nothing_pipeline")}
              </p>
            )}
          </TabsContent>
        </Tabs>
      )}
    </Shell>
  )
}

function Hint({ text }: { text: string }) {
  return <p className="text-muted-foreground mb-3 text-xs">{text}</p>
}

function CardGrid({
  entries,
  empty,
}: {
  entries: React.ComponentProps<typeof PayoutCard>["entry"][]
  empty: string
}) {
  if (!entries.length) {
    return <p className="text-muted-foreground text-sm">{empty}</p>
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry) => (
        <PayoutCard key={entry.customer_id} entry={entry} />
      ))}
    </div>
  )
}

function Shell({
  children,
  subtitle,
  onRefresh,
  refreshing,
}: {
  children: React.ReactNode
  subtitle?: string
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const t = useT()
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold sm:text-xl">{t("title")}</h1>
          {subtitle && (
            <p className="text-muted-foreground text-xs">{subtitle}</p>
          )}
        </div>
        {onRefresh && (
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <Icon.refresh className={refreshing ? "animate-spin" : ""} />
            {t("refresh")}
          </Button>
        )}
      </header>
      {children}
    </div>
  )
}
