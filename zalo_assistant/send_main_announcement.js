import { Zalo, ThreadType } from "zca-js";
import fs from "node:fs/promises";
import path from "node:path";
import sizeOf from "image-size";
import { config } from "./config.js";

function parseMarkdownStyles(mdText) {
  const styles = [];
  let cleanText = "";
  const boldRegex = /\*\*(.*?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = boldRegex.exec(mdText)) !== null) {
    cleanText += mdText.substring(lastIndex, match.index);
    const start = cleanText.length;
    const boldContent = match[1];
    cleanText += boldContent;
    styles.push({ start, len: boldContent.length, st: "b" });
    lastIndex = match.index + match[0].length;
  }
  cleanText += mdText.substring(lastIndex);

  return { cleanText, styles };
}

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
  const mainGid = String(config.GROUP_MAIN_ID || "2813090100064697955");
  const imgPath = path.resolve("./announcement_poster.jpg");

  const rawMessage = `📢 **THÔNG BÁO QUAN TRỌNG: NÂNG CẤP HỆ THỐNG HOÀN TIỀN 80%** 🎉

Chào cả nhà! Để hỗ trợ mọi người mua sắm, săn sale và đặt đồ ăn tiết kiệm nhất, Trợ lý @Hoàn Tiền Shopping Dp đã chính thức có mặt để phục vụ cả nhà rồi đây ạ ✨

Từ nay, mỗi khi mua sắm, mọi người chỉ cần gửi link cho **mình** (hoặc gửi thẳng vào nhóm), mình sẽ tạo link hoàn tiền **80%** gửi lại ngay trong tích tắc nha!

🚀 **CÁC TIỆN ÍCH MỚI MÌNH HỖ TRỢ CẢ NHÀ:**
1️⃣ **HOÀN TIỀN SHOPEEFOOD (MỚI):** Đặt trà sữa, đồ ăn, ship siêu tốc — nhận trọn **80% hoàn tiền**.
2️⃣ **HOÀN TIỀN TIKTOK SHOP (MỚI):** Mua sắm qua video, livestream TikTok — nhận lại **80% hoa hồng**.
3️⃣ **SHOPEE SIÊU TỐC:** Nhận link hoàn tiền chỉ trong **3 - 5 giây**, hoạt động 24/7 bất kể ngày đêm.
4️⃣ **TRA CỨU MINH BẠCH:** Theo dõi trạng thái đơn hàng và cài đặt STK nhận tiền dễ dàng tại: **https://hoantiendp.com**

🎁 **KÍCH HOẠT TÀI KHOẢN VỚI MÌNH (Làm 1 lần duy nhất):**
👉 **Bước 1:** Bấm vào nick của mình: @Hoàn Tiền Shopping Dp
👉 **Bước 2:** Chọn **"Nhắn tin"** và gửi cho mình chữ: **/id**
(Mình sẽ gửi tặng ngay Mã Khách Hàng và hướng dẫn bạn đăng nhập web cài STK nhận tiền hoàn tự động nhé)

💡 **MẸO MUA SẮM CỰC TIỆN:**
Cả nhà có thể dán link sản phẩm trực tiếp vào nhóm này hoặc nhắn tin riêng cho **mình** bất cứ lúc nào nhé, mình luôn sẵn sàng hỗ trợ 24/7!

Cảm ơn cả nhà đã luôn đồng hành cùng DP! Chúc mọi người mua sắm thật vui và tiết kiệm được thật nhiều nha! ❤️`;

  const { cleanText, styles } = parseMarkdownStyles(rawMessage);

  const mentions = [];
  const tag = "@Hoàn Tiền Shopping Dp";
  let searchIndex = 0;
  while (true) {
    const pos = cleanText.indexOf(tag, searchIndex);
    if (pos === -1) break;
    mentions.push({ pos, uid: ownId, len: tag.length });
    styles.push({ start: pos, len: tag.length, st: "b" });
    searchIndex = pos + tag.length;
  }

  styles.sort((a, b) => a.start - b.start);

  console.log(`1. Đang gửi ảnh poster vào nhóm chính Hoàn Tiền Shopee (${mainGid})...`);
  const imgRes = await api.sendMessage(
    {
      msg: "",
      attachments: [imgPath],
    },
    mainGid,
    ThreadType.Group
  );
  console.log("Gửi ảnh poster thành công:", imgRes);

  await new Promise((r) => setTimeout(r, 1200));

  console.log(`2. Đang gửi bài viết thông báo có IN ĐẬM và TAG trợ lý...`);
  const textRes = await api.sendMessage(
    {
      msg: cleanText,
      mentions: mentions.length > 0 ? mentions : undefined,
      styles: styles.length > 0 ? styles : undefined,
    },
    mainGid,
    ThreadType.Group
  );
  console.log("Bắn bài viết vào nhóm chính thành công:", textRes);
}

main().catch((err) => {
  console.error("Lỗi khi bắn nhóm chính:", err);
  process.exit(1);
});
