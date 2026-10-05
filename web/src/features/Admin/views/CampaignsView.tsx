import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { CurrencyInput } from "@/components/ui/CurrencyInput"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  fetchAdminCampaigns,
  createAdminCampaign,
} from "@/lib/api"
import { vnd, shortDate } from "@/lib/format"
import { CodeBadge } from "@/features/Admin/components/CodeBadge"
import {
  Gift,
  RefreshCw,
  Plus,
  Calendar,
  Layers,
  Coins,
  ShieldCheck,
  Clock,
  CheckCircle2,
  Users,
  ChevronDown,
  ChevronUp,
  ShoppingBag,
} from "lucide-react"

export function CampaignsView() {
  const queryClient = useQueryClient()
  const [expandedCampaignId, setExpandedCampaignId] = React.useState<string | null>("trungthu2026")
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [toastMessage, setToastMessage] = React.useState<{ text: string; type: "success" | "error" } | null>(null)

  // Query campaigns
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-campaigns"],
    queryFn: fetchAdminCampaigns,
    refetchInterval: 30_000,
  })

  // Toast auto-dismiss
  React.useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [toastMessage])

  // Form State for New Campaign
  const [newCid, setNewCid] = React.useState("")
  const [newName, setNewName] = React.useState("")
  const [newStartsAt, setNewStartsAt] = React.useState("")
  const [newEndsAt, setNewEndsAt] = React.useState("")
  const [newSlots, setNewSlots] = React.useState(20)
  const [newBonusVnd, setNewBonusVnd] = React.useState(20000)
  const [newMinOrderValue, setNewMinOrderValue] = React.useState(0)
  const [newPerCustomer, setNewPerCustomer] = React.useState(0)
  const [newPlatforms, setNewPlatforms] = React.useState("shopee,shopeefood,tiktok")

  // Create Campaign Mutation
  const createMutation = useMutation({
    mutationFn: () =>
      createAdminCampaign({
        campaign_id: newCid.trim(),
        name: newName.trim(),
        starts_at: newStartsAt.trim(),
        ends_at: newEndsAt.trim(),
        slots: newSlots,
        bonus_vnd: newBonusVnd,
        min_order_value: newMinOrderValue,
        per_customer: newPerCustomer,
        platforms: newPlatforms.trim(),
      }),
    onSuccess: (res) => {
      setToastMessage({ text: res.message || "Tạo chiến dịch thành công!", type: "success" })
      setCreateDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: ["admin-campaigns"] })
      queryClient.invalidateQueries({ queryKey: ["admin-metrics"] })
      // Reset form
      setNewCid("")
      setNewName("")
      setNewStartsAt("")
      setNewEndsAt("")
    },
    onError: (err: any) => {
      setToastMessage({ text: err.message || "Lỗi khi tạo chiến dịch", type: "error" })
    },
  })

  const campaigns = data?.campaigns || []
  const summary = data?.summary || {
    total_campaigns: 0,
    total_bonus_awarded: 0,
    total_bonus_paid: 0,
    total_slots_used: 0,
  }

  const toggleExpand = (cid: string) => {
    setExpandedCampaignId((prev) => (prev === cid ? null : cid))
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 space-y-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-xl px-4 py-3 text-xs font-semibold shadow-xl border animate-in slide-in-from-top-2 ${
            toastMessage.type === "success"
              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-500 backdrop-blur-md"
              : "bg-destructive/15 border-destructive/40 text-destructive backdrop-blur-md"
          }`}
        >
          {toastMessage.text}
        </div>
      )}

      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500 border border-amber-500/20">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                Chiến Dịch & Thưởng Sự Kiện
              </h2>
              <p className="text-xs text-muted-foreground">
                Quản lý các chương trình kích cầu mua sắm, tặng thêm thưởng (+20.000đ) và phân bổ slot
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            <span>Làm mới</span>
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
            className="h-8 gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold shadow-xs"
          >
            <Plus className="h-4 w-4" />
            <span>Tạo Chiến Dịch Mới</span>
          </Button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4 bg-card/70 border-border/70 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Tổng Chiến Dịch</span>
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-foreground">
            {summary.total_campaigns}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">Đang kích hoạt trên hệ thống</div>
        </Card>

        <Card className="p-4 bg-card/70 border-border/70 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Suất Thưởng Đã Phát</span>
            <Users className="h-4 w-4 text-sky-500" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-sky-500">
            {summary.total_slots_used} <span className="text-xs font-normal text-muted-foreground">suất</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">Đã gắn vào đơn hàng</div>
        </Card>

        <Card className="p-4 bg-card/70 border-border/70 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Tổng Thưởng Đã Gán</span>
            <Coins className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-amber-500">
            {vnd(summary.total_bonus_awarded)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">Ngân sách đã phát ra</div>
        </Card>

        <Card className="p-4 bg-card/70 border-border/70 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Đã Chi Trả Cho Khách</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-emerald-500">
            {vnd(summary.total_bonus_paid)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            Còn chờ trả: <strong className="text-foreground">{vnd(summary.total_bonus_awarded - summary.total_bonus_paid)}</strong>
          </div>
        </Card>
      </div>

      {/* Campaigns List Container */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mr-2 text-primary" /> Đang tải danh sách chiến dịch...
          </div>
        ) : campaigns.length === 0 ? (
          <Card className="p-12 text-center border-dashed border-border/80">
            <Gift className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-foreground">Chưa có chiến dịch nào</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Hãy bấm nút &ldquo;Tạo Chiến Dịch Mới&rdquo; để thiết lập chương trình thưởng kích cầu mua sắm.
            </p>
          </Card>
        ) : (
          campaigns.map((camp) => {
            const isExpanded = expandedCampaignId === camp.campaign_id
            const percent = camp.slots > 0 ? Math.round((camp.slots_used / camp.slots) * 100) : 0
            const nowIso = new Date().toISOString()
            const isFinished = camp.ends_at < nowIso
            const isUpcoming = camp.starts_at > nowIso
            const isRunning = !isFinished && !isUpcoming

            return (
              <Card
                key={camp.campaign_id}
                className="overflow-hidden border-border/80 bg-card/80 shadow-xs transition-all hover:border-border"
              >
                {/* Campaign Header Bar */}
                <div
                  onClick={() => toggleExpand(camp.campaign_id)}
                  className="p-4 sm:p-5 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 select-none hover:bg-secondary/20 transition-colors"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20">
                        {camp.campaign_id}
                      </span>
                      <h3 className="text-base font-bold text-foreground truncate">
                        {camp.name}
                      </h3>
                      {isRunning ? (
                        <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-semibold text-[10px]">
                          ● Đang diễn ra
                        </Badge>
                      ) : isFinished ? (
                        <Badge variant="outline" className="text-muted-foreground text-[10px]">
                          Đã kết thúc
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-blue-400 border-blue-500/30 bg-blue-500/10 text-[10px]">
                          Sắp diễn ra
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>
                          {camp.starts_at.slice(0, 16).replace("T", " ")} → {camp.ends_at.slice(0, 16).replace("T", " ")}
                        </span>
                      </div>
                      <span>•</span>
                      <div className="flex items-center gap-1">
                        <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="capitalize">{camp.platforms.replace(/,/g, ", ")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Progress & Slots Overview */}
                  <div className="flex items-center gap-4 sm:gap-6 self-start sm:self-center shrink-0">
                    <div className="text-left sm:text-right">
                      <div className="text-xs font-medium text-muted-foreground">
                        Suất thưởng: <strong className="text-foreground font-mono">{camp.slots_used} / {camp.slots}</strong> ({percent}%)
                      </div>
                      <div className="mt-1.5 w-36 sm:w-44 bg-secondary rounded-full h-2 overflow-hidden border border-border/60">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, percent)}%` }}
                        />
                      </div>
                    </div>

                    <div className="text-left sm:text-right min-w-[100px]">
                      <span className="text-[10px] text-muted-foreground block">Mức thưởng / đơn</span>
                      <strong className="text-sm font-bold text-amber-500 font-mono">
                        +{vnd(camp.bonus_vnd)}
                      </strong>
                    </div>

                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Collapsible Awards List & Metadata */}
                {isExpanded && (
                  <div className="border-t border-border/70 p-4 sm:p-5 bg-secondary/15 space-y-4">
                    {/* Metadata Chips */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-2.5 rounded-xl border border-border/60 bg-card/60">
                        <span className="text-[10px] text-muted-foreground block">Đơn hàng tối thiểu</span>
                        <strong className="text-foreground">{camp.min_order_value > 0 ? vnd(camp.min_order_value) : "0đ (Mọi đơn)"}</strong>
                      </div>
                      <div className="p-2.5 rounded-xl border border-border/60 bg-card/60">
                        <span className="text-[10px] text-muted-foreground block">Giới hạn mỗi khách</span>
                        <strong className="text-foreground">{camp.per_customer && camp.per_customer > 0 ? `${camp.per_customer} đơn / khách` : "Không giới hạn"}</strong>
                      </div>
                      <div className="p-2.5 rounded-xl border border-border/60 bg-card/60">
                        <span className="text-[10px] text-muted-foreground block">Tổng tiền thưởng đã gán</span>
                        <strong className="text-amber-500 font-mono">{vnd(camp.total_bonus_awarded)}</strong>
                      </div>
                      <div className="p-2.5 rounded-xl border border-border/60 bg-card/60">
                        <span className="text-[10px] text-muted-foreground block">Đã thực tế chi trả</span>
                        <strong className="text-emerald-500 font-mono">{vnd(camp.total_bonus_paid)}</strong>
                      </div>
                    </div>

                    {/* Awards Table */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <Gift className="h-3.5 w-3.5 text-amber-500" />
                          <span>Danh Sách Đơn Hàng Đạt Thưởng ({camp.awards.length} đơn)</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Slot tự động kích hoạt khi khách bấm tạo link & đơn được ghi nhận
                        </span>
                      </div>

                      {camp.awards.length === 0 ? (
                        <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-xl bg-card/40">
                          Chưa có đơn hàng nào nhận slot trong sự kiện này.
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-secondary/60 text-muted-foreground font-semibold border-b border-border/60">
                              <tr>
                                <th className="p-3 w-12 text-center">Slot</th>
                                <th className="p-3 font-semibold">Khách Hàng</th>
                                <th className="p-3 font-semibold">Mã Đơn & Sàn</th>
                                <th className="p-3 font-semibold text-right">Giá Trị Đơn</th>
                                <th className="p-3 font-semibold text-right">Tiền Thưởng</th>
                                <th className="p-3 font-semibold">Trạng Thái Slot</th>
                                <th className="p-3 font-semibold">Thời Gian Ghi Nhận</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                              {camp.awards.map((award, idx) => (
                                <tr key={award.id} className="hover:bg-secondary/30 transition-colors">
                                  <td className="p-3 text-center font-mono font-bold text-muted-foreground">
                                    #{idx + 1}
                                  </td>
                                  <td className="p-3">
                                    <div className="font-medium text-foreground">
                                      {award.display_name || "Khách hàng"}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground font-mono">
                                      {award.customer_code ? (
                                        <CodeBadge code={award.customer_code} />
                                      ) : (
                                        <span>{award.customer_id}</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="p-3">
                                    <div className="font-mono font-bold text-foreground">
                                      {award.order_id}
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <Badge variant="outline" className="text-[9px] px-1 py-0">
                                        {award.platform === "tiktok" ? "TikTok" : "Shopee"}
                                      </Badge>
                                      {award.order_status === "paid" ? (
                                        <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-emerald-500/10 text-emerald-400">
                                          Đã tất toán
                                        </Badge>
                                      ) : award.order_status === "approved" ? (
                                        <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-emerald-500/10 text-emerald-400">
                                          Đã duyệt
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-blue-500/10 text-blue-400">
                                          Chờ duyệt
                                        </Badge>
                                      )}
                                    </div>
                                  </td>
                                  <td className="p-3 text-right font-mono text-muted-foreground">
                                    {award.order_value ? vnd(award.order_value) : "—"}
                                  </td>
                                  <td className="p-3 text-right font-mono font-bold text-amber-500">
                                    +{vnd(award.amount)}
                                  </td>
                                  <td className="p-3">
                                    {award.status === "paid" ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                        <CheckCircle2 className="h-3 w-3" />
                                        <span>Đã chuyển tiền</span>
                                      </span>
                                    ) : award.status === "confirmed" ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20">
                                        <ShieldCheck className="h-3 w-3" />
                                        <span>Sẵn sàng chi trả</span>
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                                        <Clock className="h-3 w-3" />
                                        <span>Chờ chốt cùng đơn</span>
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-muted-foreground text-[11px] whitespace-nowrap">
                                    {shortDate(award.created_at)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>

      {/* Create Campaign Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg bg-card border-border shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Gift className="h-5 w-5 text-amber-500" />
              <span>Tạo Chương Trình Chiến Dịch Mới</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Thiết lập chương trình thưởng sự kiện tặng thêm tiền mặt cho đơn hàng đạt điều kiện.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Mã Chiến Dịch (ID viết liền) <span className="text-destructive">*</span>
                </label>
                <Input
                  placeholder="VD: 1010_sieusale"
                  value={newCid}
                  onChange={(e) => setNewCid(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Số suất thưởng (Slots)
                </label>
                <Input
                  type="number"
                  value={newSlots}
                  onChange={(e) => setNewSlots(Math.max(1, parseInt(e.target.value) || 20))}
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                Tên Chiến Dịch Hiển Thị <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="VD: Siêu Sale 10.10 Rinh Quà Khủng"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-xs font-medium"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Thời Gian Bắt Đầu <span className="text-destructive">*</span>
                </label>
                <Input
                  type="datetime-local"
                  value={newStartsAt}
                  onChange={(e) => setNewStartsAt(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Thời Gian Kết Thúc <span className="text-destructive">*</span>
                </label>
                <Input
                  type="datetime-local"
                  value={newEndsAt}
                  onChange={(e) => setNewEndsAt(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Tiền thưởng mỗi đơn (VND)
                </label>
                <CurrencyInput
                  value={newBonusVnd}
                  onValueChange={(val) => setNewBonusVnd(Math.max(0, val || 20000))}
                  className="h-8 font-mono font-bold text-amber-500 text-xs"
                  placeholder="20,000"
                  suffix="đ"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Đơn tối thiểu (0 = Không yêu cầu)
                </label>
                <CurrencyInput
                  value={newMinOrderValue}
                  onValueChange={(val) => setNewMinOrderValue(Math.max(0, val || 0))}
                  className="h-8 font-mono text-xs"
                  placeholder="0"
                  suffix="đ"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Giới hạn / khách (0 = Không giới hạn)
                </label>
                <Input
                  type="number"
                  value={newPerCustomer}
                  onChange={(e) => setNewPerCustomer(Math.max(0, parseInt(e.target.value) || 0))}
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Sàn áp dụng
                </label>
                <Input
                  value={newPlatforms}
                  onChange={(e) => setNewPlatforms(e.target.value)}
                  placeholder="shopee,shopeefood,tiktok"
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreateDialogOpen(false)}
              className="h-8 text-xs"
            >
              Hủy bỏ
            </Button>
            <Button
              type="button"
              disabled={createMutation.isPending || !newCid || !newName || !newStartsAt || !newEndsAt}
              onClick={() => createMutation.mutate()}
              className="h-8 text-xs bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold"
            >
              {createMutation.isPending ? "Đang tạo..." : "Xác Nhận Tạo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
