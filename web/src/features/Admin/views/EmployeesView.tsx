import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  fetchAdminEmployees,
  createAdminEmployee,
  updateAdminEmployee,
  type AdminEmployee,
} from "@/lib/api"
import { shortDate } from "@/lib/format"
import {
  UserPlus,
  Shield,
  UserCheck,
  X,
  AlertCircle,
  CheckCircle2,
  Search,
} from "lucide-react"
import { AdminTableLayout } from "@/features/Admin/components/AdminTableLayout"
import { PaginationBar } from "@/features/Admin/components/PaginationBar"
import { SortableHeader } from "@/features/Admin/components/SortableHeader"
import { EmptyDash } from "@/features/Admin/components/EmptyDash"

export function EmployeesView() {
  const queryClient = useQueryClient()
  const [page, setPage] = React.useState(1)
  const [limit, setLimit] = React.useState(20)
  const [searchTerm, setSearchTerm] = React.useState("")
  const [roleFilter, setRoleFilter] = React.useState("all")
  const [sortBy, setSortBy] = React.useState<string>("created_at")
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc")

  const handleSort = (column: string, order: "asc" | "desc") => {
    setSortBy(column)
    setSortOrder(order)
    setPage(1)
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admin-employees", page, limit, searchTerm, roleFilter, sortBy, sortOrder],
    queryFn: () =>
      fetchAdminEmployees({
        page,
        limit,
        search: searchTerm,
        role: roleFilter,
        sort_by: sortBy,
        sort_order: sortOrder,
      }),
  })

  const [showCreateModal, setShowCreateModal] = React.useState(false)
  const [newUsername, setNewUsername] = React.useState("")
  const [newDisplayName, setNewDisplayName] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [newRole, setNewRole] = React.useState<"employee" | "admin">("employee")
  const [formError, setFormError] = React.useState<string | null>(null)
  const [formSuccess, setFormSuccess] = React.useState<string | null>(null)

  // Edit / Reset Modal State
  const [editingEmp, setEditingEmp] = React.useState<AdminEmployee | null>(null)
  const [editRole, setEditRole] = React.useState<string>("employee")
  const [editStatus, setEditStatus] = React.useState<string>("active")
  const [editPassword, setEditPassword] = React.useState<string>("")

  const createMutation = useMutation({
    mutationFn: createAdminEmployee,
    onSuccess: (res) => {
      if (res.ok) {
        setFormSuccess(res.message || "Tạo nhân viên thành công!")
        setNewUsername("")
        setNewDisplayName("")
        setNewPassword("")
        queryClient.invalidateQueries({ queryKey: ["admin-employees"] })
        queryClient.invalidateQueries({ queryKey: ["admin-metrics"] })
        setTimeout(() => {
          setShowCreateModal(false)
          setFormSuccess(null)
        }, 1200)
      } else {
        setFormError(res.message || "Không thể tạo nhân viên")
      }
    },
    onError: () => {
      setFormError("Lỗi kết nối máy chủ")
    },
  })

  const updateMutation = useMutation({
    mutationFn: updateAdminEmployee,
    onSuccess: (res) => {
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["admin-employees"] })
        setEditingEmp(null)
        setEditPassword("")
      } else {
        alert(res.message || "Cập nhật thất bại")
      }
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUsername.trim() || !newPassword.trim()) {
      setFormError("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu")
      return
    }
    setFormError(null)
    createMutation.mutate({
      username: newUsername.trim(),
      password: newPassword.trim(),
      display_name: newDisplayName.trim() || newUsername.trim(),
      role: newRole,
    })
  }

  const handleUpdateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingEmp) return
    updateMutation.mutate({
      customer_id: editingEmp.customer_id,
      role: editRole,
      status: editStatus,
      new_password: editPassword.trim() || undefined,
    })
  }

  const employees = data?.employees || []
  const pagination = data?.pagination || {
    page,
    limit,
    total: employees.length,
    total_pages: Math.ceil(employees.length / limit) || 1,
  }

  const toolbar = (
    <Card className="p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setPage(1)
              }}
              placeholder="Tìm kiếm tài khoản, tên nhân sự..."
              className="pl-9 text-xs sm:text-sm"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value)
              setPage(1)
            }}
            className="h-9 rounded-lg border border-border/80 bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:w-40"
          >
            <option value="all">Tất cả vai trò</option>
            <option value="admin">Quản Trị (Admin)</option>
            <option value="employee">Vận Hành (Employee)</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="text-xs text-muted-foreground">
            Tổng số <strong className="text-foreground">{pagination.total}</strong> nhân sự
          </span>
          <Button
            onClick={() => {
              setFormError(null)
              setFormSuccess(null)
              setShowCreateModal(true)
            }}
            className="text-xs font-medium shrink-0"
            size="sm"
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Thêm Nhân Viên
          </Button>
        </div>
      </div>
    </Card>
  )

  const paginationBar = pagination.total > 0 ? (
    <PaginationBar
      page={pagination.page}
      totalPages={pagination.total_pages}
      totalItems={pagination.total}
      limit={pagination.limit}
      onPageChange={setPage}
      onLimitChange={(newLimit) => {
        setLimit(newLimit)
        setPage(1)
      }}
    />
  ) : null

  return (
    <>
      <AdminTableLayout
        toolbar={toolbar}
        pagination={paginationBar}
        isLoading={isLoading}
        isEmpty={employees.length === 0}
        loadingMessage="Đang tải danh sách nhân sự..."
        emptyMessage="Chưa có tài khoản nhân sự nào phù hợp."
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-secondary/95 backdrop-blur-xs">
            <TableRow>
              <TableHead className="min-w-[180px]">
                <SortableHeader
                  title="Tài Khoản / Tên"
                  column="name"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                  defaultOrder="asc"
                />
              </TableHead>
              <TableHead className="whitespace-nowrap">
                <SortableHeader
                  title="Vai Trò (Phân Quyền)"
                  column="role"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="whitespace-nowrap">
                <SortableHeader
                  title="Trạng Thái"
                  column="status"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="whitespace-nowrap">
                <SortableHeader
                  title="Đăng Nhập Cuối"
                  column="last_login"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="whitespace-nowrap text-center">
                <SortableHeader
                  title="Số Lần"
                  column="login_count"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                  align="center"
                />
              </TableHead>
              <TableHead className="whitespace-nowrap">
                <SortableHeader
                  title="Ngày Tạo"
                  column="created_at"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-right whitespace-nowrap">Thao Tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((emp) => {
              const isAdmin = emp.role === "admin"
              const isActive = emp.status === "active"
              return (
                <TableRow key={emp.customer_id}>
                  <TableCell>
                    <div className="font-semibold text-foreground">
                      {emp.display_name || emp.customer_id}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      @{emp.customer_id}
                    </div>
                  </TableCell>

                  <TableCell>
                    {isAdmin ? (
                      <Badge variant="default" className="bg-emerald-600 text-white">
                        <Shield className="mr-1 h-3 w-3" /> Quản Trị Viên (Admin)
                      </Badge>
                    ) : (
                      <Badge variant="info">
                        <UserCheck className="mr-1 h-3 w-3" /> Nhân Viên Vận Hành
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell>
                    {isActive ? (
                      <Badge variant="success" className="text-[11px]">
                        Hoạt động
                      </Badge>
                    ) : (
                      <Badge variant="danger" className="text-[11px]">
                        Tạm khóa
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground">
                    {emp.last_login_at ? shortDate(emp.last_login_at) : <EmptyDash value={null} />}
                  </TableCell>

                  <TableCell className="font-mono font-medium text-foreground">
                    <EmptyDash value={emp.login_count} />
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground">
                    {shortDate(emp.created_at)}
                  </TableCell>

                  <TableCell className="text-right">
                    <button
                      onClick={() => {
                        setEditingEmp(emp)
                        setEditRole(emp.role)
                        setEditStatus(emp.status)
                        setEditPassword("")
                      }}
                      className="rounded-lg border border-border/70 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary"
                    >
                      Sửa / Đổi MK
                    </button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </AdminTableLayout>

      {/* Modal: Create Employee */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <Card className="w-full max-w-md border-border bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">Thêm Nhân Sự Mới</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            {formSuccess && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 p-2.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{formSuccess}</span>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="mb-1 block font-medium text-foreground">
                  Tên đăng nhập (username)
                </label>
                <Input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="ví dụ: cskh_lan, nhanvien2"
                  className="text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-foreground">
                  Tên hiển thị
                </label>
                <Input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="ví dụ: Nguyễn Thị Lan (CSKH)"
                  className="text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-foreground">
                  Mật khẩu khởi tạo
                </label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự"
                  className="text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-foreground">
                  Vai trò (Phân quyền)
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "employee" | "admin")}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-2xs focus:outline-none"
                >
                  <option value="employee">
                    Nhân Viên Vận Hành (Chỉ duyệt đơn & hỗ trợ khách, ẩn tài chính)
                  </option>
                  <option value="admin">
                    Quản Trị Viên (Toàn quyền, thấy doanh thu, quản lý nhân viên)
                  </option>
                </select>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateModal(false)}
                >
                  Hủy
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Đang tạo..." : "Xác Nhận Tạo"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Modal: Edit Employee */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <Card className="w-full max-w-md border-border bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">
                Chỉnh Sửa: @{editingEmp.customer_id}
              </h3>
              <button
                onClick={() => setEditingEmp(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="mb-1 block font-medium text-foreground">
                  Vai trò phân quyền
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  disabled={editingEmp.customer_id === "admin"}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-2xs focus:outline-none disabled:opacity-50"
                >
                  <option value="employee">Nhân Viên Vận Hành</option>
                  <option value="admin">Quản Trị Viên</option>
                </select>
                {editingEmp.customer_id === "admin" && (
                  <span className="text-[10px] text-muted-foreground">
                    Không thể đổi vai trò của admin gốc
                  </span>
                )}
              </div>

              <div>
                <label className="mb-1 block font-medium text-foreground">
                  Trạng thái tài khoản
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  disabled={editingEmp.customer_id === "admin"}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-2xs focus:outline-none disabled:opacity-50"
                >
                  <option value="active">Hoạt động bình thường</option>
                  <option value="disabled">Tạm khóa tài khoản</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-foreground">
                  Đặt lại mật khẩu mới (để trống nếu không đổi)
                </label>
                <Input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Nhập mật khẩu mới nếu muốn reset..."
                  className="text-xs"
                />
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingEmp(null)}
                >
                  Hủy
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? "Đang lưu..." : "Lưu Thay Đổi"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  )
}
