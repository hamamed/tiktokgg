// Bomb Pass: viewers join (!join or any gift). The bomb sits on one player; gifts pass it on or add
// time. Whoever holds it at zero is out. Last player standing wins.
import { text, sky, particles, GOLD } from './_lib.js';

export default function create(api) {
  const { W, H, clamp, rand, t } = api;
  const CX = W / 2, CY = 655, RING = 160;
  const fxp = particles(api);
  const S = { players: [], phase: 'waiting', holder: -1, fuse: 0, phaseT: 0, lastBeep: 0, winner: null, rounds: 0 };
  const fuseLen = () => clamp(Number(api.options.fuse) || 25, 5, 300);
  const minPlayers = () => clamp(Math.round(Number(api.options.minPlayers) || 3), 2, 50);
  const alive = () => S.players.filter((p) => !p.out);

  function join(user, pic) {
    if (!user || S.players.some((p) => p.user === user)) return;
    if (S.players.length >= api.num('maxPlayers', 16, 2, 30)) return;
    S.players.push({ user, pic: pic || null, out: S.phase === 'playing' });
    api.sfx('blip');
  }
  function pickHolder(not) {
    const list = S.players.map((p, i) => i).filter((i) => !S.players[i].out && i !== not);
    return list.length ? list[Math.floor(Math.random() * list.length)] : not;
  }
  function pass(times = 1) {
    if (S.phase !== 'playing') return;
    for (let i = 0; i < times; i++) S.holder = pickHolder(S.holder);
    fxp.burst(...pos(S.holder), '#f87171', 10, 160);
  }
  function pos(i) {
    const n = Math.max(1, S.players.length), a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [CX + Math.cos(a) * RING, CY + Math.sin(a) * RING];
  }
  function explode() {
    const p = S.players[S.holder];
    if (p) { p.out = true; fxp.burst(...pos(S.holder), '#fb923c', 50, 340); }
    api.sfx('boom');
    api.banner(t('BOOM!', 'بوم!', 'BUM!'), p ? t(`@${p.user} is out`, `@${p.user} خرج`, `@${p.user} elendi`) : '', '#fb923c', 2200);
    const left = alive();
    if (left.length <= 1) {
      S.winner = left[0]?.user || null;
      S.phase = 'won'; S.phaseT = api.num('roundPause', 6, 2, 30); S.rounds++;
      api.banner(t('WINNER!', 'الفائز!', 'KAZANAN!'), S.winner ? '@' + S.winner : '', GOLD, 5500);
      api.sfx('win');
      api.announce(S.winner ? t(`${S.winner} survived the bomb and wins! Type join to play the next round!`, `${S.winner} نجا من القنبلة وفاز! اكتب join للعب الجولة القادمة!`, `${S.winner} bombadan kurtuldu ve kazandı! Sonraki tur için join yaz!`) : t('Nobody survived!', 'لم ينجُ أحد!', 'Kimse kurtulamadı!'));
      api.reportScore(S.rounds);
    } else { S.holder = pickHolder(S.holder); S.fuse = fuseLen(); }
  }

  const actions = {
    JOIN: (ev) => join(ev.user, ev.profilePictureUrl),
    PASS_BOMB: (ev) => { join(ev.user, ev.profilePictureUrl); pass(clamp(Math.round(ev.value) || 1, 1, 5)); },
    ADD_TIME: (ev) => { join(ev.user, ev.profilePictureUrl); if (S.phase === 'playing') S.fuse = Math.min(S.fuse + clamp(Number(ev.value) || 5, 1, 120), 300); },
  };
  const sounds = { JOIN: 'blip', PASS_BOMB: 'whoosh', ADD_TIME: 'good' };

  function update(dt) {
    fxp.update(dt);
    if (S.phase === 'waiting' && S.players.length >= minPlayers()) { S.phase = 'countdown'; S.phaseT = api.num('countdown', 5, 1, 30); api.banner(t('GET READY', 'استعدوا', 'HAZIR OLUN'), t(`${S.players.length} players`, `${S.players.length} لاعبين`, `${S.players.length} oyuncu`), GOLD, 1800); }
    if (S.phase === 'countdown') {
      S.phaseT -= dt;
      if (S.phaseT <= 0) { S.phase = 'playing'; S.players.forEach((p) => (p.out = false)); S.holder = pickHolder(-1); S.fuse = fuseLen(); api.announce(t('The bomb is lit! Gifts pass it on!', 'القنبلة اشتعلت! الهدايا تمررها!', 'Bomba yandı! Hediyeler onu başkasına geçirir!')); }
    }
    if (S.phase === 'playing') {
      S.fuse -= dt;
      const beepEvery = S.fuse < 5 ? 0.25 : S.fuse < 10 ? 0.5 : 1;
      if (api.now - S.lastBeep > beepEvery) { S.lastBeep = api.now; api.sfx('tick'); }
      if (S.fuse <= 0) explode();
    }
    if (S.phase === 'won') {
      S.phaseT -= dt;
      if (S.phaseT <= 0) { S.phase = 'waiting'; S.players.forEach((p) => (p.out = false)); S.winner = null; api.resetRound(); }
    }
    api.setHud(`<div class="sub">${t('Players', 'اللاعبون', 'Oyuncular')}</div><div class="big">${api.icon('users')}${alive().length}${S.phase === 'waiting' ? ` / ${minPlayers()}` : ''}</div><div class="sub">${t('Rounds', 'الجولات', 'Turlar')} ${S.rounds}</div>`);
  }

  function draw(ctx) {
    if (!api.drawBackground(ctx)) { sky(ctx, W, H, '#1c0f0a', '#2a1410'); }
    ctx.strokeStyle = 'rgba(251,146,60,.18)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(CX, CY, RING, 0, Math.PI * 2); ctx.stroke();
    S.players.forEach((p, i) => {
      const [x, y] = pos(i);
      ctx.globalAlpha = p.out ? 0.3 : 1;
      api.drawAvatar(ctx, p.user, x, y, 26, p.pic);
      if (api.showNames) text(ctx, '@' + p.user.slice(0, 10), x, y + 40, { size: 12, color: '#fde68a', weight: 700 });
      if (p.out) { ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x - 18, y - 18); ctx.lineTo(x + 18, y + 18); ctx.moveTo(x + 18, y - 18); ctx.lineTo(x - 18, y + 18); ctx.stroke(); }
      ctx.globalAlpha = 1;
    });
    if (S.phase === 'playing' && S.players[S.holder]) {
      const [x, y] = pos(S.holder);
      const shake = S.fuse < 5 ? rand(-3, 3) : 0;
      ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(x + 26 + shake, y - 26, 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#a16207'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 36, y - 40); ctx.quadraticCurveTo(x + 46, y - 56, x + 40, y - 62); ctx.stroke();
      ctx.fillStyle = Math.floor(api.now * 10) % 2 ? '#fde047' : '#fb923c'; ctx.beginPath(); ctx.arc(x + 40, y - 64, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#f87171'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, 31, 0, Math.PI * 2); ctx.stroke();
      text(ctx, Math.ceil(S.fuse), CX, CY - 6, { size: 72, color: S.fuse < 5 ? '#f87171' : '#fde68a', weight: 900 });
      text(ctx, t('seconds', 'ثانية', 'saniye'), CX, CY + 40, { size: 18, color: '#fcd34d', weight: 700 });
    } else if (S.phase === 'countdown') {
      text(ctx, Math.ceil(S.phaseT), CX, CY, { size: 80, color: GOLD, weight: 900 });
    } else if (S.phase === 'waiting') {
      text(ctx, t('Type !join to play', 'اكتب !join للعب', 'Oynamak için !join yaz'), CX, CY - 10, { size: 26, color: '#fde68a' });
      text(ctx, t(`${S.players.length} / ${minPlayers()} players`, `${S.players.length} / ${minPlayers()} لاعبين`, `${S.players.length} / ${minPlayers()} oyuncu`), CX, CY + 24, { size: 18, color: '#fdba74', weight: 700 });
    } else if (S.phase === 'won' && S.winner) {
      const i = S.players.findIndex((p) => p.user === S.winner);
      if (i >= 0) { const [x, y] = pos(i); ctx.strokeStyle = GOLD; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.stroke(); }
      text(ctx, '@' + S.winner, CX, CY, { size: 30, color: GOLD, max: 260 });
    }
    fxp.draw(ctx);
  }

  return {
    actions, sounds, update, draw,
    onGift: (g) => { if (api.flag('giftJoins')) join(g.user, null); }, // any gift also joins the sender (setting)
  };
}
