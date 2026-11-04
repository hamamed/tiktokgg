import { useEffect, useRef, useState } from 'react';

const LABELS = {
  difficulty: 'Obstacle difficulty',
  speedMultiplier: 'Speed multiplier',
  obstacleDensity: 'Obstacle density',
  spawnRateMultiplier: 'Spawn rate multiplier',
};
const BUILT_IN = new Set(['paused', ...Object.keys(LABELS)]);

/** Slider + number box that patches the server (debounced) while you drag. */
function NumberSetting({ k, value, onPatch }) {
  const [local, setLocal] = useState(value);
  const timer = useRef();
  useEffect(() => setLocal(value), [value]);

  const change = (v) => {
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => Number.isFinite(v) && onPatch({ [k]: v }), 120);
  };
  const max = Math.max(5, Math.ceil(Math.abs(local) * 2));

  return (
    <div className="setting">
      <div className="setting-head">
        <span>{LABELS[k] ?? k}</span>
        <input type="number" step="0.05" value={local} onChange={(e) => change(e.target.valueAsNumber)} />
        <button className="btn ghost xs" title={BUILT_IN.has(k) ? 'Reset to default' : 'Remove'} onClick={() => onPatch({ [k]: null })}>
          {BUILT_IN.has(k) ? '↺' : '✕'}
        </button>
      </div>
      <input type="range" min="0" max={max} step="0.05" value={local} onChange={(e) => change(e.target.valueAsNumber)} aria-label={LABELS[k] ?? k} />
    </div>
  );
}

export default function SettingsPanel({ settings, run }) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('1');
  const patch = (p) => run('settings.patch', { patch: p }).catch(() => {});

  const entries = Object.entries(settings).filter(([k]) => k !== 'paused');

  const addKey = (e) => {
    e.preventDefault();
    const raw = newVal.trim();
    const value = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw;
    run('settings.patch', { patch: { [newKey.trim()]: value } }, `Added ${newKey}`).then(() => setNewKey('')).catch(() => {});
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Game tuning</h2>
        <button className={settings.paused ? 'btn primary xs' : 'btn danger xs'} onClick={() => patch({ paused: !settings.paused })}>
          {settings.paused ? '▶ Resume rules' : '⏸ Pause rules'}
        </button>
      </div>
      {settings.paused && <p className="banner">Rules are paused. Gifts are still shown, but nothing is sent to the game.</p>}

      {entries.map(([k, v]) =>
        typeof v === 'number' ? (
          <NumberSetting key={k} k={k} value={v} onPatch={patch} />
        ) : (
          <div className="setting" key={k}>
            <div className="setting-head">
              <span>{k}</span>
              {typeof v === 'boolean' ? (
                <label className="switch"><input type="checkbox" checked={v} onChange={() => patch({ [k]: !v })} /><span /></label>
              ) : (
                <input defaultValue={v} onBlur={(e) => e.target.value !== v && patch({ [k]: e.target.value })} />
              )}
              <button className="btn ghost xs" onClick={() => patch({ [k]: null })}>✕</button>
            </div>
          </div>
        ),
      )}

      <form className="row add-setting" onSubmit={addKey}>
        <input placeholder="customKey" value={newKey} pattern="[A-Za-z][A-Za-z0-9_]{0,39}" onChange={(e) => setNewKey(e.target.value)} required />
        <input placeholder="value" value={newVal} onChange={(e) => setNewVal(e.target.value)} />
        <button className="btn ghost xs">+ Add</button>
      </form>
      <p className="hint muted">Every change goes to the game straight away as <code>game.settings</code>.</p>
    </div>
  );
}
