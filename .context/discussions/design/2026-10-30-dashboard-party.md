# Party session: what the admin dashboard must show (2026-10-30)

- Mode: session. Asked by the project owner: "gọi phòng ban operation vào đi cần trình bày những gì ở
  dashboard để thể hiện hết được các con số business mà mình cần view lên để nhìn được toàn bộ tổng quan".
- Room: 🧾 Hà (Operations Lead), 📊 Mary (Business Analyst), 🏗️ Winston (Architect), 🎨 Sally (UX Designer).
- Input: the owner's earlier complaint ("chưa biết được Shopee trả bao nhiêu, hoàn khách bao nhiêu, trong
  khoảng thời gian đó có event không thì chi cho event bao nhiêu, rồi lợi nhuận cuối của mình là bao
  nhiêu"), the current Overview wireframe, `docs/operations/status-flows.md`, FR-13, FR-25, FR-27.

## Discussion

🧾 **Hà:** Chủ shop mở màn này buổi tối với đúng bốn câu: tháng này mình lời bao nhiêu, tiền đang nằm ở
đâu, đơn chạy có ổn không, event có đáng tiền không. Màn nào không trả lời bốn câu đó thì là trang trí.

📊 **Mary:** Và phải tách hai loại số mà hệ thống cũ trộn lẫn. "Lời tháng này" tính theo ngày sàn duyệt
đơn. "Tiền đang ở đâu" là số tại thời điểm xem, không theo kỳ. Trộn hai cái là ra con số không ai kiểm
được.

🏗️ **Winston:** Ba gốc thời gian, ghi rõ trên màn: kết quả kinh doanh theo ngày duyệt, tiền thực theo
ngày sàn trả và ngày mình chuyển, đơn mới theo ngày ghi nhận. Tất cả là ngày giờ Việt Nam. Mọi số lấy
từ sổ cái, cộng bằng `SUM()` trên cột đã lưu, chia tỉ lệ trong `packages/money`. Không số nào tính ở
trình duyệt.

🎨 **Sally:** Thứ tự đọc: chọn kỳ → việc cần làm → lời bao nhiêu → tiền ở đâu → xu hướng → đơn và
event. Lợi nhuận là con số to nhất màn hình. Mỗi số có một dòng định nghĩa ngắn ngay bên dưới.

🧾 **Hà:** Lợi nhuận phải trừ cả thưởng event. Tháng 10 có campaign 20 suất, lời ròng tụt từ 329 nghìn
xuống 270 nghìn, chủ shop phải thấy ngay vì sao.

📊 **Mary:** Event cần bảng riêng: bao nhiêu suất đã dùng, chi bao nhiêu, đơn trong khung giờ event mang
về bao nhiêu hoa hồng, phần mình giữ trừ thưởng còn lời hay lỗ. Không thì không biết lần sau có nên chạy.

🏗️ **Winston:** "Đơn tăng thêm nhờ event" thì mình không đo được thật, không có nhóm đối chứng. Mình
chỉ hiện số đo được: hoa hồng của đơn giành suất và chi phí thưởng. Không bịa "doanh thu tăng thêm".

🧾 **Hà:** Đồng ý. Và phần "tiền ở đâu" phải có khoản khách đang nợ mình (clawback). Đơn huỷ sau khi đã
trả là tiền thật bị mất nếu không trừ lại.

🎨 **Sally:** Biểu đồ chỉ một: lợi nhuận theo tuần. Muốn xem hoa hồng hay tiền hoàn thì chuyển tab trên
cùng biểu đồ, không vẽ hai trục.

📊 **Mary:** Còn khách: chỉ ba số, khách có đơn trong kỳ, khách mới, tỉ lệ khách quay lại. Thêm một
cảnh báo khi một khách chiếm hơn 30% hoa hồng kỳ, vì phụ thuộc một người là rủi ro.

Disagreement left open: Mary wants a per-customer top-10 table; Hà says it belongs on the Customers
screen, not the dashboard. Decision: the dashboard shows only the concentration warning; the top list
lives in Customers sorted by commission.

## Outcome

The specification is `docs/operations/dashboard-spec.md` (owner: Operations Lead). The Overview
wireframe is redesigned to follow it.
