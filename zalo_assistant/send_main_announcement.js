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
  const imgPath = path.resolve("./mid_autumn_poster.jpg");

  const rawMessage = `🥮 **ĐÓN TẾT TRUNG THU — RINH TRỌN HOÀN TIỀN 80% CÙNG TRỢ LÝ DP** 🌕✨

Chào cả nhà @All! Không khí Tết Trung Thu đang rộn ràng khắp nơi rồi ạ 🎉

Để đồng hành cùng mọi người săn sale bánh trung thu, mua quà biếu, sắm đèn lồng và đặt tiệc trà sữa/đồ ăn liên hoan tiết kiệm nhất, Trợ lý @Hoàn Tiền Shopping Dp chính thức ra mắt để phục vụ cả nhà từ hôm nay ✨

Từ nay, mỗi khi mua sắm hay đặt đồ ăn mùa lễ hội, cả nhà chỉ cần gửi link cho **mình** (hoặc gửi thẳng vào nhóm), mình sẽ tạo ngay link hoàn tiền **80%** chỉ trong tích tắc nha!

🚀 **TIỆN ÍCH HOÀN TIỀN MÙA TRUNG THU DÀNH CHO CẢ NHÀ:**
1️⃣ **HOÀN TIỀN SHOPEEFOOD (MỚI):** Đặt trà sữa, đồ ăn liên hoan, ship đồ ăn vặt tiệc trăng rằm — nhận trọn **80% hoàn tiền**.
2️⃣ **HOÀN TIỀN TIKTOK SHOP (MỚI):** Mua bánh trung thu, quà tặng qua video/livestream TikTok — nhận lại **80% hoa hồng**.
3️⃣ **SHOPEE SIÊU TỐC:** Săn sale bánh kẹo, lồng đèn, đồ chơi — nhận link hoàn tiền chỉ trong **3 - 5 giây** 24/7.
4️⃣ **TRA CỨU MINH BẠCH:** Xem chi tiết từng đơn hàng và cài đặt STK ngân hàng nhận tiền tiện lợi tại: **https://hoantiendp.com**

🎁 **KÍCH HOẠT TÀI KHOẢN VỚI MÌNH (Làm 1 lần duy nhất để nhận hoàn tiền):**
👉 **Bước 1:** Bấm vào nick của mình: @Hoàn Tiền Shopping Dp
👉 **Bước 2:** Chọn **"Nhắn tin"** và gửi cho mình chữ: **/id**
(Mình sẽ gửi tặng ngay Mã Khách Hàng và hướng dẫn bạn đăng nhập web cài STK nhận tiền hoàn tự động nhé)

💡 **MẸO MUA SẮM TIẾT KIỆM:**
Cả nhà có thể gửi link sản phẩm Shopee, ShopeeFood hoặc TikTok Shop vào nhóm này hoặc nhắn tin riêng cho **mình** bất kỳ lúc nào nhé!

Chúc cả nhà và gia đình một mùa Tết Trung Thu thật ấm áp, đoàn viên và mua sắm siêu tiết kiệm cùng DP! ❤️🏮`;

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

  // Mention @All
  const allTag = "@All";
  const allPos = cleanText.indexOf(allTag);
  if (allPos !== -1) {
    mentions.push({ pos: allPos, uid: "-1", len: allTag.length });
    styles.push({ start: allPos, len: allTag.length, st: "b" });
  }

  styles.sort((a, b) => a.start - b.start);

  console.log(`1. Đang gửi ảnh poster Trung Thu vào nhóm chính Hoàn Tiền Shopee (${mainGid})...`);
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

  console.log(`2. Đang gửi bài viết Trung Thu có IN ĐẬM, TAG @All và TAG trợ lý...`);
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
