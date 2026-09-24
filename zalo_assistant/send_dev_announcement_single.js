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
    },
  });

  const api = await zalo.login(creds);
  const ownId = await api.getOwnId();
  const devGid = "8786316503449470342"; // Dev Internal DP
  const imgPath = path.resolve("./announcement_poster.jpg");

  const message = `📢 THÔNG BÁO QUAN TRỌNG: NÂNG CẤP HỆ THỐNG HOÀN TIỀN 80% 🎉

Chào cả nhà! Để hỗ trợ mọi người mua sắm, săn sale và đặt đồ ăn tiết kiệm nhất, Trợ lý @Hoàn Tiền Shopping Dp đã chính thức có mặt để phục vụ cả nhà rồi đây ạ ✨

Từ nay, mỗi khi mua sắm, mọi người chỉ cần gửi link cho mình (hoặc gửi thẳng vào nhóm), mình sẽ tạo link hoàn tiền 80% gửi lại ngay trong tích tắc nha!

🚀 CÁC TIỆN ÍCH MỚI MÌNH HỖ TRỢ CẢ NHÀ:
1️⃣ HOÀN TIỀN SHOPEEFOOD (MỚI): Đặt trà sữa, đồ ăn, ship siêu tốc — nhận trọn 80% hoàn tiền.
2️⃣ HOÀN TIỀN TIKTOK SHOP (MỚI): Mua sắm qua video, livestream TikTok — nhận lại 80% hoa hồng.
3️⃣ SHOPEE SIÊU TỐC: Nhận link hoàn tiền chỉ trong 3 - 5 giây, hoạt động 24/7 bất kể ngày đêm.
4️⃣ TRA CỨU MINH BẠCH: Theo dõi trạng thái đơn hàng và cài đặt STK nhận tiền dễ dàng tại: https://hoantiendp.com

🎁 KÍCH HOẠT TÀI KHOẢN VỚI MÌNH (Làm 1 lần duy nhất):
👉 Bước 1: Bấm vào nick của mình: @Hoàn Tiền Shopping Dp
👉 Bước 2: Chọn "Nhắn tin" và gửi cho mình chữ: /id
(Mình sẽ gửi tặng ngay Mã Khách Hàng và hướng dẫn bạn đăng nhập web cài STK nhận tiền hoàn tự động nhé)

💡 MẸO MUA SẮM CỰC TIỆN:
Cả nhà có thể dán link sản phẩm trực tiếp vào nhóm này hoặc nhắn tin riêng cho mình bất cứ lúc nào nhé, mình luôn sẵn sàng hỗ trợ 24/7!

Cảm ơn cả nhà đã luôn đồng hành cùng DP! Chúc mọi người mua sắm thật vui và tiết kiệm được thật nhiều nha! ❤️`;

  // Mentions
  const mentions = [];
  const tag = "@Hoàn Tiền Shopping Dp";
  let searchIndex = 0;
  while (true) {
    const pos = message.indexOf(tag, searchIndex);
    if (pos === -1) break;
    mentions.push({ pos, uid: ownId, len: tag.length });
    searchIndex = pos + tag.length;
  }

  console.log("Đang gửi DUY NHẤT 1 TIN NHẮN (ảnh + toàn bộ nội dung dính liền nhau)...");
  const res = await api.sendMessage(
    {
      msg: message,
      attachments: [imgPath],
      mentions: mentions.length > 0 ? mentions : undefined,
    },
    devGid,
    ThreadType.Group
  );

  console.log("Gửi thành công duy nhất 1 tin nhắn:", JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
