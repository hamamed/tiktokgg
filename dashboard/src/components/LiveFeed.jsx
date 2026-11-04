import { useState } from 'react';

const ICON = { gift: '🎁', chat: '💬', like: '❤️', follow: '➕', share: '↗️', member: '👋', subscribe: '⭐' };
const FILTERS = ['all', 'gift', 'chat', 'like', 'other'];

const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function describe(e) {
  switch (e.type) {
    case 'gift':
      return null; // custom rendering
    case 'chat':
      return e.comment;
    case 'like':
      return `liked ×${e.likeCount}`;
    case 'follow':
      return 'followed';
    case 'share':
      return 'shared the stream';
    case 'member':
      return 'joined';
    case 'subscribe':
      return 'subscribed';
    default:
      return e.type;
  }
}

export default function LiveFeed({ feed, stats, onResetStats, onMakeRule }) {
  const [filter, setFilter] = useState('all');
  const shown = feed.filter((e) =>
    filter === 'all' ? true : filter === 'other' ? !['gift', 'chat', 'like'].includes(e.type) : e.type === filter,
  );

  return (
    <div className="card fill">
      <div className="card-head">
        <h2>Live feed</h2>
        <div className="seg" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="stats">
        <div><b>{stats.gifts.toLocaleString()}</b><span>gifts</span></div>
        <div><b>💎 {stats.diamonds.toLocaleString()}</b><span>diamonds</span></div>
        <div><b>{stats.likes.toLocaleString()}</b><span>likes</span></div>
        <div><b>{stats.chats.toLocaleString()}</b><span>chats</span></div>
        <button className="btn ghost xs" onClick={onResetStats} title="Reset counters">↺</button>
      </div>

      <ul className="feed">
        {shown.length === 0 && <li className="empty">Waiting for events… use the Test panel to simulate some.</li>}
        {shown.map((e) => (
          <li key={e.id} className={`ev ev-${e.type} ${e.streak?.phase === 'progress' ? 'streaking' : ''}`}>
            <span className="ev-icon" aria-hidden>{ICON[e.type] ?? '•'}</span>
            {e.user?.avatar ? <img className="avatar" src={e.user.avatar} alt="" loading="lazy" /> : <span className="avatar ph" />}
            <div className="ev-body">
              <div className="ev-user">
                <b>{e.user?.nickname}</b> <span className="muted">@{e.user?.uniqueId}</span>
                {e.simulated && <span className="tag">test</span>}
              </div>
              {e.type === 'gift' ? (
                <div className="ev-gift">
                  {e.gift.image && <img src={e.gift.image} alt="" className="gift-img" />}
                  <span>{e.gift.name}</span>
                  <b className="combo">×{e.streak.total}</b>
                  <span className="muted">💎{e.gift.diamonds}</span>
                  {e.streak.phase === 'progress' && <span className="tag live">combo…</span>}
                  {e.streak.phase === 'end' && <span className="tag">{e.streak.synthetic ? 'timed out' : 'streak end'}</span>}
                  <button className="btn ghost xs" title="Create a rule for this gift" onClick={() => onMakeRule({ trigger: { type: 'gift', giftName: e.gift.name } })}>
                    + rule
                  </button>
                </div>
              ) : (
                <div className="ev-text">
                  {describe(e)}
                  {e.type === 'chat' && (
                    <button className="btn ghost xs" title="Create a chat command rule" onClick={() => onMakeRule({ trigger: { type: 'chat', keyword: e.comment.split(/\s+/)[0], keywordMode: 'startsWith' } })}>
                      + rule
                    </button>
                  )}
                </div>
              )}
            </div>
            <time className="muted">{time(e.ts)}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
