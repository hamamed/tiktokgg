// Tug of War: red vs blue pull a rope. First team to drag the knot over its line wins the round.
import { text, sky, particles, teamNames, teamBoard, teamHud, RED, BLUE, GOLD } from './_lib.js';

export default function create(api) {
  const { W, H, clamp, t } = api;
  const ROPE_Y = 640, SPAN = 190; // knot moves ±SPAN px from the centre
  const fxp = particles();
  const board = teamBoard();
  const S = { pos: 0, shown: 0, rounds: { red: 0, blue: 0 }, frozen: { red: 0, blue: 0 }, phase: 'play', phaseT: 0, recent: { red: [], blue: [] }, strain: 0 };
  const winAt = () => Math.max(5, Number(api.options.winAt) || 50);

  function pull(team, amount, user) {
    if (S.phase !== 'play') return;
    if (S.frozen[team] > api.now) return;
    const a = Math.max(0, Number(amount) || 0);
    S.pos += team === 'red' ? -a : a;
    S.strain = 0.4;
    board.add(team, user, a);
    if (user) { const r = S.recent[team]; if (r[0] !== user) r.unshift(user); r.length = Math.min(r.length, 4); }
    fxp.burst(W / 2 + knotX(), ROPE_Y, team === 'red' ? RED : BLUE, 6, 120, 200);
    checkWin();
  }
  const knotX = () => clamp(S.shown / winAt(), -1, 1) * SPAN;
  function checkWin() {
    if (Math.abs(S.pos) < winAt()) return;
    const team = S.pos < 0 ? 'red' : 'blue';
    const names = teamNames(api);
    S.rounds[team]++;
    S.phase = 'win'; S.phaseT = 6;
    const mvp = board.mvp(team);
    api.banner(t(`${names[team]} WINS!`, `فاز ${names[team]}!`), mvp ? t(`MVP @${mvp}`, `الأفضل @${mvp}`) : '', team === 'red' ? RED : BLUE, 5500);
    api.sfx('win');
    fxp.burst(W / 2 + (team === 'red' ? -SPAN : SPAN), ROPE_Y - 40, GOLD, 60, 320);
    api.announce(t(`${names[team]} team wins the round!${mvp ? ` Biggest puller: ${mvp}.` : ''} Next round starts now, pick your side!`, `فاز الفريق ${names[team]} بالجولة!${mvp ? ` أقوى ساحب: ${mvp}.` : ''} جولة جديدة، اختر فريقك!`));
    api.reportScore(S.rounds.red + S.rounds.blue);
  }

  const actions = {
    PULL_RED: (ev) => pull('red', ev.value, ev.user),
    PULL_BLUE: (ev) => pull('blue', ev.value, ev.user),
    FREEZE_RED: (ev) => { S.frozen.red = Math.max(S.frozen.red, api.now) + clamp(ev.value || 5, 1, 60); },
    FREEZE_BLUE: (ev) => { S.frozen.blue = Math.max(S.frozen.blue, api.now) + clamp(ev.value || 5, 1, 60); },
    HELP_LOSER: (ev) => pull(S.pos < 0 ? 'blue' : S.pos > 0 ? 'red' : (Math.random() < 0.5 ? 'red' : 'blue'), ev.value, ev.user),
  };
  const sounds = {
    PULL_RED: () => api.tone({ type: 'triangle', f0: 300, f1: 220, dur: 0.12, vol: 0.25 }),
    PULL_BLUE: () => api.tone({ type: 'triangle', f0: 340, f1: 460, dur: 0.12, vol: 0.25 }),
    FREEZE_RED: () => api.tone({ type: 'sine', f0: 1800, f1: 600, dur: 0.5, vol: 0.18 }),
    FREEZE_BLUE: () => api.tone({ type: 'sine', f0: 1800, f1: 600, dur: 0.5, vol: 0.18 }),
    HELP_LOSER: 'good',
  };

  function update(dt) {
    S.shown += (S.pos - S.shown) * Math.min(1, dt * 6);
    S.strain = Math.max(0, S.strain - dt);
    fxp.update(dt);
    if (S.phase === 'win') {
      S.phaseT -= dt;
      if (S.phaseT <= 0) { S.phase = 'play'; S.pos = 0; board.reset(); api.resetRound(); S.recent = { red: [], blue: [] }; api.banner(t('PULL!', 'اسحب!'), '', GOLD, 1200); }
    }
    const names = teamNames(api);
    const fr = (team) => (S.frozen[team] > api.now ? `<div class="sub" style="color:#bae6fd">${api.icon('snowflake')} ${Math.ceil(S.frozen[team] - api.now)}s</div>` : '');
    const [l, r] = teamHud(api, names, S.rounds, fr('red'), fr('blue'));
    api.setHud(l, r);
  }

  function team(ctx, side, color, frozen) {
    const dir = side === 'red' ? -1 : 1;
    const lean = 0.25 + S.strain * 0.6;
    for (let i = 0; i < 4; i++) {
      const x = W / 2 + knotX() + dir * (70 + i * 48), y = ROPE_Y + 58;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(dir * lean);
      ctx.strokeStyle = frozen ? '#bae6fd' : color; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -46); ctx.stroke();          // body
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-dir * 14, 34); ctx.moveTo(0, 0); ctx.lineTo(dir * 12, 34); ctx.stroke(); // legs
      ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(-dir * 26, -58); ctx.stroke(); // arms to rope
      ctx.fillStyle = frozen ? '#e0f2fe' : color; ctx.beginPath(); ctx.arc(0, -60, 14, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function draw(ctx) {
    sky(ctx, W, H, '#0b1026', '#111a33');
    // stadium lights
    for (let i = 0; i < 5; i++) { const x = 60 + i * 105; const g = ctx.createRadialGradient(x, 430, 2, x, 430, 120); g.addColorStop(0, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.fillRect(x - 120, 310, 240, 240); }
    // ground halves
    ctx.fillStyle = 'rgba(254,44,85,.14)'; ctx.fillRect(0, 700, W / 2, 160);
    ctx.fillStyle = 'rgba(37,244,238,.12)'; ctx.fillRect(W / 2, 700, W / 2, 160);
    ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 696, W, 6);
    // win lines + centre
    for (const [x, c] of [[W / 2 - SPAN, RED], [W / 2 + SPAN, BLUE]]) { ctx.strokeStyle = c; ctx.setLineDash([10, 8]); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, 560); ctx.lineTo(x, 760); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(W / 2, 590); ctx.lineTo(W / 2, 760); ctx.stroke();
    // progress meter
    const p = clamp(S.shown / winAt(), -1, 1);
    api.roundRect(ctx, 40, 520, W - 80, 18, 9); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fill();
    ctx.fillStyle = p < 0 ? RED : BLUE;
    const half = (W - 80) / 2;
    if (p < 0) ctx.fillRect(40 + half + p * half, 520, -p * half, 18); else ctx.fillRect(40 + half, 520, p * half, 18);
    text(ctx, `${Math.round(Math.abs(S.pos))} / ${winAt()}`, W / 2, 500, { size: 18, color: '#cbd5e1', weight: 700 });
    // rope
    ctx.strokeStyle = '#d6b37a'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(20, ROPE_Y); ctx.quadraticCurveTo(W / 2 + knotX(), ROPE_Y + 6 + S.strain * 10, W - 20, ROPE_Y); ctx.stroke();
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(W / 2 + knotX(), ROPE_Y + 3, 12, 0, Math.PI * 2); ctx.fill();
    team(ctx, 'red', RED, S.frozen.red > api.now);
    team(ctx, 'blue', BLUE, S.frozen.blue > api.now);
    // latest pullers
    const names = teamNames(api);
    text(ctx, names.red, 30, 800, { size: 22, color: RED, align: 'left' });
    text(ctx, names.blue, W - 30, 800, { size: 22, color: BLUE, align: 'right' });
    S.recent.red.slice(0, 1).forEach((u) => text(ctx, '@' + u, 30, 826, { size: 14, color: '#fecdd3', align: 'left', weight: 600, max: 220 }));
    S.recent.blue.slice(0, 1).forEach((u) => text(ctx, '@' + u, W - 30, 826, { size: 14, color: '#cffafe', align: 'right', weight: 600, max: 220 }));
    fxp.draw(ctx);
  }

  return { actions, sounds, update, draw };
}
