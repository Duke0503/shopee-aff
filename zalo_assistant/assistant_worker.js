import { Zalo, ThreadType, GroupEventType, FriendEventType } from "zca-js";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import sizeOf from "image-size";
import { config } from "./config.js";
import { createFriendKeeper } from "./friends.js";

// Regex nhận diện link Shopee, TikTok Shop, Lazada, Tiki & ShopeeFood
const SHOPEE_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)?(?:shopee\.vn|s\.shopee\.vn|shp\.ee)\/[^\s]+/i;
const TIKTOK_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.shop)\/[^\s]+/i;
const LAZADA_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:lazada\.vn|s\.lazada\.vn|c\.lazada\.vn)\/[^\s]+/i;
const TIKI_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:tiki\.vn|ti\.ki)\/[^\s]+/i;
const SHOPEEFOOD_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:shopeefood\.vn|food\.shopee\.vn|shopee\.vn\/now-food)\/[^\s]+/i;
const PRODUCT_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:shopee\.vn|s\.shopee\.vn|shp\.ee|tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.shop|lazada\.vn|s\.lazada\.vn|c\.lazada\.vn|tiki\.vn|ti\.ki|shopeefood\.vn|food\.shopee\.vn)\/[^\s]+/i;

async function reportBugToTelegram({ title, details, severity = "HIGH", source = "zalo_assistant", trace = "", actionNeeded = "" }) {
  try {
    await fetch(`${config.MAIN_API_URL}/api/alerts/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alert_type: "bug_report",
        title,
        details,
        severity,
        source,
        error_trace: trace,
        action_needed: actionNeeded,
      }),
    });
  } catch (_) {
    // Direct Telegram fallback
    const devChatId = config.TELEGRAM_DEV_CHAT_ID || config.TELEGRAM_CHAT_ID;
    if (config.TELEGRAM_BOT_TOKEN && devChatId) {
      const badge = severity === "CRITICAL" ? "🚨🔴 [BUG CRITICAL - KHẨN CẤP]" : (severity === "HIGH" ? "⚠️🟠 [BUG HIGH - QUAN TRỌNG]" : "⚠️🟡 [WARNING]");
      const text = `${badge} <b>${title}</b>\n\n` +
                   `📍 <b>Nguồn:</b> <code>${source}</code>\n` +
                   `⏱ <b>Thời gian:</b> <code>${new Date().toLocaleTimeString('vi-VN')}</code>\n` +
                   `📝 <b>Chi tiết:</b>\n${details}\n` +
                   (trace ? `\n📌 <b>Trace:</b>\n<pre>${trace.slice(0, 800)}</pre>\n` : "") +
                   (actionNeeded ? `\n👉 <b>Xử lý:</b> ${actionNeeded}` : "");
      fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: devChatId, text, parse_mode: "HTML" }),
      }).catch(() => {});
    }
  }
}

process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]:", err);
  reportBugToTelegram({
    title: "Uncaught Exception trong Zalo Assistant",
    severity: "CRITICAL",
    details: err?.message || String(err),
    trace: err?.stack || "",
    actionNeeded: "Kiểm tra tiến trình Zalo Assistant bot xem có bị treo hoặc sập không.",
  });
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Unhandled Rejection]:", reason);
  reportBugToTelegram({
    title: "Unhandled Promise Rejection trong Zalo Assistant",
    severity: "HIGH",
    details: String(reason?.message || reason),
    trace: reason?.stack || "",
    actionNeeded: "Kiểm tra lỗi bất đồng bộ trong assistant_worker.js.",
  });
});

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer()
      .once("error", (err) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(`Cổng ${port} đang được sử dụng bởi một tiến trình Bot khác. Dừng tiến trình này ngay để tránh tranh chấp WebSocket Zalo.`));
        } else {
          reject(err);
        }
      })
      .once("listening", () => {
        tester.once("close", () => resolve()).close();
      })
      .listen(port, "127.0.0.1");
  });
}

async function main() {
  console.log("=== KHỞI ĐỘNG ZALO ASSISTANT BOT (FULL PLAN) ===");
  try {
    await checkPortAvailable(config.PORT);
  } catch (err) {
    console.error(`[FATAL CONCURRENCY ERROR] ${err.message}`);
    process.exit(1);
  }
  const credentials = JSON.parse(await fs.readFile(config.CREDENTIALS_PATH, "utf-8"));

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
  console.log(`[Environment] Môi trường hoạt động: ${config.APP_ENV.toUpperCase()} (${config.IS_PRODUCTION ? 'PRODUCTION 🚀' : 'DEV LOCAL 🛠️'})`);
  console.log(`[Config] Nhóm đang kích hoạt (Active Group): ${config.ACTIVE_GROUP_ID}`);
  if (config.IS_DEV) {
    console.log(`[Dev Safeguard] 🛡️ ĐÃ BẬT BẢO VỆ: Bot local tuyệt đối KHÔNG gửi tin nhắn vào nhóm Production (${config.GROUP_MAIN_ID}) nếu không có cờ cưỡng chế.`);
  }

  // Safeguard: Bọc api.sendMessage để chặn triệt để mọi hành vi bot local gửi tin nhắn vào nhóm Production
  const originalSendMessage = api.sendMessage.bind(api);
  api.sendMessage = async function(content, threadId, threadType, options = {}) {
    const threadIdStr = String(threadId || "");
    const isProdGroup = threadIdStr === String(config.GROUP_MAIN_ID);

    if (config.IS_DEV && isProdGroup) {
      // Chỉ cho phép nếu có cờ forceProd hoặc tin nhắn là object có cờ forceProd / force_production
      const isForced = options?.forceProd || options?.force_production || (typeof content === "object" && (content?.forceProd || content?.force_production));
      if (!isForced) {
        const preview = typeof content === "string" 
          ? content.slice(0, 90).replace(/\n/g, " ") 
          : JSON.stringify(content?.msg || content).slice(0, 90);
        console.warn(
          `[DEV SAFEGUARD BLOCKED] ⛔ ĐÃ CHẶN gửi tin nhắn vào nhóm Production (${threadIdStr})! ` +
          `Bot đang chạy ở DEV (APP_ENV=${config.APP_ENV}). Nội dung: "${preview}"`
        );
        return { ok: true, dev_blocked: true, target: threadIdStr };
      }
      console.warn(`[DEV OVERRIDE] ⚠️ Cho phép gửi vào nhóm Production (${threadIdStr}) do có cờ forceProd từ lệnh chỉ định.`);
    }

    return originalSendMessage(content, threadId, threadType);
  };

  const wording = JSON.parse(await fs.readFile(config.MESSAGES_PATH, "utf-8"));
  const friends = createFriendKeeper({
    api,
    ownId,
    statePath: config.FRIEND_STATE_PATH,
    dailyLimit: config.FRIEND_REQUESTS_PER_DAY,
    message: wording.friend_request,
  });

  // Group owner and deputies, cached a minute. Only operator commands
  // (/refreshcache) check it: everyone, admins included, is tagged by name.
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

  // Helper chọn template ngẫu nhiên và thay thế biến
  function getRandomTemplate(templates, vars = {}) {
    if (!Array.isArray(templates) || templates.length === 0) return "";
    let template = templates[Math.floor(Math.random() * templates.length)];
    for (const [key, val] of Object.entries(vars)) {
      template = template.replaceAll(`{${key}}`, val);
    }
    return template;
  }

  // Dynamic Group Name Resolver
  const groupNameCache = new Map();
  async function getGroupName(groupId) {
    const gidStr = String(groupId);
    if (gidStr === String(config.GROUP_MAIN_ID) || gidStr === "2813090100064697955") {
      return "Hoàn Tiền Shopee";
    }
    if (gidStr === String(config.GROUP_TEST_ID) || gidStr === "8786316503449470342") {
      return "Dev Internal DP";
    }
    if (groupNameCache.has(gidStr)) {
      return groupNameCache.get(gidStr);
    }
    try {
      const res = await api.getGroupInfo(gidStr);
      const gInfo = res?.gridInfoMap?.[gidStr] || res;
      const name = gInfo?.name || gInfo?.groupName || "Hoàn Tiền Shopee";
      groupNameCache.set(gidStr, name);
      return name;
    } catch {
      return "Hoàn Tiền Shopee";
    }
  }

  // 1. Helper gửi lời chào trong nhóm (hỗ trợ gộp tag nhiều người trong 1 tin nhắn để chống spam)
  async function sendGroupWelcomeBatch(groupId, members, groupName = "Hoàn Tiền Shopee") {
    if (!members || members.length === 0) return;
    const validMembers = members.filter((m) => String(m.id || m.uid) !== String(ownId));
    if (validMembers.length === 0) return;

    // Chọn ngẫu nhiên mẫu template
    const rawTemplate = getRandomTemplate(config.GROUP_WELCOME_TEMPLATES, {
      tag: "__TAGS_PLACEHOLDER__",
      groupName: groupName,
    });

    const placeholderIdx = rawTemplate.indexOf("__TAGS_PLACEHOLDER__");
    const prefix = placeholderIdx !== -1 ? rawTemplate.substring(0, placeholderIdx) : "Chào mừng ";
    const suffix = placeholderIdx !== -1 ? rawTemplate.substring(placeholderIdx + "__TAGS_PLACEHOLDER__".length) : "! 🎉";

    const mentions = [];
    let tagsStr = "";

    for (let i = 0; i < validMembers.length; i++) {
      const m = validMembers[i];
      const mName = m.dName || m.name || `bạn ${String(m.id || m.uid).slice(-4)}`;
      const tagText = `@${mName}`;
      const mUid = String(m.id || m.uid);

      if (i > 0) {
        if (i === validMembers.length - 1) {
          tagsStr += " & ";
        } else {
          tagsStr += ", ";
        }
      }

      const mentionPos = prefix.length + tagsStr.length;
      mentions.push({
        uid: mUid,
        pos: mentionPos,
        len: tagText.length,
      });

      tagsStr += tagText;
    }

    const fullText = prefix + tagsStr + suffix;

    const boldTargets = [
      "dán thẳng link vào nhóm hoặc inbox riêng cho mình",
      "nhắn tin trực tiếp cho mình hoặc gửi thẳng link sản phẩm Shopee / TikTok Shop vào nhóm này",
      "nhắn tin trực tiếp cho mình hoặc gửi thẳng link sản phẩm Shopee vào nhóm này",
      "gửi link sản phẩm vào nhóm hoặc inbox riêng cho mình",
      "nhận trọn 80% hoàn tiền",
      "hoàn tiền 80%",
      "hoàn tiền 80% Shopee",
      "https://hoantiendp.com",
      "Shopee Affiliate ghi nhận",
      "Mã Khách Hàng",
      "/id",
      "/matkhau",
    ];

    const styles = [];
    for (const target of boldTargets) {
      let startIndex = 0;
      while ((startIndex = fullText.indexOf(target, startIndex)) !== -1) {
        styles.push({ start: startIndex, len: target.length, st: "b" });
        startIndex += target.length;
      }
    }
    styles.sort((a, b) => a.start - b.start);

    try {
      await api.sendMessage(
        {
          msg: fullText,
          mentions: mentions,
          styles: styles.length > 0 ? styles : undefined,
        },
        groupId,
        ThreadType.Group
      );
      console.log(`[Group Welcome Batch] Đã gửi lời chào tới ${validMembers.length} thành viên trong nhóm ${groupName}!`);
    } catch (err) {
      console.error(`[Group Welcome Batch Error]:`, err.message);
    }
  }

  // Buffer gom lời chào (Debounce chống spam khi nhiều thành viên cùng vào nhóm một lúc)
  const pendingWelcomeQueues = new Map();
  function queueGroupWelcome(groupId, newMembers, groupName) {
    const gidStr = String(groupId);
    let queue = pendingWelcomeQueues.get(gidStr);
    if (!queue) {
      queue = { members: [], timer: null };
      pendingWelcomeQueues.set(gidStr, queue);
    }

    for (const m of newMembers) {
      const mid = String(m.id || m.uid);
      if (mid !== String(ownId) && !queue.members.some((ex) => String(ex.id || ex.uid) === mid)) {
        queue.members.push(m);
      }
    }

    if (queue.timer) {
      clearTimeout(queue.timer);
    }

    const delay = randomInt(config.DELAY_GROUP_MIN_MS, config.DELAY_GROUP_MAX_MS);
    console.log(`[Group Welcome] Đang gom ${queue.members.length} thành viên mới, sẽ gửi chào mừng sau ${delay}ms...`);
    queue.timer = setTimeout(async () => {
      const membersToSend = [...queue.members];
      queue.members = [];
      queue.timer = null;
      if (membersToSend.length > 0) {
        await sendGroupWelcomeBatch(gidStr, membersToSend, groupName);
      }
    }, delay);
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

// Helper làm sạch URL bóc tách từ tin nhắn
function cleanExtractedUrl(u) {
  if (typeof u !== "string") return "";
  let cleaned = u.trim();
  // Loại bỏ các ký tự bọc URL hoặc dấu câu ở cuối/đầu do người dùng gõ kèm
  cleaned = cleaned.replace(/^['"<([{\\]+/, "").replace(/['">,.;:)\]}\\]+$/, "");
  return cleaned;
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

    // Quét trực tiếp các link trong content text của người gửi
    const directMatches = data.content.match(/https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:shopee\.vn|s\.shopee\.vn|shp\.ee|tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.shop|lazada\.vn|s\.lazada\.vn|c\.lazada\.vn|shopeefood\.vn|food\.shopee\.vn)\/[^\s]+/gi);
    if (directMatches) {
      urls.push(...directMatches);
    }
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

  // Quét regex trên toàn bộ chuỗi JSON của data để không bao giờ bỏ sót bất kỳ link Shopee, TikTok, Lazada, Tiki hay ShopeeFood nào (cho phép dấu nháy đơn ' trong URL như L'Oreal)
  try {
    const rawJson = JSON.stringify(data);
    const productMatches = rawJson.match(/https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:shopee\.vn|s\.shopee\.vn|shp\.ee|tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.shop|lazada\.vn|s\.lazada\.vn|c\.lazada\.vn|tiki\.vn|ti\.ki|shopeefood\.vn|food\.shopee\.vn)\/[^\s"\\]+/gi);
    if (productMatches) {
      for (const m of productMatches) {
        urls.push(m);
      }
    }
  } catch (_) {}

  // Chuẩn hóa và chỉ giữ lại link sản phẩm hợp lệ
  const validUrls = urls
    .map(cleanExtractedUrl)
    .filter((u) => PRODUCT_LINK_REGEX.test(u));

  return { text: text.trim(), urls: [...new Set(validUrls)] };
}

  // Bộ nhớ đệm RAM (Level-1 Cache) lưu sản phẩm trong 12 tiếng để phản hồi tức thì 0.001s
  const memoryProductCache = new Map(); // key: item_id, val: { data, cachedAt }

  // 3. Helper xử lý link Shopee & TikTok Shop (Áp dụng Smart Resolve đa sàn + Cache RAM + DB SQLite)
  async function handleProductLink(rawUrl, threadId, threadType, senderName, senderUid, customerId = null) {
    try {
      const isTikTok = TIKTOK_LINK_REGEX.test(rawUrl);
      const isLazada = LAZADA_LINK_REGEX.test(rawUrl);
      const isTiki = TIKI_LINK_REGEX.test(rawUrl);
      const isFood = SHOPEEFOOD_LINK_REGEX.test(rawUrl);

      const isGroup = threadType === ThreadType.Group;
      const tagText = isGroup && senderUid ? `@${senderName}` : "";
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

      // Nếu khách gửi link Lazada hoặc Tiki: Phản hồi ngay chỉ hỗ trợ Shopee và TikTok Shop
      if (isLazada || isTiki) {
        const platName = isLazada ? "Lazada" : "Tiki";
        console.log(`[Unsupported Platform] Khách gửi link ${platName}: ${rawUrl} (Người gửi: ${senderName}, UID: ${senderUid})`);
        const unsupportedMsg =
          tagPrefix +
          `Dạ hiện tại hệ thống chỉ hỗ trợ hoàn tiền cho các đơn hàng trên Shopee và TikTok Shop thôi bạn nhé! 🛍️✨\n\n` +
          `👉 Bạn hãy gửi link sản phẩm Shopee hoặc TikTok Shop để nhận lại đến 80% tiền hoàn nha! 💖`;
        await api.sendMessage({ msg: unsupportedMsg, mentions }, threadId, threadType);
        return;
      }

      const platformLabel = isTikTok ? "TikTok Shop" : (isFood ? "ShopeeFood" : "Shopee");
      console.log(`[${platformLabel} Link] Đang kiểm tra thông tin link: ${rawUrl} (Người gửi: ${senderName}, UID: ${senderUid})`);
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

      // Nếu người bán (Shop) không tham gia chương trình tiếp thị liên kết (Affiliate)
      if (resolveRes.no_affiliate || resolveRes.error === "product_not_in_affiliate") {
        console.warn(`[${platformLabel} Link] Shop không tham gia Affiliate: ${rawUrl}`);
        const noAffMsg =
          tagPrefix +
          `⚠️ Rất tiếc, người bán (Shop) của sản phẩm này hiện không tham gia chương trình hoàn tiền / tiếp thị liên kết trên ${platformLabel} nên hệ thống không thể tạo link hoàn tiền được bạn nhé! 🛍️\n\n` +
          `👉 Bạn hãy thử tìm sản phẩm tương tự từ các Shop khác xem sao nha!`;
        await api.sendMessage({ msg: noAffMsg, mentions }, threadId, threadType);
        return;
      }

      let productData = resolveRes.ok && resolveRes.ready ? resolveRes : null;
      let affUrl = productData?.affiliate_url;

      // Nếu sản phẩm mới tinh chưa từng có (ready: false), chờ extension/worker tạo link (tối đa 28s)
      if (!affUrl && resolveRes.request_id) {
        console.log(`[${platformLabel} Link] Sản phẩm mới, chờ worker chuyển đổi link (request_id: ${resolveRes.request_id})...`);
        // Tăng thời gian chờ lên 65 lần x 0.8s = 52s để đồng bộ với backend & extension (tránh báo lỗi giả khi hệ thống đang xử lý)
        const maxAttempts = 65; // 65 * 800ms = 52s
        for (let i = 0; i < maxAttempts; i++) {
          await sleep(800);
          try {
            const statusRes = await fetch(`${config.MAIN_API_URL}/api/shopee/link-status?request_id=${resolveRes.request_id}`);
            const statusData = await statusRes.json();
            if (statusData.failed) {
              console.warn(`[${platformLabel} Link] Worker báo lỗi tạo link (failed) cho request_id: ${resolveRes.request_id}`);
              break;
            }
            if (statusData.ok && statusData.ready && statusData.affiliate_url) {
              affUrl = statusData.affiliate_url;
              productData = { ...(productData || {}), ...statusData };
              if (statusData.is_group_order || resolveRes.is_group_order) {
                productData.is_group_order = true;
              }
              console.log(`[${platformLabel} Link] Đã tạo thành công link Affiliate sau ${((i + 1) * 0.8).toFixed(1)}s: ${affUrl}`);
              break;
            }
          } catch (_) {}
        }
      }

      // Nếu sau thời gian chờ vẫn không có link Affiliate, TUYỆT ĐỐI KHÔNG gửi link gốc rawUrl
      if (!affUrl) {
        console.warn(`[${platformLabel} Link] Không lấy được link affiliate cho: ${rawUrl}`);
        const busyMsg =
          tagPrefix +
          `⚠️ Hệ thống chưa thể tạo link hoàn tiền cho liên kết ${platformLabel} này (có thể quán/sản phẩm không thuộc chương trình tiếp thị liên kết hoặc link chia sẻ đã hết hạn).\n\n👉 Bạn hãy thử sao chép link trực tiếp từ trang chính của quán/sản phẩm giúp mình nhé!`;
        await api.sendMessage({ msg: busyMsg, mentions }, threadId, threadType);
        return;
      }

      // Our own short link when the backend gave one. Tapped inside Zalo it
      // lands on our page, which gets the customer into a real browser
      // before Shopee: opened in Zalo's in-app browser, the purchase is not
      // credited (see src/cashback/web/share_page.py).
      const linkUrl = productData?.share_url || resolveRes.share_url || affUrl;
      const openHint = linkUrl !== affUrl && wording.link_open_hint ? `${wording.link_open_hint}\n\n` : "";

      // A link made for this customer just now arrives with a name at most
      // (link-status carries no figures), so a name alone is not enough to
      // skip the preview: without it the reply goes out with no price and
      // no cashback amount.
      const hasFigures = productData && (productData.price > 0 || productData.commission > 0 ||
        productData.total_commission > 0 || productData.shopee_rate > 0 || productData.seller_rate > 0);
      if (!hasFigures && affUrl) {
        try {
          const previewRes = await fetch(`${config.MAIN_API_URL}/api/shopee/preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: rawUrl }),
          });
          const previewData = await previewRes.json();
          if (previewData.ok && previewData.found) {
            const isGroupOrder = productData && productData.is_group_order;
            productData = isGroupOrder ? { ...previewData, is_group_order: true } : previewData;
          }
        } catch (_) {}
      }

      let replyText = "";
      const boldTargets = [
        `Link hoàn tiền ${platformLabel} của bạn đã sẵn sàng`,
        `Link đặt ShopeeFood của bạn đã sẵn sàng`,
        `Bấm link trên và đặt hàng trực tiếp trên ${platformLabel}`,
        `Bấm link trên để mở App Shopee / ShopeeFood và đặt món`,
        "Nên mua ngay sau khi mở link",
        "Nên đặt món ngay sau khi mở link",
      ];

      if (isFood) {
        const rawStoreName = (productData?.name || "").trim();
        const hasValidStoreName =
          rawStoreName &&
          !/^quán ăn shopeefood$/i.test(rawStoreName) &&
          !/^shop(\s*\(.*?\))?$/i.test(rawStoreName) &&
          !/^shopeefood$/i.test(rawStoreName);

        const storeSection = hasValidStoreName ? `🍽️ ${rawStoreName}\n` : "";
        const readyTitle = `Link đặt ShopeeFood của bạn đã sẵn sàng`;
        const actionTitle = `Bấm link trên để mở App Shopee / ShopeeFood và đặt món`;
        boldTargets.push(readyTitle, actionTitle, "nhận 80% hoa hồng tích lũy");

        const groupOrderTip = (productData?.is_group_order || resolveRes?.is_group_order)
          ? `\n👥 Bạn đang đặt đơn nhóm: Người chốt đơn/thanh toán chỉ cần bấm vào link hoàn tiền này trước khi thanh toán đơn nhóm để được ghi nhận hoa hồng nhé!\n`
          : "";

        replyText =
          tagPrefix +
          `🍜 ${readyTitle}\n\n` +
          storeSection +
          `🔗 ${linkUrl}\n\n` +
          openHint +
          `🎁 Bạn sẽ nhận 80% hoa hồng tích lũy của đơn sau khi giao hàng thành công (Shopee áp dụng trần hoa hồng cho từng quán)!\n` +
          groupOrderTip +
          `\n👉 ${actionTitle}.\n` +
          `💡 Nên đặt món ngay sau khi mở link và hạn chế bấm link khác trước khi chốt đơn bạn nhé!`;
      } else if (productData && (productData.shopee_rate > 0 || productData.seller_rate > 0 || productData.commission > 0 || productData.total_commission > 0 || productData.found)) {
        const commissionLines = [];
        const commissionItems = [];
        if (isTikTok) {
          const rateText = (productData.seller_rate && productData.seller_rate > 0)
            ? `TikTok Shop ${productData.seller_rate}%`
            : "TikTok Shop";
          const payoutPart = productData.seller_part_formatted || productData.commission_formatted || `${productData.commission || productData.total_commission || 0}đ`;
          const coreText = `${rateText} → ${payoutPart}`;
          commissionLines.push(`• ${coreText}`);
          commissionItems.push(coreText);
        } else if (isLazada) {
          const rateText = (productData.seller_rate && productData.seller_rate > 0)
            ? `Lazada ${productData.seller_rate}%`
            : "Lazada";
          const payoutPart = productData.seller_part_formatted || productData.commission_formatted || `${productData.commission || productData.total_commission || 0}đ`;
          const coreText = `${rateText} → ${payoutPart}`;
          commissionLines.push(`• ${coreText}`);
          commissionItems.push(coreText);
        } else {
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
          `🎉 Link hoàn tiền ${platformLabel} của bạn đã sẵn sàng\n\n` +
          (productData.name ? `📦 ${productData.name}\n` : "") +
          `🔗 ${linkUrl}\n\n` +
          openHint +
          `📊 Hoa hồng hiện tại:\n` +
          `${commissionSection}\n\n` +
          `🎁 ${payoutLine}\n\n` +
          `👉 Bấm link trên và đặt hàng trực tiếp trên ${platformLabel}.\n` +
          `💡 Nên mua ngay sau khi mở link và hạn chế bấm thêm link Affiliate khác trước khi đặt hàng.`;
      } else {
        replyText =
          tagPrefix +
          `🎉 Link hoàn tiền ${platformLabel} của bạn đã sẵn sàng\n\n` +
          `🔗 ${linkUrl}\n\n` +
          openHint +
          `👉 Bấm link trên và đặt hàng trực tiếp trên ${platformLabel}.\n` +
          `💡 Nên mua ngay sau khi mở link và hạn chế bấm thêm link Affiliate khác trước khi đặt hàng.`;
      }

      // A campaign this order could still win: said only when true for this
      // customer on this platform. Any failure leaves the reply as it was.
      try {
        const platformKey = isTikTok ? "tiktok" : isFood ? "shopeefood" : isLazada ? "lazada" : "shopee";
        const offerRes = await fetch(
          `${config.MAIN_API_URL}/api/campaigns/offer?customer_id=${encodeURIComponent(effectiveCustomerId)}&platform=${platformKey}`,
          { signal: AbortSignal.timeout(3000) }
        ).then((r) => r.json());
        const offer = offerRes && offerRes.ok ? offerRes.offer : null;
        if (offer && wording.campaign_link_hint) {
          const money = (n) => `${Number(n).toLocaleString("vi-VN")}${wording.currency || ""}`;
          const bonus = money(offer.bonus);
          // The total only when the cashback is known: a guessed total is a promise.
          const cashbackNum = Number(productData?.cashback) || 0;
          const total = cashbackNum > 0 && wording.campaign_link_total
            ? wording.campaign_link_total.replaceAll("{total}", money(cashbackNum + Number(offer.bonus)))
            : "";
          const rule = offer.per_customer > 0
            ? (wording.campaign_rule_per_customer || "").replaceAll("{cap}", String(offer.per_customer))
            : (wording.campaign_rule_unlimited || "");
          replyText += "\n\n" + wording.campaign_link_hint
            .replaceAll("{name}", offer.name)
            .replaceAll("{slots}", String(offer.slots))
            .replaceAll("{left}", String(offer.left))
            .replaceAll("{bonus}", bonus)
            .replaceAll("{rule}", rule)
            .replaceAll("{total}", total);
        }
      } catch (_) {}

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
      console.log(`[${platformLabel} Link] Đã phản hồi tin nhắn kèm link Affiliate cho ${senderName}`);
    } catch (err) {
      console.error(`[Product Link Error]:`, err.message);
    }
  }
  const handleShopeeLink = handleProductLink;

  // LẮNG NGHE SỰ KIỆN QUA WEBSOCKET
  let reconnectAttempts = 0;

  api.listener.on("connected", () => {
    reconnectAttempts = 0;
    console.log("[Listener] Kết nối WebSocket Zalo thành công. Đang lắng nghe 24/7...");
  });

  api.listener.on("closed", (code, reason) => {
    reconnectAttempts++;
    // Exponential backoff: 3s, 6s, 12s, 24s, tối đa 30s để tránh spam kết nối khi bị xung đột session
    const delaySec = Math.min(30, 3 * Math.pow(2, Math.min(reconnectAttempts - 1, 4)));
    console.warn(`[Listener] WebSocket đóng (${code}): ${reason}. Thử kết nối lại lần ${reconnectAttempts} sau ${delaySec}s...`);
    setTimeout(() => {
      try {
        api.listener.start({ retryOnClose: true });
      } catch (err) {
        console.error("[Listener Reconnect Error]:", err.message);
      }
    }, delaySec * 1000);
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

      // Only the groups this environment serves; see LISTEN_GROUP_IDS in config.js
      const allowedGroups = config.LISTEN_GROUP_IDS.map(String);
      if (isGroup && !allowedGroups.includes(String(message.threadId))) {
        return;
      }

      // Ở môi trường DEV, bot local tuyệt đối KHÔNG phản hồi tin nhắn trong nhóm Production
      // trừ khi là lệnh cưỡng chế của admin bắt đầu bằng !force-prod
      if (isGroup && String(message.threadId) === String(config.GROUP_MAIN_ID) && config.IS_DEV) {
        const rawContent = message.data?.content || message.data?.msg || "";
        if (!String(rawContent).trim().startsWith("!force-prod")) {
          return;
        }
      }

      // Bóc tách text và link từ message.data
      const { text, urls } = extractTextAndUrls(message.data);
      console.log(`[Message In] [${isGroup ? 'Group ' + message.threadId : 'DM ' + senderUid}] ${senderName}: text="${text}", urls=${JSON.stringify(urls)}`);

      // They wrote to us first, privately: offer to be friends (once).
      if (!isGroup && !message.isSelf) {
        friends.afterPrivateMessage(senderUid).catch(() => {});
      }

      // Ghi nhận nhật ký hành vi người dùng (Group Message vs Bot DM)
      logActivity(
        isGroup ? "group_message" : "bot_dm",
        senderUid,
        senderName,
        { text: text.slice(0, 100), urlsCount: urls.length, threadId: message.threadId },
        isGroup ? `zalo_group_${message.threadId}` : "zalo_dm"
      );

      // 1. Kiểm tra nếu có link Shopee hoặc TikTok Shop
      if (urls.length > 0) {
        const productUrl = urls[0];
        await handleProductLink(productUrl, message.threadId, message.type, senderName, senderUid);
        return;
      }

      // 2. Kiểm tra các lệnh (BẮT BUỘC PHẢI CÓ DẤU / HOẶC ! ĐẰNG TRƯỚC ĐỂ KHÔNG BẮT NHẦM TIN NHẮN THÔNG THƯỜNG)
      const cmdMatch = text.match(/(?:^|\s)([\/!][a-zA-Z0-9_]+)/);
      const cmd = cmdMatch ? cmdMatch[1].toLowerCase() : "";

      const isIdCmd = cmd === "/id" || cmd === "!id" || cmd === "/ma" || cmd === "!ma";
      const isPassCmd = cmd === "/matkhau" || cmd === "!matkhau" || cmd === "/pass" || cmd === "!pass" || cmd === "/password" || cmd === "!password";
      const isBalanceCmd = cmd === "/sodu" || cmd === "!sodu";
      const isOrdersCmd = ["/donhang", "!donhang", "/don", "!don", "/lichsu", "!lichsu"].includes(cmd);

      // Xử lý lệnh lấy ID / Mật khẩu / Số dư / Đơn hàng
      if (isIdCmd || isPassCmd || isBalanceCmd || isOrdersCmd) {
        // TRƯỜNG HỢP 1: Người dùng gõ trong NHÓM CHUNG -> Bot tag nhắc nhắn riêng để bảo mật
        if (isGroup && isOrdersCmd) {
          // Orders and amounts are private: answer only in a 1-1 chat.
          const tagText = senderUid ? `@${senderName}` : "";
          const reply = (tagText ? `${tagText}\n` : "") + wording.orders_in_group;
          await api.sendMessage(
            {
              msg: reply,
              mentions: tagText ? [{ uid: String(senderUid), pos: 0, len: tagText.length }] : undefined,
            },
            message.threadId,
            message.type
          );
          return;
        }
        if (isGroup) {
          const tagText = senderUid ? `@${senderName}` : "";
          const tagPrefix = tagText ? `${tagText}\n` : "";
          const reply =
            tagPrefix +
            `🔒 Để bảo mật thông tin tài khoản và mật khẩu cá nhân, bạn hãy bấm vào ảnh đại diện của mình và NHẮN TIN RIÊNG (inbox 1-1) cho mình nhé:\n\n` +
            `👉 Gõ "/id" để nhận Mã Khách Hàng riêng của bạn\n` +
            `👉 Gõ "/matkhau" để nhận mật khẩu đăng nhập website https://hoantiendp.com\n\n` +
            `⚠️ Tuyệt đối không lấy mật khẩu ở nhóm chung để tránh lộ tài khoản nha!`;

          const mentions = tagText
            ? [{ uid: String(senderUid), pos: 0, len: tagText.length }]
            : undefined;

          const boldTargets = [
            "NHẮN TIN RIÊNG",
            "/id",
            "/matkhau",
            "https://hoantiendp.com",
            "Tuyệt đối không lấy mật khẩu ở nhóm chung",
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

          // Chủ động gửi 1 tin nhắn vào inbox riêng cho khách để tiện trao đổi
          try {
            if (senderUid) {
              if (isPassCmd) {
                await api.sendMessage(
                  `Chào ${senderName} 👋! Mình thấy bạn vừa hỏi mật khẩu trong nhóm. Để đảm bảo an toàn, bạn hãy gửi lệnh /matkhau ngay tại khung chat riêng này với mình để nhận mật khẩu đăng nhập website https://hoantiendp.com nhé! 🔒`,
                  String(senderUid),
                  ThreadType.User
                );
              } else {
                const authRes = await fetch(`${config.MAIN_API_URL}/api/bot/customer-auth`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ uid: String(senderUid), name: senderName, action: "get_id" }),
                }).then((r) => r.json()).catch(() => null);

                const custId = authRes?.customer_code || authRes?.customer_id || String(senderUid);
                await api.sendMessage(
                  `✨ MÃ KHÁCH HÀNG (ID) CỦA BẠN ✨\n\n` +
                  `👤 Tên Zalo: ${senderName}\n` +
                  `🆔 Mã Khách Hàng: ${custId}\n` +
                  `🌐 Website tra cứu: https://hoantiendp.com\n\n` +
                  `💡 Bạn dùng Mã ID này để dán vào website khi tạo link hoàn tiền.\n` +
                  `🔑 Để lấy mật khẩu đăng nhập website cài đặt STK ngân hàng nhận tiền hoàn, bạn gõ tiếp: /matkhau`,
                  String(senderUid),
                  ThreadType.User
                );
              }
            }
          } catch (_) {}
          return;
        }

        // TRƯỜNG HỢP 2: Người dùng nhắn tin RIÊNG (DM 1-1) với Bot
        if (isIdCmd) {
          try {
            const authRes = await fetch(`${config.MAIN_API_URL}/api/bot/customer-auth`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uid: String(senderUid), name: senderName, action: "get_id" }),
            }).then((r) => r.json()).catch(() => null);

            const custId = authRes?.customer_code || authRes?.customer_id || String(senderUid);
            const reply =
              `✨ THÔNG TIN MÃ KHÁCH HÀNG CỦA BẠN ✨\n\n` +
              `👤 Tên Zalo: ${senderName}\n` +
              `🆔 Mã Khách Hàng (ID): ${custId}\n` +
              `🌐 Website tra cứu: https://hoantiendp.com\n\n` +
              `📌 HƯỚNG DẪN SỬ DỤNG:\n` +
              `1️⃣ Khi dán link sản phẩm Shopee hoặc TikTok Shop trên website https://hoantiendp.com, bạn nhập Mã Khách Hàng ở trên để hệ thống tự động ghi nhận hoàn tiền 80% cho bạn.\n` +
              `2️⃣ Để đăng nhập website cài đặt Số Tài Khoản Ngân Hàng nhận tiền hoàn, bạn gõ lệnh:\n` +
              `👉 /matkhau (Mình sẽ cấp mật khẩu đăng nhập bảo mật cho bạn ngay)`;

            await api.sendMessage(reply, message.threadId, message.type);
          } catch (err) {
            await api.sendMessage(`Mã Khách Hàng của bạn là: ${senderUid}`, message.threadId, message.type);
          }
          return;
        }

        if (isPassCmd) {
          try {
            const authRes = await fetch(`${config.MAIN_API_URL}/api/bot/customer-auth`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uid: String(senderUid), name: senderName, action: "issue_password" }),
            }).then((r) => r.json()).catch(() => null);

            if (authRes && authRes.ok && authRes.password) {
              const pwd = authRes.password;
              await api.sendMessage(pwd, message.threadId, message.type);
            } else {
              await api.sendMessage(`⚠️ Chưa thể tạo mật khẩu lúc này, bạn vui lòng thử lại sau 10 giây nhé!`, message.threadId, message.type);
            }
          } catch (err) {
            console.error("[Issue Password Error]:", err);
          }
          return;
        }

        if (isBalanceCmd) {
          try {
            const balRes = await fetch(`${config.MAIN_API_URL}/api/bot/customer-auth`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uid: String(senderUid), name: senderName, action: "get_balance" }),
            }).then((r) => r.json()).catch(() => null);

            if (balRes && balRes.ok) {
              const formatVND = (num) => (num || 0).toLocaleString("vi-VN") + "đ";
              const bankStatus = balRes.has_bank
                ? `✅ Đã cài đặt STK (${balRes.bank_name} - ···${balRes.bank_account_tail})`
                : `⚠️ Chưa cài đặt STK ngân hàng (Đăng nhập web để cài đặt nhé)`;

              const reply =
                `💰 SỐ DƯ TIỀN HOÀN CỦA BẠN 💰\n\n` +
                `👤 Khách hàng: ${balRes.display_name} (${balRes.customer_code || balRes.customer_id})\n` +
                `💵 Đã tích lũy sẵn sàng nhận: ${formatVND(balRes.approved)}\n` +
                `⏳ Đang chờ Shopee đối soát: ${formatVND(balRes.awaiting)}\n` +
                `🎉 Đã chuyển khoản về ví: ${formatVND(balRes.paid)}\n` +
                `🏦 Trạng thái ngân hàng: ${bankStatus}\n\n` +
                `🌐 Xem chi tiết từng đơn hàng tại: https://hoantiendp.com`;

              await api.sendMessage(reply, message.threadId, message.type);
            }
          } catch (err) {
            console.error("[Get Balance Error]:", err);
          }
          return;
        }

        if (isOrdersCmd) {
          // The backend writes the messages (every order, newest first, split
          // to fit Zalo); this only delivers them, in order.
          try {
            const res = await fetch(`${config.MAIN_API_URL}/api/bot/customer-auth`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uid: String(senderUid), name: senderName, action: "get_orders", is_group: isGroup }),
            }).then((r) => r.json()).catch(() => null);

            if (res && res.ok && Array.isArray(res.parts)) {
              for (const [i, part] of res.parts.entries()) {
                if (i > 0) await sleep(randomInt(800, 1500));
                await api.sendMessage(part, message.threadId, message.type);
              }
            }
          } catch (err) {
            console.error("[Get Orders Error]:", err);
          }
          return;
        }
      }

      if (cmd === "!ping" || cmd === "/ping") {
        const currentGName = await getGroupName(message.threadId);
        const reply = `Pong! 🏓 Trợ lý Hoàn Tiền đang hoạt động ổn định 24/7 tại ${currentGName}.`;
        await api.sendMessage(reply, message.threadId, message.type);
      } else if (cmd === "!help" || cmd === "/huongdan" || cmd === "/help") {
        const tagText = isGroup && senderUid ? `@${senderName}` : "";
        const tagPrefix = tagText ? `${tagText}\n` : "";

        const reply =
          tagPrefix +
          `📋 HƯỚNG DẪN NHẬN HOÀN TIỀN 80% SHOPEE & TIKTOK SHOP\n\n` +
          `1️⃣ Gửi link sản phẩm Shopee hoặc TikTok Shop bạn muốn mua vào nhóm hoặc inbox riêng cho mình.\n` +
          `2️⃣ Nhận lại link mua hàng đã kích hoạt hoàn tiền 80% hoa hồng.\n` +
          `3️⃣ Bấm link và tiến hành đặt hàng trực tiếp trên sàn Shopee hoặc TikTok Shop.\n` +
          `4️⃣ Nhắn tin riêng cho mình gõ /id để lấy Mã Khách Hàng và /matkhau để đăng nhập website https://hoantiendp.com.\n` +
          `5️⃣ Cài đặt số tài khoản ngân hàng trên Web, tiền hoàn sẽ được tự động chuyển về cho bạn sau khi sàn đối soát.\n\n` +
          `• /id: Lấy Mã Khách Hàng (Dùng tạo link web & đăng nhập)\n` +
          `• /matkhau: Lấy mật khẩu đăng nhập website hoantiendp.com\n` +
          `• /sodu: Tra cứu số dư tiền hoàn đã tích lũy\n` +
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
          "HƯỚNG DẪN NHẬN HOÀN TIỀN 80% SHOPEE & TIKTOK SHOP",
          "inbox riêng cho mình",
          "hoàn tiền 80% hoa hồng",
          "đặt hàng trực tiếp",
          "https://hoantiendp.com",
          "cập nhật số tài khoản ngân hàng",
          "/id",
          "/matkhau",
          "/sodu",
          "/highlands",
          "/tch",
          "/voucher",
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
      } else if (
        ["/highlands", "!highlands", "/hl", "!hl", "/highland", "!highland",
         "/tch", "!tch", "/thecoffeehouse", "!thecoffeehouse", "/coffeehouse", "!coffeehouse",
         "/coffee", "!coffee", "/caphe", "!caphe", "/voucher", "!voucher", "/uudai", "!uudai", "/fnb", "!fnb"].includes(cmd)
      ) {
        const ENABLE_FNB_FEATURE = false; // Tạm ẩn theo yêu cầu
        if (!ENABLE_FNB_FEATURE) {
          const pauseMsg = "☕ Tính năng ưu đãi đồ uống tại quầy hiện đang được tạm ẩn để nâng cấp. Bạn vui lòng quay lại sau nhé!";
          if (isGroup && senderUid) {
            const tagText = `@${senderName}\n`;
            await api.sendMessage({ msg: tagText + pauseMsg, mentions: [{ uid: String(senderUid), pos: 0, len: tagText.length - 1 }] }, message.threadId, message.type);
          } else {
            await api.sendMessage(pauseMsg, message.threadId, message.type);
          }
          return;
        }

        const isHighlandsCmd = ["/highlands", "!highlands", "/hl", "!hl", "/highland", "!highland"].includes(cmd);
        const isTchCmd = ["/tch", "!tch", "/thecoffeehouse", "!thecoffeehouse", "/coffeehouse", "!coffeehouse"].includes(cmd);
        const brand = isHighlandsCmd ? "highlands" : (isTchCmd ? "thecoffeehouse" : "");

        try {
          if (brand) {
            const brandTitle = isHighlandsCmd ? "HIGHLANDS COFFEE" : "THE COFFEE HOUSE";
            const brandEmoji = isHighlandsCmd ? "☕" : "🏠";

            // Fetch personalized link from Python backend
            const linkRes = await fetch(`${config.MAIN_API_URL}/api/fnb/link?brand=${brand}&customer_id=${senderUid}`).then(r => r.json()).catch(() => null);
            const shortLink = linkRes?.short_link || (isHighlandsCmd ? "https://shorten.asia/ay4B1J76" : "https://shorten.asia/hd1SKkKf");

            let dmMsg = `${brandEmoji} LINK VOUCHER ${brandTitle} CỦA BẠN (DÙNG TẠI QUẦY) 🎁\n\n`;
            dmMsg += `👉 Link nhận mã ưu đãi của bạn:\n${shortLink}\n\n`;

            // Fetch specific vouchers from backend if configured
            const vRes = await fetch(`${config.MAIN_API_URL}/api/fnb/vouchers?brand=${brand}&type=counter`).then(r => r.json()).catch(() => null);
            const activeVouchers = (vRes && vRes.ok && Array.isArray(vRes.vouchers)) ? vRes.vouchers : [];

            if (activeVouchers.length > 0) {
              dmMsg += `🔥 Các ưu đãi cụ thể đang áp dụng:\n`;
              activeVouchers.slice(0, 3).forEach((v, idx) => {
                let vLine = `${idx + 1}. 🏷️ ${v.title}`;
                if (v.code) vLine += ` (Mã: ${v.code})`;
                else if (v.discountText) vLine += ` (${v.discountText})`;
                dmMsg += `${vLine}\n`;
              });
              dmMsg += `\n`;
            } else {
              dmMsg += `🎁 Quyền lợi nhận được khi mở link:\n`;
              if (isHighlandsCmd) {
                dmMsg += `• Giảm giá trực tiếp theo hóa đơn (10k - 30k) hoặc combo nước + bánh.\n`;
                dmMsg += `• Quà tặng thành viên Highlands Mini App.\n`;
                dmMsg += `• ĐẶC BIỆT: Tự động tích lũy hoàn tiền vào ví bot sau khi thanh toán!\n\n`;
              } else {
                dmMsg += `• Voucher giảm giá đồ uống trực tiếp tại quầy.\n`;
                dmMsg += `• Ưu đãi dùng thử món mới & quà tặng thành viên.\n`;
                dmMsg += `• ĐẶC BIỆT: Tự động tích lũy hoàn tiền vào ví bot sau khi thanh toán!\n\n`;
              }
            }

            dmMsg += `📋 3 BƯỚC ĐỂ ĐƯỢC GIẢM GIÁ & NHẬN TIỀN HOÀN:\n`;
            dmMsg += `1️⃣ Bấm link trên để mở Mini App Zalo / Web -> Bấm "Lưu mã / Nhận mã" để hiện mã vạch (Barcode/QR).\n`;
            dmMsg += `2️⃣ Đưa mã vạch trên màn hình điện thoại cho thu ngân quét trước khi thanh toán tiền tại quầy.\n`;
            dmMsg += `3️⃣ Hóa đơn được trừ tiền trực tiếp + Tự động tích lũy hoàn tiền vào tài khoản bot! (Gõ /sodu để kiểm tra).\n\n`;
            dmMsg += `💡 Mẹo: Bạn có thể lưu ảnh chụp màn hình mã vạch để quét nhanh khi đến quán nhé!`;

            // Always send to private DM (1-1 chat)
            await api.sendMessage(dmMsg, String(senderUid), ThreadType.User);

            // If triggered inside a group, tag the user in the group and ask them to check DM
            if (isGroup) {
              const groupTagText = `@${senderName}`;
              const groupNotify = `${brandEmoji} ${groupTagText} Mình đã gửi link nhận voucher ${brandTitle} kèm hướng dẫn dùng tại quầy vào tin nhắn riêng cho bạn rồi nhé! Bạn kiểm tra hộp thư Zalo với mình nha! 📩`;
              const tagPos = groupNotify.indexOf(groupTagText);
              const mentions = tagPos !== -1 ? [{ uid: String(senderUid), pos: tagPos, len: groupTagText.length }] : undefined;

              const boldText = "tin nhắn riêng";
              const bPos = groupNotify.indexOf(boldText);
              const styles = bPos !== -1 ? [{ start: bPos, len: boldText.length, st: "b" }] : undefined;

              await api.sendMessage(
                {
                  msg: groupNotify,
                  mentions,
                  styles,
                },
                message.threadId,
                message.type
              );
            }
          } else {
            // General /voucher summary
            let reply = `🎁 TỔNG HỢP VOUCHER ĐỒ UỐNG TẠI QUẦY HÔM NAY 🥤\n\n`;
            reply += `☕ 1. HIGHLANDS COFFEE:\n`;
            reply += `👉 Nhắn tin riêng cho bot hoặc gõ /highlands để nhận link voucher cá nhân (+ tích lũy hoàn tiền).\n\n`;

            reply += `🏠 2. THE COFFEE HOUSE:\n`;
            reply += `👉 Nhắn tin riêng cho bot hoặc gõ /tch để nhận link voucher cá nhân (+ tích lũy hoàn tiền).\n\n`;

            reply += `📋 Cách dùng tại quầy: Mở link lấy mã vạch -> Đưa thu ngân quét -> Nhận giảm giá trực tiếp + Tự động tích lũy tiền hoàn vào bot!`;

            if (isGroup && senderUid) {
              const tagText = `@${senderName}\n`;
              reply = tagText + reply;
              const mentions = [{ uid: String(senderUid), pos: 0, len: tagText.length - 1 }];
              await api.sendMessage({ msg: reply, mentions }, message.threadId, message.type);
            } else {
              await api.sendMessage(reply, message.threadId, message.type);
            }
          }
        } catch (err) {
          console.error("[F&B Voucher Command Error]:", err);
        }
      } else if (cmd === "/web" || cmd === "!web") {
        const tagText = isGroup && senderUid ? `@${senderName}` : "";
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
      } else if (cmd === "!chinhsach" || cmd === "/chinhsach") {
        const tagText = isGroup && senderUid ? `@${senderName}` : "";
        const tagPrefix = tagText ? `${tagText}\n` : "";

        const reply =
          tagPrefix +
          `💡 CHÍNH SÁCH HOÀN TIỀN 80% SHOPEE & TIKTOK SHOP\n\n` +
          `• Tỷ lệ hoàn tiền: Bạn nhận trọn 80% hoa hồng thực tế mà hệ thống nhận được từ Shopee Affiliate & TikTok Shop (AccessTrade).\n` +
          `• Mức ước tính ban đầu: Được tính trên giá niêm yết hiện tại của sản phẩm.\n` +
          `• Số tiền thực nhận: Sẽ được tính theo hoa hồng thực tế sàn duyệt sau khi trừ voucher giảm giá và các khoản thuế/khấu trừ theo quy định (nếu có).\n` +
          `• Thời gian chi trả: Tiền sẽ được tự động chuyển cho bạn sau khi sàn đối soát (thường từ 30 - 70 ngày kể từ khi đơn giao thành công).\n` +
          `• Tra cứu minh bạch: Truy cập website https://hoantiendp.com để xem chi tiết từng đơn hàng và số tiền tích lũy nhé!`;

        const mentions = tagText
          ? [{ uid: String(senderUid), pos: 0, len: tagText.length }]
          : undefined;

        const boldTargets = [
          "CHÍNH SÁCH HOÀN TIỀN 80% SHOPEE & TIKTOK SHOP",
          "80% hoa hồng thực tế",
          "Shopee Affiliate & TikTok Shop",
          "hoa hồng thực tế sàn duyệt",
          "thuế/khấu trừ",
          "tự động chuyển cho bạn",
          "sau khi sàn đối soát",
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
      } else if (cmd === "/topdeal" || cmd === "/hot" || cmd === "!topdeal" || cmd === "!hot") {
        const tagText = isGroup && senderUid ? `@${senderName}` : "";
        const tagPrefix = tagText ? `${tagText}\n` : "";

        // Check for subcommand: /topdeal tiktok
        const subCmd = (text || "").trim().split(/\s+/)[1]?.toLowerCase();
        const isTikTokDeal = subCmd === "tiktok" || subCmd === "tt";

        try {
          if (isTikTokDeal) {
            // TikTok Shop top deals via AccessTrade product feed
            const tkRes = await fetch(`${config.MAIN_API_URL}/api/tiktok/topdeal?limit=5`);
            const tkData = await tkRes.json();
            const topItems = (tkData.products || []).filter((p) => p.detail_link).slice(0, 5);

            if (!tkData.ok || topItems.length === 0) {
              await api.sendMessage(
                tagPrefix + `🛍️ Hiện chưa có dữ liệu top sản phẩm TikTok Shop. Bạn cứ dán link TikTok Shop vào nhé!`,
                message.threadId,
                message.type
              );
            } else {
              const lines = [`🔥 TOP SẢN PHẨM TIKTOK SHOP BÁN CHẠY NHẤT\n`];
              for (let i = 0; i < topItems.length; i++) {
                const item = topItems[i];
                const commPct = item.commission_rate_pct ? `${item.commission_rate_pct}%` : "?%";
                const priceStr = item.price_formatted && item.price_formatted !== "N/A" ? `${item.price_formatted}` : "";
                lines.push(`${i + 1}️⃣ ${(item.title || "Sản phẩm").substring(0, 55)}...`);
                if (priceStr) lines.push(`💰 Giá: ${priceStr} | HH: ${commPct}`);
                lines.push(`🔗 ${item.detail_link}\n`);
              }
              lines.push(`👉 Dán link vào nhóm để nhận link hoàn tiền 80%!`);
              await api.sendMessage(tagPrefix + lines.join("\n"), message.threadId, message.type);
            }
          } else {
            // Shopee hot products (default)
            const statsRes = await fetch(`${config.MAIN_API_URL}/api/shopee/cache/stats`);
            const stats = await statsRes.json();
            const topItems = (stats.top_products || []).filter((p) => p.price && p.affiliate_url).slice(0, 5);
            if (topItems.length === 0) {
              await api.sendMessage(
                tagPrefix + `🔥 Chưa có đủ dữ liệu top sản phẩm Shopee hot.\n\n💡 Gõ /topdeal tiktok để xem top TikTok Shop nhé!`,
                message.threadId,
                message.type
              );
            } else {
              const lines = [`🔥 TOP SẢN PHẨM SHOPEE ĐƯỢC QUAN TÂM NHẤT TRONG NHÓM\n`];
              for (let i = 0; i < topItems.length; i++) {
                const item = topItems[i];
                lines.push(`${i + 1}️⃣ ${(item.name || "").substring(0, 55)}...`);
                lines.push(`💰 Giá: ${item.price_formatted} | Hoàn 80%: ${item.cashback_formatted || "..."}`);
                lines.push(`🔗 ${item.affiliate_url}\n`);
              }
              lines.push(`👉 Bấm link trên để đặt hàng và nhận hoàn tiền 80% nhé!`);
              lines.push(`\n💡 Gõ /topdeal tiktok để xem top TikTok Shop!`);
              await api.sendMessage(tagPrefix + lines.join("\n"), message.threadId, message.type);
            }
          }
        } catch (err) {
          console.error("[Top Deal Error]:", err.message);
        }
      } else if (cmd === "/refreshcache") {
        // Operators only: a refresh looks up every hot product at once.
        if (!isGroup || !(await isGroupAdminOrCreator(message.threadId, senderUid))) return;
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
      } else if (cmd === "!test-welcome") {
        // Operators only: it posts a welcome into the group.
        if (!isGroup || !(await isGroupAdminOrCreator(message.threadId, senderUid))) return;
        const gName = await getGroupName(message.threadId);
        await sendGroupWelcomeBatch(message.threadId, [{ id: senderUid, dName: senderName }], gName);
        if (config.ENABLE_PRIVATE_WELCOME) {
          await sendPrivateWelcome({ id: senderUid, dName: senderName });
        }
      } else if (/^\/[a-z0-9_]+(\s|$)/i.test(text.trim())) {
        // Every command above has already answered. What reaches here is a
        // slash command we do not have: say so, and list the ones a customer
        // can use (operator commands are not listed). Only a message that
        // STARTS with "/word" counts: "50k /cái" in a chat is not a command,
        // and "!" also starts ordinary chat like "!!!".
        const tagText = isGroup && senderUid ? `@${senderName}` : "";
        const reply =
          (tagText ? `${tagText}\n` : "") +
          wording.unknown_command
            .replace("{command}", cmd)
            .replace("{commands}", wording.command_list);
        await api.sendMessage(
          {
            msg: reply,
            mentions: tagText ? [{ uid: String(senderUid), pos: 0, len: tagText.length }] : undefined,
          },
          message.threadId,
          message.type
        );
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
  api.listener.on("friend_event", (event) => {
    if (event.type === FriendEventType.REQUEST && !event.isSelf) {
      friends.onFriendRequest(event.data?.fromUid);
    }
  });

  api.listener.on("group_event", async (event) => {
    try {
      const allowedGroups = config.LISTEN_GROUP_IDS.map(String);
      if (!allowedGroups.includes(String(event.threadId))) return;

      // Ở môi trường DEV, bot local tuyệt đối bỏ qua mọi sự kiện của nhóm Production
      if (config.IS_DEV && String(event.threadId) === String(config.GROUP_MAIN_ID)) {
        console.log(`[DEV SAFEGUARD] Bỏ qua sự kiện group_event nhóm Production ${event.threadId} (chỉ xử lý bởi bot Production).`);
        return;
      }

      console.log(`[Group Event] Nhận sự kiện: ${event.type} (${event.act}) trong group ${event.threadId}`);

      if (event.type === GroupEventType.JOIN) {
        const updateMembers = event.data.updateMembers || [];
        const realGroupName = await getGroupName(event.threadId);

        // Lấy số lượng thành viên hiện tại của nhóm
        let currentTotalMembers = 0;
        try {
          const gRes = await api.getGroupInfo(String(event.threadId));
          const gInfo = gRes?.gridInfoMap?.[String(event.threadId)] || gRes;
          currentTotalMembers = gInfo?.totalMember || (gInfo?.memVerList?.length) || 0;
        } catch (_) {}

        // Ghi nhận tất cả thành viên mới vào nhật ký quản trị & bắn thông báo Telegram
        for (const member of updateMembers) {
          if (member.id === ownId) continue;

          const memberName = member.dName || member.name || `Thành viên ${String(member.id).slice(-4)}`;
          console.log(`[Member Joined] Phát hiện thành viên mới gia nhập: ${memberName} (nhóm: ${realGroupName})`);
          
          logActivity(
            "group_join",
            member.id || member.uid,
            memberName,
            { groupId: event.threadId, groupName: realGroupName, rank: currentTotalMembers },
            `zalo_group_${event.threadId}`
          );

          // Bắn thông báo về Telegram Group DP Business
          try {
            fetch(`${config.MAIN_API_URL}/api/alerts/telegram`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                alert_type: "member_joined",
                display_name: memberName,
                member_rank: currentTotalMembers,
                group_name: realGroupName,
                zalo_uid: String(member.id || member.uid || "")
              })
            }).catch(() => {});
          } catch (_) {}

          if (config.ENABLE_PRIVATE_WELCOME) {
            await sendPrivateWelcome(member);
          } else {
            console.log(`[Private DM] Tạm tắt gửi tin riêng cho người mới: ${memberName}`);
          }
        }

        // Kiểm tra điều kiện gửi lời chào mừng trong nhóm:
        // 1. Phải bật cấu hình ENABLE_GROUP_WELCOME trong config.js
        if (!config.ENABLE_GROUP_WELCOME) {
          console.log(`[Group Welcome] Đã tắt chào mừng theo cấu hình (ENABLE_GROUP_WELCOME: false).`);
          return;
        }

        // 2. Chỉ gửi chào mừng ở các nhóm trong ALLOWED_WELCOME_GROUP_IDS (mặc định CHỈ nhóm chính, cấm tuyệt đối nhóm Dev)
        const allowedWelcomeIds = (config.ALLOWED_WELCOME_GROUP_IDS || [String(config.GROUP_MAIN_ID)]).map(String);
        if (!allowedWelcomeIds.includes(String(event.threadId))) {
          console.log(`[Group Welcome] Bỏ qua chào mừng vì nhóm ${event.threadId} (${realGroupName}) không thuộc danh sách được phép gửi lời chào.`);
          return;
        }

        // 3. Đưa vào hàng đợi chào mừng (tự động gom nhóm nếu nhiều người cùng vào một lúc để chống spam)
        queueGroupWelcome(event.threadId, updateMembers, realGroupName);
      }
    } catch (err) {
      console.error("[Group Event Handler Error]:", err);
    }
  });

  // LẮNG NGHE SỰ KIỆN KẾT NỐI & XUNG ĐỘT WEBSOCKET ZALO
  let recentDisconnects = [];
  let isAlertedConflict = false;

  async function reportTelegramConflict(alertType, data = {}) {
    try {
      await fetch(`${config.MAIN_API_URL}/api/alerts/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_type: alertType, ...data }),
      });
    } catch (_) {
      // Fallback gửi trực tiếp tới Telegram nếu backend chưa chạy
      const devChatId = config.TELEGRAM_DEV_CHAT_ID || config.TELEGRAM_CHAT_ID;
      if (config.TELEGRAM_BOT_TOKEN && devChatId) {
        let text = "";
        if (alertType === "zalo_conflict") {
          text = `🚨 <b>[CẢNH BÁO HỆ THỐNG] Zalo Bot Tranh Chấp WebSocket</b>\n\n` +
                 `⏱ <b>Thời gian:</b> <code>${new Date().toLocaleTimeString('vi-VN')}</code>\n` +
                 `🔍 <b>Chi tiết:</b> Bị ngắt WebSocket dồn dập (${data.reconnect_count || 3} lần/phút).\n` +
                 `Nguyên nhân: <code>${data.reason || 'Tranh chấp session do 2 worker cùng chạy'}</code>\n\n` +
                 `👉 <b>Hành động:</b> Kiểm tra có 2 worker chạy cùng lúc không và tắt bớt 1 bên!`;
        } else if (alertType === "zalo_recovered") {
          text = `✅ <b>[ĐÃ PHỤC HỒI] WebSocket Zalo Bot Đã Ổn Định</b>\n\n` +
                 `⏱ <b>Thời gian:</b> <code>${new Date().toLocaleTimeString('vi-VN')}</code>\n` +
                 `Trạng thái: Kết nối WebSocket Zalo đã hoạt động bình thường trở lại.`;
        }
        if (text) {
          fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: devChatId,
              text,
              parse_mode: "HTML",
            }),
          }).catch(() => {});
        }
      }
    }
  }

  api.listener.on("closed", (code, reason) => {
    const now = Date.now();
    recentDisconnects.push(now);
    recentDisconnects = recentDisconnects.filter(t => now - t <= 60000);
    console.warn(`[Zalo Listener Closed] Mã: ${code}, Lý do: ${reason}. Số lần ngắt trong 60s: ${recentDisconnects.length}`);

    if (recentDisconnects.length >= 3 && !isAlertedConflict) {
      isAlertedConflict = true;
      console.error(`[Zalo WebSocket Conflict] ⚠️ PHÁT HIỆN TRANH CHẤP WEBSOCKET! Gửi cảnh báo tới Dev...`);
      reportTelegramConflict("zalo_conflict", {
        reconnect_count: recentDisconnects.length,
        reason: `Mã ${code}: ${reason || 'Ngắt liên tục do 2 worker cùng kết nối hoặc bị đăng nhập đè session'}`
      });
    }
  });

  api.listener.on("connected", () => {
    console.log(`[Zalo Listener Connected] ✅ WebSocket Zalo đã kết nối thành công.`);
    if (isAlertedConflict) {
      isAlertedConflict = false;
      recentDisconnects = [];
      reportTelegramConflict("zalo_recovered");
    }
  });

  api.listener.on("error", (err) => {
    console.warn(`[Zalo Listener Error]:`, err?.message || err);
  });

  // Bắt đầu listener
  api.listener.start({ retryOnClose: true });

  // C. HTTP API NOTIFICATION SERVER (Port 8891)
  const server = http.createServer(async (req, res) => {
    // Anything that can make this account speak needs the shared secret
    // when one is configured. The server also listens on loopback only.
    if (config.API_TOKEN && req.headers["x-assistant-token"] !== config.API_TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "bad token" }));
      return;
    }
    // 1. Gửi thông báo tùy biến
    if (req.method === "POST" && req.url === "/api/notify") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          let targetId = payload.targetId || config.ACTIVE_GROUP_ID;
          if (config.IS_DEV && String(targetId) === String(config.GROUP_MAIN_ID)) {
            if (!payload.force_production && !payload.forceProd) {
              console.warn(`[DEV SAFEGUARD] 🛡️ Đã tự động chuyển hướng thông báo từ nhóm Production sang nhóm Dev (${config.GROUP_TEST_ID})!`);
              targetId = config.GROUP_TEST_ID;
            }
          }
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
          // Only the two groups this instance knows: "test" to rehearse an
          // announcement, anything else means the active group.
          let groupId = payload.group === "test" ? config.GROUP_TEST_ID : config.ACTIVE_GROUP_ID;
          if (config.IS_DEV && String(groupId) === String(config.GROUP_MAIN_ID)) {
            if (!payload.force_production && !payload.forceProd) {
              console.warn(`[DEV SAFEGUARD] 🛡️ Đã tự động chuyển hướng broadcast từ nhóm Production sang nhóm Dev (${config.GROUP_TEST_ID})!`);
              groupId = config.GROUP_TEST_ID;
            }
          }
          const attachments = payload.attachments || (payload.imagePath ? [payload.imagePath] : undefined);

          console.log(`[HTTP Broadcast] Gửi broadcast vào group ${groupId}: ${text.slice(0, 80)}`);
          const results = [];
          // Picture first, then the text: a caption under an image is cut
          // short by Zalo, a message of its own is not.
          if (attachments && payload.imageFirst) {
            results.push(await api.sendMessage({ msg: "", attachments }, groupId, ThreadType.Group));
          }
          if (text) {
            const mentions = [];
            if (Array.isArray(payload.mentions)) {
              for (const m of payload.mentions) {
                if (m.tag && typeof m.tag === "string") {
                  const p = text.indexOf(m.tag);
                  if (p !== -1) {
                    mentions.push({ uid: String(m.uid), pos: p, len: m.tag.length });
                    continue;
                  }
                }
                if (typeof m.pos === "number" && typeof m.len === "number") {
                  mentions.push({ uid: String(m.uid), pos: m.pos, len: m.len });
                }
              }
            }
            const allPos = payload.mentionAll ? text.indexOf("@All") : -1;
            if (allPos !== -1) mentions.push({ pos: allPos, uid: "-1", len: 4 });
            const msg = { msg: text };
            if (mentions.length) msg.mentions = mentions;
            if (attachments && !payload.imageFirst) msg.attachments = attachments;
            results.push(await api.sendMessage(msg, groupId, ThreadType.Group));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, group: groupId, result: results }));
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

  const knownMemberNames = new Map();

  async function syncGroupInfo() {
    const groupsToSync = [
      { id: String(config.GROUP_MAIN_ID), defaultName: "Hoàn Tiền Shopee" },
    ];

    for (const grp of groupsToSync) {
      try {
        const res = await api.getGroupInfo(grp.id);
        const gInfo = res?.gridInfoMap?.[grp.id] || res;
        if (gInfo) {
          const totalMembers = gInfo.totalMember || 0;
          const groupName = gInfo.name || grp.defaultName;
          console.log(`[Group Sync] "${groupName}" (${grp.id}): ${totalMembers} thành viên`);
          await fetch(`${config.MAIN_API_URL}/api/activity/group-info`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              group_id: grp.id,
              group_name: groupName,
              total_members: totalMembers,
            }),
          }).catch(() => {});
        }
      } catch (err) {
        console.warn(`[Group Sync Warning] ${grp.id}:`, err.message);
      }
    }

    try {
      const targetGid = String(config.GROUP_MAIN_ID || config.ACTIVE_GROUP_ID);
      const res = await api.getGroupInfo(targetGid);
      const gInfo = res?.gridInfoMap?.[targetGid] || res;
      if (gInfo) {

        // Bóc tách danh sách UID thành viên trong nhóm và đồng bộ vào hệ thống khách hàng
        const uids = (gInfo.memVerList || []).map((item) => item.split("_")[0]);
        if (uids.length > 0) {
          const members = [];
          for (const uid of uids) {
            if (uid === ownId || (config.IGNORE_MEMBER_UIDS || []).includes(uid)) continue;
            // Names are only needed for people the ledger has not seen.
            // Looking every member up every five minutes was ~12,000 profile
            // reads a day from a personal account: a bot signal, for nothing.
            if (knownMemberNames.has(uid)) {
              members.push({ uid, name: knownMemberNames.get(uid) });
              continue;
            }
            try {
              const uInfo = await api.getUserInfo(uid);
              const name =
                uInfo?.changed_profiles?.[uid]?.zaloName ||
                uInfo?.displayName ||
                uInfo?.name ||
                ("Thành viên " + uid.slice(-4));
              members.push({ uid, name });
              knownMemberNames.set(uid, name);
            } catch (_) {
              members.push({ uid, name: "Thành viên " + uid.slice(-4) });
            }
            await sleep(300);
          }

          // Đồng bộ vào cơ sở dữ liệu khách hàng
          await fetch(`${config.MAIN_API_URL}/api/activity/sync-group-members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              group_id: targetGid,
              group_name: gInfo?.name || "Hoàn Tiền Shopee",
              members,
            }),
          }).catch(() => {});
          console.log(`[Group Sync] Đã đồng bộ chi tiết ${members.length} thành viên vào danh sách khách hàng`);
        }
      }
    } catch (err) {
      console.warn(`[syncGroupInfo Warning]:`, err.message);
    }
  }

  // Chạy đồng bộ nhóm ngay khi khởi động và định kỳ mỗi 5 phút
  syncGroupInfo();
  setInterval(syncGroupInfo, 5 * 60 * 1000);
  setInterval(() => {}, 60 * 60 * 1000); // Keep process event loop alive

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[FATAL CONCURRENCY ERROR] Cổng ${config.PORT} bị chiếm dụng bởi tiến trình khác! Dừng bot ngay lập tức để tránh tranh chấp WebSocket.`);
      process.exit(1);
    } else {
      console.error("[HTTP Server Error]:", err);
    }
  });

  server.listen(config.PORT, "127.0.0.1", () => {
    console.log(`[HTTP Server] Notification API đang chạy tại http://localhost:${config.PORT}`);
  });
}

main().catch((err) => {
  console.error("Lỗi khởi động Assistant:", err);
  setTimeout(main, 10000);
});
