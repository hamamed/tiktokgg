import { useEffect, useState } from 'react';

const TRIGGERS = [
  ['gift', '🎁 Gift'],
  ['chat', '💬 Chat command'],
  ['like', '❤️ Likes'],
  ['follow', '➕ Follow'],
  ['share', '↗️ Share'],
  ['member', '👋 Viewer joins'],
  ['subscribe', '⭐ Subscribe'],
];

export const blankRule = () => ({
  name: '',
  enabled: true,
  trigger: { type: 'gift', giftName: '', minDiamonds: 0, keyword: '', keywordMode: 'contains', everyLikes: 100 },
  action: { name: '', params: {} },
  streakMode: 'onEnd',
  countMode: 'perUnit',
  multiplier: 1,
  maxCount: 100,
  cooldownMs: 0,
  userCooldownMs: 0,
});

/** Merge any partial rule (existing rule or feed prefill) onto a blank form model. */
export function toForm(rule = {}) {
  const b = blankRule();
  return {
    ...b,
    ...rule,
    trigger: { ...b.trigger, ...(rule.trigger ?? {}) },
    action: { ...b.action, ...(rule.action ?? {}) },
    paramsText: JSON.stringify(rule.action?.params ?? {}, null, 2),
  };
}

export default function RuleForm({ initial, gifts, knownActions, onSave, onCancel }) {
  const [f, setF] = useState(() => toForm(initial));
  const [paramsError, setParamsError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setF(toForm(initial)), [initial]);

  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setTrig = (patch) => setF((x) => ({ ...x, trigger: { ...x.trigger, ...patch } }));
  const setAct = (patch) => setF((x) => ({ ...x, action: { ...x.action, ...patch } }));

  const t = f.trigger.type;
  const selectedGift = t === 'gift' ? gifts.find((g) => g.name.toLowerCase() === f.trigger.giftName.toLowerCase()) : null;

  const submit = async (e) => {
    e.preventDefault();
    let params;
    try {
      params = f.paramsText.trim() ? JSON.parse(f.paramsText) : {};
      if (typeof params !== 'object' || Array.isArray(params) || params === null) throw new Error('must be an object');
      setParamsError(null);
    } catch (err) {
      setParamsError(`Params JSON: ${err.message}`);
      return;
    }
    const { paramsText, ...rule } = f;
    setSaving(true);
    try {
      await onSave({ ...rule, action: { ...rule.action, params } });
    } catch { /* toast shown by caller */ }
    setSaving(false);
  };

  return (
    <form className="rule-form" onSubmit={submit}>
      <div className="row">
        <label className="grow">
          <span>When</span>
          <select value={t} onChange={(e) => setTrig({ type: e.target.value })}>
            {TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>

        {t === 'gift' && (
          <>
            <label className="grow2">
              <span>Gift name <small className="muted">(* = any gift)</small></span>
              <input list="gift-names" value={f.trigger.giftName} placeholder="Rose" onChange={(e) => setTrig({ giftName: e.target.value })} required />
              <datalist id="gift-names">
                <option value="*">Any gift</option>
                {gifts.map((g) => <option key={g.name} value={g.name}>{`💎${g.diamonds}${g.streakable ? ' · combo' : ''}`}</option>)}
              </datalist>
            </label>
            <label>
              <span>Min 💎</span>
              <input type="number" min="0" value={f.trigger.minDiamonds} onChange={(e) => setTrig({ minDiamonds: +e.target.value })} />
            </label>
          </>
        )}

        {t === 'chat' && (
          <>
            <label className="grow2">
              <span>Keyword</span>
              <input value={f.trigger.keyword} placeholder="!jump" onChange={(e) => setTrig({ keyword: e.target.value })} required />
            </label>
            <label>
              <span>Match</span>
              <select value={f.trigger.keywordMode} onChange={(e) => setTrig({ keywordMode: e.target.value })}>
                <option value="contains">contains</option>
                <option value="startsWith">starts with</option>
                <option value="exact">exact</option>
                <option value="regex">regex</option>
              </select>
            </label>
          </>
        )}

        {t === 'like' && (
          <label>
            <span>Every N likes</span>
            <input type="number" min="1" value={f.trigger.everyLikes} onChange={(e) => setTrig({ everyLikes: +e.target.value })} />
          </label>
        )}
      </div>

      {selectedGift && (
        <p className="hint">
          {selectedGift.image && <img src={selectedGift.image} alt="" className="gift-img" />} {selectedGift.name} · 💎{selectedGift.diamonds} ·{' '}
          {selectedGift.streakable ? 'streakable (combo) gift' : 'single gift'}
        </p>
      )}

      <div className="row">
        <label className="grow2">
          <span>Then trigger game action</span>
          <input list="action-names" value={f.action.name} placeholder="spawn_train" onChange={(e) => setAct({ name: e.target.value.replace(/\s+/g, '_') })} required />
          <datalist id="action-names">{knownActions.map((a) => <option key={a} value={a} />)}</datalist>
        </label>
        <label className="grow">
          <span>Rule name <small className="muted">(optional)</small></span>
          <input value={f.name} placeholder="auto" onChange={(e) => set({ name: e.target.value })} />
        </label>
      </div>

      <div className="row">
        {t === 'gift' && (
          <label className="grow">
            <span>Gift streak</span>
            <select value={f.streakMode} onChange={(e) => set({ streakMode: e.target.value })}>
              <option value="onEnd">Fire once when the streak ends (repeatEnd)</option>
              <option value="perUnit">Fire live with each gift in the combo</option>
            </select>
          </label>
        )}
        <label className="grow">
          <span>Count</span>
          <select value={f.countMode} onChange={(e) => set({ countMode: e.target.value })}>
            <option value="perUnit">{t === 'like' ? 'per threshold reached' : t === 'gift' ? 'per gift' : 'per event'}</option>
            {t === 'gift' && <option value="perDiamond">per diamond (gifts × 💎)</option>}
            <option value="once">always 1</option>
          </select>
        </label>
        <label>
          <span>× Multiplier</span>
          <input type="number" step="0.1" min="0" value={f.multiplier} onChange={(e) => set({ multiplier: +e.target.value })} />
        </label>
        <label>
          <span>Max count</span>
          <input type="number" min="1" value={f.maxCount} onChange={(e) => set({ maxCount: +e.target.value })} />
        </label>
      </div>

      <div className="row">
        <label>
          <span>Rule cooldown (s)</span>
          <input type="number" min="0" step="0.5" value={f.cooldownMs / 1000} onChange={(e) => set({ cooldownMs: Math.round(+e.target.value * 1000) })} />
        </label>
        <label>
          <span>Per-viewer cooldown (s)</span>
          <input type="number" min="0" step="0.5" value={f.userCooldownMs / 1000} onChange={(e) => set({ userCooldownMs: Math.round(+e.target.value * 1000) })} />
        </label>
        <label className="grow2">
          <span>Action params (JSON sent to the game)</span>
          <textarea rows={3} value={f.paramsText} spellCheck={false} onChange={(e) => set({ paramsText: e.target.value })} className={paramsError ? 'invalid' : ''} />
          {paramsError && <small className="err">{paramsError}</small>}
        </label>
      </div>

      <div className="row end">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" disabled={saving}>{f.id ? 'Save changes' : 'Add rule'}</button>
      </div>
    </form>
  );
}
