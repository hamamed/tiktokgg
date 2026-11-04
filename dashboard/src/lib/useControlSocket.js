import { useCallback, useEffect, useReducer, useRef } from 'react';

const MAX_FEED = 150;
const MAX_DISPATCH = 120;
const MAX_LOG = 120;

export const initialState = {
  socket: 'connecting', // connecting | open | closed
  tiktok: { state: 'disconnected', username: null, roomId: null, viewerCount: null, error: null },
  rules: [],
  settings: {},
  gifts: [],
  clients: [],
  knownActions: [],
  feed: [],
  dispatches: [],
  acks: {}, // actionId -> { status, clientName }
  gameStates: {}, // clientId -> { clientName, state }
  logs: [],
  stats: { gifts: 0, diamonds: 0, likes: 0, chats: 0 },
  lastUsername: '',
};

function addToFeed(feed, evt) {
  let next = feed;
  if (evt.type === 'gift' && evt.streak?.key) {
    // Keep one row per running combo: replace the in-progress row instead of stacking.
    next = feed.filter((e) => !(e.streak?.key === evt.streak.key && e.streak.phase === 'progress'));
  }
  return [evt, ...next].slice(0, MAX_FEED);
}

function bumpStats(stats, e) {
  if (e.type === 'gift' && e.streak?.phase !== 'progress') {
    return { ...stats, gifts: stats.gifts + e.streak.total, diamonds: stats.diamonds + e.streak.total * e.gift.diamonds };
  }
  if (e.type === 'like') return { ...stats, likes: stats.likes + e.likeCount };
  if (e.type === 'chat') return { ...stats, chats: stats.chats + 1 };
  return stats;
}

function reducer(state, { type, payload }) {
  switch (type) {
    case '_socket':
      return { ...state, socket: payload };
    case 'state.snapshot':
      return { ...state, ...payload, feed: payload.feed ?? [] };
    case 'tiktok.status':
      return { ...state, tiktok: payload };
    case 'tiktok.event':
      return { ...state, feed: addToFeed(state.feed, payload), stats: bumpStats(state.stats, payload) };
    case 'rules.updated':
      return { ...state, rules: payload };
    case 'settings.updated':
      return { ...state, settings: payload };
    case 'gifts.updated':
      return { ...state, gifts: payload };
    case 'clients.updated':
      return { ...state, clients: payload };
    case 'actions.updated':
      return { ...state, knownActions: payload };
    case 'action.dispatched':
      return { ...state, dispatches: [payload, ...state.dispatches].slice(0, MAX_DISPATCH) };
    case 'game.ack':
      return { ...state, acks: { ...state.acks, [payload.actionId]: payload } };
    case 'game.state':
      return { ...state, gameStates: { ...state.gameStates, [payload.clientId]: payload } };
    case 'log':
      return { ...state, logs: [payload, ...state.logs].slice(0, MAX_LOG) };
    case '_resetStats':
      return { ...state, stats: initialState.stats };
    default:
      return state;
  }
}

function socketUrl() {
  const params = new URLSearchParams(location.search);
  let token = params.get('token');
  try {
    if (token) localStorage.setItem('tg.token', token);
    else token = localStorage.getItem('tg.token');
  } catch { /* storage blocked */ }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const base = import.meta.env.VITE_WS_URL || `${proto}://${location.host}/ws`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * Manages the dashboard's WebSocket: auto-reconnect, hello handshake, state reducer,
 * and a promise-based `send(type, payload)` that resolves on `ack` / rejects on `error`.
 */
export function useControlSocket() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef(null);
  const pending = useRef(new Map());

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer;

    const open = () => {
      dispatch({ type: '_socket', payload: 'connecting' });
      const ws = new WebSocket(socketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        dispatch({ type: '_socket', payload: 'open' });
        ws.send(JSON.stringify({ v: 1, type: 'hello', id: uid(), ts: Date.now(), payload: { role: 'dashboard', name: 'Web Dashboard' } }));
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.replyTo && pending.current.has(msg.replyTo)) {
          const p = pending.current.get(msg.replyTo);
          pending.current.delete(msg.replyTo);
          clearTimeout(p.timer);
          if (msg.type === 'error') p.reject(new Error(msg.payload?.error || 'Request failed'));
          else p.resolve(msg.payload?.result);
          return;
        }
        dispatch({ type: msg.type, payload: msg.payload });
      };
      ws.onclose = (ev) => {
        dispatch({ type: '_socket', payload: 'closed' });
        for (const p of pending.current.values()) { clearTimeout(p.timer); p.reject(new Error('Connection lost')); }
        pending.current.clear();
        if (closed) return;
        if (ev.code === 4401) {
          dispatch({ type: 'log', payload: { level: 'error', scope: 'dashboard', msg: 'Unauthorized: open the dashboard with ?token=YOUR_WS_TOKEN', ts: Date.now() } });
        }
        timer = setTimeout(open, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    open();

    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((type, payload = {}, { timeoutMs = 30_000 } = {}) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected to the control server'));
    const id = uid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(new Error(`${type} timed out`));
      }, timeoutMs);
      pending.current.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ v: 1, type, id, ts: Date.now(), payload }));
    });
  }, []);

  const resetStats = useCallback(() => dispatch({ type: '_resetStats' }), []);

  return { state, send, resetStats };
}
