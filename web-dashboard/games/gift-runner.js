// Gift Runner: three-lane night-highway runner. The car drives itself (or ← → / tap);
// gifts drop barriers, change speed, splash mud, reverse controls, summon a boss or heal.
export default function create(api) {
  const { W, H, clamp, rand, t } = api;
  const LANES = 3, ROAD_X = 60, ROAD_W = W - 120, LANE_W = ROAD_W / LANES;
  const laneX = (l) => ROAD_X + LANE_W * l + LANE_W / 2;
  const PLAYER_Y = H - 190, CAR_W = 70, CAR_H = 120, BASE_SPEED = 420, BOSS_Y = 330;
  const readBest = () => { try { return Number(JSON.parse(localStorage.getItem('gr.best'))) || 0; } catch { return 0; } };

  const S = {
    lane: 1, x: laneX(1), hp: 100, dist: 0, best: readBest(), invuln: 0, crashed: 0, lastHitBy: null,
    autopilot: true, aiCooldown: 0, obstacles: [], shots: [], particles: [], mud: [], stripes: 0, ambientIn: 1.2, shake: 0,
    fx: { boost: { until: 0, mul: 1 }, slow: { until: 0, mul: 1 }, reverse: { until: 0 }, mud: { until: 0 } }, boss: null,
  };
  const now = () => api.now;
  const speedMul = () => (S.fx.boost.until > now() ? S.fx.boost.mul : 1) * (S.fx.slow.until > now() ? S.fx.slow.mul : 1);
  const unit = (ev) => ev.value / Math.max(1, ev.repeatCount || 1);

  const auto = api.addTool(t('Autopilot on', 'قيادة آلية', 'Otomatik pilot açık'), 'bot', () => { S.autopilot = !S.autopilot; syncAuto(); });
  const syncAuto = () => auto.set(S.autopilot ? t('Autopilot on', 'قيادة آلية', 'Otomatik pilot açık') : t('Autopilot off', 'قيادة يدوية', 'Otomatik pilot kapalı'), 'bot');

  function spawnObstacle(y = -120, by = null) {
    const kind = Math.random() < 0.25 ? 'cone' : 'barrier';
    S.obstacles.push({ lane: (Math.random() * LANES) | 0, y, h: kind === 'cone' ? 60 : 46, kind, by });
  }
  function steer(dir) {
    if (S.crashed > 0) return;
    if (S.fx.reverse.until > now()) dir = -dir;
    S.lane = clamp(S.lane + dir, 0, LANES - 1);
  }
  function viewerSteer(dir, value) { for (let i = 0; i < clamp(Math.round(value || 1), 1, 2); i++) steer(dir); S.aiCooldown = 1.2; }
  function hurt(dmg, by) {
    if (S.invuln > 0 || S.crashed > 0) return;
    S.hp = clamp(S.hp - dmg, 0, 100);
    S.invuln = 0.9; S.shake = 0.35; S.lastHitBy = by || S.lastHitBy;
    api.sfx(S.hp <= 0 ? 'boom' : 'hit');
    for (let i = 0; i < 18; i++) S.particles.push({ x: S.x + rand(-25, 25), y: PLAYER_Y + rand(0, 40), vx: rand(-220, 220), vy: rand(-220, 40), life: 0.8, color: '#fe2c55' });
    if (S.hp <= 0) {
      S.crashed = 3;
      S.best = Math.max(S.best, Math.floor(S.dist));
      try { localStorage.setItem('gr.best', JSON.stringify(S.best)); } catch {}
      const mvp = api.mvp();
      const sub = [S.lastHitBy ? t(`taken out by @${S.lastHitBy}`, `أسقطها @${S.lastHitBy}`, `devirdi: @${S.lastHitBy}`) : '', mvp ? t(`MVP @${mvp.user} · ${mvp.diamonds.toLocaleString()} diamonds`, `الأفضل @${mvp.user}`, `MVP @${mvp.user} · ${mvp.diamonds.toLocaleString()} elmas`) : ''].filter(Boolean).join('  ·  ');
      api.banner(t('CRASHED', 'تحطمت!', 'KAZA!'), sub || t('back in 3…', 'نعود بعد 3…', '3 saniyede dönüyoruz…'), '#fe2c55', 3000);
      api.reportScore(S.dist);
      api.announce(mvp ? t(`Crash! The MVP of this run is ${mvp.user}. Thank you!`, `اصطدام! أفضل داعم في هذه الجولة هو ${mvp.user}. شكراً!`, `Kaza! Bu turun MVP'si ${mvp.user}. Teşekkürler!`) : t(`Crash! We drove ${Math.floor(S.dist)} meters.`, `اصطدام! قطعنا ${Math.floor(S.dist)} متر.`, `Kaza! ${Math.floor(S.dist)} metre gittik.`));
    }
  }

  const actions = {
    SPAWN_OBSTACLE(ev) { for (let i = 0; i < clamp(Math.round(ev.value) || 1, 1, 40); i++) spawnObstacle(-120 - i * 170, ev.user); },
    SPEED_BOOST(ev) { S.fx.boost.mul = clamp(unit(ev) || 1.5, 1.2, 2.5); S.fx.boost.until = Math.max(S.fx.boost.until, now()) + 4 + 1.5 * ((ev.repeatCount || 1) - 1); },
    SPEED_SLOW(ev) { S.fx.slow.mul = clamp(unit(ev) || 0.5, 0.3, 0.9); S.fx.slow.until = Math.max(S.fx.slow.until, now()) + 4 + 1.5 * ((ev.repeatCount || 1) - 1); },
    SCREEN_SPLATTER(ev) {
      const secs = clamp(ev.value || 3, 1, 20);
      S.fx.mud.until = Math.max(S.fx.mud.until, now()) + secs;
      for (let i = 0; i < clamp(5 + Math.round(secs * 1.5), 6, 24); i++) S.mud.push({ x: rand(30, W - 30), y: rand(120, H - 120), r: rand(40, 110), seed: Math.random() * 1000 });
    },
    REVERSE_CONTROLS(ev) { S.fx.reverse.until = Math.max(S.fx.reverse.until, now()) + clamp(ev.value || 5, 1, 30); },
    BOSS_ATTACK(ev) {
      const level = clamp(Math.round(unit(ev)) || 1, 1, 5);
      const extra = 6 + 2 * level + 3 * ((ev.repeatCount || 1) - 1);
      if (S.boss && S.boss.until > now()) { S.boss.level = Math.max(S.boss.level, level); S.boss.until += extra; S.boss.by = ev.user; }
      else S.boss = { until: now() + extra, level, x: W / 2, dir: 1, fireIn: 1.2, enter: 0, by: ev.user };
      api.banner(t('BOSS INCOMING', 'الزعيم قادم', 'PATRON GELİYOR'), t(`level ${level} · sent by @${ev.user}`, `المستوى ${level} · من @${ev.user}`, `seviye ${level} · gönderen @${ev.user}`), '#f87171');
    },
    HEAL_PLAYER(ev) {
      if (S.crashed > 0) return;
      S.hp = clamp(S.hp + (Number(ev.value) || 10), 0, 100);
      for (let i = 0; i < 24; i++) S.particles.push({ x: S.x + rand(-30, 30), y: PLAYER_Y + rand(0, CAR_H), vx: rand(-40, 40), vy: rand(-160, -60), life: 1, color: '#6ee7b7' });
    },
    STEER_LEFT(ev) { viewerSteer(-1, ev.value); },
    STEER_RIGHT(ev) { viewerSteer(1, ev.value); },
  };
  const sounds = {
    SPAWN_OBSTACLE: () => { api.noise({ dur: 0.18, vol: 0.7, freq: 400 }); api.tone({ type: 'square', f0: 160, f1: 90, dur: 0.15, vol: 0.25 }); },
    SPEED_BOOST: 'whoosh', SPEED_SLOW: 'down', SCREEN_SPLATTER: 'splash',
    REVERSE_CONTROLS: () => { for (let i = 0; i < 4; i++) api.tone({ type: 'triangle', f0: i % 2 ? 520 : 390, dur: 0.1, vol: 0.28, delay: i * 0.1 }); },
    BOSS_ATTACK: () => { api.tone({ type: 'sawtooth', f0: 90, f1: 55, dur: 1, vol: 0.4 }); for (let i = 0; i < 3; i++) api.tone({ type: 'square', f0: 880, f1: 660, dur: 0.18, vol: 0.14, delay: 0.15 + i * 0.25 }); },
    HEAL_PLAYER: 'good', STEER_LEFT: 'blip', STEER_RIGHT: 'blip',
  };

  function autopilot(dt) {
    S.aiCooldown -= dt;
    if (S.aiCooldown > 0) return;
    const danger = [0, 0, 0];
    for (const o of S.obstacles) { const dy = PLAYER_Y - (o.y + o.h); if (dy > -CAR_H && dy < 420) danger[o.lane] += 1 + (420 - dy) / 200; }
    for (const s of S.shots) { const dy = PLAYER_Y - s.y; if (dy > -40 && dy < 300) danger[clamp(Math.floor((s.x - ROAD_X) / LANE_W), 0, 2)] += 1.5; }
    const cur = S.lane;
    if (danger[cur] < 0.5) return;
    const opts = [cur - 1, cur + 1].filter((l) => l >= 0 && l < LANES).sort((a, b) => danger[a] - danger[b]);
    if (opts.length && danger[opts[0]] < danger[cur]) { steer(opts[0] > cur ? 1 : -1); S.aiCooldown = 0.22; }
  }

  function update(dt) {
    const v = BASE_SPEED * speedMul() * (S.crashed > 0 ? 0.25 : 1);
    S.stripes = (S.stripes + v * dt) % 80;
    S.x += (laneX(S.lane) - S.x) * Math.min(1, dt * 14);
    S.invuln = Math.max(0, S.invuln - dt);
    S.shake = Math.max(0, S.shake - dt);
    if (S.crashed > 0) {
      S.crashed -= dt;
      if (S.crashed <= 0) { Object.assign(S, { hp: 100, dist: 0, obstacles: [], shots: [], lastHitBy: null, invuln: 1.5 }); api.resetRound(); api.banner(''); }
    } else {
      S.dist += (v * dt) / 40;
      if (S.autopilot) autopilot(dt);
    }
    S.ambientIn -= dt * speedMul();
    if (S.ambientIn <= 0) { spawnObstacle(); S.ambientIn = rand(1.1, 2); }
    for (const o of S.obstacles) {
      o.y += v * dt;
      if (!o.hit && Math.abs(laneX(o.lane) - S.x) < LANE_W * 0.55 && o.y + o.h > PLAYER_Y + 10 && o.y < PLAYER_Y + CAR_H - 10) { o.hit = true; hurt(20, o.by); }
    }
    S.obstacles = S.obstacles.filter((o) => o.y < H + 80 && !o.hit);
    const b = S.boss;
    if (b) {
      b.enter = Math.min(1, b.enter + dt * 1.5);
      b.x += b.dir * (90 + 25 * b.level) * dt;
      if (b.x < ROAD_X + 60 || b.x > ROAD_X + ROAD_W - 60) b.dir *= -1;
      b.fireIn -= dt;
      if (b.fireIn <= 0 && S.crashed <= 0 && b.until > now()) {
        const aim = Math.atan2(PLAYER_Y + 40 - (BOSS_Y + 30), S.x - b.x);
        for (const sp of b.level >= 3 ? [-0.18, 0, 0.18] : [0]) S.shots.push({ x: b.x, y: BOSS_Y + 30, vx: Math.cos(aim + sp) * 360, vy: Math.sin(aim + sp) * 360, by: b.by });
        b.fireIn = Math.max(0.35, 1.4 - b.level * 0.2);
      }
      if (b.until <= now()) { b.enter -= dt * 3; if (b.enter <= 0) S.boss = null; }
    }
    for (const s of S.shots) { s.x += s.vx * dt; s.y += s.vy * dt; if (!s.hit && Math.abs(s.x - S.x) < CAR_W / 2 + 8 && s.y > PLAYER_Y && s.y < PLAYER_Y + CAR_H) { s.hit = true; hurt(10, s.by); } }
    S.shots = S.shots.filter((s) => !s.hit && s.y < H + 20 && s.x > -20 && s.x < W + 20);
    for (const p of S.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }
    S.particles = S.particles.filter((p) => p.life > 0);
    if (S.fx.mud.until <= now()) S.mud = [];

    // HUD + effect timers
    const hpColor = S.hp > 50 ? 'linear-gradient(90deg,#22c55e,#a3e635)' : S.hp > 25 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#dc2626,#f87171)';
    api.setHud(
      `<div class="sub">${t('Distance', 'المسافة', 'Mesafe')}</div><div class="big">${api.icon('route')}${Math.floor(S.dist).toLocaleString()}</div>`,
      `<div class="sub" style="display:flex;justify-content:space-between"><span>HP</span><span>${Math.ceil(S.hp)}</span></div><div class="bar"><i style="width:${S.hp}%;background:${hpColor}"></i></div><div class="sub" style="margin-top:.35em">${t('Best', 'الأفضل', 'En iyi')} ${Math.max(S.best, Math.floor(S.dist)).toLocaleString()}</div>`,
    );
    const eff = [];
    const add = (id, until, extra = '') => { const s = until - now(); if (s > 0) { const a = lookAction(id); eff.push({ icon: a.icon, color: a.color, label: `${a.label} ${extra}`.trim(), secs: s }); } };
    add('SPEED_BOOST', S.fx.boost.until, `×${S.fx.boost.mul.toFixed(1)}`);
    add('SPEED_SLOW', S.fx.slow.until, `×${S.fx.slow.mul.toFixed(1)}`);
    add('SCREEN_SPLATTER', S.fx.mud.until);
    add('REVERSE_CONTROLS', S.fx.reverse.until);
    if (S.boss && S.boss.until > now()) add('BOSS_ATTACK', S.boss.until, `LV ${S.boss.level}`);
    api.setEffects(eff);
  }
  const LOOK = { SPEED_BOOST: ['zap', '#fcd34d', t('Speed boost', 'سرعة', 'Hız')], SPEED_SLOW: ['snail', '#7dd3fc', t('Slow motion', 'بطء', 'Ağır çekim')], SCREEN_SPLATTER: ['droplets', '#ca8a04', t('Mud', 'طين', 'Çamur')], REVERSE_CONTROLS: ['arrow-left-right', '#c4b5fd', t('Reversed', 'معكوس', 'Ters')], BOSS_ATTACK: ['skull', '#f87171', t('Boss', 'الزعيم', 'Patron')] };
  const lookAction = (id) => ({ icon: LOOK[id][0], color: LOOK[id][1], label: LOOK[id][2] });

  function draw(ctx, fx) {
    ctx.save();
    if (S.shake > 0) ctx.translate(rand(-8, 8) * S.shake * 3, rand(-8, 8) * S.shake * 3);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1026'); g.addColorStop(1, '#05060d');
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.fillStyle = '#0d1224'; ctx.fillRect(ROAD_X, -20, ROAD_W, H + 40);
    ctx.shadowColor = '#25f4ee'; ctx.shadowBlur = 18; ctx.fillStyle = '#25f4ee'; ctx.fillRect(ROAD_X - 4, -20, 4, H + 40);
    ctx.shadowColor = '#fe2c55'; ctx.fillStyle = '#fe2c55'; ctx.fillRect(ROAD_X + ROAD_W, -20, 4, H + 40);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    for (let l = 1; l < LANES; l++) for (let y = -80 + S.stripes; y < H; y += 80) ctx.fillRect(ROAD_X + LANE_W * l - 2, y, 4, 40);
    if (S.fx.boost.until > now()) {
      ctx.strokeStyle = 'rgba(252,211,77,.35)'; ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) { const x = rand(0, W), y = rand(0, H); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rand(40, 120)); ctx.stroke(); }
    }
    for (const o of S.obstacles) {
      const x = laneX(o.lane);
      if (o.kind === 'cone') {
        ctx.fillStyle = '#fb923c'; ctx.beginPath(); ctx.moveTo(x, o.y); ctx.lineTo(x + 26, o.y + o.h); ctx.lineTo(x - 26, o.y + o.h); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 13, o.y + o.h * 0.55, 26, 7);
      } else {
        const w = LANE_W - 34;
        api.roundRect(ctx, x - w / 2, o.y, w, o.h, 8); ctx.fillStyle = '#f1f5f9'; ctx.fill();
        ctx.save(); ctx.clip(); ctx.fillStyle = '#fe2c55';
        for (let sx = -w; sx < w; sx += 28) { ctx.beginPath(); ctx.moveTo(x - w / 2 + sx, o.y + o.h); ctx.lineTo(x - w / 2 + sx + 14, o.y + o.h); ctx.lineTo(x - w / 2 + sx + 14 + o.h, o.y); ctx.lineTo(x - w / 2 + sx + o.h, o.y); ctx.fill(); }
        ctx.restore();
        if (o.by) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('@' + o.by.slice(0, 14), x, o.y - 8); }
      }
    }
    const b = S.boss;
    if (b) {
      const y = -120 + (BOSS_Y + 120) * (1 - (1 - clamp(b.enter, 0, 1)) ** 3);
      ctx.save(); ctx.translate(b.x, y);
      ctx.shadowColor = '#f87171'; ctx.shadowBlur = 30; ctx.fillStyle = '#1f0a10'; ctx.strokeStyle = '#f87171'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-90, -20); ctx.lineTo(-50, -60); ctx.lineTo(50, -60); ctx.lineTo(90, -20); ctx.lineTo(60, 40); ctx.lineTo(-60, 40); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = '#f87171';
      ctx.beginPath(); ctx.arc(-30, -15, 12, 0, Math.PI * 2); ctx.arc(30, -15, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('LV ' + b.level, 0, 30);
      ctx.restore();
    }
    ctx.fillStyle = '#fca5a5'; ctx.shadowColor = '#f87171'; ctx.shadowBlur = 14;
    for (const s of S.shots) { ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.fill(); }
    ctx.shadowBlur = 0;
    if (!(S.invuln > 0 && Math.floor(now() * 14) % 2) || S.crashed > 0) drawCar(ctx, S.x, PLAYER_Y, S.crashed > 0);
    for (const p of S.particles) { ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x - 3, p.y - 3, 6, 6); }
    ctx.globalAlpha = 1;
    if (S.fx.slow.until > now()) { ctx.fillStyle = 'rgba(56,189,248,.08)'; ctx.fillRect(0, 0, W, H); }
    if (S.fx.reverse.until > now()) { ctx.strokeStyle = 'rgba(196,181,253,.5)'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, W - 10, H - 10); }
    ctx.restore();
    // mud on the overlay canvas
    if (S.mud.length) {
      fx.globalAlpha = clamp(S.fx.mud.until - now(), 0, 1) * 0.92;
      for (const m of S.mud) {
        fx.fillStyle = '#5b3a1a'; fx.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 9) { const r = m.r * (0.75 + 0.25 * Math.sin(a * 3 + m.seed)); fx.lineTo(m.x + Math.cos(a) * r, m.y + Math.sin(a) * r); }
        fx.fill(); fx.fillStyle = '#7c5427'; fx.beginPath(); fx.arc(m.x - m.r * 0.25, m.y - m.r * 0.25, m.r * 0.3, 0, Math.PI * 2); fx.fill();
      }
      fx.globalAlpha = 1;
    }
  }
  function drawCar(ctx, x, y, wrecked) {
    ctx.save(); ctx.translate(x, y);
    if (wrecked) ctx.rotate(Math.sin(now() * 20) * 0.08);
    ctx.shadowColor = '#25f4ee'; ctx.shadowBlur = wrecked ? 0 : 24;
    api.roundRect(ctx, -CAR_W / 2, 0, CAR_W, CAR_H, 18); ctx.fillStyle = wrecked ? '#475569' : '#25f4ee'; ctx.fill();
    ctx.shadowBlur = 0;
    api.roundRect(ctx, -CAR_W / 2 + 10, 22, CAR_W - 20, 30, 8); ctx.fillStyle = '#0b1026'; ctx.fill();
    api.roundRect(ctx, -CAR_W / 2 + 12, 74, CAR_W - 24, 22, 6); ctx.fillStyle = 'rgba(11,16,38,.75)'; ctx.fill();
    ctx.fillStyle = '#fff7ae'; ctx.fillRect(-CAR_W / 2 + 6, 2, 14, 6); ctx.fillRect(CAR_W / 2 - 20, 2, 14, 6);
    ctx.fillStyle = '#fe2c55'; ctx.fillRect(-CAR_W / 2 + 6, CAR_H - 8, 14, 5); ctx.fillRect(CAR_W / 2 - 20, CAR_H - 8, 14, 5);
    ctx.restore();
  }

  return {
    actions, sounds, update, draw,
    onPointer(x) { S.autopilot = false; syncAuto(); steer(x < W / 2 ? -1 : 1); },
    onKey(k) {
      if (k === 'ArrowLeft' || k === 'a') { S.autopilot = false; syncAuto(); steer(-1); }
      if (k === 'ArrowRight' || k === 'd') { S.autopilot = false; syncAuto(); steer(1); }
      if (k === 'p') { S.autopilot = !S.autopilot; syncAuto(); }
    },
  };
}
