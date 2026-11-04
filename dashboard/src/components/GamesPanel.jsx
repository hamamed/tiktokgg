import { useState } from 'react';

const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function GamesPanel({ clients, dispatches, acks, gameStates, logs }) {
  const [tab, setTab] = useState('dispatch');
  const games = clients.filter((c) => c.role === 'game');

  return (
    <div className="card">
      <div className="card-head">
        <h2>Game clients</h2>
        <div className="seg">
          <button className={tab === 'dispatch' ? 'on' : ''} onClick={() => setTab('dispatch')}>Dispatches</button>
          <button className={tab === 'state' ? 'on' : ''} onClick={() => setTab('state')}>State</button>
          <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Server log</button>
        </div>
      </div>

      <ul className="clients">
        {games.length === 0 && (
          <li className="empty">
            No game connected. Open <a href="/demo" target="_blank" rel="noreferrer">/demo</a> or start your Unity scene.
          </li>
        )}
        {games.map((c) => (
          <li key={c.id}>
            <b>🕹 {c.name}</b> <span className="muted">{c.ip}</span>
            {c.actions.length > 0 && <div className="muted small">actions: {c.actions.join(', ')}</div>}
          </li>
        ))}
      </ul>

      {tab === 'dispatch' && (
        <ul className="log">
          {dispatches.length === 0 && <li className="empty">No actions dispatched yet.</li>}
          {dispatches.map((d) => {
            const ack = acks[d.actionId];
            return (
              <li key={d.actionId}>
                <time className="muted">{time(d.ts)}</time>
                <code>{d.action}</code> ×{d.count}
                <span className="muted">
                  {' '}
                  ← {d.source.kind === 'manual' ? 'manual' : `${d.source.gift?.name ?? d.source.kind} @${d.source.user?.uniqueId ?? '?'}`}
                </span>
                {d.deliveredTo === 0 ? <span className="tag warn">no game</span> : <span className="tag">{d.deliveredTo}×</span>}
                {ack && <span className={`tag ${ack.status === 'ok' ? 'ok' : 'warn'}`} title={ack.message}>{ack.status}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'state' && (
        <div className="stack">
          {Object.values(gameStates).length === 0 && <p className="empty">Games can send <code>game.state</code> (score, lives…) to show it here.</p>}
          {Object.values(gameStates).map((g) => (
            <div key={g.clientId}>
              <b>{g.clientName}</b>
              <pre className="json">{JSON.stringify(g.state, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}

      {tab === 'log' && (
        <ul className="log">
          {logs.map((l, i) => (
            <li key={i} className={`lvl-${l.level}`}>
              <time className="muted">{time(l.ts)}</time> <span className="muted">[{l.scope}]</span> {l.msg}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
