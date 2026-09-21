import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { adminLogin } from "@/lib/api"
import { ShieldCheck, Lock, User, AlertCircle, Loader2 } from "lucide-react"

export function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const queryClient = useQueryClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError("Vui lòng nhập đầy đủ tài khoản và mật khẩu")
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await adminLogin(username.trim(), password)
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: ["me"] })
        await queryClient.invalidateQueries({ queryKey: ["admin-metrics"] })
        onSuccess()
      } else {
        setError(res.message || "Tài khoản hoặc mật khẩu không chính xác.")
      }
    } catch (err) {
      setError("Lỗi kết nối tới máy chủ. Vui lòng thử lại sau.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md border-border/80 bg-card p-6 shadow-xl sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Cổng Quản Trị & Vận Hành
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Dành riêng cho Quản trị viên và Nhân viên hệ thống
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Tài khoản đăng nhập
            </label>
            <div className="relative">
              <User className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin hoặc mã nhân viên"
                className="pl-9 text-sm"
                autoFocus
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Mật khẩu bảo mật
            </label>
            <div className="relative">
              <Lock className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-9 text-sm"
                disabled={loading}
              />
            </div>
          </div>

          <Button type="submit" className="w-full font-medium" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Đang đăng nhập...
              </>
            ) : (
              "Đăng Nhập Quản Trị"
            )}
          </Button>
        </form>

        <div className="mt-6 border-t border-border/50 pt-4 text-center text-xs text-muted-foreground">
          Cần hỗ trợ phân quyền? Liên hệ quản trị viên cấp cao.
        </div>
      </Card>
    </div>
  )
}
