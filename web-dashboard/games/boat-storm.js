// Boat Storm: a little boat crosses a stormy sea. Gifts bring waves, lightning and a whale,
// or a sail boost, repairs and calm water. Distance sailed is the score.
import { text, particles, GOLD } from './_lib.js';

export default function create(api) {
  const { W, H, clamp, rand, t } = api;
  const SEA_Y = 660, BOAT_X = W / 2;
  const fxp = particles(api);
  const rain = Array.from({ length: 90 }, () => ({ x: rand(0, W), y: rand(0, H), s: rand(500, 800) }));
  const S = { hp: 100, dist: 0, best: 0, boost: 0, calm: 0, swell: 0, waves: [], bolts: [], whale: null, sinking: 0, tilt: 0, flash: 0 };
  const calm = () => S.calm > api.now;
  const hull = () => api.num('hullHp', 100, 20, 2000);
  const pct = (n) => (n * 100) / hull(); // hull is kept as a percentage
  const storm = () => ({ light: 0.45, wild: 1.8 }[api.options.storm] ?? 1);

  function damage(n, by) {
    if (S.sinking > 0 || calm()) return;
    S.hp = clamp(S.hp - pct(n), 0, 100);
    fxp.burst(BOAT_X, boatY(), '#e2e8f0', 14, 200);
    if (S.hp <= 0) sink(by);
  }
  function sink() {
    S.sinking = S.sinkLen = api.num('roundPause', 4.5, 2, 30);
    S.best = Math.max(S.best, Math.floor(S.dist));
    const mvp = api.mvp();
    api.banner(t('THE BOAT SANK', 'غرق القارب', 'TEKNE BATTI'), t(`${Math.floor(S.dist)} m${mvp ? ` · MVP @${mvp.user}` : ''}`, `${Math.floor(S.dist)} م${mvp ? ` · الأفضل @${mvp.user}` : ''}`, `${Math.floor(S.dist)} m${mvp ? ` · MVP @${mvp.user}` : ''}`), '#38bdf8', 4000);
    api.sfx('boom');
    api.reportScore(S.dist);
    api.announce(t(`The boat sank after ${Math.floor(S.dist)} meters!${mvp ? ` Thanks ${mvp.user}!` : ''} New boat, set sail!`, `غرق القارب بعد ${Math.floor(S.dist)} متر!${mvp ? ` شكراً ${mvp.user}!` : ''} قارب جديد، أبحروا!`, `Tekne ${Math.floor(S.dist)} metre sonra battı!${mvp ? ` Teşekkürler ${mvp.user}!` : ''} Yeni tekne, yelken açın!`));
  }
  const waveAt = (x) => Math.sin(x / 60 + api.now * 2) * (10 + S.swell * 20) + Math.sin(x / 23 - api.now * 3) * 4;
  const boatY = () => SEA_Y + waveAt(BOAT_X) - 10 + (S.sinking > 0 ? Math.min(4.5, (S.sinkLen || 4.5) - S.sinking) * 40 : 0);

  const actions = {
    WAVE: (ev) => { const size = clamp(Number(ev.value) || 1, 1, 10); S.waves.push({ x: W + 60, size, by: ev.user, hit: false }); },
    LIGHTNING: (ev) => { for (let i = 0; i < clamp(Math.round(ev.value) || 1, 1, 8); i++) S.bolts.push({ in: i * 0.45, by: ev.user }); },
    WHALE: (ev) => { S.whale = { t: 0, by: ev.user }; api.banner(t('WHALE!', 'حوت!', 'BALİNA!'), t(`sent by @${ev.user}`, `من @${ev.user}`, `gönderen @${ev.user}`), '#818cf8', 1800); },
    SAIL_BOOST: (ev) => { S.boost = Math.max(S.boost, api.now) + clamp(ev.value || 3, 1, 60); },
    REPAIR: (ev) => { if (S.sinking <= 0) { S.hp = clamp(S.hp + pct(Number(ev.value) || 10), 0, 100); fxp.burst(BOAT_X, boatY(), '#6ee7b7', 20, 150); } },
    CALM_SEA: (ev) => { S.calm = Math.max(S.calm, api.now) + clamp(ev.value || 10, 1, 120); },
  };
  const sounds = {
    WAVE: 'splash', LIGHTNING: () => { api.noise({ dur: 0.6, vol: 0.9, freq: 2500 }); api.tone({ type: 'sawtooth', f0: 70, f1: 40, dur: 0.9, vol: 0.3, delay: 0.1 }); },
    WHALE: () => api.tone({ type: 'sine', f0: 180, f1: 90, dur: 1.4, vol: 0.4 }), SAIL_BOOST: 'whoosh', REPAIR: 'good', CALM_SEA: 'good',
  };

  function update(dt) {
    fxp.update(dt);
    S.flash = Math.max(0, S.flash - dt);
    S.swell += ((calm() ? 0 : (0.6 + Math.min(1.4, S.dist / 3000)) * storm()) - S.swell) * dt * 0.5;
    for (const r of rain) { r.y += r.s * dt * (calm() ? 0.2 : 1); r.x -= 120 * dt; if (r.y > H) { r.y = -10; r.x = rand(0, W + 100); } }
    if (S.sinking > 0) {
      S.sinking -= dt;
      if (S.sinking <= 0) { Object.assign(S, { hp: 100, dist: 0, waves: [], bolts: [], whale: null }); api.resetRound(); api.banner(t('SET SAIL!', 'أبحروا!', 'YELKEN AÇ!'), '', GOLD, 1500); }
    } else {
      S.dist += (S.boost > api.now ? api.num('boostSpeed', 16, 1, 100) : api.num('sailSpeed', 7, 1, 50)) * dt;
      if (!calm() && api.flag('ambientWaves') && Math.random() < dt * 0.25 * storm()) S.waves.push({ x: W + 60, size: 1, by: null, hit: false }); // small ambient waves
    }
    for (const w of S.waves) {
      w.x -= (220 + w.size * 20) * dt;
      if (!w.hit && Math.abs(w.x - BOAT_X) < 30) { w.hit = true; S.tilt = 0.35 * Math.min(3, w.size); if (w.size > 1 || !calm()) damage(api.num('waveDamage', 4, 0, 500) * w.size, w.by); }
    }
    S.waves = S.waves.filter((w) => w.x > -100);
    for (const b of S.bolts) {
      b.in -= dt;
      if (b.in <= 0 && !b.done) { b.done = true; b.show = 0.25; S.flash = 0.2; if (!calm()) damage(api.num('lightningDamage', 10, 0, 500), b.by); else fxp.burst(BOAT_X, boatY() - 120, '#fde047', 10, 120); }
      if (b.show) b.show -= dt;
    }
    S.bolts = S.bolts.filter((b) => !b.done || b.show > 0);
    if (S.whale) {
      S.whale.t += dt;
      if (!S.whale.hit && S.whale.t > 1.2) { S.whale.hit = true; S.tilt = 0.8; damage(api.num('whaleDamage', 20, 0, 500), S.whale.by); }
      if (S.whale.t > 3) S.whale = null;
    }
    S.tilt *= Math.pow(0.15, dt);
    const hpColor = S.hp > 50 ? '#22c55e' : S.hp > 25 ? '#f59e0b' : '#ef4444';
    api.setHud(
      `<div class="sub">${t('Sailed', 'المسافة', 'Yol')}</div><div class="big">${api.icon('sailboat')}${Math.floor(S.dist).toLocaleString()} m</div><div class="sub">${t('Best', 'الأفضل', 'En iyi')} ${Math.max(S.best, Math.floor(S.dist)).toLocaleString()} m</div>`,
      `<div class="sub" style="display:flex;justify-content:space-between"><span>${t('Hull', 'الهيكل', 'Gövde')}</span><span>${Math.ceil((S.hp * hull()) / 100)}</span></div><div class="bar"><i style="width:${S.hp}%;background:${hpColor}"></i></div>`,
    );
    const eff = [];
    if (S.boost > api.now) eff.push({ icon: 'wind', color: '#fcd34d', label: t('Sail boost', 'دفع الشراع', 'Yelken gücü'), secs: S.boost - api.now });
    if (calm()) eff.push({ icon: 'sun', color: '#fdba74', label: t('Calm sea', 'بحر هادئ', 'Sakin deniz'), secs: S.calm - api.now });
    api.setEffects(eff);
  }

  function draw(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, SEA_Y);
    if (calm()) { g.addColorStop(0, '#1e3a8a'); g.addColorStop(1, '#f59e0b'); } else { g.addColorStop(0, '#0f172a'); g.addColorStop(1, '#334155'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (calm()) { ctx.fillStyle = 'rgba(253,224,71,.85)'; ctx.beginPath(); ctx.arc(W / 2, SEA_Y - 40, 60, Math.PI, 0); ctx.fill(); }
    if (S.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${S.flash * 2})`; ctx.fillRect(0, 0, W, H); }
    for (const b of S.bolts.filter((x) => x.show > 0)) {
      ctx.strokeStyle = '#fde047'; ctx.lineWidth = 5; ctx.beginPath();
      let x = BOAT_X + rand(-30, 30), y = 380; ctx.moveTo(x, y);
      while (y < boatY() - 60) { x += rand(-25, 25); y += rand(30, 50); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // whale
    if (S.whale) {
      const k = S.whale.t, x = BOAT_X + 90 - k * 40, y = SEA_Y + 40 - Math.sin(Math.min(Math.PI, k * 1.6)) * 130;
      ctx.fillStyle = '#4f46e5'; ctx.beginPath(); ctx.ellipse(x, y, 90, 40, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c7d2fe'; ctx.beginPath(); ctx.ellipse(x + 10, y + 18, 60, 16, -0.3, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - 50, y - 10, 6, 0, Math.PI * 2); ctx.fill();
    }
    // boat
    const by = boatY();
    ctx.save(); ctx.translate(BOAT_X, by); ctx.rotate(Math.sin(api.now * 2) * 0.06 + S.tilt);
    ctx.fillStyle = '#92400e'; ctx.beginPath(); ctx.moveTo(-70, 0); ctx.lineTo(70, 0); ctx.lineTo(48, 34); ctx.lineTo(-48, 34); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#78350f'; ctx.fillRect(-3, -110, 6, 110);
    ctx.fillStyle = S.boost > api.now ? '#fde68a' : '#f1f5f9'; ctx.beginPath(); ctx.moveTo(4, -104); ctx.quadraticCurveTo(S.boost > api.now ? 80 : 60, -60, 4, -12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fe2c55'; ctx.beginPath(); ctx.moveTo(-3, -110); ctx.lineTo(-30, -102); ctx.lineTo(-3, -94); ctx.fill();
    ctx.restore();
    // sea layers + waves
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ['rgba(14,116,144,.9)', 'rgba(8,80,110,.92)', 'rgba(7,52,80,.96)'][layer];
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 10) {
        let y = SEA_Y + layer * 40 + waveAt(x + layer * 40) * (1 - layer * 0.25);
        for (const w of S.waves) { const d = (x - w.x) / 60; y -= Math.exp(-d * d) * (24 + w.size * 18) * (1 - layer * 0.3); }
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.fill();
    }
    if (api.showNames) for (const w of S.waves) if (w.by) text(ctx, '@' + w.by.slice(0, 12), w.x, SEA_Y - 60 - w.size * 14, { size: 13, color: '#e0f2fe', weight: 600 });
    ctx.strokeStyle = 'rgba(186,230,253,.45)'; ctx.lineWidth = 1.5;
    if (api.flag('showRain')) for (const r of rain) { ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - 6, r.y + 16); ctx.stroke(); }
    fxp.draw(ctx);
  }

  return { actions, sounds, update, draw };
}
