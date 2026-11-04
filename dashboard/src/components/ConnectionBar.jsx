import { useEffect, useState } from 'react';

const LABEL = {
  disconnected: 'Offline',
  connecting: 'Connecting…',
  connected: 'LIVE',
  reconnecting: 'Reconnecting…',
  ended: 'Stream ended',
  error: 'Error',
};

export default function ConnectionBar({ state, run }) {
  const { tiktok, socket, lastUsername, clients } = state;
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!username && lastUsername) setUsername(lastUsername);
  }, [lastUsername]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = tiktok.state === 'connected' || tiktok.state === 'connecting' || tiktok.state === 'reconnecting';
  const games = clients.filter((c) => c.role === 'game').length;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (live) await run('tiktok.disconnect', {}, 'Disconnected');
      else await run('tiktok.connect', { username }, `Connected to @${username.replace(/^@/, '')}`);
    } catch { /* toast already shown */ }
    setBusy(false);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden>🎮</span>
        <div>
          <h1>TikTok Game Control</h1>
          <small className={`sock sock-${socket}`}>server {socket}</small>
        </div>
      </div>

      <form className="connect" onSubmit={submit}>
        <div className="at-input">
          <span>@</span>
          <input
            aria-label="TikTok username"
            placeholder="tiktok_username"
            value={username}
            onChange={(e) => setUsername(e.target.value.trim())}
            disabled={live || busy}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button className={live ? 'btn danger' : 'btn primary'} disabled={busy || socket !== 'open' || (!live && !username)}>
          {busy ? '…' : live ? 'Disconnect' : 'Connect'}
        </button>
      </form>

      <div className="status">
        <span className={`pill pill-${tiktok.state}`}>{LABEL[tiktok.state] ?? tiktok.state}</span>
        {tiktok.username && tiktok.state === 'connected' && <span className="muted">@{tiktok.username}</span>}
        {tiktok.viewerCount != null && <span className="muted">👁 {tiktok.viewerCount.toLocaleString()}</span>}
        <span className={games ? 'muted ok' : 'muted warn'}>🕹 {games} game{games === 1 ? '' : 's'}</span>
        {tiktok.error && <span className="err" title={tiktok.error}>{tiktok.error}</span>}
      </div>
    </header>
  );
}
