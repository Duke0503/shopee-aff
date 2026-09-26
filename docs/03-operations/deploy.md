# Deploy: dựng server trên máy mới và cập nhật bản chạy thật

Tài liệu này dành cho người dựng hoặc chuyển server. Đọc hết mục 1 trước
khi làm bất cứ bước nào, vì mục đó nói về điều duy nhất có thể gây hại
thật: chạy hai máy cùng lúc.

---

## 1. Luật số một: không bao giờ chạy hai máy cùng lúc

| Thứ bị hỏng | Chuyện gì xảy ra nếu hai máy cùng chạy |
|---|---|
| **Tài khoản Zalo** | Một tài khoản chỉ giữ được một phiên. Hai assistant sẽ đá phiên nhau, Zalo coi đó là dấu hiệu bất thường và có thể **khoá tài khoản**. Khoá là mất liên lạc với mọi khách cùng lúc. |
| **Cloudflare tunnel** | Cùng một token thì traffic web bị chia cho cả hai máy. Khách lúc thấy dữ liệu mới, lúc thấy dữ liệu cũ. |
| **Database** | Mỗi máy có một bản `cashback.db`. Đơn và tiền ghi vào bản này thì bản kia không có, và không có cách gộp tự động. |

Máy cũ được giữ làm dự phòng, nhưng phải **tắt hẳn**. Muốn quay lại máy
cũ thì trước hết chép `cashback.db` mới nhất từ máy mới về.

---

## 2. Hệ thống gồm những gì

`start.bat` bật 4 cửa sổ, mỗi cửa sổ là một dịch vụ:

| Cửa sổ | Dịch vụ | Làm gì |
|---|---|---|
| `[1]` | Backend (`uv run cashback serve`) | Web + API ở cổng 8899, đối soát đơn, gửi thông báo, backup, campaign |
| `[2]` | Zalo assistant (`node assistant_worker.js`) | Tài khoản Zalo cá nhân: trả lời khách, gửi tin backend nhờ gửi |
| `[3]` | Cloudflare tunnel | Đưa web ra internet ở hoantiendp.com |
| `[4]` | Chrome + extension | Tạo link tiếp thị Shopee trên tài khoản affiliate đã đăng nhập |

PID của từng cửa sổ được ghi vào `logs/pids/`. Lần bật sau chỉ tắt đúng các
PID đó, nên một bản dev chạy cạnh không bị ảnh hưởng.

---

## 3. Máy mới cần cài

| Công cụ | Ghi chú |
|---|---|
| **Git** | Lấy code |
| **Node.js** bản LTS | Chạy assistant |
| **Chrome** (hoặc Edge) | Chạy extension |
| **uv** | `start.bat` tự cài qua winget nếu chưa có |
| **cloudflared** | `start.bat` tự cài qua winget nếu chưa có |

Cài đặt Windows nên chỉnh:

- **Tắt Sleep / Hibernate.** Máy ngủ là bot ngừng trả lời.
- Tắt tự khởi động lại sau Windows Update, hoặc đặt giờ cập nhật vào lúc vắng khách.
- Clone vào đường dẫn **không dấu, không khoảng trắng**, ví dụ `C:\Project\mmo`.

---

## 4. Những thứ không có trên git: phải chép tay

| File / thư mục | Là gì | Ghi chú |
|---|---|---|
| `.env` | Toàn bộ cấu hình và khoá: `ASSISTANT_TOKEN`, `CLOUDFLARE_TUNNEL_TOKEN`, `ACCESSTRADE_API_KEY`, ID nhóm Zalo, cổng… | Không có file này thì không chạy được gì |
| `zalo_assistant/credentials.json` | Phiên đăng nhập của tài khoản Zalo | Chép file này thì khỏi quét QR lại |
| `cashback.db` | Toàn bộ khách, đơn, tiền, campaign | **Chỉ chép sau khi đã tắt backend** |
| `backups/` | Các bản backup tự động | Nên chép theo để có đường lùi |

Không cần chép:

- `.browser-profile/`: đăng nhập Shopee Affiliate lại một lần trên máy mới là xong.
- `extension/background/base_url.js`: `start.bat` tự tạo (`cashback setup-token`).
- `.venv/`, `node_modules/`: cài lại ở bước 5.

Các file trên chứa khoá và dữ liệu khách. Chép qua USB hoặc ổ mạng nội bộ,
**đừng** gửi qua Zalo, email hay dán lên chat.

---

## 5. Dựng máy mới, từng bước

### Bước 1: đưa code mới nhất lên GitHub (làm ở máy cũ)

```powershell
git status          # phải sạch; còn thay đổi thì commit trước
git push origin main
```

### Bước 2: chuẩn bị máy mới (máy cũ vẫn chạy bình thường)

```powershell
git clone https://github.com/Duke0503/shopee-aff.git C:\Project\mmo
cd C:\Project\mmo
uv sync
cd zalo_assistant
npm install
cd ..
```

