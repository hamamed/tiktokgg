import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftStreakTracker } from '../src/tiktok/GiftStreakTracker.js';
import { RuleEngine } from '../src/rules/RuleEngine.js';
import { DEFAULT_SETTINGS } from '../src/rules/ruleModel.js';
import { normalizeGift } from '../src/tiktok/normalize.js';

const fakeStore = () => ({ data: { rules: [], settings: { ...DEFAULT_SETTINGS } }, save() {} });
const user = { userId: 'u1', uniqueId: 'alice', nickname: 'Alice' };
const gift = (repeatCount, repeatEnd, extra = {}) =>
  normalizeGift({ ...user, giftId: 5655, giftName: 'Rose', diamondCount: 1, giftType: 1, repeatCount, repeatEnd, ...extra });

test('normalizes connector v2 (protobuf v3) gift shape', () => {
  const g = normalizeGift({
    giftId: '5655', repeatCount: 3, repeatEnd: 1,
    user: { id: '42', nickname: 'Bob', displayId: 'bob', avatarThumb: { urlList: ['http://a'] } },
    gift: { id: '5655', name: 'Rose', type: 1, diamondCount: 1, image: { urlList: ['http://g'] } },
  });
  assert.equal(g.gift.name, 'Rose');
  assert.equal(g.gift.repeatEnd, true);
  assert.equal(g.gift.streakable, true);
  assert.equal(g.user.uniqueId, 'bob');
  assert.equal(g.user.avatar, 'http://a');
});

test('streak tracker: progress deltas then end total', () => {
  const t = new GiftStreakTracker({ timeoutMs: 60_000 });
  const phases = [gift(1, false), gift(2, false), gift(5, false), gift(5, true)].map((g) => t.process(g));
  assert.deepEqual(phases.map((p) => [p.phase, p.delta, p.total]), [
    ['progress', 1, 1], ['progress', 1, 2], ['progress', 3, 5], ['end', 0, 5],
  ]);
  assert.equal(t.activeCount, 0);
  t.dispose();
});

test('streak tracker: synthetic end on timeout', () => {
  const t = new GiftStreakTracker({ timeoutMs: 1000 });
  let ended = null;
  t.on('timeout', (e) => (ended = e));
  t.process(gift(4, false));
  t.sweep(Date.now() + 5000);
  assert.equal(ended.streak.total, 4);
  assert.equal(ended.streak.synthetic, true);
  t.dispose();
});

test('onEnd rule fires once with full count; perUnit fires live', () => {
  const engine = new RuleEngine(fakeStore());
  engine.upsertRule({ trigger: { type: 'gift', giftName: 'rose' }, action: { name: 'spawn_train' }, streakMode: 'onEnd' });
  engine.upsertRule({ trigger: { type: 'gift', giftName: 'Rose' }, action: { name: 'boost' }, streakMode: 'perUnit', multiplier: 2 });
  const t = new GiftStreakTracker();
  const fired = [];
  for (const g of [gift(1, false), gift(3, false), gift(3, true)]) {
    g.streak = t.process(g);
    for (const d of engine.evaluate(g)) fired.push([d.rule.action.name, d.count]);
  }
  assert.deepEqual(fired, [['boost', 2], ['boost', 4], ['spawn_train', 3]]);
  t.dispose();
});

test('like threshold accumulates across events', () => {
  const engine = new RuleEngine(fakeStore());
  engine.upsertRule({ trigger: { type: 'like', everyLikes: 10 }, action: { name: 'jump' } });
  const like = (n) => ({ type: 'like', user, likeCount: n });
  assert.equal(engine.evaluate(like(6)).length, 0);
  assert.equal(engine.evaluate(like(6))[0].count, 1);
  assert.equal(engine.evaluate(like(25))[0].count, 2);
});

test('paused settings stop all rules; invalid rules rejected', () => {
  const engine = new RuleEngine(fakeStore());
  engine.upsertRule({ trigger: { type: 'chat', keyword: '!jump', keywordMode: 'startsWith' }, action: { name: 'jump' } });
  assert.equal(engine.evaluate({ type: 'chat', user, comment: '!jump now' }).length, 1);
  engine.patchSettings({ paused: true });
  assert.equal(engine.evaluate({ type: 'chat', user, comment: '!jump' }).length, 0);
  assert.throws(() => engine.upsertRule({ trigger: { type: 'gift' }, action: { name: '' } }));
});
