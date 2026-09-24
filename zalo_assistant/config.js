export const config = {
  // Nhóm thử nghiệm và nhóm thật (chuẩn hóa theo tài khoản mới)
  GROUP_TEST_ID: "8786316503449470342", // Dev Internal DP (6 thành viên)
  GROUP_MAIN_ID: "2813090100064697955", // Hoàn Tiền Shopee (37 thành viên)

  // Nhóm đang hoạt động: Nhóm chính Hoàn Tiền Shopee!
  ACTIVE_GROUP_ID: "2813090100064697955",

  // Danh sách UID Quản trị viên toàn hệ thống (Minh Đức & Xuân Phước)
  // Khi gửi link hoặc lệnh, bot sẽ không tag tên mà chỉ phản hồi nội dung
  GLOBAL_ADMIN_UIDS: [
    "6356806862452292219", // Minh Đức (ID Zalo cũ)
    "6823332485297437912", // Minh Đức (ID Zalo cá nhân mới)
    "7835381167015183856", // Xuân Phước (ID Zalo cũ)
    "7654552834503557971", // Xuân Phước (ID Zalo cá nhân mới)
  ],

  // Cổng HTTP API nội bộ để nhận thông báo từ hệ thống chính
  PORT: 8891,
  MAIN_API_URL: "http://localhost:8899",

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
