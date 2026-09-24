import { Zalo, ThreadType } from "zca-js";
import fs from "node:fs/promises";
import path from "node:path";
import sizeOf from "image-size";

async function main() {
  const creds = JSON.parse(await fs.readFile("./credentials.json", "utf-8"));
  const zalo = new Zalo({
    logging: false,
    imageMetadataGetter: async (filePath) => {
      const stat = await fs.stat(filePath);
      const buffer = await fs.readFile(filePath);
      const dimensions = sizeOf(buffer);
      return {
        size: stat.size,
        width: dimensions.width,
        height: dimensions.height,
      };
    }
  });

  const api = await zalo.login(creds);
  const imgPath = path.resolve("./announcement_poster.jpg");
  const devGid = "8786316503449470342"; // Dev Internal DP

  const message = `📢 THÔNG BÁO NÂNG CẤP HỆ THỐNG HOÀN TIỀN 80% 🎉

Chào cả nhà, để nâng cao tốc độ trả link và mở rộng thêm nhiều sàn mua sắm, hệ thống Hoàn Tiền DP chính thức ra mắt Trợ lý cá nhân mới: @Hoàn Tiền Shopping Dp ✨

🚀 CÁC TÍNH NĂNG MỚI ĐÃ SẴN SÀNG:
1️⃣ HOÀN TIỀN SHOPEEFOOD: Đặt trà sữa, đồ ăn, ship siêu tốc nhận hoàn tiền 80% hoa hồng.
2️⃣ HOÀN TIỀN TIKTOK SHOP: Mua hàng qua video/livestream trên TikTok nhận hoàn tiền trọn gói.
3️⃣ SHOPEE SIÊU TỐC: Trả link chỉ trong 3 - 5 giây ngay trong nhóm hoặc chat riêng.
4️⃣ QUẢN LÝ TỰ ĐỘNG: Xem lịch sử đơn, tiến độ tích lũy và cài STK nhận tiền minh bạch tại https://hoantiendp.com

🎁 KÍCH HOẠT TÀI KHOẢN & NHẬN MÃ ĐĂNG NHẬP (Làm 1 lần duy nhất):
👉 Bước 1: Bấm vào avatar nick Trợ lý @Hoàn Tiền Shopping Dp trong nhóm này.
👉 Bước 2: Chọn "Nhắn tin" và gửi lệnh: /id
👉 Bước 3: Gửi tiếp lệnh: /matkhau để nhận mật khẩu đăng nhập website cài đặt STK ngân hàng nhận tiền hoàn tự động nhé!

💡 Bạn có thể gửi link sản phẩm trực tiếp vào nhóm này hoặc nhắn tin riêng cho Trợ lý bất kỳ lúc nào để nhận link hoàn tiền 80%! Cảm ơn cả nhà đã luôn đồng hành cùng DP! ❤️`;

  console.log("Đang đăng thử thông báo + poster vào nhóm Dev Internal DP...");
  const res = await api.sendMessage({
    msg: message,
    attachments: [imgPath]
  }, devGid, ThreadType.Group);

  console.log("Đăng thành công! Kết quả:", JSON.stringify(res, null, 2));
}

main().catch(err => {
  console.error("Lỗi khi đăng:", err);
  process.exit(1);
});
