// Vote Path: chat votes left or right at each fork. One side hides treasure, the other a trap.
import { text, sky, stars, particles, GOLD } from './_lib.js';

export default function create(api) {
  const { W, H, clamp, rand, t } = api;
  const FORK_Y = 600, BOTTOM = 840;
  const fxp = particles(api);
  const S = { phase: 'walk', phaseT: 3, votes: { left: 0, right: 0 }, voters: new Set(), extra: 0, coins: 0, lives: api.num('lives', 3, 1, 10), best: 0, step: 0, choice: null, treasureSide: null, heroY: BOTTOM, result: null };
  const voteSecs = () => clamp(Number(api.options.voteSeconds) || 12, 5, 120);
  const LEFT = new Set(['left', '!left', 'l', 'يسار', 'يسارا', 'شمال', 'gauche', 'sol', 'izquierda']);
  const RIGHT = new Set(['right', '!right', 'r', 'يمين', 'يمينا', 'droite', 'sağ', 'sag', 'derecha']);

  function startVote() { S.phase = 'vote'; S.phaseT = voteSecs() + S.extra; S.extra = 0; S.votes = { left: 0, right: 0 }; S.voters = new Set(); S.treasureSide = Math.random() < 0.5 ? 'left' : 'right'; api.sfx('alert'); }
  function decide() {
    const { left, right } = S.votes;
    S.choice = left === right ? (Math.random() < 0.5 ? 'left' : 'right') : left > right ? 'left' : 'right';
    S.phase = 'go'; S.phaseT = 2.2;
  }
  function reveal() {
    S.phase = 'reveal'; S.phaseT = 3;
    if (S.choice === S.treasureSide) {
      const base = api.num('treasure', 10, 1, 1000), gain = base + Math.round(S.step * base * 0.2);
      S.coins += gain; S.result = 'treasure';
      api.banner(t('TREASURE!', 'كنز!', 'HAZİNE!'), `+${gain}`, GOLD, 2500); api.sfx('win');
      fxp.burst(S.choice === 'left' ? 140 : W - 140, FORK_Y - 40, GOLD, 50, 300);
    } else {
      S.lives--; S.result = 'trap';
      api.banner(t('TRAP!', 'فخ!', 'TUZAK!'), t(`${S.lives} lives left`, `باقي ${S.lives} أرواح`, `${S.lives} can kaldı`), '#f87171', 2500); api.sfx('boom');
      fxp.burst(S.choice === 'left' ? 140 : W - 140, FORK_Y - 40, '#f87171', 40, 300);
    }
    S.step++;
  }
  function gameOver() {
    S.best = Math.max(S.best, S.coins);
    const mvp = api.mvp();
    api.banner(t('GAME OVER', 'انتهت اللعبة', 'OYUN BİTTİ'), t(`${S.coins} coins${mvp ? ` · MVP @${mvp.user}` : ''}`, `${S.coins} عملة${mvp ? ` · الأفضل @${mvp.user}` : ''}`, `${S.coins} altın${mvp ? ` · MVP @${mvp.user}` : ''}`), '#f87171', 4500);
    api.announce(t(`Game over with ${S.coins} coins! Let's explore again. Type left or right to vote!`, `انتهت اللعبة بـ ${S.coins} عملة! لنبدأ من جديد. اكتب يمين أو يسار للتصويت!`, `Oyun ${S.coins} altınla bitti! Haydi yeniden keşfedelim. Oy vermek için sol ya da sağ yaz!`));
    api.reportScore(S.coins);
    Object.assign(S, { coins: 0, lives: api.num('lives', 3, 1, 10), step: 0, phase: 'walk', phaseT: 5 });
    api.resetRound();
  }
  function vote(side, n, user) {
    if (S.phase !== 'vote') return;
    S.votes[side] += n;
    if (user) fxp.burst(side === 'left' ? 140 : W - 140, FORK_Y - 120, side === 'left' ? '#67e8f9' : '#f472b6', 4, 90, 100);
  }

  const actions = {
    VOTE_LEFT: (ev) => vote('left', clamp(Math.round(ev.value) || 1, 1, 10000), ev.user),
    VOTE_RIGHT: (ev) => vote('right', clamp(Math.round(ev.value) || 1, 1, 10000), ev.user),
    EXTRA_TIME: (ev) => { const s = clamp(Number(ev.value) || 5, 1, 120); if (S.phase === 'vote') S.phaseT += s; else S.extra += s; },
  };
  const sounds = { VOTE_LEFT: 'blip', VOTE_RIGHT: 'blip', EXTRA_TIME: 'good' };

  function update(dt) {
    fxp.update(dt);
    S.phaseT -= dt;
    if (S.phase === 'walk') { S.heroY = BOTTOM - (1 - Math.max(0, S.phaseT) / 3) * 0; if (S.phaseT <= 0) startVote(); }
    else if (S.phase === 'vote') { if (S.phaseT <= 0) decide(); }
    else if (S.phase === 'go') { if (S.phaseT <= 0) reveal(); }
    else if (S.phase === 'reveal') { if (S.phaseT <= 0) { if (S.lives <= 0) gameOver(); else { S.phase = 'walk'; S.phaseT = 2; S.result = null; } } }
    const hearts = Array.from({ length: Math.max(S.lives, api.num('lives', 3, 1, 10)) }, (_, i) => `<span style="color:${i < S.lives ? '#f87171' : '#475569'}">${api.icon('heart')}</span>`).join('');
    api.setHud(
      `<div class="sub">${t('Coins', 'العملات', 'Altın')}</div><div class="big" style="color:${GOLD}">${api.icon('coins')}${S.coins}</div><div class="sub">${t('Best', 'الأفضل', 'En iyi')} ${Math.max(S.best, S.coins)}</div>`,
      `<div class="sub">${t('Lives', 'الأرواح', 'Canlar')}</div><div class="big">${hearts}</div>`,
    );
  }

  function draw(ctx) {
    if (!api.drawBackground(ctx)) { sky(ctx, W, H, '#0f1f17', '#14281d'); stars(ctx, W, H, api.now, 40, 420); }
    // trees
    for (let i = 0; i < 10; i++) { const x = (i * 61) % W, y = 470 + (i % 3) * 20; ctx.fillStyle = '#14532d'; ctx.beginPath(); ctx.moveTo(x, y - 60); ctx.lineTo(x - 26, y); ctx.lineTo(x + 26, y); ctx.fill(); }
    // path: trunk + two branches
    ctx.strokeStyle = '#a16207'; ctx.lineCap = 'round'; ctx.lineWidth = 46;
    ctx.beginPath(); ctx.moveTo(W / 2, BOTTOM + 40); ctx.lineTo(W / 2, FORK_Y + 30); ctx.stroke();
    for (const [x, side] of [[140, 'left'], [W - 140, 'right']]) {
      ctx.strokeStyle = S.choice === side && S.phase !== 'vote' ? '#ca8a04' : '#854d0e';
      ctx.beginPath(); ctx.moveTo(W / 2, FORK_Y + 30); ctx.quadraticCurveTo(W / 2, FORK_Y - 20, x, FORK_Y - 70); ctx.stroke();
    }
    // reveal chest / trap at the chosen end
    if (S.phase === 'reveal' || S.phase === 'go') {
      for (const side of ['left', 'right']) {
        const x = side === 'left' ? 140 : W - 140, y = FORK_Y - 90;
        if (S.phase === 'reveal' || side !== S.choice) continue;
        text(ctx, '?', x, y, { size: 40, color: '#fde68a' });
      }
      if (S.phase === 'reveal') {
        const x = S.choice === 'left' ? 140 : W - 140, y = FORK_Y - 95;
        if (S.result === 'treasure') { ctx.fillStyle = '#b45309'; ctx.fillRect(x - 30, y - 18, 60, 36); ctx.fillStyle = GOLD; ctx.fillRect(x - 30, y - 24, 60, 10); ctx.fillRect(x - 6, y - 6, 12, 14); }
        else { ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 4; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * 12, y + 18); ctx.lineTo(x + i * 12 + 6, y - 14); ctx.lineTo(x + i * 12 + 12, y + 18); ctx.stroke(); } }
      }
    }
    // hero
    let hx = W / 2, hy = BOTTOM - 40;
    if (S.phase === 'go' || S.phase === 'reveal') { const k = S.phase === 'go' ? 1 - clamp(S.phaseT / 2.2, 0, 1) : 1; const tx = S.choice === 'left' ? 140 : W - 140; hx = W / 2 + (tx - W / 2) * k; hy = BOTTOM - 40 - (BOTTOM - 40 - (FORK_Y - 40)) * k; }
    else if (S.phase === 'vote') hy = FORK_Y + 70;
    ctx.fillStyle = '#25f4ee'; ctx.beginPath(); ctx.arc(hx, hy - 30, 14, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(hx - 10, hy - 16, 20, 30);
    // vote: one horizontal bar (left vs right) + countdown, in the clear area under the fork
    if (S.phase === 'vote') {
      const total = S.votes.left + S.votes.right;
      const share = total ? S.votes.left / total : 0.5;
      const bx = 40, bw = W - 80, by = 770;
      api.roundRect(ctx, bx, by, bw, 26, 13); ctx.fillStyle = '#f472b6'; ctx.fill();
      ctx.save(); api.roundRect(ctx, bx, by, bw, 26, 13); ctx.clip(); ctx.fillStyle = '#67e8f9'; ctx.fillRect(bx, by, bw * share, 26); ctx.restore();
      if (api.flag('showVotes')) text(ctx, `${t('LEFT', 'يسار', 'SOL')} ${S.votes.left}`, bx + 10, by - 18, { size: 22, color: '#67e8f9', align: 'left' });
      if (api.flag('showVotes')) text(ctx, `${S.votes.right} ${t('RIGHT', 'يمين', 'SAĞ')}`, bx + bw - 10, by - 18, { size: 22, color: '#f472b6', align: 'right' });
      text(ctx, Math.ceil(S.phaseT), W / 2, by - 22, { size: 40, color: '#fde68a', weight: 900 });
      if (api.flag('chatVotes')) text(ctx, t('Type left or right!', 'اكتب يمين أو يسار!', 'Sol ya da sağ yaz!'), W / 2, by + 52, { size: 20, color: '#bbf7d0' });
    }
    fxp.draw(ctx);
  }

  return {
    actions, sounds, update, draw,
    onChat(m) {
      if (S.phase !== 'vote' || S.voters.has(m.user) || !api.flag('chatVotes')) return;
      const w = String(m.comment || '').trim().toLowerCase();
      const side = LEFT.has(w) ? 'left' : RIGHT.has(w) ? 'right' : null;
      if (!side) return;
      S.voters.add(m.user);
      vote(side, 1, m.user);
    },
  };
}
