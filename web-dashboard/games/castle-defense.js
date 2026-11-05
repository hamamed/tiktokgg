// Castle Defense: monsters march down in waves; gifts send more monsters or help defend.
import { text, sky, particles, GOLD } from './_lib.js';

export default function create(api) {
  const { W, H, clamp, rand, t } = api;
  const WALL_Y = 770, SPAWN_Y = 330;
  const fxp = particles();
  const S = { hp: 100, wave: 1, kills: 0, monsters: [], arrows: [], toSpawn: 0, spawnIn: 1, waveDelay: 2, shield: 0, dragon: null, gameOver: 0, turretIn: 1.2, best: 0, flash: 0 };

  function spawn(kind = 'imp', by = null) {
    const big = kind === 'ogre';
    S.monsters.push({ kind, x: rand(70, W - 70), y: SPAWN_Y + rand(-30, 30), hp: big ? 6 : 1, max: big ? 6 : 1, speed: big ? rand(26, 34) : rand(42, 62) * (1 + S.wave * 0.04), by, wob: rand(0, 6) });
  }
  function shoot(n = 1, by = null) {
    const targets = [...S.monsters].sort((a, b) => b.y - a.y);
    for (let i = 0; i < n; i++) {
      const m = targets[i % Math.max(1, targets.length)];
      const tx = m ? m.x : rand(80, W - 80), ty = m ? m.y : SPAWN_Y;
      const sx = W / 2 + rand(-120, 120), sy = WALL_Y - 30;
      const d = Math.hypot(tx - sx, ty - sy) || 1;
      S.arrows.push({ x: sx, y: sy, vx: ((tx - sx) / d) * 700, vy: ((ty - sy) / d) * 700, life: 1.6, by });
    }
  }
  function kill(m) {
    m.dead = true;
    S.kills++;
    fxp.burst(m.x, m.y, m.kind === 'ogre' ? '#f87171' : '#a3e635', m.kind === 'ogre' ? 30 : 12, 200);
  }
  function fall() {
    S.gameOver = 5;
    S.best = Math.max(S.best, S.wave);
    const mvp = api.mvp();
    api.banner(t('THE CASTLE FELL', 'سقطت القلعة'), t(`Wave ${S.wave}${mvp ? ` · MVP @${mvp.user}` : ''}`, `الموجة ${S.wave}${mvp ? ` · الأفضل @${mvp.user}` : ''}`), '#f87171', 4500);
    api.sfx('boom');
    api.reportScore(S.wave);
    api.announce(t(`The castle fell at wave ${S.wave}!${mvp ? ` Thank you ${mvp.user} for the support!` : ''} Let's defend again!`, `سقطت القلعة في الموجة ${S.wave}!${mvp ? ` شكراً ${mvp.user} على الدعم!` : ''} لندافع من جديد!`));
  }

  const actions = {
    SPAWN_MONSTERS: (ev) => { for (let i = 0; i < clamp(Math.round(ev.value) || 1, 1, 40); i++) spawn('imp', ev.user); },
    BIG_MONSTER: (ev) => { for (let i = 0; i < clamp(Math.round(ev.value) || 1, 1, 10); i++) spawn('ogre', ev.user); api.banner(t('OGRE!', 'غول!'), t(`sent by @${ev.user}`, `من @${ev.user}`), '#f87171', 1800); },
    ARROW_VOLLEY: (ev) => shoot(clamp(Math.round(ev.value) || 1, 1, 60), ev.user),
    DRAGON: (ev) => { S.dragon = { x: -120, by: ev.user, times: clamp(Math.round(ev.value) || 1, 1, 3) }; api.banner(t('DRAGON FIRE!', 'نار التنين!'), t(`called by @${ev.user}`, `استدعاه @${ev.user}`), '#fb923c', 2200); },
    SHIELD: (ev) => { S.shield = Math.max(S.shield, api.now) + clamp(ev.value || 5, 1, 60); },
    REPAIR: (ev) => { if (S.gameOver <= 0) { S.hp = clamp(S.hp + (Number(ev.value) || 10), 0, 100); fxp.burst(W / 2, WALL_Y, '#6ee7b7', 24, 160); } },
  };
  const sounds = {
    SPAWN_MONSTERS: () => api.tone({ type: 'square', f0: 140, f1: 90, dur: 0.25, vol: 0.2 }),
    BIG_MONSTER: () => api.tone({ type: 'sawtooth', f0: 80, f1: 50, dur: 0.9, vol: 0.4 }),
    ARROW_VOLLEY: () => { for (let i = 0; i < 3; i++) api.noise({ dur: 0.08, vol: 0.3, freq: 3000, delay: i * 0.06 }); },
    DRAGON: () => { api.noise({ dur: 1.2, vol: 0.8, freq: 700 }); api.tone({ type: 'sawtooth', f0: 120, f1: 300, dur: 1, vol: 0.25 }); },
    SHIELD: 'whoosh', REPAIR: 'good',
  };

  function update(dt) {
    fxp.update(dt);
    S.flash = Math.max(0, S.flash - dt);
    if (S.gameOver > 0) {
      S.gameOver -= dt;
      if (S.gameOver <= 0) { Object.assign(S, { hp: 100, wave: 1, kills: 0, monsters: [], arrows: [], toSpawn: 0, waveDelay: 2 }); api.resetRound(); api.banner(t('WAVE 1', 'الموجة 1'), '', GOLD, 1500); }
      return;
    }
    // waves
    if (S.toSpawn <= 0 && !S.monsters.length) {
      S.waveDelay -= dt;
      if (S.waveDelay <= 0) { if (S.kills > 0) S.wave++; S.toSpawn = 3 + S.wave * 2; S.waveDelay = 3; api.banner(t(`WAVE ${S.wave}`, `الموجة ${S.wave}`), '', GOLD, 1500); }
    }
    if (S.toSpawn > 0) { S.spawnIn -= dt; if (S.spawnIn <= 0) { spawn(Math.random() < Math.min(0.25, S.wave * 0.03) ? 'ogre' : 'imp'); S.toSpawn--; S.spawnIn = rand(0.5, 1.3); } }
    // turret
    S.turretIn -= dt;
    if (S.turretIn <= 0 && S.monsters.length) { shoot(1); S.turretIn = 1.3; }
    // dragon sweeps across, burning everything
    if (S.dragon) {
      S.dragon.x += 520 * dt;
      for (const m of S.monsters) if (!m.dead && Math.abs(m.x - S.dragon.x) < 40) kill(m);
      if (S.dragon.x > W + 120) { S.dragon.times--; S.dragon = S.dragon.times > 0 ? { ...S.dragon, x: -120 } : null; }
    }
    for (const a of S.arrows) {
      a.x += a.vx * dt; a.y += a.vy * dt; a.life -= dt;
      for (const m of S.monsters) if (!m.dead && Math.hypot(m.x - a.x, m.y - a.y) < (m.kind === 'ogre' ? 30 : 20)) { a.life = 0; m.hp--; if (m.hp <= 0) kill(m); break; }
    }
    S.arrows = S.arrows.filter((a) => a.life > 0);
    for (const m of S.monsters) {
      if (m.dead) continue;
      m.y += m.speed * dt;
      if (m.y >= WALL_Y - 20) {
        m.dead = true;
        if (S.shield > api.now) fxp.burst(m.x, WALL_Y - 20, '#7dd3fc', 10, 140);
        else { S.hp = clamp(S.hp - (m.kind === 'ogre' ? 15 : 5), 0, 100); S.flash = 0.25; api.sfx('hit'); if (S.hp <= 0) fall(); }
      }
    }
    S.monsters = S.monsters.filter((m) => !m.dead);
    const hpColor = S.hp > 50 ? '#22c55e' : S.hp > 25 ? '#f59e0b' : '#ef4444';
    api.setHud(
      `<div class="sub">${t('Wave', 'الموجة')}</div><div class="big">${api.icon('swords')}${S.wave}</div><div class="sub">${t('Kills', 'القتلى')} ${S.kills} · ${t('Best', 'الأفضل')} ${Math.max(S.best, S.wave)}</div>`,
      `<div class="sub" style="display:flex;justify-content:space-between"><span>${t('Walls', 'الأسوار')}</span><span>${Math.ceil(S.hp)}</span></div><div class="bar"><i style="width:${S.hp}%;background:${hpColor}"></i></div>`,
    );
    api.setEffects(S.shield > api.now ? [{ icon: 'shield', color: '#7dd3fc', label: t('Shield', 'الدرع'), secs: S.shield - api.now }] : []);
  }

  function drawMonster(ctx, m) {
    const big = m.kind === 'ogre', r = big ? 30 : 18;
    const bob = Math.sin(api.now * 8 + m.wob) * 3;
    ctx.fillStyle = big ? '#b91c1c' : '#65a30d';
    ctx.beginPath(); ctx.arc(m.x, m.y + bob, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(m.x - r * 0.35, m.y - r * 0.2 + bob, r * 0.22, 0, Math.PI * 2); ctx.arc(m.x + r * 0.35, m.y - r * 0.2 + bob, r * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(m.x - r * 0.35, m.y - r * 0.15 + bob, r * 0.1, 0, Math.PI * 2); ctx.arc(m.x + r * 0.35, m.y - r * 0.15 + bob, r * 0.1, 0, Math.PI * 2); ctx.fill();
    if (big) { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(m.x - 26, m.y - 46, 52, 6); ctx.fillStyle = '#f87171'; ctx.fillRect(m.x - 26, m.y - 46, 52 * (m.hp / m.max), 6); }
    if (m.by) text(ctx, '@' + m.by.slice(0, 12), m.x, m.y + r + 12, { size: 12, color: '#e2e8f0', weight: 600 });
  }

  function draw(ctx) {
    sky(ctx, W, H, '#1a1033', '#2b1838');
    // hills
    ctx.fillStyle = '#1f2937';
    ctx.beginPath(); ctx.moveTo(0, 420); for (let x = 0; x <= W; x += 30) ctx.lineTo(x, 400 + Math.sin(x / 70) * 20); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.fillStyle = '#243042'; ctx.fillRect(0, 430, W, WALL_Y - 430);
    for (const m of S.monsters) drawMonster(ctx, m);
    ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 3;
    for (const a of S.arrows) { const d = Math.hypot(a.vx, a.vy); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - (a.vx / d) * 18, a.y - (a.vy / d) * 18); ctx.stroke(); }
    // castle wall
    ctx.fillStyle = S.flash > 0 ? '#7f1d1d' : '#475569';
    ctx.fillRect(0, WALL_Y, W, 100);
    for (let x = 0; x < W; x += 54) ctx.fillRect(x, WALL_Y - 22, 32, 24);
    ctx.fillStyle = '#334155';
    for (let y = WALL_Y + 12; y < WALL_Y + 100; y += 24) for (let x = (y / 24) % 2 ? 0 : 27; x < W; x += 54) ctx.fillRect(x, y, 50, 2);
    ctx.fillStyle = '#64748b'; ctx.fillRect(W / 2 - 46, WALL_Y - 70, 92, 70); ctx.fillStyle = '#1e293b'; ctx.fillRect(W / 2 - 16, WALL_Y - 40, 32, 40);
    if (S.shield > api.now) { ctx.strokeStyle = 'rgba(125,211,252,.7)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(W / 2, WALL_Y + 30, W / 2 + 20, 90, 0, Math.PI, 0); ctx.stroke(); }
    if (S.dragon) {
      const d = S.dragon, y = 520;
      ctx.fillStyle = '#ea580c'; ctx.beginPath(); ctx.ellipse(d.x, y, 60, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9a3412'; ctx.beginPath(); ctx.moveTo(d.x - 10, y); ctx.lineTo(d.x - 50, y - 60 + Math.sin(api.now * 20) * 20); ctx.lineTo(d.x + 30, y - 6); ctx.fill();
      const g = ctx.createLinearGradient(d.x, y, d.x, WALL_Y); g.addColorStop(0, 'rgba(251,146,60,.8)'); g.addColorStop(1, 'rgba(251,146,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(d.x + 40, y); ctx.lineTo(d.x + 10, WALL_Y); ctx.lineTo(d.x + 90, WALL_Y); ctx.fill();
    }
    fxp.draw(ctx);
  }

  return { actions, sounds, update, draw };
}
