# Party session: status flows and the cancelled-but-payable bug (2026-10-30)

- Mode: session (one facilitator voicing every persona), run on the owner's request
  ("cần có một phòng ban operation để định nghĩa toàn bộ về trạng thái flow cho chuẩn").
- Room: 📊 Mary (Business Analyst), 🏗️ Winston (Architect), 🧾 Hà (Operations Lead, new member
  in `_bmad/custom/bmad-party-mode.toml`).
- Input: the owner's incident (a buyer cancelled, the payout screen still showed money owed) and the
  read-only code trace of the live system.

## Discussion

🧾 **Hà:** Đây không phải lỗi giao diện. Đơn đó chưa bao giờ rời trạng thái chờ duyệt. Code chỉ đọc
`items[0].display_item_status`, bỏ qua `order_status`, nên "Pending" + "CANCELLED" vẫn ra chờ duyệt.
Rồi màn chuyển tiền bật sẵn "hiện cả đơn chờ duyệt" và QR lấy luôn tiền chờ duyệt.

📊 **Mary:** So the customer saw "waiting" money that was never going to exist. Worse: what does a
customer read when Shopee cancels after we already paid? Today we have no sentence for that.

🏗️ **Winston:** And no state. `APPROVED → PAID` is the only exit; a later cancel is counted as
"skipped" and nobody is told. I want `REVERSED` before payout and a clawback entry after payout.
`PAID` itself never changes — D4 stays intact.

🧾 **Hà:** Đồng ý `REVERSED`. Nhưng em không chịu "đòi lại tiền" khách. Trừ vào lần chuyển sau,
báo khách một câu, admin được xoá nợ nếu cần. Đòi tiền 9.000đ là mất khách.

📊 **Mary:** Then the unknown statuses. Today "returned" and "refunded" fall into review but the order
still sits in the awaiting total. That is the second leak.

🏗️ **Winston:** `FROZEN`: unknown string, missing order id, page cap hit. Frozen money is in no total
at all, and it opens a review case. Silence is the bug; freezing is loud.

🧾 **Hà:** Và thứ tự tín hiệu huỷ phải cố định: trạng thái đơn trước, rồi từng sản phẩm, rồi hoa hồng
về 0. Không bao giờ để trạng thái sản phẩm đè lên huỷ cấp đơn.

📊 **Mary:** One disagreement left open: Hà wants a 14-day "not seen in report" flag, I think 14 days
is too short for Shopee's return window. We keep 14 as a flag, not a state change.

## Outcome

- `docs/operations/status-flows.md` is the single standard for every status (owner: Operations Lead).
- New decisions: D30 (cancel after approval → REVERSED; after payout → clawback netted against the
  next payout), D31 (fixed cancel-signal precedence; unknown → FROZEN, excluded from every total),
  D32 (payout confirm re-reads every order in the transaction; awaiting money is never shown as owed).
- Production hotfix proposal for `main` recorded for the owner; not applied (main is production).
