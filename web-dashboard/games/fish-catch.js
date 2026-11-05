// Fish Catch: gifts (or free !fish casts) catch a random fish for the sender; luck = rarer fish.
// Leaderboard of the biggest catches.
import { text, particles, GOLD } from './_lib.js';

export default function create(api) {
  const { W, H, clamp, rand, t } = api;
  const WATER_Y = 600, ROD_X = 120, ROD_Y = 560;
  const TIERS = [
    // [english, arabic, turkish] names; weights in kg
    { id: 'common', w: 55, color: '#94a3b8', label: ['Common', 'عادية', 'sıradan'], fish: [[['Minnow', 'سمكة صغيرة', 'Gümüş balığı'], 0.1, 0.6], [['Sardine', 'سردين', 'Sardalya'], 0.2, 0.9]] },
    { id: 'uncommon', w: 25, color: '#4ade80', label: ['Uncommon', 'غير شائعة', 'nadir olmayan'], fish: [[['Bass', 'قاروص', 'Levrek'], 1, 4], [['Trout', 'سلمون مرقط', 'Alabalık'], 1, 5]] },
    { id: 'rare', w: 13, color: '#38bdf8', label: ['Rare', 'نادرة', 'nadir'], fish: [[['Salmon', 'سلمون', 'Somon'], 3, 12], [['Tuna', 'تونة', 'Ton balığı'], 6, 25]] },
    { id: 'epic', w: 5.5, color: '#c084fc', label: ['Epic', 'ملحمية', 'destansı'], fish: [[['Swordfish', 'سمكة أبو سيف', 'Kılıç balığı'], 30, 90], [['Shark', 'قرش', 'Köpek balığı'], 60, 200]] },
    { id: 'legendary', w: 1.5, color: GOLD, label: ['Legendary', 'أسطورية', 'efsanevi'], fish: [[['Golden Koi', 'كوي ذهبية', 'Altın Koi'], 8, 30]] },
  ];
  const fxp = particles(api);
  const S = { queue: [], cast: null, board: [], total: 0, swim: Array.from({ length: 7 }, () => ({ x: rand(0, W), y: rand(WATER_Y + 40, 840), v: rand(30, 70) * (Math.random() < 0.5 ? -1 : 1), s: rand(0.6, 1.2) })) };

  function roll(luck) {
    const weights = TIERS.map((tier, i) => tier.w * (i === 0 ? 1 / (1 + luck * 0.3) : 1 + luck * 0.35 * i));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0), i = 0;
    while (r > weights[i]) r -= weights[i++];
    const tier = TIERS[Math.min(i, TIERS.length - 1)];
    const [names, lo, hi] = tier.fish[Math.floor(Math.random() * tier.fish.length)];
    return { tier, name: t(...names), kg: Math.round(rand(lo, hi) * 10) / 10 };
  }
  function next() {
    if (S.cast || !S.queue.length) return;
    const q = S.queue.shift();
    S.cast = { ...q, t: 0, catch: roll(q.luck * api.num('luck', 100, 0, 500) / 100), bobX: rand(250, 430) };
  }

  const actions = {
    CAST: (ev) => {
      const luck = clamp(Number(ev.value) / Math.max(1, ev.repeatCount || 1) || 1, 0, 20);
      for (let i = 0; i < clamp(ev.repeatCount || 1, 1, 10) && S.queue.length < 30; i++) S.queue.push({ user: ev.user, luck });
      next();
    },
  };
  const sounds = { CAST: () => api.tone({ type: 'sine', f0: 900, f1: 300, dur: 0.35, vol: 0.2 }) };

  function update(dt) {
    fxp.update(dt);
    for (const f of S.swim) { f.x += f.v * dt; if (f.x < -40) f.x = W + 40; if (f.x > W + 40) f.x = -40; }
    const c = S.cast;
    if (c) {
      c.t += dt * api.num('castTime', 100, 40, 300) / 100;
      if (c.t > 1.0 && !c.splash) { c.splash = true; fxp.burst(c.bobX, WATER_Y, '#bae6fd', 14, 160); api.sfx('splash'); }
      if (c.t > 2.4 && !c.landed) {
        c.landed = true;
        const k = c.catch;
        S.total += k.kg;
        S.board.push({ user: c.user, ...k });
        S.board.sort((a, b) => b.kg - a.kg);
        S.board.length = Math.min(S.board.length, 5);
        const tierName = t(...k.tier.label);
        api.banner(`${k.name} · ${k.kg} kg`, t(`@${c.user} caught a ${tierName} fish!`, `@${c.user} اصطاد سمكة ${tierName}!`, `@${c.user} ${tierName} bir balık tuttu!`), k.tier.color, 2600);
        api.sfx(['epic', 'legendary'].includes(k.tier.id) ? 'win' : 'good');
        fxp.burst(c.bobX, WATER_Y - 80, k.tier.color, ['epic', 'legendary'].includes(k.tier.id) ? 60 : 20, 260);
        if (['rare', 'epic', 'legendary'].includes(k.tier.id)) api.announce(t(`${c.user} caught a ${tierName} ${k.name}, ${k.kg} kilos!`, `${c.user} اصطاد ${k.name} ${tierName} بوزن ${k.kg} كيلو!`, `${c.user} ${tierName} bir ${k.name} tuttu, ${k.kg} kilo!`));
        api.reportScore(k.kg);
      }
      if (c.t > 3.6) { S.cast = null; next(); }
    } else next();
    const board = S.board.slice(0, api.num('boardSize', 3, 0, 5)).map((b, i) => `<div class="sub" style="text-transform:none;font-size:.62em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:14em">${i + 1}. @${api.esc(b.user)} · <b style="color:${b.tier.color}">${api.esc(b.name)} ${b.kg}kg</b></div>`).join('');
    api.setHud(`<div class="sub">${t('Biggest catches', 'أكبر صيد', 'En büyük avlar')}</div><div class="big">${api.icon('fish')}${S.queue.length + (S.cast ? 1 : 0)}</div>${board}`);
  }

  function drawFish(ctx, x, y, s, color, dir = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir * s, s);
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(0, 0, 26, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-38, -12); ctx.lineTo(-38, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.arc(14, -3, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function draw(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, WATER_Y); g.addColorStop(0, '#0c4a6e'); g.addColorStop(1, '#fdba74'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, WATER_Y);
    ctx.fillStyle = 'rgba(253,224,71,.8)'; ctx.beginPath(); ctx.arc(W - 120, WATER_Y - 10, 50, Math.PI, 0); ctx.fill();
    const wg = ctx.createLinearGradient(0, WATER_Y, 0, H); wg.addColorStop(0, '#0e7490'); wg.addColorStop(1, '#082f49'); ctx.fillStyle = wg; ctx.fillRect(0, WATER_Y, W, H - WATER_Y);
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) { const y = WATER_Y + 14 + i * 30; ctx.beginPath(); for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + Math.sin(x / 40 + api.now * 2 + i) * 3); ctx.stroke(); }
    if (api.flag('showSwimmers')) for (const f of S.swim) { ctx.globalAlpha = 0.35; drawFish(ctx, f.x, f.y, f.s, '#7dd3fc', Math.sign(f.v)); }
    ctx.globalAlpha = 1;
    // dock + fisher
    ctx.fillStyle = '#78350f'; ctx.fillRect(0, ROD_Y + 30, 170, 18);
    ctx.fillStyle = '#92400e'; for (let x = 10; x < 170; x += 40) ctx.fillRect(x, ROD_Y + 48, 10, 70);
    ctx.fillStyle = '#25f4ee'; ctx.beginPath(); ctx.arc(70, ROD_Y - 10, 16, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(58, ROD_Y + 4, 24, 28);
    const c = S.cast;
    const tipX = ROD_X + 40, tipY = ROD_Y - 70;
    ctx.strokeStyle = '#a16207'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(80, ROD_Y + 10); ctx.lineTo(tipX, tipY); ctx.stroke();
    if (c) {
      const k = Math.min(1, c.t / 1.0);
      const bx = tipX + (c.bobX - tipX) * k, by = c.t < 1 ? tipY + (WATER_Y - tipY) * k - Math.sin(k * Math.PI) * 120 : WATER_Y + Math.sin(c.t * 18) * (c.t > 1.6 ? 6 : 2);
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
      if (c.t > 2.4) { const up = Math.min(1, (c.t - 2.4) / 0.5); drawFish(ctx, c.bobX, WATER_Y - up * 90, 1.6 + (c.catch.tier.id === 'legendary' ? 0.6 : 0), c.catch.tier.color, 1); }
      if (api.showNames) text(ctx, '@' + c.user, c.bobX, WATER_Y - 150, { size: 16, color: '#fef3c7', max: 220 });
    } else if (!S.queue.length) text(ctx, t('Type !fish to cast for free!', 'اكتب !fish لرمية مجانية!', 'Ücretsiz atış için !fish yaz!'), W / 2, WATER_Y + 120, { size: 22, color: '#bae6fd' });
    text(ctx, t(`Total caught: ${S.total.toFixed(1)} kg`, `مجموع الصيد: ${S.total.toFixed(1)} كغ`, `Toplam av: ${S.total.toFixed(1)} kg`), W / 2, 840, { size: 16, color: '#7dd3fc', weight: 700 });
    fxp.draw(ctx);
  }

  return { actions, sounds, update, draw };
}
