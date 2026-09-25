# Hướng dẫn cho người tiếp nhận dự án

Đọc file này trước khi sửa bất cứ dòng nào. Nó ghi những thứ **không đọc ra
được từ code**: vì sao chọn cách này, đã thử cách nào và thất bại ra sao.

---

## 1. Quy ước ngôn ngữ — không thương lượng

| Chỗ | Ngôn ngữ |
|---|---|
| Code, comment, tên biến, tên cột CSDL, biến `.env` | **Tiếng Anh** |
| Tài liệu trong `docs/`, `README.md` | **Tiếng Việt** |
| Câu chữ gửi cho khách | **`resources/messages.vi.json`** |

**Không được có chữ tiếng Việt nào trong code**, kể cả comment, kể cả chữ
`đ` của tiền. Ký tự tiền nằm ở khoá `currency` trong file tin nhắn.

Kiểm nhanh:

```bash
uv run python -c "
import pathlib, unicodedata
bad = [(f.name, i) for f in pathlib.Path('src/cashback').rglob('*.py')
       for i, l in enumerate(f.read_text(encoding='utf-8').splitlines(), 1)
       for c in l if ord(c) > 127 and 'LATIN' in unicodedata.name(c, '')]
print(bad or 'sach')"
```

---

## 2. Ba quy tắc tiền — ép trong code, đừng gỡ

Nằm ở `core/policy.py` và `ledger/repository.py`:

1. **Cashback tính từ hoa hồng Shopee ĐÃ DUYỆT**, không bao giờ từ số ước
   tính đã hiện cho khách. Số ước tính chỉ để tham khảo.
2. **Đơn đã có `paid_at` thì không xử lý lại.** Đối soát chạy chồng kỳ;
   thiếu chốt này là trả tiền hai ba lần cho một đơn.
3. **Không xoá khách còn nợ tiền.** `forget_customer()` từ chối, trừ khi
   `force=True`.

**Trần hoa hồng 40.000₫** (`SHOPEE_COMMISSION_CAP_VND`): Shopee giới hạn
phần của *họ* ở 40.000₫ mỗi đơn, phần shop bù thêm (XTRA) thì không.

```
tổng = min(giá × %Shopee, 40.000) + giá × %Shop
```

Kiểm trên 18 sản phẩm, đúng 18/18. **Bỏ quên trần này là hứa gấp gần 3 lần
số thật** — một chiếc xe 84,6 triệu sẽ được báo hoàn 2.368.800₫ thay vì
28.000₫.

**Một link chỉ thuộc về một khách.** sub_id1 của link là mã khách được
tạo link, và đối soát ghi mọi đơn trên link đó cho người ấy. Tái dùng link
theo *sản phẩm* (cache) là khách B mua thì tiền về khách A — đã xảy ra
thật (sửa ngày 25/9/2026). Thông tin sản phẩm (giá, hoa hồng) dùng chung
được; link thì chỉ tái dùng qua `ledger.find_own_request()`, tức theo
*khách*. Test: `tests/test_link_attribution.py`.

**Làm tròn tiền phải nửa-lên**, dùng `round_dong()`. `round()` của Python
làm tròn về số chẵn: `round(9262.5) = 9262`, trong khi mọi công cụ khác
trong thị trường hiện 9263.

---

## 3. Những đường đã thử và ĐÃ CHẾT — đừng thử lại

| Đường | Kết quả | Bằng chứng |
|---|---|---|
| Shopee Open API (`productOfferV2`) | Bị từ chối bằng email 10/9/2026 | Khoá từ 4/8/2023, chỉ mở cho KOC có nhân viên riêng |
| Gọi thẳng API nội bộ `/api/v3/gql` | **Cả phiên bị bắt giải captcha** | Thiếu `af-ac-enc-dat`, `x-sap-sec` → `error 90309999` |
| Thêm CSRF token vào request | Vẫn bị chặn y hệt | Đã thử 3 biến thể header |
| Product Feed (xuất cả kho) | "Không có dữ liệu" | Tài khoản chưa được cấp |
| Tra hoa hồng theo `item_id` | Không tồn tại | 8 đường dẫn 404, 5 tên tham số bị bỏ qua |
| Lật nhiều trang kết quả tìm kiếm | Bị đá sang `verify/traffic/error` | Phải reload tay mới chạy lại |

