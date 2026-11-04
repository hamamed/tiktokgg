import { useCallback, useMemo, useState } from 'react';
import { useControlSocket } from './lib/useControlSocket.js';
import ConnectionBar from './components/ConnectionBar.jsx';
import LiveFeed from './components/LiveFeed.jsx';
import RulesPanel from './components/RulesPanel.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import TestPanel from './components/TestPanel.jsx';
import GamesPanel from './components/GamesPanel.jsx';

export default function App() {
  const { state, send, resetStats } = useControlSocket();
  const [toasts, setToasts] = useState([]);
  const [draft, setDraft] = useState(null); // rule prefill (e.g. clicked from the feed)

  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 2500);
  }, []);

  /** send() wrapper that reports errors (and optionally success) as toasts. */
  const run = useCallback(
    async (type, payload, okText) => {
      try {
        const res = await send(type, payload);
        if (okText) toast(okText);
        return res;
      } catch (err) {
        toast(err.message, 'error');
        throw err;
      }
    },
    [send, toast],
  );

  const giftNames = useMemo(() => state.gifts.map((g) => g.name), [state.gifts]);

  return (
    <div className="app">
      <ConnectionBar state={state} run={run} />

      <main className="grid">
        <section className="col col-feed">
          <LiveFeed feed={state.feed} stats={state.stats} onResetStats={resetStats} onMakeRule={setDraft} />
        </section>

        <section className="col col-rules">
          <RulesPanel
            rules={state.rules}
            gifts={state.gifts}
            knownActions={state.knownActions}
            draft={draft}
            onDraftConsumed={() => setDraft(null)}
            run={run}
            toast={toast}
          />
        </section>

        <section className="col col-side">
          <SettingsPanel settings={state.settings} run={run} />
          <TestPanel giftNames={giftNames} knownActions={state.knownActions} run={run} />
          <GamesPanel clients={state.clients} dispatches={state.dispatches} acks={state.acks} gameStates={state.gameStates} logs={state.logs} />
        </section>
      </main>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
