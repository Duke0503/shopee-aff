import { Zalo, ThreadType, GroupEventType } from "zca-js";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import sizeOf from "image-size";
import { config } from "./config.js";

// Regex nhận diện link Shopee
const SHOPEE_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)?(?:shopee\.vn|s\.shopee\.vn|shp\.ee)\/[^\s]+/i;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomTemplate(templates, data) {
  const tpl = templates[Math.floor(Math.random() * templates.length)];
  return tpl.replace(/\{(\w+)\}/g, (_, key) => data[key] ?? "");
}

async function main() {
  console.log("=== KHỞI ĐỘNG ZALO ASSISTANT BOT (FULL PLAN) ===");
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
    },
  });

  const api = await zalo.login(credentials);
  const ownId = await api.getOwnId();
  console.log(`[Bot Online] Đăng nhập thành công với UID: ${ownId}`);
  console.log(`[Config] Nhóm đang kích hoạt (Active Group): ${config.ACTIVE_GROUP_ID}`);

  // Cache thông tin trưởng nhóm & phó nhóm (admin) để không tag tên khi họ gõ lệnh hoặc gửi link
  const groupAdminsCache = new Map();

  async function isGroupAdminOrCreator(groupId, uid) {
    if (!groupId || !uid) return false;
    const uidStr = String(uid);
    if (config.GLOBAL_ADMIN_UIDS && config.GLOBAL_ADMIN_UIDS.includes(uidStr)) {
      return true;
    }
    const now = Date.now();
    let cached = groupAdminsCache.get(String(groupId));
    if (!cached || now - cached.lastFetched > 60000) {
      try {
        const res = await api.getGroupInfo(String(groupId));
        const gInfo = res?.gridInfoMap?.[String(groupId)];
        if (gInfo) {
          cached = {
            creatorId: String(gInfo.creatorId || ""),
            adminIds: new Set((gInfo.adminIds || []).map(String)),
            lastFetched: now,
          };
          groupAdminsCache.set(String(groupId), cached);
        }
      } catch (err) {
        console.warn(`[getGroupInfo Warning]:`, err.message);
      }
    }
    if (!cached) return false;
    return cached.creatorId === uidStr || cached.adminIds.has(uidStr);
  }

  // Helper ghi nhận nhật ký hành vi người dùng lên hệ thống phân tích trung tâm
  async function logActivity(action, customerId, displayName, detail, path = "zalo") {
    try {
      fetch(`${config.MAIN_API_URL}/api/activity/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          customer_id: customerId ? String(customerId) : null,
          display_name: displayName || null,
          detail,
          path,
        }),
      }).catch(() => {});
    } catch (_) {}
  }

  // 1. Helper gửi lời chào trong nhóm kèm @tag
  async function sendGroupWelcome(groupId, member, groupName = "nhóm") {
    const name = member.dName || member.name || "bạn";
    const uid = member.id || member.uid;
    const tagText = `@${name}`;

    const text = getRandomTemplate(config.GROUP_WELCOME_TEMPLATES, {
      tag: tagText,
      groupName: groupName,
    });

    const tagPos = text.indexOf(tagText);
    const mentions = [
      {
        uid: String(uid),
        pos: tagPos,
        len: tagText.length,
      },
    ];

    const delay = randomInt(config.DELAY_GROUP_MIN_MS, config.DELAY_GROUP_MAX_MS);
    console.log(`[Group Welcome] Chờ ${delay}ms trước khi chào ${name} trong group...`);
    await sleep(delay);

    const boldTargets = [
      "dán thẳng link vào nhóm hoặc inbox riêng cho mình",
      "nhắn tin trực tiếp cho mình hoặc gửi thẳng link sản phẩm Shopee vào nhóm này",
      "gửi link sản phẩm vào nhóm hoặc inbox riêng cho mình",
      "nhận trọn 80% hoàn tiền",
      "hoàn tiền 80%",
      "hoàn tiền 80% Shopee",
      "https://hoantiendp.com",
      "Shopee Affiliate ghi nhận",
    ];

    const styles = [];
    for (const target of boldTargets) {
      const start = text.indexOf(target);
      if (start !== -1) {
        styles.push({ start, len: target.length, st: "b" });
      }
    }
    styles.sort((a, b) => a.start - b.start);

    try {
      await api.sendMessage(
        {
          msg: text,
          mentions: mentions,
          styles: styles.length > 0 ? styles : undefined,
        },
        groupId,
        ThreadType.Group
      );
      console.log(`[Group Welcome] Đã tag chào ${name} thành công!`);
    } catch (err) {
      console.error(`[Group Welcome Error]:`, err.message);
    }
  }

  // 2. Helper gửi tin nhắn riêng 1-1 cho thành viên mới
  async function sendPrivateWelcome(member) {
    const uid = member.id || member.uid;
    const name = member.dName || member.name || "bạn";

    const delay = randomInt(config.DELAY_PRIVATE_MIN_MS, config.DELAY_PRIVATE_MAX_MS);
    console.log(`[Private DM] Chờ ${delay}ms delay an toàn trước khi inbox cho ${name} (${uid})...`);
    await sleep(delay);

    const privateMsg = getRandomTemplate(config.PRIVATE_WELCOME_TEMPLATES, {
      name: name,
    });

    try {
      await api.sendMessage(privateMsg, String(uid), ThreadType.User);
      console.log(`[Private DM] Đã gửi tin nhắn riêng cho ${name} (${uid}) thành công!`);
    } catch (err) {
      console.warn(`[Private DM Warning] Không thể gửi tin riêng cho ${name} (khách có thể chặn tin nhắn từ người lạ):`, err.message);
    }
  }

// Helper bóc tách toàn bộ URL và text từ mọi loại message Zalo (text, link card preview, object)
function extractTextAndUrls(data) {
  let text = "";
  const urls = [];

  if (typeof data.content === "string") {
    text += " " + data.content;
    try {
      const parsed = JSON.parse(data.content);
      if (typeof parsed === "object" && parsed !== null) {
        if (parsed.href) urls.push(parsed.href);
        if (parsed.url) urls.push(parsed.url);
        if (parsed.title) text += " " + parsed.title;
        if (parsed.description) text += " " + parsed.description;
      }
    } catch (_) {}
  } else if (typeof data.content === "object" && data.content !== null) {
    if (data.content.href) urls.push(data.content.href);
    if (data.content.url) urls.push(data.content.url);
    if (data.content.link) urls.push(data.content.link);
    if (data.content.title) text += " " + data.content.title;
    if (data.content.description) text += " " + data.content.description;
    if (data.content.params) {
      if (typeof data.content.params === "string") {
        try {
          const parsed = JSON.parse(data.content.params);
          if (parsed.href) urls.push(parsed.href);
          if (parsed.url) urls.push(parsed.url);
        } catch (_) {}
      } else if (typeof data.content.params === "object" && data.content.params !== null) {
        if (data.content.params.href) urls.push(data.content.params.href);
        if (data.content.params.url) urls.push(data.content.params.url);
      }
    }
  }

  if (data.propertyExt) {
    let prop = data.propertyExt;
    if (typeof prop === "string") {
      try { prop = JSON.parse(prop); } catch (_) {}
    }
    if (typeof prop === "object" && prop !== null) {
      if (prop.href) urls.push(prop.href);
      if (prop.url) urls.push(prop.url);
      if (prop.oriUrl) urls.push(prop.oriUrl);
    }
  }

  if (data.href) urls.push(data.href);
  if (data.url) urls.push(data.url);

  // Quét regex trên toàn bộ chuỗi JSON của data để không bao giờ bỏ sót bất kỳ link Shopee nào
  try {
    const rawJson = JSON.stringify(data);
    const shopeeMatches = rawJson.match(/https?:\/\/(?:[a-zA-Z0-9_-]+\.)?(?:shopee\.vn|s\.shopee\.vn|shp\.ee)\/[^\s"'\\]+/gi);
    if (shopeeMatches) {
      for (const m of shopeeMatches) {
        urls.push(m);
      }
    }
  } catch (_) {}

  // Chỉ giữ lại link Shopee hợp lệ
  const shopeeUrls = urls.filter((u) => SHOPEE_LINK_REGEX.test(u));

  return { text: text.trim(), urls: [...new Set(shopeeUrls)] };
}

  // Bộ nhớ đệm RAM (Level-1 Cache) lưu sản phẩm trong 12 tiếng để phản hồi tức thì 0.001s
  const memoryProductCache = new Map(); // key: item_id, val: { data, cachedAt }

  // 3. Helper xử lý link Shopee (Áp dụng Smart Resolve 3 tầng + Cache RAM 12h + DB SQLite)
  async function handleShopeeLink(rawUrl, threadId, threadType, senderName, senderUid, customerId = null) {
    try {
      console.log(`[Shopee Link] Đang kiểm tra thông tin link: ${rawUrl} (Người gửi: ${senderName}, UID: ${senderUid})`);
      const effectiveCustomerId = customerId || (senderUid ? String(senderUid) : config.DEFAULT_CUSTOMER_ID);

      // Gọi Smart Resolve API từ hệ thống FastAPI chính
      const resolveRes = await fetch(`${config.MAIN_API_URL}/api/shopee/smart-resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: rawUrl,
          customer_id: effectiveCustomerId,
          display_name: senderName,
          channel: threadType === ThreadType.Group ? "zalo_group" : "zalo_dm",
          max_age_hours: 12
        }),
      }).then((r) => r.json()).catch(() => ({ ok: false }));

      let productData = resolveRes.ok && resolveRes.ready ? resolveRes : null;
      let affUrl = productData?.affiliate_url;

      // Nếu sản phẩm mới tinh chưa từng có (ready: false), chờ extension tạo link (tối đa 16s)
      if (!affUrl && resolveRes.request_id) {
        console.log(`[Shopee Link] Sản phẩm mới, chờ worker chuyển đổi link (request_id: ${resolveRes.request_id})...`);
        const maxAttempts = 20; // 20 * 800ms = 16s
        for (let i = 0; i < maxAttempts; i++) {
          await sleep(800);
          try {
            const statusRes = await fetch(`${config.MAIN_API_URL}/api/shopee/link-status?request_id=${resolveRes.request_id}`);
            const statusData = await statusRes.json();
            if (statusData.ok && statusData.ready && statusData.affiliate_url) {
              affUrl = statusData.affiliate_url;
              console.log(`[Shopee Link] Đã tạo thành công link Affiliate sau ${((i + 1) * 0.8).toFixed(1)}s: ${affUrl}`);
              break;
            }
          } catch (_) {}
        }
      }

      const isGroup = threadType === ThreadType.Group;
      const isAdmin = isGroup && await isGroupAdminOrCreator(threadId, senderUid);
      const tagText = isGroup && senderUid && !isAdmin ? `@${senderName}` : "";
      const tagPrefix = tagText ? `${tagText}\n` : "";
      const mentions = tagText
        ? [
            {
              uid: String(senderUid),
              pos: 0,
              len: tagText.length,
            },
          ]
        : undefined;

      // Nếu sau 16s vẫn không có link Affiliate, TUYỆT ĐỐI KHÔNG gửi link gốc rawUrl
      if (!affUrl) {
        console.warn(`[Shopee Link] Không lấy được link affiliate cho: ${rawUrl}`);
        const busyMsg =
          tagPrefix +
          `⚠️ Hệ thống đang chuyển đổi link sản phẩm hơi chậm một chút. Bạn đợi khoảng 10 giây rồi dán lại link giúp mình nhé!`;
        await api.sendMessage({ msg: busyMsg, mentions }, threadId, threadType);
        return;
      }

      if (!productData && affUrl) {
        try {
          const previewRes = await fetch(`${config.MAIN_API_URL}/api/shopee/preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: rawUrl }),
          });
          const previewData = await previewRes.json();
          if (previewData.ok && previewData.found) {
            productData = previewData;
          }
        } catch (_) {}
      }

      let replyText = "";
      const boldTargets = [
        "Link hoàn tiền của bạn đã sẵn sàng",
        "Bấm link trên và đặt hàng trực tiếp trên Shopee",
        "Nên mua ngay sau khi mở link",
      ];

      if (productData && (productData.shopee_rate > 0 || productData.seller_rate > 0 || productData.found)) {
        const commissionLines = [];
        const commissionItems = [];
        if (productData.shopee_rate > 0) {
          const capNote = productData.is_capped
            ? " (tối đa 40.000đ/sản phẩm theo quy định Shopee)"
            : "";
          const coreText = `Shopee ${productData.shopee_rate}% → ${productData.shopee_part_formatted}`;
          commissionLines.push(`• ${coreText}${capNote}`);
          commissionItems.push(coreText);
        }
        if (productData.seller_rate > 0) {
          const coreText = `Shop ${productData.seller_rate}% → ${productData.seller_part_formatted}`;
          commissionLines.push(`• ${coreText}`);
          commissionItems.push(coreText);
        }
        if (commissionLines.length === 0) {
          commissionLines.push(`• Đang cập nhật`);
        }
        const commissionSection = commissionLines.join("\n");

        const ratePercent = productData.rate_percent || "80%";
        const cashbackFormatted = productData.cashback_formatted || `${productData.cashback || 0}đ`;
        const payoutLine = `Bạn nhận ${ratePercent} → dự kiến ${cashbackFormatted}`;
        boldTargets.push(...commissionItems, payoutLine);

        replyText =
          tagPrefix +
          `🎉 Link hoàn tiền của bạn đã sẵn sàng\n\n` +
          `🔗 ${affUrl}\n\n` +
          `📊 Hoa hồng hiện tại:\n` +
          `${commissionSection}\n\n` +
          `🎁 ${payoutLine}\n\n` +
          `👉 Bấm link trên và đặt hàng trực tiếp trên Shopee.\n` +
          `💡 Nên mua ngay sau khi mở link và hạn chế bấm thêm link Affiliate khác trước khi đặt hàng.`;
      } else {
        replyText =
          tagPrefix +
          `🎉 Link hoàn tiền của bạn đã sẵn sàng\n\n` +
          `🔗 ${affUrl}\n\n` +
          `👉 Bấm link trên và đặt hàng trực tiếp trên Shopee.\n` +
          `💡 Nên mua ngay sau khi mở link và hạn chế bấm thêm link Affiliate khác trước khi đặt hàng.`;
      }

      const styles = [];
      for (const target of boldTargets) {
        if (!target) continue;
        const start = replyText.indexOf(target);
        if (start !== -1) {
          styles.push({ start, len: target.length, st: "b" });
        }
      }
      styles.sort((a, b) => a.start - b.start);

      await api.sendMessage(
        {
          msg: replyText,
          mentions: mentions,
          styles: styles.length > 0 ? styles : undefined,
        },
        threadId,
        threadType
      );
      console.log(`[Shopee Link] Đã phản hồi tin nhắn kèm link Affiliate cho ${senderName}`);
    } catch (err) {
      console.error(`[Shopee Link Error]:`, err.message);
    }
  }

  // LẮNG NGHE SỰ KIỆN QUA WEBSOCKET
  api.listener.on("connected", () => {
    console.log("[Listener] Kết nối WebSocket Zalo thành công. Đang lắng nghe 24/7...");
  });

  api.listener.on("closed", (code, reason) => {
    console.warn(`[Listener] WebSocket đóng (${code}): ${reason}. Sẽ tự động kết nối lại.`);
  });

  api.listener.on("error", (err) => {
    console.error("[Listener Error]:", err);
  });

  // A. LẮNG NGHE TIN NHẮN
  api.listener.on("message", async (message) => {
    try {
      const isGroup = message.type === ThreadType.Group;
      const senderName = message.data.dName || "Bạn";
      const senderUid = message.data.uidFrom;
      const isAdmin = isGroup && await isGroupAdminOrCreator(message.threadId, senderUid);

      // Lắng nghe ở nhóm chính (Hoàn Tiền Shopee) và nhóm test (Dev Internal)
      const allowedGroups = [String(config.ACTIVE_GROUP_ID), String(config.GROUP_MAIN_ID), String(config.GROUP_TEST_ID)].filter(Boolean);
      if (isGroup && !allowedGroups.includes(String(message.threadId))) {
        return;
      }

      // Bóc tách text và link từ message.data
      const { text, urls } = extractTextAndUrls(message.data);
      console.log(`[Message In] [${isGroup ? 'Group ' + message.threadId : 'DM ' + senderUid}] ${senderName} (Admin: ${isAdmin}): text="${text}", urls=${JSON.stringify(urls)}`);

      // Ghi nhận nhật ký hành vi người dùng (Group Message vs Bot DM)
      logActivity(
        isGroup ? "group_message" : "bot_dm",
        senderUid,
        senderName,
        { text: text.slice(0, 100), urlsCount: urls.length, threadId: message.threadId },
        isGroup ? `zalo_group_${message.threadId}` : "zalo_dm"
      );

      // 1. Kiểm tra nếu có link Shopee
      if (urls.length > 0) {
        const shopeeUrl = urls[0];
        await handleShopeeLink(shopeeUrl, message.threadId, message.type, senderName, senderUid);
        return;
      }

      // 2. Kiểm tra các lệnh
      const lower = text.toLowerCase();
      if (lower === "!ping" || lower === "/ping") {
        const reply = `Pong! 🏓 Bot Normie đang hoạt động ổn định 24/7 tại nhóm Dev Internal DP.`;
        await api.sendMessage(reply, message.threadId, message.type);
      } else if (lower === "!help" || lower === "/huongdan" || lower === "/help") {
        const tagText = isGroup && senderUid && !isAdmin ? `@${senderName}` : "";
        const tagPrefix = tagText ? `${tagText}\n` : "";

        const reply =
          tagPrefix +
          `📋 HƯỚNG DẪN NHẬN HOÀN TIỀN 80% SHOPEE\n\n` +
          `1️⃣ Gửi link sản phẩm Shopee bạn muốn mua vào nhóm hoặc inbox riêng cho mình.\n` +
          `2️⃣ Nhận lại link mua hàng đã kích hoạt hoàn tiền 80% hoa hồng.\n` +
          `3️⃣ Bấm link và tiến hành đặt hàng trực tiếp trên Shopee.\n` +
          `4️⃣ Truy cập https://hoantiendp.com để kiểm tra đơn và cập nhật số tài khoản ngân hàng nhận tiền hoàn (đơn sẽ tự động cập nhật sau khi Shopee Affiliate ghi nhận).\n` +
          `5️⃣ Tiền hoàn sẽ được tự động chuyển về số tài khoản của bạn sau khi Shopee hoàn tất đối soát.\n\n` +
          `📌 Các lệnh hỗ trợ:\n` +
          `• /chinhsach: Chính sách hoàn tiền 80% & các khoản khấu trừ\n` +
          `• /web: Website tra cứu đơn & cập nhật STK ngân hàng`;

        const mentions = tagText
          ? [
              {
                uid: String(senderUid),
                pos: 0,
                len: tagText.length,
              },
            ]
          : undefined;

        const boldTargets = [
          "HƯỚNG DẪN NHẬN HOÀN TIỀN 80% SHOPEE",
          "inbox riêng cho mình",
          "hoàn tiền 80% hoa hồng",
          "đặt hàng trực tiếp trên Shopee",
          "https://hoantiendp.com",
          "cập nhật số tài khoản ngân hàng",
          "Shopee Affiliate ghi nhận",
          "tự động chuyển về số tài khoản",
          "sau khi Shopee hoàn tất đối soát",
          "/chinhsach",
          "/web",
        ];

        const styles = [];
        for (const target of boldTargets) {
          if (!target) continue;
          const start = reply.indexOf(target);
          if (start !== -1) {
            styles.push({ start, len: target.length, st: "b" });
          }
        }
        styles.sort((a, b) => a.start - b.start);

        await api.sendMessage(
          {
            msg: reply,
            mentions: mentions,
            styles: styles.length > 0 ? styles : undefined,
          },
          message.threadId,
          message.type
        );
      } else if (lower === "/web" || lower === "!web") {
        const tagText = isGroup && senderUid && !isAdmin ? `@${senderName}` : "";
        const tagPrefix = tagText ? `${tagText}\n` : "";
        const reply =
          tagPrefix +
          `🌐 Website chính thức: https://hoantiendp.com\n\n` +
          `👉 Bạn truy cập website để kiểm tra lịch sử đơn hàng, theo dõi tiến độ tiền hoàn và cập nhật số tài khoản ngân hàng nhận tiền nhé!`;

        const mentions = tagText
          ? [{ uid: String(senderUid), pos: 0, len: tagText.length }]
          : undefined;

        const boldTargets = [
          "https://hoantiendp.com",
          "cập nhật số tài khoản ngân hàng",
        ];

        const styles = [];
        for (const target of boldTargets) {
          const start = reply.indexOf(target);
          if (start !== -1) styles.push({ start, len: target.length, st: "b" });
        }
        styles.sort((a, b) => a.start - b.start);

        await api.sendMessage(
          {
            msg: reply,
            mentions: mentions,
            styles: styles.length > 0 ? styles : undefined,
          },
          message.threadId,
          message.type
        );
      } else if (lower === "!chinhsach" || lower === "/chinhsach") {
        const tagText = isGroup && senderUid && !isAdmin ? `@${senderName}` : "";
        const tagPrefix = tagText ? `${tagText}\n` : "";

        const reply =
          tagPrefix +
          `💡 CHÍNH SÁCH HOÀN TIỀN 80% SHOPEE\n\n` +
          `• Tỷ lệ hoàn tiền: Bạn nhận trọn 80% hoa hồng thực tế mà hệ thống nhận được từ Shopee Affiliate.\n` +
          `• Mức ước tính ban đầu: Được tính trên giá niêm yết hiện tại của sản phẩm.\n` +
          `• Số tiền thực nhận: Sẽ được tính theo hoa hồng Shopee thực tế duyệt sau khi trừ voucher giảm giá và các khoản thuế/khấu trừ theo quy định (nếu có).\n` +
          `• Thời gian chi trả: Tiền sẽ được tự động chuyển cho bạn sau khi Shopee hoàn tất đối soát (thường từ 30 - 70 ngày kể từ khi đơn giao thành công).\n` +
          `• Tra cứu minh bạch: Truy cập website https://hoantiendp.com để xem chi tiết từng đơn hàng và số tiền tích lũy nhé!`;

        const mentions = tagText
          ? [{ uid: String(senderUid), pos: 0, len: tagText.length }]
          : undefined;

        const boldTargets = [
          "CHÍNH SÁCH HOÀN TIỀN 80% SHOPEE",
          "80% hoa hồng thực tế",
          "Shopee Affiliate",
          "hoa hồng Shopee thực tế duyệt",
          "thuế/khấu trừ",
          "tự động chuyển cho bạn",
          "sau khi Shopee hoàn tất đối soát",
          "30 - 70 ngày",
          "https://hoantiendp.com",
        ];

        const styles = [];
        for (const target of boldTargets) {
          if (!target) continue;
          const start = reply.indexOf(target);
          if (start !== -1) {
            styles.push({ start, len: target.length, st: "b" });
          }
        }
        styles.sort((a, b) => a.start - b.start);

        await api.sendMessage(
          {
            msg: reply,
            mentions: mentions,
            styles: styles.length > 0 ? styles : undefined,
          },
          message.threadId,
          message.type
        );
      } else if (lower === "/topdeal" || lower === "/hot") {
        const tagText = isGroup && senderUid && !isAdmin ? `@${senderName}` : "";
        const tagPrefix = tagText ? `${tagText}\n` : "";
        try {
          const statsRes = await fetch(`${config.MAIN_API_URL}/api/shopee/cache/stats`);
          const stats = await statsRes.json();
          const topItems = (stats.top_products || []).filter((p) => p.price && p.affiliate_url).slice(0, 5);
          if (topItems.length === 0) {
            await api.sendMessage(
              tagPrefix + `🔥 Hiện tại chưa có đủ dữ liệu top sản phẩm hot trong nhóm. Bạn cứ dán link Shopee vào nhé!`,
              message.threadId,
              message.type
            );
          } else {
            const lines = [`🔥 TOP SẢN PHẨM ĐƯỢC QUAN TÂM NHẤT TRONG NHÓM\n`];
            for (let i = 0; i < topItems.length; i++) {
              const item = topItems[i];
              lines.push(`${i + 1}️⃣ ${item.name.substring(0, 55)}...`);
              lines.push(`💰 Giá: ${item.price_formatted} | Hoàn 80%: ${item.cashback_formatted || "..."}`);
              lines.push(`🔗 ${item.affiliate_url}\n`);
            }
            lines.push(`👉 Bấm link trên để đặt hàng và nhận hoàn tiền 80% nhé!`);
            await api.sendMessage(tagPrefix + lines.join("\n"), message.threadId, message.type);
          }
        } catch (err) {
          console.error("[Top Deal Error]:", err.message);
        }
      } else if (lower === "/refreshcache") {
        if (!isAdmin) return;
        try {
          const refRes = await fetch(`${config.MAIN_API_URL}/api/shopee/cache/refresh-hot`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ limit: 30, max_age_hours: 0 }),
          });
          const refData = await refRes.json();
          await api.sendMessage(
            `✅ Đã làm mới giá và hoa hồng cho ${refData.refreshed_count || 0} sản phẩm hot trong DB!`,
            message.threadId,
            message.type
          );
        } catch (err) {
          console.error("[Refresh Cache Error]:", err.message);
        }
      } else if (lower === "!test-welcome") {
        await sendGroupWelcome(message.threadId, { id: senderUid, dName: senderName }, "Dev Internal DP");
        if (config.ENABLE_PRIVATE_WELCOME) {
          await sendPrivateWelcome({ id: senderUid, dName: senderName });
        }
      }
    } catch (err) {
      console.error("[Message Listener Error]:", err);
    }
  });

  // 4. Background Periodic Cron (Strategy 2): Quét làm mới giá Top sản phẩm hot mỗi 6 tiếng
  setInterval(async () => {
    try {
      console.log("[Background Cron] Bắt đầu quét cập nhật giá Top sản phẩm hot...");
      const res = await fetch(`${config.MAIN_API_URL}/api/shopee/cache/refresh-hot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20, max_age_hours: 6 }),
      });
      const data = await res.json();
      console.log(`[Background Cron] Đã cập nhật giá mới cho ${data.refreshed_count || 0} sản phẩm hot.`);
    } catch (err) {
      console.warn("[Background Cron Warning]:", err.message);
    }
  }, 6 * 60 * 60 * 1000);

  // B. LẮNG NGHE SỰ KIỆN THÀNH VIÊN VÀO NHÓM
  api.listener.on("group_event", async (event) => {
    try {
      const allowedGroups = [String(config.ACTIVE_GROUP_ID), String(config.GROUP_MAIN_ID), String(config.GROUP_TEST_ID)].filter(Boolean);
      if (!allowedGroups.includes(String(event.threadId))) return;

      console.log(`[Group Event] Nhận sự kiện: ${event.type} (${event.act}) trong group ${event.threadId}`);

      if (event.type === GroupEventType.JOIN) {
        const updateMembers = event.data.updateMembers || [];
        for (const member of updateMembers) {
          if (member.id === ownId) continue;

          console.log(`[Member Joined] Phát hiện thành viên mới gia nhập: ${member.dName || member.id}`);
          
          // Ghi nhận thành viên mới vào hệ thống quản trị
          logActivity(
            "group_join",
            member.id || member.uid,
            member.dName || member.name,
            { groupId: event.threadId, groupName: "Dev Internal DP" },
            `zalo_group_${event.threadId}`
          );

          // 1. Chào mừng trong nhóm kèm @tag
          await sendGroupWelcome(event.threadId, member, "Dev Internal DP");

          // 2. Nhắn tin riêng 1-1 (Tạm tắt theo config, giữ nguyên code để bật lại khi cần)
          if (config.ENABLE_PRIVATE_WELCOME) {
            await sendPrivateWelcome(member);
          } else {
            console.log(`[Private DM] Tạm tắt gửi tin riêng cho người mới: ${member.dName || member.id}`);
          }
        }
      }
    } catch (err) {
      console.error("[Group Event Handler Error]:", err);
    }
  });

  // Bắt đầu listener
  api.listener.start({ retryOnClose: true });

  // C. HTTP API NOTIFICATION SERVER (Port 8891)
  const server = http.createServer(async (req, res) => {
    // 1. Gửi thông báo tùy biến
    if (req.method === "POST" && req.url === "/api/notify") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          const targetId = payload.targetId || config.ACTIVE_GROUP_ID;
          const targetType = payload.type === "user" ? ThreadType.User : ThreadType.Group;
          const text = payload.message || "";
          const attachments = payload.attachments || (payload.imagePath ? [payload.imagePath] : undefined);

          console.log(`[HTTP Notify] Bắn thông báo tới ${targetId}: ${text} (attachments: ${attachments ? attachments.length : 0})`);
          const sendRes = await api.sendMessage(
            attachments ? { msg: text, attachments } : text,
            targetId,
            targetType
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, result: sendRes }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
    }
    // 2. Bắn thông báo thẳng vào Active Group
    else if (req.method === "POST" && req.url === "/api/broadcast") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          const text = payload.message || "";
          const attachments = payload.attachments || (payload.imagePath ? [payload.imagePath] : undefined);

          console.log(`[HTTP Broadcast] Gửi broadcast vào group ${config.ACTIVE_GROUP_ID}: ${text}`);
          const sendRes = await api.sendMessage(
            attachments ? { msg: text, attachments } : text,
            config.ACTIVE_GROUP_ID,
            ThreadType.Group
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, result: sendRes }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
    }
    // 3. API lấy thông tin nhóm Hoàn Tiền Shopee
    else if (req.method === "GET" && req.url === "/api/group-info") {
      try {
        const targetGid = String(config.GROUP_MAIN_ID || config.ACTIVE_GROUP_ID);
        const res = await api.getGroupInfo(targetGid);
        const gInfo = res?.gridInfoMap?.[targetGid] || res;
        const totalMembers = gInfo?.totalMember ?? 33;
        const groupName = gInfo?.name || "Hoàn Tiền Shopee";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          groupId: targetGid,
          groupName,
          totalMembers,
        }));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          groupId: config.GROUP_MAIN_ID,
          groupName: "Hoàn Tiền Shopee",
          totalMembers: 33,
        }));
      }
    }
    // 4. Kiểm tra trạng thái
    else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "running",
        botUid: ownId,
        activeGroupId: config.ACTIVE_GROUP_ID,
        mainGroupId: config.GROUP_MAIN_ID,
        target: "Hoàn Tiền Shopee (33 thành viên)"
      }));
    }
  });

  async function syncGroupInfo() {
    try {
      const targetGid = String(config.GROUP_MAIN_ID || config.ACTIVE_GROUP_ID);
      const res = await api.getGroupInfo(targetGid);
      const gInfo = res?.gridInfoMap?.[targetGid] || res;
      if (gInfo) {
        const totalMembers = gInfo.totalMember || 33;
        const groupName = gInfo.name || "Hoàn Tiền Shopee";
        console.log(`[Group Sync] Nhóm chính "${groupName}" (${targetGid}): ${totalMembers} thành viên`);
        await fetch(`${config.MAIN_API_URL}/api/activity/group-info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            group_id: targetGid,
            group_name: groupName,
            total_members: totalMembers,
          }),
        }).catch(() => {});
      }
    } catch (err) {
      console.warn(`[syncGroupInfo Warning]:`, err.message);
    }
  }

  // Chạy đồng bộ nhóm ngay khi khởi động và định kỳ mỗi 60s
  syncGroupInfo();
  setInterval(syncGroupInfo, 60000);

  server.listen(config.PORT, () => {
    console.log(`[HTTP Server] Notification API đang chạy tại http://localhost:${config.PORT}`);
  });
}

main().catch((err) => {
  console.error("Lỗi khởi động Assistant:", err);
});