Chép `.env` vào `C:\Project\mmo\`. **Chưa bật gì cả.**

### Bước 3: chuyển (khách không được trả lời khoảng 10–15 phút)

Chọn lúc vắng khách, ví dụ đêm khuya.

1. **Máy cũ:** đóng cả 4 cửa sổ `[1]` đến `[4]`. Kiểm tra lại trong Task
   Manager: không còn `node.exe` chạy `assistant_worker.js` và không còn
   `cloudflared.exe`.
2. Chép `cashback.db`, `backups/` và `zalo_assistant/credentials.json` sang máy mới.
3. **Máy mới:** chạy `start.bat`. Backend tự backup rồi mới chạy migration.
4. Cửa sổ Chrome `[4]` mở ra: đăng nhập tài khoản **Shopee Affiliate** một lần.
   Hồ sơ trình duyệt được giữ lại, nên các lần sau không phải đăng nhập nữa.

Đơn về trong lúc tắt máy không mất: backend bật lại sẽ đối soát bù. Chỉ có
tin khách nhắn trong khoảng đó là không được trả lời.

### Bước 4: kiểm tra

```powershell
uv run cashback status            # đọc được cấu hình
uv run cashback campaign-status   # campaign đang chạy (nếu có) còn đúng
```

Thử bằng tay:

- [ ] Nhắn riêng assistant một link Shopee: tin trả có **giá và hoa hồng**,
      và có dòng 🏮 nếu đang có event.
- [ ] Gõ `/donhang`: ra danh sách đơn.
- [ ] Mở https://hoantiendp.com: đăng nhập được bằng mã `DPxxxxx`.
- [ ] Trang admin hiện đơn và ảnh sản phẩm.

Tin trả link **thiếu giá** thường là do cửa sổ Chrome `[4]` đang ở trang lỗi
hoặc trang captcha của Shopee. Reload tay trong cửa sổ đó là tra giá chạy lại.

---

## 6. Cập nhật code trên máy đang chạy

```powershell
git pull origin main
uv sync                                  # nếu có thêm thư viện Python
cd zalo_assistant; npm install; cd ..    # nếu package.json đổi
uv run pytest -q                         # 3 test frontend trong test_dashboard.py đang fail sẵn
node --check zalo_assistant/assistant_worker.js
```

Sau đó:

1. Đóng cửa sổ `[1]` và `[2]`.
2. Nếu có việc dữ liệu (ví dụ `merge-customers`), chạy bản xem trước, đọc kỹ,
   rồi mới thêm `--apply`.
3. Chạy lại `start.bat`.

Thay đổi có hiệu lực vào lúc nào:

| Sửa gì | Khi nào có hiệu lực |
|---|---|
| File `.py` | Sau khi restart backend `[1]` |
| File `.js` trong `zalo_assistant/` | Sau khi restart assistant `[2]` |
| `resources/messages.vi.json` (tin nhắn cho khách) | Sau khi restart **cả** backend và assistant |
| `resources/dashboard.vi.json` (nhãn web) | **Ngay lập tức**, không cần restart |
| Build web (`cd web && npm run build`) | **Ngay lập tức** khi build xong |

Vì hai dòng cuối đổi web thật ngay, muốn build thử thì ra thư mục tạm:
`npx vite build --outDir <thư mục tạm>`.

---

## 7. Những tình huống đặc biệt

**Đổi tài khoản Zalo của assistant.** Zalo cấp UID theo tài khoản đang xem,
nên sau khi đổi, mỗi khách mang một UID mới. Chạy
`uv run cashback merge-customers` để xem trước, đọc kỹ, rồi thêm `--apply`.
UID cũ được giữ làm bí danh, nên đơn từ link cũ vẫn về đúng người. Dùng lại
đúng `credentials.json` cũ thì không gặp chuyện này.

**Mất `credentials.json`.** Chạy `node login.js` trong `zalo_assistant/` và
quét QR bằng điện thoại đang đăng nhập tài khoản đó. Mã QR hiện ngay trong
terminal và được lưu thành `zalo_assistant/qr.png`. Dòng báo "Lỗi copy QR sang
artifact" trên máy mới là bình thường, bỏ qua được. Làm lúc assistant **đang
tắt**.

**Bật một campaign mới.** Tạo campaign là thêm dữ liệu, không phải sửa code:

```powershell
uv run cashback campaign-create --id <id> --name "<tên>" --starts 2026-10-01T00:00:00+07:00 --ends 2026-10-03T00:00:00+07:00 --slots 20 --bonus 20000
# đọc lại bản xem trước rồi chạy lại với --apply
```

Gửi thông báo vào nhóm thì tập trước ở nhóm test:

```powershell
uv run cashback announce --text <file.txt> --image <ảnh.png> --group test --send
uv run cashback announce --text <file.txt> --image <ảnh.png> --group main --send
```

**Lùi về bản database trước.** Tắt backend, chép một file trong `backups/`
đè lên `cashback.db`, rồi bật lại. Mọi thứ ghi sau thời điểm của bản backup
sẽ mất, nên chỉ làm khi thật cần.

---

## 8. Việc định kỳ

- [ ] `uv run cashback audit --scan` trước mỗi đợt chuyển tiền.
- [ ] `uv run cashback audit --archive` mỗi tháng.
- [ ] Chép `backups/` ra **ngoài máy** (ổ khác, cloud) định kỳ. Backup nằm cùng
      ổ đĩa không cứu được khi ổ hỏng.
- [ ] Xem cửa sổ Chrome `[4]` vẫn đăng nhập Shopee Affiliate và không kẹt ở trang lỗi.
