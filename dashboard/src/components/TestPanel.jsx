import { useState } from 'react';

export default function TestPanel({ giftNames, knownActions, run }) {
  const [tab, setTab] = useState('event');

  // Direct action
  const [action, setAction] = useState('');
  const [count, setCount] = useState(1);
  const [params, setParams] = useState('{}');

  // Simulated TikTok event
  const [evType, setEvType] = useState('gift');
  const [giftName, setGiftName] = useState('');
  const [giftCount, setGiftCount] = useState(5);
  const [streak, setStreak] = useState(true);
  const [comment, setComment] = useState('!jump');
  const [likes, setLikes] = useState(50);
  const [username, setUsername] = useState('tester');

  const fireAction = (e) => {
    e.preventDefault();
    // params is sent as text; the server parses it and replies with an error toast if it's invalid JSON.
    run('test.action', { action, count, params }, `Sent ${action} ×${count}`).catch(() => {});
  };

  const simulate = (e) => {
    e.preventDefault();
    const payload = { type: evType, username };
    if (evType === 'gift') Object.assign(payload, { giftName, count: giftCount, streak });
    if (evType === 'chat') payload.comment = comment;
    if (evType === 'like') payload.likeCount = likes;
    run('test.event', payload).catch(() => {});
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Test console</h2>
        <div className="seg">
          <button className={tab === 'event' ? 'on' : ''} onClick={() => setTab('event')}>Simulate viewer</button>
          <button className={tab === 'action' ? 'on' : ''} onClick={() => setTab('action')}>Fire action</button>
        </div>
      </div>

      {tab === 'event' ? (
        <form onSubmit={simulate} className="stack">
          <p className="hint muted">Runs through streaks and rules just like a real TikTok event.</p>
          <div className="row">
            <label>
              <span>Event</span>
              <select value={evType} onChange={(e) => setEvType(e.target.value)}>
                {['gift', 'chat', 'like', 'follow', 'share', 'member', 'subscribe'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="grow">
              <span>Viewer</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
          </div>
          {evType === 'gift' && (
            <div className="row">
              <label className="grow">
                <span>Gift</span>
                <input list="test-gifts" value={giftName} placeholder="Rose" onChange={(e) => setGiftName(e.target.value)} required />
                <datalist id="test-gifts">{giftNames.map((g) => <option key={g} value={g} />)}</datalist>
              </label>
              <label>
                <span>Count</span>
                <input type="number" min="1" max="500" value={giftCount} onChange={(e) => setGiftCount(+e.target.value)} />
              </label>
              <label className="check">
                <input type="checkbox" checked={streak} onChange={(e) => setStreak(e.target.checked)} />
                <span>combo streak</span>
              </label>
            </div>
          )}
          {evType === 'chat' && (
            <label><span>Comment</span><input value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          )}
          {evType === 'like' && (
            <label><span>Likes</span><input type="number" min="1" value={likes} onChange={(e) => setLikes(+e.target.value)} /></label>
          )}
          <button className="btn primary">Simulate {evType}</button>
        </form>
      ) : (
        <form onSubmit={fireAction} className="stack">
          <p className="hint muted">Sends <code>game.action</code> straight to the game. Rules are skipped.</p>
          <div className="row">
            <label className="grow">
              <span>Action</span>
              <input list="test-actions" value={action} placeholder="spawn_train" onChange={(e) => setAction(e.target.value.replace(/\s+/g, '_'))} required />
              <datalist id="test-actions">{knownActions.map((a) => <option key={a} value={a} />)}</datalist>
            </label>
            <label>
              <span>Count</span>
              <input type="number" min="1" value={count} onChange={(e) => setCount(+e.target.value)} />
            </label>
          </div>
          <label>
            <span>Params JSON</span>
            <textarea rows={2} value={params} spellCheck={false} onChange={(e) => setParams(e.target.value)} />
          </label>
          {knownActions.length > 0 && (
            <div className="quick">
              {knownActions.map((a) => (
                <button type="button" key={a} className="btn ghost xs" onClick={() => run('test.action', { action: a, count: 1 }, `Sent ${a}`).catch(() => {})}>
                  ⚡ {a}
                </button>
              ))}
            </div>
          )}
          <button className="btn primary">Fire action</button>
        </form>
      )}
    </div>
  );
}