**Đừng dựng lại mấy header chữ ký.** Đó là vô hiệu hoá cơ chế chống bot, và
cũng là cách nhanh nhất mất tài khoản: chữ ký lệch với thiết bị thật là tín
hiệu mạnh hơn nhiều so với gọi hơi nhiều.

Đầy đủ: [`docs/04-reference/shopee-api-findings.md`](docs/04-reference/shopee-api-findings.md)

---

## 4. Những bẫy đã dính, đừng dính lại

**Tab chạy script phải đúng trang.** URL tương đối (`/api/v3/...`) sẽ hỏng
nếu tab đã bị điều hướng đi chỗ khác. Luôn kiểm `location.href` trước.

**Chỉ đọc trang 1 khi tra hoa hồng.** Lật trang để săn cho ra là đúng cái
làm dính `verify/traffic/error`.

**`sub_id` chỉ nhận `a-zA-Z0-9`.** Dấu gạch ngang làm hỏng attribution
lặng lẽ — đơn về nhưng không gắn được vào khách nào. Chặn ngay từ lúc sinh
trong `core/identifiers.py`.

**`sub_id` dùng chung cho cả 5 link trong một lần submit.** Nên **không
trộn nhiều khách trong một lần submit** — phải gom theo từng khách rồi chia 5.

**Antd là React**: gán `.value` trực tiếp thì form submit rỗng. Phải set
qua native setter rồi dispatch `input` + `change`.

**Không còn Zalo Bot API.** Từ 25/9/2026 mọi tin nhắn đi qua
`zalo_assistant/` — một **tài khoản Zalo cá nhân** chạy bằng `zca-js`
(thư viện không chính thức). Assistant trả lời khách; backend chỉ *chủ
động* nói (link xong muộn, đơn duyệt, đã chuyển tiền) qua
`messaging/notifications.py` → `/api/notify` của assistant. Tài khoản đó
bị khoá là mất liên lạc với mọi khách cùng lúc: giữ delay giống người,
đừng gọi API Zalo dồn dập, website là kênh dự phòng.

**Zalo cấp UID theo tài khoản đang xem.** Cùng một người, nhìn từ tài
khoản bot cũ và mới là hai UID khác nhau. Ngày 24/9 bot đổi tài khoản →
34 người thành 2 dòng khách. Đổi tài khoản bot lần nữa thì chạy
`cashback merge-customers` (xem trước rồi mới `--apply`). UID cũ được giữ
làm **bí danh** (`customer_aliases`): đơn về từ link cũ vẫn đúng người,
gõ UID cũ vẫn đăng nhập được, và không tạo lại được khách bằng UID đó.

**Kết bạn chỉ với người tự nhắn riêng trước** (`zalo_assistant/friends.js`):
mỗi người một lần, chờ ngẫu nhiên, tối đa `ZALO_FRIEND_REQUESTS_PER_DAY`
lời mời/ngày; ai mời trước thì tự chấp nhận. **Đừng** gửi kết bạn hàng loạt
cho cả nhóm — đó là dấu hiệu spam Zalo hay khoá tài khoản cá nhân nhất.

**Một tài khoản Zalo chỉ một phiên.** Các script trong
`zalo_assistant/scripts/` đăng nhập thêm một phiên vào đúng tài khoản của
assistant — chạy lúc assistant đang chạy có thể đá phiên của nó ra. Bản
dev bắt buộc dùng tài khoản Zalo khác (`ZALO_CREDENTIALS_PATH`).

