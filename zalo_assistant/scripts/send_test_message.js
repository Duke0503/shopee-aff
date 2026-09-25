import { Zalo, ThreadType } from "zca-js";
import fs from "node:fs/promises";

async function main() {
  const credentials = JSON.parse(await fs.readFile("./credentials.json", "utf-8"));
  
  const zalo = new Zalo({
    logging: false,
  });

  const api = await zalo.login(credentials);
  console.log("Đã kết nối Zalo API!");

  const groupId = "9181140731214988069"; // Dev Internal DP
  const ducUid = "6356806862452292219";  // Minh Đức
  const phuocUid = "7835381167015183856"; // Xuân Phước

  const text = "Xin chào @Minh Đức và @Xuân Phước! 🤖 Bot Normie đã kết nối thành công vào nhóm Dev Internal DP để bắt đầu thử nghiệm.";
  
  const ducTag = "@Minh Đức";
  const phuocTag = "@Xuân Phước";

  const ducPos = text.indexOf(ducTag);
  const phuocPos = text.indexOf(phuocTag);

  console.log(`Minh Đức tag pos: ${ducPos}, len: ${ducTag.length}`);
  console.log(`Xuân Phước tag pos: ${phuocPos}, len: ${phuocTag.length}`);

  const mentions = [
    {
      uid: ducUid,
      pos: ducPos,
      len: ducTag.length,
    },
    {
      uid: phuocUid,
      pos: phuocPos,
      len: phuocTag.length,
    }
  ];

  console.log("Đang gửi tin nhắn vào nhóm Dev Internal DP...");
  const res = await api.sendMessage(
    {
      msg: text,
      mentions: mentions,
    },
    groupId,
    ThreadType.Group
  );

  console.log("Kết quả gửi tin nhắn:", JSON.stringify(res, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi khi gửi tin nhắn:", err);
  process.exit(1);
});
