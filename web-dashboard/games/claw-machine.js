// Claw Machine: each gift drops the claw for the sender. Stronger gifts grab better.
// Prizes won go on the winners' shelf.
import { text, particles, GOLD } from './_lib.js';

export default function create(api) {
  const { W, H, clamp, rand, t } = api;
  const BOX = { x: 50, y: 440, w: W - 100, h: 410 }, RAIL_Y = BOX.y + 40, FLOOR = BOX.y + BOX.h - 20, CHUTE_X = BOX.x + 60;
  const TYPES = [
    { id: 'bear', color: '#d97706', name: ['Teddy bear', 'دبدوب'], rare: false },
    { id: 'star', color: '#facc15', name: ['Star', 'نجمة'], rare: false },
    { id: 'heart', color: '#fb7185', name: ['Heart', 'قلب'], rare: false },
    { id: 'gem', color: '#22d3ee', name: ['Gem', 'جوهرة'], rare: false },
    { id: 'crown', color: '#fbbf24', name: ['Golden crown', 'تاج ذهبي'], rare: true },
  ];
  const fxp = particles();
  const S = { prizes: [], queue: [], claw: { x: BOX.x + BOX.w / 2, y: RAIL_Y, open: 1, state: 'idle', target: null, held: null, user: null, strength: 1, t: 0 }, winners: [], drops: 0 };

  function addPrize() {
    const type = Math.random() < 0.08 ? TYPES[4] : TYPES[Math.floor(Math.random() * 4)];
    S.prizes.push({ type, x: rand(CHUTE_X + 70, BOX.x + BOX.w - 40), y: FLOOR - rand(0, 26), r: type.rare ? 22 : 20 });
  }
  for (let i = 0; i < 12; i++) addPrize();

  function nextDrop() {
    const c = S.claw;
    if (c.state !== 'idle' || !S.queue.length) return;
    const d = S.queue.shift();
    Object.assign(c, { state: 'move', user: d.user, strength: d.strength, target: S.prizes[Math.floor(Math.random() * S.prizes.length)] ?? null, held: null });
    S.drops++;
  }

  const actions = {
    DROP_CLAW: (ev) => {
      const strength = clamp(Number(ev.value) / Math.max(1, ev.repeatCount || 1) || 1, 1, 5);
      for (let i = 0; i < clamp(ev.repeatCount || 1, 1, 10) && S.queue.length < 30; i++) S.queue.push({ user: ev.user, strength });
    },
  };
  const sounds = { DROP_CLAW: 'blip' };

  function update(dt) {
    fxp.update(dt);
    const c = S.claw;
    const tx = c.target ? c.target.x : BOX.x + BOX.w / 2;
    if (c.state === 'idle') nextDrop();
    else if (c.state === 'move') { c.x += clamp(tx - c.x, -260 * dt, 260 * dt); if (Math.abs(tx - c.x) < 2) c.state = 'down'; }
    else if (c.state === 'down') { c.y += 280 * dt; if (c.y >= (c.target ? c.target.y - 28 : FLOOR - 30)) { c.state = 'grab'; c.t = 0.5; } }
    else if (c.state === 'grab') {
      c.open = Math.max(0, c.open - dt * 3);
      c.t -= dt;
      if (c.t <= 0) {
        const chance = clamp(0.2 + 0.15 * c.strength, 0.2, 0.95) * (c.target?.type.rare ? 0.5 : 1);
        if (c.target && S.prizes.includes(c.target) && Math.random() < chance) { c.held = c.target; S.prizes.splice(S.prizes.indexOf(c.target), 1); }
        c.state = 'up';
      }
    } else if (c.state === 'up') {
      c.y -= 240 * dt;
      if (c.held && Math.random() < dt * 0.15 * (6 - c.strength) / 5) { c.held.y = c.y + 30; S.prizes.push(c.held); c.held = null; api.sfx('bad'); } // slip!
      if (c.y <= RAIL_Y) { c.y = RAIL_Y; c.state = 'return'; }
    } else if (c.state === 'return') {
      c.x += clamp(CHUTE_X - c.x, -260 * dt, 260 * dt);
      if (Math.abs(CHUTE_X - c.x) < 2) {
        c.open = 1;
        if (c.held) {
          const name = c.held.type.name[api.lang === 'ar' ? 1 : 0];
          S.winners.unshift({ user: c.user, prize: name, color: c.held.type.color });
          S.winners.length = Math.min(S.winners.length, 4);
          fxp.burst(CHUTE_X, BOX.y + BOX.h, c.held.type.color, 40, 300);
          api.banner(t('WINNER!', 'فاز!'), t(`@${c.user} grabbed a ${name}`, `@${c.user} فاز بـ ${name}`), c.held.type.rare ? GOLD : '#f472b6', 2800);
          api.sfx('win');
          if (c.held.type.rare || Math.random() < 0.5) api.announce(t(`${c.user} grabbed a ${name}!`, `${c.user} فاز بـ ${name}!`));
          c.held = null;
          addPrize();
        } else api.sfx('bad');
        c.state = 'pause'; c.t = 0.8;
      }
    } else if (c.state === 'pause') { c.t -= dt; if (c.t <= 0) c.state = 'idle'; }
    if (c.state === 'move' || c.state === 'down') c.open = Math.min(1, c.open + dt * 3);
    const wins = S.winners.map((w) => `<div class="sub" style="text-transform:none;font-size:.62em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:14em">@${api.esc(w.user)} · <b style="color:${w.color}">${api.esc(w.prize)}</b></div>`).join('');
    api.setHud(`<div class="sub">${t('Claws waiting', 'بانتظار المخلب')}</div><div class="big">${api.icon('magnet')}${S.queue.length + (c.state === 'idle' ? 0 : 1)}</div>${wins}`);
  }

  function drawPrize(ctx, p, x = p.x, y = p.y) {
    const col = p.type.color;
    ctx.fillStyle = col;
    if (p.type.id === 'star' || p.type.id === 'crown') {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? p.r * 0.45 : p.r; const a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      ctx.fill();
      if (p.type.id === 'crown') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    } else if (p.type.id === 'heart') {
      ctx.beginPath(); ctx.moveTo(x, y + p.r * 0.8); ctx.bezierCurveTo(x - p.r * 1.4, y - p.r * 0.2, x - p.r * 0.5, y - p.r * 1.1, x, y - p.r * 0.35); ctx.bezierCurveTo(x + p.r * 0.5, y - p.r * 1.1, x + p.r * 1.4, y - p.r * 0.2, x, y + p.r * 0.8); ctx.fill();
    } else if (p.type.id === 'gem') {
      ctx.beginPath(); ctx.moveTo(x, y - p.r); ctx.lineTo(x + p.r, y - p.r * 0.2); ctx.lineTo(x, y + p.r); ctx.lineTo(x - p.r, y - p.r * 0.2); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x - p.r * 0.7, y - p.r * 0.75, p.r * 0.38, 0, Math.PI * 2); ctx.arc(x + p.r * 0.7, y - p.r * 0.75, p.r * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.arc(x - 6, y - 3, 2.5, 0, Math.PI * 2); ctx.arc(x + 6, y - 3, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function draw(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1e1b4b'); g.addColorStop(1, '#0f0a24'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // cabinet
    api.roundRect(ctx, BOX.x - 14, BOX.y - 60, BOX.w + 28, BOX.h + 90, 22); ctx.fillStyle = '#db2777'; ctx.fill();
    text(ctx, 'CLAW', W / 2, BOX.y - 30, { size: 30, color: '#fff', weight: 900 });
    ctx.fillStyle = 'rgba(15,23,42,.92)'; ctx.fillRect(BOX.x, BOX.y, BOX.w, BOX.h);
    ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(BOX.x + 10, BOX.y + 10, 40, BOX.h - 20);
    ctx.fillStyle = '#334155'; ctx.fillRect(BOX.x, RAIL_Y - 6, BOX.w, 6);
    ctx.fillStyle = '#020617'; ctx.fillRect(CHUTE_X - 36, FLOOR - 30, 72, 50);
    text(ctx, t('PRIZES', 'جوائز'), CHUTE_X, FLOOR - 4, { size: 11, color: '#94a3b8', weight: 700 });
    for (const p of S.prizes) drawPrize(ctx, p);
    // claw
    const c = S.claw;
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(c.x, RAIL_Y); ctx.lineTo(c.x, c.y); ctx.stroke();
    ctx.fillStyle = '#cbd5e1'; ctx.fillRect(c.x - 16, c.y - 6, 32, 12);
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(c.x + s * 12, c.y + 4); ctx.lineTo(c.x + s * (12 + 14 * c.open), c.y + 26); ctx.lineTo(c.x + s * (4 + 10 * c.open), c.y + 40); ctx.stroke(); }
    if (c.held) drawPrize(ctx, c.held, c.x, c.y + 38);
    if (c.user && c.state !== 'idle') text(ctx, '@' + c.user, c.x, RAIL_Y - 22, { size: 14, color: '#fde68a', max: 200 });
    if (!S.queue.length && c.state === 'idle') text(ctx, t('Send a gift to drop the claw!', 'أرسل هدية لإنزال المخلب!'), W / 2, BOX.y + 120, { size: 20, color: '#f9a8d4' });
    fxp.draw(ctx);
  }

  return { actions, sounds, update, draw };
}
