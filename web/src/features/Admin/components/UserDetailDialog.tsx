import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  fetchAdminUserDetail,
  recordAdminTransfer,
  type AdminUser,
  type UserDetailData,
} from "@/lib/api"
import { vnd, shortDate } from "@/lib/format"
import { EmptyDash } from "@/features/Admin/components/EmptyDash"
import { CodeBadge } from "@/features/Admin/components/CodeBadge"
import { OrderFinancialCard } from "@/features/Admin/components/OrderFinancialCard"
import {
  User,
  CreditCard,
  ShoppingBag,
  Link2,
  Banknote,
  Loader2,
  Send,
  Calendar,
  Clock,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Timer,
  Copy,
  Check,
  Upload,
  Image as ImageIcon,
  X,
} from "lucide-react"

interface UserDetailDialogProps {
  user: AdminUser | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "warning" | "info" | "secondary"; icon: React.ReactNode }> = {
  paid: { label: "Đã thanh toán", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
  approved: { label: "Đã duyệt", variant: "info", icon: <CheckCircle2 className="h-3 w-3" /> },
  awaiting_approval: { label: "Chờ duyệt", variant: "warning", icon: <Timer className="h-3 w-3" /> },
  rejected: { label: "Từ chối", variant: "secondary", icon: <XCircle className="h-3 w-3" /> },
}

export function UserDetailDialog({ user, open, onOpenChange }: UserDetailDialogProps) {
  const queryClient = useQueryClient()
  const [transferAmount, setTransferAmount] = React.useState("")
  const [transferCode, setTransferCode] = React.useState("")
  const [transferNote, setTransferNote] = React.useState("")
  const [proofImage, setProofImage] = React.useState<string>("")
  const [copiedBank, setCopiedBank] = React.useState(false)
  const [viewingProof, setViewingProof] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-detail", user?.customer_id],
    queryFn: () => fetchAdminUserDetail(user!.customer_id),
    enabled: open && !!user?.customer_id,
  })

  // Set default transfer amount to ready_amount when dialog opens or data loads
  React.useEffect(() => {
    if (data?.stats?.ready_amount && data.stats.ready_amount > 0) {
      setTransferAmount(String(data.stats.ready_amount))
    } else if (user?.ready_amount && user.ready_amount > 0) {
      setTransferAmount(String(user.ready_amount))
    }
  }, [data?.stats?.ready_amount, user?.ready_amount, open])

  const transferMutation = useMutation({
    mutationFn: recordAdminTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-detail", user?.customer_id] })
      queryClient.invalidateQueries({ queryKey: ["admin-users"] })
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] })
      setTransferAmount("")
      setTransferCode("")
      setTransferNote("")
      setProofImage("")
    },
  })

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const b64 = event.target?.result as string
      setProofImage(b64)
    }
    reader.readAsDataURL(file)
  }

  const handleCopyBank = () => {
    if (!user?.bank_account) return
    const text = `${user.bank_name || ''} - ${user.bank_account} - ${user.account_holder || ''}`
    navigator.clipboard.writeText(text)
    setCopiedBank(true)
    setTimeout(() => setCopiedBank(false), 2000)
  }

  const handleTransfer = () => {
    if (!user || !transferAmount) return
    transferMutation.mutate({
      customer_id: user.customer_id,
      amount: Number(transferAmount),
      transfer_code: transferCode || undefined,
      note: transferNote || undefined,
      proof_image: proofImage || undefined,
    })
  }

  const detail = data as UserDetailData | undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <span>{user?.display_name || user?.customer_id || "Chi tiết khách hàng"}</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" /> Đang tải...
          </div>
        ) : detail ? (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {/* Stats Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0 mb-3">
              <StatCard label="Tổng tiền Aff" value={detail.stats.total_cashback} color="text-blue-600 dark:text-blue-400" />
              <StatCard label="Có thể nhận" value={detail.stats.ready_amount} color="text-emerald-600 dark:text-emerald-400" />
              <StatCard label="Đã chuyển" value={detail.stats.paid_amount} color="text-foreground" />
              <StatCard label="Chờ duyệt" value={detail.stats.awaiting_amount} color="text-amber-600 dark:text-amber-400" />
            </div>

            {/* Tabs */}
            <Tabs defaultValue="orders" className="flex-1 min-h-0 flex flex-col">
              <TabsList className="shrink-0">
                <TabsTrigger value="orders" className="text-xs gap-1">
                  <ShoppingBag className="h-3.5 w-3.5" /> Đơn Hàng ({detail.orders?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="requests" className="text-xs gap-1">
                  <Link2 className="h-3.5 w-3.5" /> Link Requests ({detail.link_requests?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="transfers" className="text-xs gap-1">
                  <Banknote className="h-3.5 w-3.5" /> Chuyển Khoản ({detail.transfers?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="profile" className="text-xs gap-1">
                  <User className="h-3.5 w-3.5" /> Hồ Sơ
                </TabsTrigger>
              </TabsList>

              {/* Orders Tab */}
              <TabsContent value="orders" className="flex-1 min-h-0 overflow-auto">
                {detail.orders?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Mã Đơn</TableHead>
                        <TableHead className="text-xs">Sản Phẩm</TableHead>
                        <TableHead className="text-xs text-right">Giá Trị</TableHead>
                        <TableHead className="text-xs text-right">Hoàn Tiền</TableHead>
                        <TableHead className="text-xs text-right text-emerald-600">Lợi Nhuận Mình</TableHead>
                        <TableHead className="text-xs text-center">Trạng Thái</TableHead>
                        <TableHead className="text-xs">Ngày</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.orders.map((o) => {
                        const sb = STATUS_BADGE[o.status] || STATUS_BADGE.awaiting_approval
                        return (
                          <TableRow key={o.order_id}>
                            <TableCell><CodeBadge code={o.order_id} variant="purple" /></TableCell>
                            <TableCell className="text-xs max-w-[180px] truncate" title={o.product}>{o.product}</TableCell>
                            <TableCell className="text-xs text-right"><EmptyDash value={o.order_value} type="currency" /></TableCell>
                            <TableCell className="text-xs text-right font-medium text-foreground"><EmptyDash value={o.cashback_amount} type="currency" /></TableCell>
                            <TableCell className="text-xs text-right whitespace-nowrap">
                              <OrderFinancialCard order={o} />
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant={sb.variant} className="text-[10px] gap-1">{sb.icon} {sb.label}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {shortDate(o.recorded_at || o.approved_at)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="py-8 text-center text-xs text-muted-foreground">Chưa có đơn hàng nào</div>
                )}
              </TabsContent>

              {/* Link Requests Tab */}
              <TabsContent value="requests" className="flex-1 min-h-0 overflow-auto">
                {detail.link_requests?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Sản Phẩm</TableHead>
                        <TableHead className="text-xs">Ngày Hỏi</TableHead>
                        <TableHead className="text-xs text-center">Link Aff</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.link_requests.map((r) => (
                        <TableRow key={r.request_id}>
                          <TableCell className="text-xs max-w-[300px]">
                            <div className="truncate" title={r.name || r.source_url}>{r.name || r.source_url}</div>
                            <div className="text-[10px] text-muted-foreground font-mono truncate" title={r.source_url}>{r.source_url}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{shortDate(r.created_at)}</TableCell>
                          <TableCell className="text-center">
                            {r.affiliate_url ? (
                              <a href={r.affiliate_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary text-[10px]">
                                <ExternalLink className="h-3 w-3" /> Có
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="py-8 text-center text-xs text-muted-foreground">Chưa có yêu cầu link nào</div>
                )}
              </TabsContent>

              {/* Transfers Tab */}
              <TabsContent value="transfers" className="flex-1 min-h-0 overflow-auto space-y-3">
                {/* Bank Account Quick Copy Card */}
                {user?.bank_account && (
                  <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <CreditCard className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-foreground flex items-center gap-2">
                          <span>{user.bank_name}</span>
                          <CodeBadge code={user.bank_account} variant="primary" />
                        </div>
                        <div className="text-[11px] text-muted-foreground uppercase font-medium mt-0.5">
                          Chủ TK: {user.account_holder || user.display_name}
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyBank}
                      className="h-8 gap-1.5 text-xs"
                    >
                      {copiedBank ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedBank ? "Đã chép STK" : "Sao chép STK"}
                    </Button>
                  </div>
                )}

                {/* Record New Transfer Form */}
                <Card className="p-3.5 shrink-0 border-border/80">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                      <Send className="h-3.5 w-3.5 text-primary" /> Ghi nhận chuyển khoản hoa hồng
                    </div>
                    {detail.stats.ready_amount > 0 && (
                      <button
                        type="button"
                        onClick={() => setTransferAmount(String(detail.stats.ready_amount))}
                        className="text-[11px] text-primary hover:underline font-medium cursor-pointer"
                      >
                        Nạp số tiền có thể nhận ({vnd(detail.stats.ready_amount)})
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2.5">
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Số tiền (VNĐ) *</label>
                      <Input
                        type="number"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        placeholder="Số tiền (VNĐ)"
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Mã giao dịch / Mã chuyển khoản</label>
                      <Input
                        value={transferCode}
                        onChange={(e) => setTransferCode(e.target.value)}
                        placeholder="VD: FT260921..."
                        className="text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Ghi chú chuyển tiền</label>
                      <Input
                        value={transferNote}
                        onChange={(e) => setTransferNote(e.target.value)}
                        placeholder="VD: Hoàn tiền Shopee tháng 9"
                        className="text-xs"
                      />
                    </div>
                  </div>

                  {/* Proof Image Upload */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-2 border-t border-border/50">
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-8 text-xs gap-1.5"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {proofImage ? "Thay đổi ảnh bill" : "Tải ảnh bill / ủy nhiệm chi"}
                      </Button>

                      {proofImage && (
                        <div className="relative inline-block">
                          <img
                            src={proofImage}
                            alt="Bill preview"
                            onClick={() => setViewingProof(proofImage)}
                            className="h-8 w-12 object-cover rounded border border-border cursor-pointer hover:opacity-80"
                          />
                          <button
                            type="button"
                            onClick={() => setProofImage("")}
                            className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full p-0.5"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <Button
                      size="sm"
                      onClick={handleTransfer}
                      disabled={!transferAmount || transferMutation.isPending}
                      className="text-xs h-8 gap-1.5 font-semibold"
                    >
                      {transferMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      Xác nhận chuyển khoản & Đổi trạng thái đơn
                    </Button>
                  </div>

                  {transferMutation.isSuccess && (
                    <p className="text-[11px] text-emerald-600 mt-2 flex items-center gap-1 font-medium">
                      <Check className="h-3.5 w-3.5" /> Đã ghi nhận chuyển khoản thành công và cập nhật trạng thái đơn!
                    </p>
                  )}
                  {transferMutation.isError && (
                    <p className="text-[11px] text-destructive mt-2">Lỗi khi ghi nhận chuyển khoản. Vui lòng thử lại.</p>
                  )}
                </Card>

                {/* Transfer History */}
                {detail.transfers?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Ngày</TableHead>
                        <TableHead className="text-xs text-right">Số Tiền</TableHead>
                        <TableHead className="text-xs">Mã CK</TableHead>
                        <TableHead className="text-xs">Ảnh Bill</TableHead>
                        <TableHead className="text-xs">Ghi Chú</TableHead>
                        <TableHead className="text-xs">Người Chuyển</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.transfers.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="text-xs whitespace-nowrap">{shortDate(t.created_at)}</TableCell>
                          <TableCell className="text-xs text-right font-semibold text-emerald-600">{vnd(t.amount)}</TableCell>
                          <TableCell>{t.transfer_code ? <CodeBadge code={t.transfer_code} variant="default" /> : "—"}</TableCell>
                          <TableCell>
                            {t.proof_image ? (
                              <button
                                type="button"
                                onClick={() => setViewingProof(t.proof_image)}
                                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                              >
                                <ImageIcon className="h-3 w-3" /> Xem ảnh
                              </button>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{t.note || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{t.created_by || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="py-6 text-center text-xs text-muted-foreground">Chưa có lịch sử chuyển khoản</div>
                )}
              </TabsContent>

              {/* Profile Tab */}
              <TabsContent value="profile" className="flex-1 min-h-0 overflow-auto">
                <Card className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <ProfileRow icon={<User className="h-3.5 w-3.5" />} label="Tên hiển thị" value={user?.display_name || "—"} />
                    <ProfileRow
                      icon={<User className="h-3.5 w-3.5" />}
                      label="Mã Khách Hàng (Customer ID)"
                      value={user?.customer_id ? <CodeBadge code={user.customer_id} variant="blue" /> : "—"}
                    />
                    <ProfileRow
                      icon={<User className="h-3.5 w-3.5" />}
                      label="Zalo User ID"
                      value={user?.zalo_user_id ? <CodeBadge code={user.zalo_user_id} /> : "—"}
                    />
                    <ProfileRow icon={<Calendar className="h-3.5 w-3.5" />} label="Ngày tham gia" value={user?.created_at ? shortDate(user.created_at) : "—"} />
                    <ProfileRow icon={<Clock className="h-3.5 w-3.5" />} label="Đăng nhập web cuối" value={user?.last_login_at ? shortDate(user.last_login_at) : "Chưa"} />
                    <ProfileRow icon={<Clock className="h-3.5 w-3.5" />} label="Hỏi bot cuối" value={user?.last_bot_activity ? shortDate(user.last_bot_activity) : "Chưa"} />
                    {user?.bank_name && (
                      <>
                        <ProfileRow icon={<CreditCard className="h-3.5 w-3.5" />} label="Ngân hàng" value={user.bank_name} />
                        <ProfileRow
                          icon={<CreditCard className="h-3.5 w-3.5" />}
                          label="Số Tài Khoản"
                          value={
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <CodeBadge code={user.bank_account || ""} variant="primary" />
                              {user.account_holder && (
                                <span className="text-[11px] text-muted-foreground uppercase font-medium">({user.account_holder})</span>
                              )}
                            </div>
                          }
                        />
                      </>
                    )}
                    <ProfileRow icon={<ShoppingBag className="h-3.5 w-3.5" />} label="Tổng đơn hàng" value={String(detail.stats.total_orders)} />
                    <ProfileRow icon={<Link2 className="h-3.5 w-3.5" />} label="Tổng lượt hỏi" value={String(detail.stats.total_requests)} />
                  </div>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <AlertCircle className="mx-auto mb-2 h-5 w-5 text-destructive" />
            Không thể tải thông tin khách hàng
          </div>
        )}

        {/* Proof Image Viewer Lightbox */}
        {viewingProof && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs animate-in fade-in"
            onClick={() => setViewingProof(null)}
          >
            <div className="relative max-h-[85vh] max-w-[90vw] overflow-hidden rounded-xl bg-card p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <span className="text-xs font-bold">Hình ảnh chứng từ chuyển tiền</span>
                <button
                  onClick={() => setViewingProof(null)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <img
                src={viewingProof}
                alt="Proof"
                className="max-h-[75vh] w-auto max-w-full rounded object-contain mt-2"
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <Card className="px-3 py-2 text-center">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold mt-0.5">
        <EmptyDash value={value} type="currency" className={color} />
      </div>
    </Card>
  )
}

function ProfileRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-secondary/20 p-2.5">
      <span className="text-muted-foreground shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className={`text-xs font-medium text-foreground truncate ${mono ? "font-mono" : ""}`}>{value}</div>
      </div>
    </div>
  )
}