**Mã khách có hai lớp.** `customer_id` = UID, nằm trong sub_id của mọi
link đã phát, **không bao giờ đổi**. Khách nhìn thấy và đăng nhập bằng
`customer_code` (`DP00012`), do trigger cấp khi tạo khách, lấy từ bộ đếm
chỉ tăng — số của khách đã xoá không bao giờ cấp lại. Tra khách từ bất kỳ
dạng nào qua `ledger.find_customer_id()`.

**Web không được tạo khách.** Chỉ assistant (gọi từ localhost) mới tạo
khách mới, vì nó vừa thấy người đó trên Zalo. Từ internet: đăng nhập,
hoặc gõ một mã có thật (`_requester` trong `dashboard.py`). Mã sai → 404,
**không** bị đổi thành khách vãng lai. Tạo link dưới mã người khác không
lấy được tiền của ai — tiền về chủ mã — nên không cần mật khẩu để tạo
link; tiền và số tài khoản thì cần.

**Khách vãng lai → tài khoản `HOUSE`.** Chưa đăng nhập, không gõ mã thì
link gắn vào khách `HOUSE` (vai trò `house`): hoa hồng là của mình, khách
không được hoàn. Vì mọi khách vãng lai là cùng một người nhận tiền, **một
link cho mỗi sản phẩm** (`find_house_link`) — spam bao nhiêu cũng chỉ vào
Shopee một lần mỗi sản phẩm. `HOUSE` không có mã DP, `mark_approved` luôn
ghi tiền hoàn 0đ, không nằm trong danh sách chuyển tiền, không nhận thông
báo. Đơn của `HOUSE` **không bao giờ** gắn lại cho khách đăng ký sau.

Hợp đồng cho giao diện: `POST /api/shopee/convert` không kèm
`customer_id` khi chưa đăng nhập → `{ready, affiliate_url, request_id,
house: true}`; thấy `house: true` thì phải cảnh báo rõ link này **không**
hoàn tiền, nút chính là vào Zalo lấy mã. `ready: false` thì hỏi
`/api/shopee/link-status?request_id=…`. Lỗi `web_busy` (429) = web đã hết
suất tạo link (60/giờ cho cả web, 20/ngày mỗi mã) → hướng khách sang
Zalo, nơi không bị giới hạn. Hàng đợi phục vụ Zalo trước, rồi khách web,
cuối cùng `HOUSE`.

**Link đã trao thì đánh dấu `notified_at`.** Assistant tự chờ link 28
giây rồi trả lời trong chat; mọi chỗ trao link (`link-status`,
`smart-resolve`, `convert`) đánh dấu đã giao. Vòng thông báo chỉ gửi link
quá 35 giây chưa ai lấy và chưa quá 2 giờ — cũ hơn thì đánh dấu, không
gửi, để bật lại sau sự cố khách không nhận một loạt tin cũ.

**Nhãn web đọc lại ở mỗi request.** Sửa `resources/dashboard.vi.json` là
**web thật đổi ngay**, không cần restart. `web/src/lib/defaultLabels.json`
là bản sao đóng gói vào bundle — sửa nhãn thì chép sang, rồi build.

**Link tiếp thị KHÔNG hết hạn.** Bảy ngày của Shopee tính từ lúc khách
**bấm** link, không phải từ lúc tạo link. Link tạo một tháng trước, hôm nay
bấm thì vẫn ăn hoa hồng, và đối soát vẫn tìm được yêu cầu gốc dù dòng đó
mang trạng thái `expired`. Trạng thái `expired` chỉ là ghi sổ.

`LINK_ATTRIBUTION_DAYS` **không phải hạn dùng của link**. Nó phân biệt
*"tôi chưa nhận được"* với *"tôi đang tìm mua lại"*: quá hạn đó thì giá và
hoa hồng đã cũ, nên tạo yêu cầu mới để lấy số mới.

