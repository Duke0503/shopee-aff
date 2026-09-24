import { Zalo, LoginQRCallbackEventType } from "zca-js";
import fs from "node:fs/promises";
import path from "node:path";
import qrcodeTerminal from "qrcode-terminal";

const ARTIFACT_DIR = "C:\\Users\\ADMIN\\.gemini\\antigravity-cli\\brain\\05853b6c-d198-44d7-b77a-cce633717bc4";
const QR_LOCAL_PATH = path.resolve("qr.png");
const QR_ARTIFACT_PATH = path.join(ARTIFACT_DIR, "zalo_qr.png");
const CREDENTIALS_PATH = path.resolve("credentials.json");

console.log("=== KHỞI TẠO ĐĂNG NHẬP ZALO QUA MÃ QR ===");

const zalo = new Zalo({
  logging: true,
});

try {
  const api = await zalo.loginQR(
    {
      qrPath: QR_LOCAL_PATH,
    },
    async (event) => {
      if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
        console.log("\n>>> MÃ QR ĐÃ ĐƯỢC TẠO! <<<");
        // Save to file
        await event.actions.saveToFile(QR_LOCAL_PATH);
        try {
          await fs.copyFile(QR_LOCAL_PATH, QR_ARTIFACT_PATH);
          console.log(`Đã lưu mã QR tại: ${QR_ARTIFACT_PATH}`);
        } catch (err) {
          console.error("Lỗi copy QR sang artifact:", err.message);
        }

        // Print to terminal if possible
        if (event.data && event.data.code) {
          console.log("\nQuét mã QR dưới đây hoặc mở file qr.png:\n");
          qrcodeTerminal.generate(event.data.code, { small: true });
        }
        console.log("\nVui lòng dùng Zalo trên điện thoại (nick Normie) quét mã QR để đăng nhập!");
      } else if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
        console.log("\n>>> ĐÃ QUÉT MÃ QR! Vui lòng bấm 'Đăng nhập' trên điện thoại... <<<");
      } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
        console.log("\n>>> Mã QR đã hết hạn. Đang thử tạo lại... <<<");
        event.actions.retry();
      } else if (event.type === LoginQRCallbackEventType.QRCodeDeclined) {
        console.log("\n>>> Bạn đã từ chối đăng nhập trên điện thoại! <<<");
      } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
        console.log("\n>>> ĐÃ LẤY ĐƯỢC THÔNG TIN ĐĂNG NHẬP! Đang lưu session... <<<");
        await fs.writeFile(
          CREDENTIALS_PATH,
          JSON.stringify(event.data, null, 2),
          "utf-8"
        );
        console.log(`Đã lưu thông tin đăng nhập vào: ${CREDENTIALS_PATH}`);
      }
    }
  );

  console.log("\n=== ĐĂNG NHẬP THÀNH CÔNG! ===");
  const ownId = await api.getOwnId();
  console.log("Zalo UID của tài khoản:", ownId);

  // Lấy danh sách các nhóm
  console.log("\nĐang lấy danh sách các nhóm đã tham gia...");
  const groups = await api.getAllGroups();
  console.log("Danh sách nhóm:");
  for (const [id, grp] of Object.entries(groups)) {
    console.log(`- Nhóm: "${grp.name || grp.groupName || 'Không tên'}" | ID: ${id}`);
  }

  process.exit(0);
} catch (error) {
  console.error("\nLỗi trong quá trình đăng nhập:", error);
  process.exit(1);
}
