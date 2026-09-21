import { Zalo, ThreadType } from "zca-js";
import fs from "node:fs/promises";
import path from "node:path";
import sizeOf from "image-size";

async function main() {
  const credentials = JSON.parse(await fs.readFile("./credentials.json", "utf-8"));
  
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

  const api = await zalo.login(credentials);
  const groupId = "9181140731214988069"; // Dev Internal DP
  
  // Dùng ảnh badge 80 hoặc qr.png
  const artifactDir = "C:\\Users\\ADMIN\\.gemini\\antigravity-cli\\brain\\1d3b6eef-1098-444e-8504-5b7037f8bb4d";
  let imagePath = path.join(artifactDir, "badge-80.webp");
  try {
    await fs.access(imagePath);
  } catch {
    imagePath = path.resolve("./qr.png");
  }

  const messageText = `🛍️ SĂN DEAL HOÀN TIỀN 80% SIÊU HOT!\n\n` +
    `📦 Sản phẩm: Tai nghe không dây Bluetooth True Wireless\n` +
    `💰 Giá bán: 250.000₫\n` +
    `🎁 Hoa hồng ước tính: 25.000₫\n` +
    `💵 Tiền hoàn 80% bạn nhận: 20.000₫\n\n` +
    `👉 Bấm link mua ngay để nhận hoàn tiền:\n` +
    `https://s.shopee.vn/70b0U7Xq6W\n\n` +
    `⚡ Đặt hàng xong hệ thống tự động ghi nhận đơn hoàn tiền!`;

  console.log("Đang gửi tin nhắn link kèm hình ảnh vào nhóm Dev Internal DP...");

  const res = await api.sendMessage(
    {
      msg: messageText,
      attachments: [imagePath],
    },
    groupId,
    ThreadType.Group
  );

  console.log("Kết quả gửi link kèm ảnh:", JSON.stringify(res, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi khi gửi link có hình:", err);
  process.exit(1);
});