**Không còn ngưỡng chuyển tiền.** Từng có mức 50.000₫ mỗi khách. Đã bỏ
hẳn: đó là luật khách không nhìn thấy và không tác động được, làm mọi tin
nhắn về tiền phải giải thích chính sách thay vì nói về khoản tiền. Giờ
**mọi đơn đã duyệt và chưa trả đều trả được**, gom theo khách, chuyển lúc
nào là quyết định của chủ.

Hệ quả: tin báo đơn duyệt **không được hứa ngày**. Khách biết tiền đã đi
qua `order_paid`, gửi đúng lúc chủ bấm nút. Thứ duy nhất còn chặn được một
lần chuyển là **thiếu số tài khoản**, và cái đó chủ không tự gỡ được.

**Phần trăm không phải là số tiền.** *"Hoàn 80% hoa hồng"* không ai quy
ra tiền được, và người mua hàng bình thường hiểu nhầm thành 80% giá trị
đơn. Mọi chỗ nêu phần trăm phải kèm một ví dụ bằng đồng
(`EXAMPLE_ORDER_VND`, `EXAMPLE_RATE` trong `messaging/notifications.py`).

**Emoji cũng là câu chữ, không được nằm trong code.** Cùng lý do với
tiếng Việt: chúng thuộc `resources/messages.vi.json` (xem
`order_identity_product`). Kiểm bằng cách quét ký tự `> 0x2100` trong
`src/`.

**Danh sách tên miền Shopee phải nằm ở một chỗ duy nhất**
(`shopee/dashboard_lookup.py`). Đã từng có hai bản sao lệch nhau và link
`shp.ee` bị coi là tin nhắn thường suốt một buổi.

**Campaign (thưởng N suất đầu tiên)** nằm ở `ledger/campaigns.py`, dữ
liệu ở bảng `campaigns` + `campaign_awards`. Event mới là **một dòng mới**
(`cashback campaign-create`), không phải code mới. Luật đã chốt:

- Suất thuộc về **đơn**, không thuộc về người: một người có thể giành nhiều
  suất (`per_customer=0`). Muốn giới hạn thì `--per-customer N`.
- Xếp hạng theo `recorded_at` (lúc hệ thống ghi nhận đơn), chỉ đơn ghi
  nhận **trong** khung giờ event.
- Đơn huỷ **trong** event → suất chuyển cho đơn kế tiếp. Huỷ **sau** event
  → mất thưởng, suất **không** chuyển cho ai (`evaluate` chỉ lấp suất khi
  đang trong khung giờ).
- Thưởng chỉ trả khi đơn được duyệt, đi cùng tiền hoàn (`payouts.collect`
  cộng `bonus_owed`). Suất đang giữ (held) không bao giờ trả được.
- Nhân viên, `HOUSE`, và mã trong `--exclude` không bao giờ giữ suất.
- Tin nhắn: đơn mới giành suất → dòng suất nằm **trong** tin "đã ghi nhận
  đơn"; suất được chuyển sang đơn đã báo trước đó → tin riêng; mất suất →
  tin riêng (hai bản: còn event / đã hết). Tin trả link có dòng gợi ý khi
  event còn suất (`/api/campaigns/offer`, chỉ localhost). Đơn không thuộc
  event nào thì không nhắc gì.
- Không có campaign nào đang chạy thì mọi luồng cũ y hệt trước — đã kiểm
  trên bản sao dữ liệu thật (57 khách: /donhang, số dư, tin duyệt, chuyển
  tiền giống hệt). Test: `tests/test_campaigns.py`.

Thông báo vào nhóm: `cashback announce --text … --image … --group test`
(xem trước), thêm `--send` để gửi; tập ở `test` rồi mới `main`.

---

## 5. Trước khi bàn giao / chạy thật

