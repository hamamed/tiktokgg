/**
 * Converts raw connector payloads into one stable internal shape.
 *
 * Supports:
 *  - tiktok-live-connector v2.x (raw protobuf v3 objects: data.gift, data.user.avatarThumb, numeric repeatEnd)
 *  - tiktok-live-connector v1.x / legacy WebcastPushConnection (flattened: data.giftName, data.uniqueId)
 *  - forks with either shape (e.g. @ycryptx/tiktok-live-connector)
 *
 * Nothing downstream (rules, game protocol, dashboard) ever sees connector-specific fields.
 */

const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const url = (img) => first(img?.urlList?.[0], img?.url_list?.[0], img?.url?.[0], typeof img === 'string' ? img : undefined);

export function normalizeUser(d = {}) {
  const u = d.user ?? {};
  const uniqueId = first(u.uniqueId, d.uniqueId, u.displayId, u.display_id, 'unknown');
  return {
    userId: String(first(u.userId, d.userId, u.id, uniqueId)),
    uniqueId: String(uniqueId),
    nickname: String(first(u.nickname, d.nickname, uniqueId)),
    avatar: first(d.profilePictureUrl, u.profilePictureUrl, url(u.avatarThumb), url(u.profilePicture)) ?? null,
  };
}

export function normalizeGift(d = {}) {
  const g = d.gift ?? {};
  const det = d.giftDetails ?? {};
  const ext = d.extendedGiftInfo ?? {};
  const id = String(first(d.giftId, g.id, ext.id, 0));
  const giftType = toNum(first(d.giftType, g.type, det.giftType, ext.type), 0);
  const combo = first(g.combo, ext.combo);
  return {
    type: 'gift',
    user: normalizeUser(d),
    gift: {
      id,
      name: String(first(d.giftName, g.name, det.giftName, ext.name, `Gift#${id}`)),
      diamonds: toNum(first(d.diamondCount, g.diamondCount, det.diamondCount, ext.diamond_count, ext.diamondCount), 0),
      image: first(d.giftPictureUrl, url(g.image), det.giftImage?.giftPictureUrl, url(ext.image)) ?? null,
      // giftType 1 == "streakable" (combo) gift. Those arrive as a series of events ending with repeatEnd.
      streakable: giftType === 1 || combo === true,
      repeatCount: Math.max(1, toNum(first(d.repeatCount, d.comboCount), 1)),
      // v2 sends repeatEnd as 0/1, v1 as boolean — coerce both.
      repeatEnd: Boolean(toNum(d.repeatEnd, d.repeatEnd ? 1 : 0)),
      groupId: first(d.groupId, null),
    },
  };
}

export function normalizeChat(d = {}) {
  return { type: 'chat', user: normalizeUser(d), comment: String(first(d.comment, d.content, '')) };
}

export function normalizeLike(d = {}) {
  return {
    type: 'like',
    user: normalizeUser(d),
    likeCount: Math.max(1, toNum(first(d.likeCount, d.count), 1)),
    totalLikeCount: toNum(first(d.totalLikeCount, d.total), 0),
  };
}

export const normalizeSimple = (type) => (d = {}) => ({ type, user: normalizeUser(d) });

/** Normalize a gift list returned by getAvailableGifts()/fetchAvailableGifts(). */
export function normalizeGiftList(raw) {
  const list = Array.isArray(raw) ? raw : raw?.gifts ?? raw?.data?.gifts ?? [];
  return list
    .filter((g) => g && first(g.name, g.giftName))
    .map((g) => ({
      id: String(first(g.id, g.giftId, '')),
      name: String(first(g.name, g.giftName)),
      diamonds: toNum(first(g.diamond_count, g.diamondCount), 0),
      image: first(url(g.image), url(g.icon), g.giftPictureUrl) ?? null,
      streakable: toNum(g.type, 0) === 1 || g.combo === true,
    }));
}
