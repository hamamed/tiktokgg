import { useEffect, useRef, useState } from 'react';
import RuleForm from './RuleForm.jsx';

function triggerText(t) {
  switch (t.type) {
    case 'gift':
      return `🎁 ${t.giftName === '*' ? 'Any gift' : t.giftName}${t.minDiamonds ? ` ≥💎${t.minDiamonds}` : ''}`;
    case 'chat':
      return `💬 ${t.keywordMode} “${t.keyword}”`;
    case 'like':
      return `❤️ every ${t.everyLikes} likes`;
    default:
      return { follow: '➕ Follow', share: '↗️ Share', member: '👋 Join', subscribe: '⭐ Subscribe' }[t.type] ?? t.type;
  }
}

export default function RulesPanel({ rules, gifts, knownActions, draft, onDraftConsumed, run, toast }) {
  const [editing, setEditing] = useState(null); // null = closed, {} = new, rule = edit
  const fileRef = useRef(null);

  useEffect(() => {
    if (draft) {
      setEditing(draft);
      onDraftConsumed();
    }
  }, [draft, onDraftConsumed]);

  const save = async (rule) => {
    await run('rules.upsert', { rule }, rule.id ? 'Rule updated' : 'Rule added');
    setEditing(null);
  };

  const toggle = (rule) => run('rules.upsert', { rule: { id: rule.id, enabled: !rule.enabled } }).catch(() => {});
  const remove = (rule) => {
    if (confirm(`Delete rule “${rule.name}”?`)) run('rules.delete', { id: rule.id }, 'Rule deleted').catch(() => {});
  };
  const duplicate = (rule) => {
    const { id, createdAt, updatedAt, ...rest } = rule;
    setEditing({ ...rest, name: `${rule.name} (copy)` });
  };

  const exportRules = () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tiktok-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importRules = async (file) => {
    try {
      const list = JSON.parse(await file.text());
      const replace = confirm('Replace ALL current rules? (Cancel = append)');
      await run('rules.import', { rules: list, replace }, `Imported ${list.length} rules`);
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  };

  return (
    <div className="card fill">
      <div className="card-head">
        <h2>Gift → action rules <span className="count">{rules.length}</span></h2>
        <div className="btns">
          <button className="btn ghost xs" onClick={exportRules} disabled={!rules.length}>Export</button>
          <button className="btn ghost xs" onClick={() => fileRef.current?.click()}>Import</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => {
              const file = e.target.files[0];
              e.target.value = '';
              if (file) importRules(file);
            }}
          />
          {!editing && <button className="btn primary xs" onClick={() => setEditing({})}>+ New rule</button>}
        </div>
      </div>

      {editing && (
        <RuleForm initial={editing} gifts={gifts} knownActions={knownActions} onSave={save} onCancel={() => setEditing(null)} />
      )}

      {rules.length === 0 && !editing && (
        <div className="empty-big">
          <p>No rules yet. Nothing is mapped by default.</p>
          <p className="muted">Add one, e.g. <b>Rose</b> → <code>spawn_train</code>. You can also click “+ rule” on any gift in the live feed.</p>
        </div>
      )}

      <ul className="rules">
        {rules.map((r) => (
          <li key={r.id} className={r.enabled ? '' : 'disabled'}>
            <label className="switch" title={r.enabled ? 'Enabled' : 'Disabled'}>
              <input type="checkbox" checked={r.enabled} onChange={() => toggle(r)} />
              <span />
            </label>
            <div className="rule-main">
              <div className="rule-name">{r.name}</div>
              <div className="rule-desc">
                <span className="chip">{triggerText(r.trigger)}</span>
                <span className="arrow">→</span>
                <code className="chip action">{r.action.name}</code>
                {r.multiplier !== 1 && <span className="chip">×{r.multiplier}</span>}
                {r.trigger.type === 'gift' && <span className="chip subtle">{r.streakMode === 'onEnd' ? 'on streak end' : 'live combo'}</span>}
                {r.countMode !== 'perUnit' && <span className="chip subtle">{r.countMode}</span>}
                {r.cooldownMs > 0 && <span className="chip subtle">⏱ {r.cooldownMs / 1000}s</span>}
                {r.maxCount !== 100 && <span className="chip subtle">max {r.maxCount}</span>}
                {Object.keys(r.action.params ?? {}).length > 0 && <span className="chip subtle" title={JSON.stringify(r.action.params)}>{'{params}'}</span>}
              </div>
            </div>
            <div className="rule-btns">
              <button className="btn ghost xs" onClick={() => setEditing(r)}>Edit</button>
              <button className="btn ghost xs" onClick={() => duplicate(r)} title="Duplicate">⧉</button>
              <button className="btn ghost xs danger-text" onClick={() => remove(r)} title="Delete">✕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
