// Friend requests, sparingly.
//
// A customer who is our Zalo friend gets order and payout notices in their
// main inbox rather than a "messages from strangers" folder. But a personal
// account sending friend requests in bulk is one of the surest ways to get
// it locked -- and this account is the only line to every customer. So:
//
//   - only people who messaged us privately first, never the whole group;
//   - once per person, remembered on disk across restarts;
//   - a random pause before each request, and a daily ceiling;
//   - someone who already asked us is accepted, not asked back.

import fs from "node:fs";

const DAY_MS = 24 * 60 * 60 * 1000;

function randomBetween(minMs, maxMs) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs));
}

function loadState(path) {
  try {
    const state = JSON.parse(fs.readFileSync(path, "utf-8"));
    return { handled: state.handled || {}, sentAt: state.sentAt || [] };
  } catch (_) {
    return { handled: {}, sentAt: [] };
  }
}

const humanPause = (kind) =>
  kind === "accept" ? randomBetween(10_000, 40_000) : randomBetween(20_000, 90_000);

export function createFriendKeeper({
  api, ownId, statePath, dailyLimit, message, log = console, pause = humanPause,
}) {
  const state = loadState(statePath);
  const inFlight = new Set();

  const save = () => {
    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (err) {
      log.warn(`[Friends] could not save state: ${err.message}`);
    }
  };

  const sentToday = () => {
    const cutoff = Date.now() - DAY_MS;
    state.sentAt = state.sentAt.filter((t) => t > cutoff);
    return state.sentAt.length;
  };

  const remember = (uid, outcome) => {
    state.handled[uid] = { outcome, at: new Date().toISOString() };
    save();
  };

  // Someone wrote to us privately. Befriend them if we have not already.
  async function afterPrivateMessage(uid) {
    uid = String(uid || "");
    if (!uid || uid === String(ownId) || state.handled[uid] || inFlight.has(uid)) return;
    if (sentToday() >= dailyLimit) return; // tried again on their next message
    inFlight.add(uid);
    try {
      const status = await api.getFriendRequestStatus(uid);
      if (status?.is_friend) return remember(uid, "already_friend");
      if (status?.is_requesting) return remember(uid, "already_requested");
      if (status?.is_requested) {
        await api.acceptFriendRequest(uid);
        return remember(uid, "accepted_theirs");
      }
      // Recorded before the pause so a second message cannot queue a
      // second request while the first is still waiting to go out.
      remember(uid, "scheduled");
      state.sentAt.push(Date.now());
      save();
      setTimeout(async () => {
        try {
          await api.sendFriendRequest(message, uid);
          remember(uid, "sent");
          log.log(`[Friends] request sent to ${uid}`);
        } catch (err) {
          remember(uid, "failed");
          log.warn(`[Friends] request to ${uid} failed: ${err.message}`);
        }
      }, pause("request"));
    } catch (err) {
      log.warn(`[Friends] status check for ${uid} failed: ${err.message}`);
    } finally {
      inFlight.delete(uid);
    }
  }

  // Someone asked to be our friend: say yes, after a human-sized pause.
  function onFriendRequest(fromUid) {
    const uid = String(fromUid || "");
    if (!uid || uid === String(ownId)) return;
    setTimeout(async () => {
      try {
        await api.acceptFriendRequest(uid);
        remember(uid, "accepted_theirs");
        log.log(`[Friends] accepted request from ${uid}`);
      } catch (err) {
        log.warn(`[Friends] accepting ${uid} failed: ${err.message}`);
      }
    }, pause("accept"));
  }

  return { afterPrivateMessage, onFriendRequest };
}
