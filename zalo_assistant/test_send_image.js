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
  const imagePath = path.resolve("./qr.png");

  console.log("Đang thử gửi hình ảnh vào nhóm Dev Internal DP:", imagePath);

  const res = await api.sendMessage(
    {
      msg: "🖼️ Test gửi hình ảnh từ bot vào nhóm Dev Internal DP!",
      attachments: [imagePath],
    },
    groupId,
    ThreadType.Group
  );

  console.log("Kết quả gửi ảnh:", JSON.stringify(res, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi gửi ảnh:", err);
  process.exit(1);
});
