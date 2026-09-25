import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// One .env per environment, shared with the Python backend, so a dev copy
// is a different .env and nothing else. Every value below falls back to
// production's, which keeps a production machine working without edits.
const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const file = process.env.CASHBACK_ENV_FILE || path.join(HERE, "..", ".env");
  const values = {};
  try {
    for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch (_) {}
  return { ...values, ...process.env };
}

const env = loadEnv();
const list = (value, fallback) =>
  value ? value.split(",").map((s) => s.trim()).filter(Boolean) : fallback;

const MAIN_GROUP = env.ZALO_MAIN_GROUP_ID || "2813090100064697955";

export const config = {
  GROUP_TEST_ID: env.ZALO_TEST_GROUP_ID || "8786316503449470342",
  GROUP_MAIN_ID: MAIN_GROUP,
  ACTIVE_GROUP_ID: MAIN_GROUP,

  // Groups this instance listens to. Production serves the main group only;
  // a dev instance runs on its own Zalo account with its own list.
  LISTEN_GROUP_IDS: list(env.ZALO_LISTEN_GROUP_IDS, [MAIN_GROUP]),

  // Group members that are not customers (the bot's other accounts). The
  // member sync skips them, so a deleted row is not recreated five minutes
  // later.
  IGNORE_MEMBER_UIDS: list(env.ZALO_IGNORE_MEMBER_UIDS, [
    "2483222542240728863", // Bot DP Shopee Affiliate
    "2661802382181188028", // Bot DP Shopee Affiliate (id seen by the old account)
  ]),

  // Operators: may run /refreshcache. Each has two ids, one per bot
  // account that has seen them.
  GLOBAL_ADMIN_UIDS: list(env.ZALO_ADMIN_UIDS, [
    "6356806862452292219",
    "6823332485297437912",
    "7835381167015183856",
    "7654552834503557971",
  ]),

  // The Zalo session this instance logs in with. A dev instance must use
  // its own account: one account logged in twice fights itself.
  CREDENTIALS_PATH: path.resolve(HERE, env.ZALO_CREDENTIALS_PATH || "credentials.json"),

  // Shared secret for the notify API; empty accepts any local caller.
  API_TOKEN: env.ASSISTANT_TOKEN || "",

  // Friend requests go only to people who messaged us privately first;
  // see friends.js for why the ceiling is low.
  FRIEND_REQUESTS_PER_DAY: Number(env.ZALO_FRIEND_REQUESTS_PER_DAY || 30),
  FRIEND_STATE_PATH: path.resolve(HERE, env.ZALO_FRIEND_STATE_PATH || "friend_state.json"),

  // Customer-facing wording shared with the backend.
  MESSAGES_PATH: path.resolve(HERE, "..", "resources", "messages.vi.json"),

  // Cổng HTTP API nội bộ để nhận thông báo từ hệ thống chính
  PORT: Number(env.ASSISTANT_PORT || 8891),
  MAIN_API_URL: env.MAIN_API_URL || `http://127.0.0.1:${env.DASHBOARD_PORT || 8899}`,

  // Default customer ID dùng khi khách chưa có mã
  DEFAULT_CUSTOMER_ID: "default_bot",

  // Bật/tắt tự động chào mừng trong nhóm khi có thành viên mới gia nhập
  ENABLE_GROUP_WELCOME: true,

  // Danh sách nhóm ĐƯỢC PHÉP gửi tin chào mừng (Chỉ nhóm chính, cấm tuyệt đối nhóm Dev / nội bộ)
  ALLOWED_WELCOME_GROUP_IDS: [
    "2813090100064697955", // Hoàn Tiền Shopee (Nhóm chính)
  ],

  // Tạm tắt chế độ tự động nhắn tin riêng 1-1 cho người mới vào (khi cần mở lại chỉ cần đổi thành true)
  ENABLE_PRIVATE_WELCOME: false,

  // Mẫu câu chào mừng trong nhóm (Spintax tự nhiên, linh hoạt gửi vào nhóm hoặc inbox + web tra cứu đơn)
  GROUP_WELCOME_TEMPLATES: [
    "Hello {tag}! Rất vui được đón tiếp bạn đến với {groupName} ✨\n👉 Chuẩn bị mua sắm trên Shopee hoặc TikTok Shop, bạn cứ dán thẳng link vào nhóm hoặc inbox riêng cho mình là được nha, nhận trọn 80% hoàn tiền siêu tiện lợi!\n🔑 Bạn hãy bấm vào avatar mình nhắn tin riêng gõ /id để lấy Mã Khách Hàng và /matkhau để nhận mật khẩu đăng nhập website cài đặt STK ngân hàng nhé!\n🌐 Website tra cứu: https://hoantiendp.com",
    "Chào mừng {tag} đã gia nhập {groupName}! 🎉\n👉 Bạn có thể nhắn tin trực tiếp cho mình hoặc gửi thẳng link sản phẩm Shopee / TikTok Shop vào nhóm này, mình sẽ tạo link hoàn tiền 80% ngay cho bạn nhé!\n🔑 Nhắn tin riêng cho mình gõ /id để nhận Mã Khách Hàng và /matkhau để đăng nhập website https://hoantiendp.com cài đặt STK nhận tiền nha!",
    "Chào mừng thành viên mới {tag}! 🚀\n👉 Để nhận hoàn tiền 80% Shopee & TikTok Shop, bạn cứ gửi link sản phẩm vào nhóm hoặc inbox riêng cho mình để nhận link mua hàng ngay nhé!\n🔑 Hãy bấm vào avatar mình nhắn tin riêng gõ /id lấy Mã Khách Hàng & /matkhau lấy mật khẩu quản lý đơn hàng tại https://hoantiendp.com nhé!",
  ],

  // Mẫu câu nhắn tin riêng (Private DM 1-1)
  PRIVATE_WELCOME_TEMPLATES: [
    `Chào {name}! Mình là Trợ lý hỗ trợ mua sắm của Cộng Đồng Hoàn Tiền DP ✨\n\n` +
    `💡 Cách nhận hoàn tiền 80% cực kỳ đơn giản:\n` +
    `1. Copy link sản phẩm Shopee, ShopeeFood hoặc TikTok Shop bạn muốn mua.\n` +
    `2. Gửi link vào đây cho mình (hoặc gửi thẳng vào nhóm).\n` +
    `3. Mình sẽ gửi lại link mua hàng đã kích hoạt hoàn tiền 80% hoa hồng.\n` +
    `4. Đặt hàng xong, bạn có thể truy cập website để xem chi tiết đơn hàng và số tiền hoàn:\n` +
    `🌐 Website: https://hoantiendp.com\n\n` +
    `👉 Bạn có thể gõ /chinhsach hoặc /huongdan để xem chi tiết chính sách đối soát nhé!`,

    `Hi {name} ơi! Chào mừng bạn đến với nhóm Hoàn Tiền DP 🎁\n\n` +
    `Mình là Trợ lý hỗ trợ bạn nhận lại trọn vẹn 80% hoa hồng Shopee, ShopeeFood & TikTok Shop cho mỗi đơn mua.\n` +
    `Mỗi khi chuẩn bị mua sắm hoặc đặt đồ ăn, bạn cứ gửi link sản phẩm qua đây, mình gửi lại link hoàn tiền cho bạn ngay trong vài giây nhé!\n\n` +
    `🌐 Sau khi mua xong, bạn vào https://hoantiendp.com để xem danh sách đơn hàng và theo dõi tiến độ hoàn tiền cực kỳ rõ ràng và minh bạch nhé!`
  ],

  // Delay ngẫu nhiên để an toàn chống quét spam
  DELAY_GROUP_MIN_MS: 3000,
  DELAY_GROUP_MAX_MS: 6000,
  DELAY_PRIVATE_MIN_MS: 6000,
  DELAY_PRIVATE_MAX_MS: 12000,
};
