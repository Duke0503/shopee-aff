import { Zalo } from "zca-js";
import fs from "node:fs/promises";

async function main() {
  const credentials = JSON.parse(await fs.readFile("./credentials.json", "utf-8"));
  
  const zalo = new Zalo({
    logging: false,
  });

  const api = await zalo.login(credentials);
  console.log("Đã kết nối thành công với tài khoản!");

  const ownId = await api.getOwnId();
  console.log("Own ID:", ownId);

  // Lấy danh sách nhóm
  const allGroups = await api.getAllGroups();
  console.log("All groups response keys:", Object.keys(allGroups));

  // Kiểm tra cấu trúc của allGroups
  if (allGroups.gridVerMap) {
    console.log("Group IDs:", Object.keys(allGroups.gridVerMap));
    for (const gid of Object.keys(allGroups.gridVerMap)) {
      try {
        const info = await api.getGroupInfo(gid);
        console.log(`GroupID: ${gid} | Name: ${info.name || info.groupName || JSON.stringify(info)}`);
      } catch (err) {
        console.log(`GroupID: ${gid} | Error fetching info:`, err.message);
      }
    }
  } else {
    console.log("All groups data:", JSON.stringify(allGroups, null, 2).slice(0, 1000));
  }
}

main().catch(console.error);
