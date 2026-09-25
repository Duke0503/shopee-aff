import { Zalo, ThreadType, GroupEventType, FriendEventType } from "zca-js";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import sizeOf from "image-size";
import { config } from "./config.js";
import { createFriendKeeper } from "./friends.js";

// Regex nhận diện link Shopee, TikTok Shop, Lazada & ShopeeFood
const SHOPEE_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)?(?:shopee\.vn|s\.shopee\.vn|shp\.ee)\/[^\s]+/i;
const TIKTOK_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.shop)\/[^\s]+/i;
const LAZADA_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:lazada\.vn|s\.lazada\.vn|c\.lazada\.vn)\/[^\s]+/i;
const SHOPEEFOOD_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:shopeefood\.vn|food\.shopee\.vn|shopee\.vn\/now-food)\/[^\s]+/i;
const PRODUCT_LINK_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:shopee\.vn|s\.shopee\.vn|shp\.ee|tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.shop|lazada\.vn|s\.lazada\.vn|c\.lazada\.vn|shopeefood\.vn|food\.shopee\.vn)\/[^\s]+/i;

process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Unhandled Rejection]:", reason);
});

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== KHỞI ĐỘNG ZALO ASSISTANT BOT (FULL PLAN) ===");
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
  console.log(`[Config] Nhóm đang kích hoạt (Active Group): ${config.ACTIVE_GROUP_ID}`);

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

  // Quét regex trên toàn bộ chuỗi JSON của data để không bao giờ bỏ sót bất kỳ link Shopee, TikTok, Lazada hay ShopeeFood nào
  try {
    const rawJson = JSON.stringify(data);
    const productMatches = rawJson.match(/https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:shopee\.vn|s\.shopee\.vn|shp\.ee|tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.shop|lazada\.vn|s\.lazada\.vn|c\.lazada\.vn|shopeefood\.vn|food\.shopee\.vn)\/[^\s"'\\]+/gi);
    if (productMatches) {
      for (const m of productMatches) {
        urls.push(m);
      }
    }
  } catch (_) {}

  // Chỉ giữ lại link sản phẩm hợp lệ
  const validUrls = urls.filter((u) => PRODUCT_LINK_REGEX.test(u));

  return { text: text.trim(), urls: [...new Set(validUrls)] };
}

  // Bộ nhớ đệm RAM (Level-1 Cache) lưu sản phẩm trong 12 tiếng để phản hồi tức thì 0.001s
  const memoryProductCache = new Map(); // key: item_id, val: { data, cachedAt }

  // 3. Helper xử lý link Shopee & TikTok Shop (Áp dụng Smart Resolve đa sàn + Cache RAM + DB SQLite)
  async function handleProductLink(rawUrl, threadId, threadType, senderName, senderUid, customerId = null) {
    try {
      const isTikTok = TIKTOK_LINK_REGEX.test(rawUrl);
      const isLazada = LAZADA_LINK_REGEX.test(rawUrl);
      const isFood = SHOPEEFOOD_LINK_REGEX.test(rawUrl);
      const platformLabel = isTikTok ? "TikTok Shop" : (isLazada ? "Lazada" : (isFood ? "ShopeeFood" : "Shopee"));
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
        const maxAttempts = 35; // 35 * 800ms = 28s
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
              if (statusData.is_group_order || resolveRes.is_group_order) {
                productData = productData || {};
                productData.is_group_order = true;
              }
              if (statusData.name && (!productData || !productData.name)) {
                productData = productData || {};
                productData.name = statusData.name;
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
          `🔗 ${affUrl}\n\n` +
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
          `🔗 ${affUrl}\n\n` +
          `📊 Hoa hồng hiện tại:\n` +
          `${commissionSection}\n\n` +
          `🎁 ${payoutLine}\n\n` +
          `👉 Bấm link trên và đặt hàng trực tiếp trên ${platformLabel}.\n` +
          `💡 Nên mua ngay sau khi mở link và hạn chế bấm thêm link Affiliate khác trước khi đặt hàng.`;
      } else {
        replyText =
          tagPrefix +
          `🎉 Link hoàn tiền ${platformLabel} của bạn đã sẵn sàng\n\n` +
          `🔗 ${affUrl}\n\n` +
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
  api.listener.on("connected", () => {
    console.log("[Listener] Kết nối WebSocket Zalo thành công. Đang lắng nghe 24/7...");
  });

  api.listener.on("closed", (code, reason) => {
    console.warn(`[Listener] WebSocket đóng (${code}): ${reason}. Sẽ tự động kết nối lại sau 3s...`);
    setTimeout(() => {
      try {
        api.listener.start({ retryOnClose: true });
      } catch (err) {
        console.error("[Listener Reconnect Error]:", err.message);
      }
    }, 3000);
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
              const custId = authRes.customer_code || authRes.customer_id;
              const pwd = authRes.password;
              const reply =
                `🔐 MẬT KHẨU ĐĂNG NHẬP WEBSITE 🔐\n\n` +
                `🆔 Tên đăng nhập (Mã ID): ${custId}\n` +
                `🔑 Mật khẩu: ${pwd}\n` +
                `🌐 Link đăng nhập: https://hoantiendp.com/login\n\n` +
                `👉 HƯỚNG DẪN TIẾP THEO:\n` +
                `1. Truy cập https://hoantiendp.com/login và đăng nhập bằng Mã ID + Mật khẩu trên.\n` +
                `2. Bấm vào tên bạn ở góc trên cùng → Chọn "Cài đặt tài khoản ngân hàng" để điền STK nhận chuyển khoản hoàn tiền 80% tự động.\n` +
                `3. Bạn có thể đổi lại mật khẩu cá nhân bất kỳ lúc nào trên website.\n\n` +
                `⚠️ Lưu ý bảo mật: Mỗi lần bạn gõ /matkhau, hệ thống sẽ cấp một mật khẩu mới để bảo vệ an toàn cho tài khoản của bạn.`;

              await api.sendMessage(reply, message.threadId, message.type);
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
              body: JSON.stringify({ uid: String(senderUid), name: senderName, action: "get_orders" }),
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
          `📌 Các lệnh hỗ trợ:\n` +
          `• /id: Lấy Mã Khách Hàng (Dùng tạo link web & đăng nhập)\n` +
          `• /matkhau: Lấy mật khẩu đăng nhập website hoantiendp.com\n` +
          `• /sodu: Tra cứu số dư tiền hoàn đã tích lũy\n` +
          `• /chinhsach: Chính sách hoàn tiền 80% & các khoản khấu trừ\n` +
          `• /web: Website tra cứu đơn & cập nhật STK ngân hàng\n\n` +
          `💡 Lưu ý: Vui lòng nhắn tin riêng cho mình khi gõ /id và /matkhau để bảo mật tài khoản!`;

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

      console.log(`[Group Event] Nhận sự kiện: ${event.type} (${event.act}) trong group ${event.threadId}`);

      if (event.type === GroupEventType.JOIN) {
        const updateMembers = event.data.updateMembers || [];
        const realGroupName = await getGroupName(event.threadId);

        // Ghi nhận tất cả thành viên mới vào nhật ký quản trị
        for (const member of updateMembers) {
          if (member.id === ownId) continue;

          console.log(`[Member Joined] Phát hiện thành viên mới gia nhập: ${member.dName || member.id} (nhóm: ${realGroupName})`);
          
          logActivity(
            "group_join",
            member.id || member.uid,
            member.dName || member.name,
            { groupId: event.threadId, groupName: realGroupName },
            `zalo_group_${event.threadId}`
          );

          if (config.ENABLE_PRIVATE_WELCOME) {
            await sendPrivateWelcome(member);
          } else {
            console.log(`[Private DM] Tạm tắt gửi tin riêng cho người mới: ${member.dName || member.id}`);
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
          // Only the two groups this instance knows: "test" to rehearse an
          // announcement, anything else means the main group.
          const groupId = payload.group === "test" ? config.GROUP_TEST_ID : config.ACTIVE_GROUP_ID;
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
      console.warn(`[HTTP Server Warning] Cổng ${config.PORT} đang bị chiếm, sẽ tự động thử lại sau 5s...`);
      setTimeout(() => {
        try { server.close(); } catch (_) {}
        server.listen(config.PORT, "127.0.0.1");
      }, 5000);
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