- [ ] Kiểm trần hoa hồng mỗi đơn trong tài khoản affiliate của chính mình
- [ ] Đo ba chỉ số sau 100–300 đơn thật (`cashback metrics`)
- [ ] Chạy `cashback audit --scan` trước mỗi đợt chuyển tiền
- [ ] `cashback audit --archive` mỗi tháng để nén log
- [ ] Chép `backups/` ra ngoài máy định kỳ — bản sao cùng ổ đĩa không cứu
      được ổ đĩa hỏng
- [ ] `ASSISTANT_TOKEN` trong `.env` phải có, và giống nhau cho cả hai phía
      (backend và assistant cùng đọc một file `.env`)

---

## 6. Khi sửa code

**Trước khi sửa:** đọc docstring của module. Chúng ghi *vì sao*, không phải
*cái gì* — phần *cái gì* thì code đã nói rồi.

**Prod đang chạy ngay trong thư mục này.** Sửa file `.py`/`.js` chưa ảnh
hưởng gì tới khi restart; nhưng `resources/dashboard.vi.json` và build web
(`src/cashback/web/static/`) thì **đổi web thật ngay lập tức**. Build thử
thì ra thư mục khác: `npx vite build --outDir <thư mục tạm>`.

**Sau khi sửa:**

```bash
uv run pytest -q                 # 3 test frontend trong test_dashboard.py
                                 # đang fail sẵn (DashboardView.tsx)
uv run python -c "
import sys; sys.path.insert(0,'src')
import importlib, pkgutil, cashback
for m in pkgutil.walk_packages(cashback.__path__, 'cashback.'):
    importlib.import_module(m.name)
print('moi module import sach')"

uv run cashback --help          # parser còn dựng được không
uv run cashback status          # cấu hình đọc được không
node --check zalo_assistant/assistant_worker.js
```

**Sửa `resources/messages.vi.json` thì phải restart** — tin nhắn được
cache ở lần đọc đầu tiên.

**Thêm cột CSDL** thì thêm vào `_LATER_COLUMNS` trong `ledger/repository.py`,
đừng sửa DDL — `serve` tự chạy migration khi khởi động, **sau khi** đã tự
backup.

**Giữ nguyên kiểu xuống dòng của từng file** (có file CRLF, có file LF).
Ghi đè cả file bằng công cụ khác kiểu là diff phình ra cả nghìn dòng.

---

## 7. Bật/tắt, deploy

```powershell
start.bat          # bật cả 4: backend, assistant, tunnel, trình duyệt Shopee
```

`scripts/start-all.ps1` ghi PID từng cửa sổ vào `logs/pids/` và lần sau
chỉ tắt đúng những PID đó — không tắt theo tên, để một bản dev chạy cạnh
không làm sập prod (và ngược lại).

**Deploy một thay đổi:**

1. `uv run pytest -q` và checklist ở mục 6.
2. Tắt backend + assistant (đóng hai cửa sổ `[1]` và `[2]`).
3. Nếu có việc dữ liệu (ví dụ `merge-customers`): chạy bản xem trước,
   đọc kỹ, rồi mới `--apply`. Lệnh tự backup trước khi ghi.
4. Bật lại (`start.bat`). `serve` tự backup rồi mới migration.
5. Có sửa web thì `cd web && npm run build` (đổi web thật ngay khi xong).

Đừng để bot phụ thuộc trình duyệt hằng ngày: đóng nó là bot mất một chân.
`scripts/start-browser.ps1` dùng hồ sơ riêng ở `.browser-profile/` nên hai
thứ độc lập hoàn toàn.

**Bản dev** (chưa dựng): thư mục riêng, `.env` riêng với `DASHBOARD_PORT`,
`BRIDGE_PORT`, `ASSISTANT_PORT` khác prod, `PUBLIC_PORT=0`, tài khoản Zalo
riêng (`ZALO_CREDENTIALS_PATH`), nhóm dev (`ZALO_LISTEN_GROUP_IDS`), và bản
sao database. Link Shopee thật tạo từ dev mang UID thật của admin trong
sub_id — có đơn là ghi vào prod.
