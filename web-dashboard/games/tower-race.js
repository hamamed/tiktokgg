// Tower Race: two teams stack blocks; wind knocks blocks off. First tower to the clouds wins.
import { text, sky, stars, particles, teamNames, teamBoard, teamHud, RED, BLUE, GOLD } from './_lib.js';

export default function create(api) {
  const { W, H, clamp, rand, t } = api;
  const GROUND = 815, TOP = 470, TOWER_W = 120;
  const X = { red: 150, blue: W - 150 };
  const fxp = particles(api);
  const board = teamBoard();
  const S = { blocks: { red: [], blue: [] }, falling: [], rounds: { red: 0, blue: 0 }, phase: 'play', phaseT: 0, wind: { red: 0, blue: 0 }, last: { red: '', blue: '' } };
  const goal = () => clamp(Math.round(Number(api.options.goalHeight) || 25), 5, 200);
  const blockH = () => (GROUND - TOP) / goal();
  const shade = (team, i) => (team === 'red' ? `hsl(${348 + (i % 3) * 4} 90% ${55 + (i % 2) * 7}%)` : `hsl(${180 + (i % 3) * 4} 85% ${48 + (i % 2) * 7}%)`);

  function build(team, n, user) {
    if (S.phase !== 'play') return;
    const count = clamp(Math.round(n) || 1, 1, 60);
    for (let i = 0; i < count; i++) S.falling.push({ team, y: TOP - 120 - i * 40, user, w: TOWER_W - rand(0, 16), off: rand(-6, 6) });
    board.add(team, user, count);
    if (user) S.last[team] = user;
  }
  function wind(team, n) {
    if (S.phase !== 'play') return;
    const k = clamp(Math.round(n) || 1, 1, 60);
    S.wind[team] = 1.2;
    for (let i = 0; i < k && S.blocks[team].length; i++) {
      const b = S.blocks[team].pop();
      fxp.burst(X[team], GROUND - (S.blocks[team].length + 0.5) * blockH(), shade(team, i), 10, 260);
    }
  }
  function land(f) {
    const tower = S.blocks[f.team];
    tower.push({ w: f.w, off: f.off, user: f.user });
    fxp.burst(X[f.team], GROUND - tower.length * blockH(), '#fff', 4, 90, 150);
    if (tower.length >= goal() && S.phase === 'play') win(f.team);
  }
  function win(team) {
    const names = teamNames(api);
    S.rounds[team]++;
    S.phase = 'win'; S.phaseT = api.num('roundPause', 6, 2, 30);
    const mvp = board.mvp(team);
    api.banner(t(`${names[team]} REACHED THE CLOUDS!`, `${names[team]} وصل للغيوم!`, `${names[team]} BULUTLARA ULAŞTI!`), mvp ? t(`Top builder @${mvp}`, `أفضل بنّاء @${mvp}`, `En iyi inşaatçı @${mvp}`) : '', team === 'red' ? RED : BLUE, 5500);
    api.sfx('win');
    fxp.burst(X[team], TOP, GOLD, 70, 340);
    api.announce(t(`The ${names[team]} tower reached the clouds!${mvp ? ` Top builder: ${mvp}.` : ''} New round, start building!`, `برج ${names[team]} وصل إلى الغيوم!${mvp ? ` أفضل بنّاء: ${mvp}.` : ''} جولة جديدة، ابدأوا البناء!`, `${names[team]} kulesi bulutlara ulaştı!${mvp ? ` En iyi inşaatçı: ${mvp}.` : ''} Yeni tur, inşaata başlayın!`));
    api.reportScore(S.rounds.red + S.rounds.blue);
  }

  const actions = {
    BUILD_RED: (ev) => build('red', ev.value, ev.user),
    BUILD_BLUE: (ev) => build('blue', ev.value, ev.user),
    WIND_RED: (ev) => wind('red', ev.value),
    WIND_BLUE: (ev) => wind('blue', ev.value),
    HELP_LOSER: (ev) => build(S.blocks.red.length <= S.blocks.blue.length ? 'red' : 'blue', ev.value, ev.user),
  };
  const sounds = {
    BUILD_RED: 'blip', BUILD_BLUE: 'blip', HELP_LOSER: 'good',
    WIND_RED: () => api.noise({ dur: 0.8, vol: 0.5, freq: 1200 }), WIND_BLUE: () => api.noise({ dur: 0.8, vol: 0.5, freq: 1200 }),
  };

  function update(dt) {
    fxp.update(dt);
    for (const k of ['red', 'blue']) S.wind[k] = Math.max(0, S.wind[k] - dt);
    for (const f of S.falling) {
      f.y += 620 * (api.num('fallSpeed', 100, 30, 300) / 100) * dt;
      const top = GROUND - (S.blocks[f.team].length + 1) * blockH();
      if (f.y >= top) { f.done = true; land(f); }
    }
    S.falling = S.falling.filter((f) => !f.done);
    if (S.phase === 'win') {
      S.phaseT -= dt;
      if (S.phaseT <= 0) { S.phase = 'play'; S.blocks = { red: [], blue: [] }; S.falling = []; board.reset(); api.resetRound(); api.banner(t('BUILD!', 'ابنوا!', 'İNŞA ET!'), '', GOLD, 1200); }
    }
    const names = teamNames(api);
    const h = (team) => `<div class="sub">${S.blocks[team].length} / ${goal()}</div>`;
    const [l, r] = teamHud(api, names, S.rounds, h('red'), h('blue'));
    api.setHud(l, r);
  }

  function draw(ctx) {
    if (!api.drawBackground(ctx)) { sky(ctx, W, H, '#0c1430', '#1c2547'); stars(ctx, W, H, api.now, 60, 420); }
    // cloud line = goal
    if (api.flag('showGoal')) {
    for (let i = 0; i < 9; i++) { ctx.fillStyle = 'rgba(226,232,240,.18)'; ctx.beginPath(); ctx.ellipse(30 + i * 62, TOP - 6 + Math.sin(api.now + i) * 4, 48, 18, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = GOLD; ctx.setLineDash([12, 10]); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(20, TOP); ctx.lineTo(W - 20, TOP); ctx.stroke(); ctx.setLineDash([]);
    text(ctx, t('GOAL', 'الهدف', 'HEDEF'), W / 2, TOP - 16, { size: 16, color: GOLD });
    }
    ctx.fillStyle = '#334155'; ctx.fillRect(0, GROUND, W, H - GROUND);
    const bh = blockH();
    for (const team of ['red', 'blue']) {
      const sway = S.wind[team] > 0 ? Math.sin(api.now * 30) * 4 * S.wind[team] : 0;
      S.blocks[team].forEach((b, i) => {
        const y = GROUND - (i + 1) * bh;
        api.roundRect(ctx, X[team] - b.w / 2 + b.off + sway * (i / 10), y + 1, b.w, bh - 2, Math.min(6, bh / 3));
        ctx.fillStyle = shade(team, i); ctx.fill();
      });
      for (const f of S.falling.filter((x) => x.team === team)) {
        api.roundRect(ctx, X[team] - f.w / 2 + f.off, f.y, f.w, bh - 2, Math.min(6, bh / 3));
        ctx.fillStyle = shade(team, 1); ctx.fill();
      }
      if (S.wind[team] > 0) {
        ctx.strokeStyle = 'rgba(226,232,240,.55)'; ctx.lineWidth = 3;
        for (let i = 0; i < 6; i++) { const y = GROUND - 60 - i * 55; const x = X[team] - 90 + ((api.now * 400 + i * 50) % 180); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 40, y); ctx.stroke(); }
      }
      const names = teamNames(api);
      text(ctx, names[team], X[team], GROUND + 22, { size: 20, color: team === 'red' ? RED : BLUE });
      if (S.last[team] && api.showNames) text(ctx, '@' + S.last[team], X[team], GROUND - S.blocks[team].length * bh - 14, { size: 14, color: '#e2e8f0', weight: 600, max: 200 });
    }
    fxp.draw(ctx);
  }

  return { actions, sounds, update, draw };
}
