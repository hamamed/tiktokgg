// Spin the Wheel: each SPIN gift turns the prize wheel for the sender. Prizes come from Settings.
import { text, sky, stars, particles, GOLD } from './_lib.js';

export default function create(api) {
  const { W, H, clamp, rand, t } = api;
  const CX = W / 2, CY = 655, R = 165;
  const COLORS = ['#fe2c55', '#25f4ee', '#fbbf24', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#fb923c'];
  const fxp = particles();
  const S = { angle: 0, vel: 0, spinning: false, current: null, queue: [], history: [], resultT: 0, lastTick: 0 };
  // Built-in prizes per stream language; used while the prizes in Settings are still the default English ones.
  const DEFAULT_PRIZES = {
    en: ['10 push-ups', 'Sing a song', 'Dance for 15s', 'Shout-out', 'Nothing!', 'Spin again', 'Funny face', 'Tell a joke'],
    ar: ['10 تمارين ضغط', 'غنِّ أغنية', 'ارقص 15 ثانية', 'تحية خاصة', 'لا شيء!', 'أدر مرة أخرى', 'وجه مضحك', 'احكِ نكتة'],
    tr: ['10 şınav', 'Şarkı söyle', '15 sn dans et', 'Selam ver', 'Hiçbir şey!', 'Tekrar çevir', 'Komik surat', 'Fıkra anlat'],
  };
  const prizes = () => {
    const p = Array.isArray(api.options.prizes) && api.options.prizes.length ? api.options.prizes : DEFAULT_PRIZES.en;
    return JSON.stringify(p) === JSON.stringify(DEFAULT_PRIZES.en) ? DEFAULT_PRIZES[api.lang] || p : p;
  };

  function startNext() {
    if (S.spinning || S.resultT > 0 || !S.queue.length) return;
    S.current = S.queue.shift();
    S.spinning = true;
    S.vel = rand(9, 14);
  }
  function finish() {
    S.spinning = false;
    const list = prizes(), n = list.length, seg = (Math.PI * 2) / n;
    // pointer is at the top (-90°): find the segment under it
    const a = ((-Math.PI / 2 - S.angle) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2);
    const prize = list[Math.floor(a / seg) % n];
    const who = S.current?.user || 'viewer';
    S.history.unshift({ who, prize });
    S.history.length = Math.min(S.history.length, 4);
    S.resultT = 3.2;
    api.banner(prize, t(`@${who} spun the wheel`, `@${who} أدار العجلة`, `@${who} çarkı çevirdi`), GOLD, 3000);
    api.sfx('win');
    fxp.burst(CX, CY - R, GOLD, 40, 300);
    api.announce(t(`${who} spun the wheel and got: ${prize}!`, `${who} أدار العجلة وحصل على: ${prize}!`, `${who} çarkı çevirdi ve kazandı: ${prize}!`));
    if (/spin again|again|مرة أخرى|مجدداً|tekrar/i.test(prize)) S.queue.unshift({ user: who });
  }

  const actions = {
    SPIN: (ev) => {
      const n = clamp(Math.round(ev.value) || 1, 1, 10);
      for (let i = 0; i < n && S.queue.length < 30; i++) S.queue.push({ user: ev.user });
      startNext();
    },
  };
  const sounds = { SPIN: 'whoosh' };

  function update(dt) {
    fxp.update(dt);
    if (S.spinning) {
      S.angle += S.vel * dt;
      S.vel *= Math.pow(0.55, dt);
      const seg = (Math.PI * 2) / prizes().length;
      const k = Math.floor(S.angle / seg);
      if (k !== S.lastTick) { S.lastTick = k; api.sfx('tick'); }
      if (S.vel < 0.25) finish();
    }
    if (S.resultT > 0) { S.resultT -= dt; if (S.resultT <= 0) startNext(); }
    else startNext();
    const hist = S.history.map((h) => `<div class="sub" style="text-transform:none;font-size:.62em;max-width:14em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">@${api.esc(h.who)}: <b style="color:#fde68a">${api.esc(h.prize)}</b></div>`).join('');
    api.setHud(`<div class="sub">${t('Spins waiting', 'دورات في الانتظار', 'Bekleyen çevirme')}</div><div class="big">${api.icon('ferris-wheel')}${S.queue.length + (S.spinning ? 1 : 0)}</div>${hist}`);
  }

  function draw(ctx) {
    sky(ctx, W, H, '#1a0b2e', '#2d1048');
    stars(ctx, W, H, api.now, 80, H);
    const list = prizes(), n = list.length, seg = (Math.PI * 2) / n;
    // lights ring
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; ctx.fillStyle = (Math.floor(api.now * 6) + i) % 2 ? GOLD : '#fff7'; ctx.beginPath(); ctx.arc(CX + Math.cos(a) * (R + 16), CY + Math.sin(a) * (R + 16), 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.save(); ctx.translate(CX, CY); ctx.rotate(S.angle);
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, i * seg, (i + 1) * seg); ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length]; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.rotate(i * seg + seg / 2);
      text(ctx, list[i], R - 14, 0, { size: n > 10 ? 12 : 15, color: '#0b1026', align: 'right', weight: 800, shadow: false, max: R - 40 });
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = '#0b1026'; ctx.beginPath(); ctx.arc(CX, CY, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 4; ctx.stroke();
    // pointer
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(CX - 16, CY - R - 26); ctx.lineTo(CX + 16, CY - R - 26); ctx.lineTo(CX, CY - R + 6); ctx.closePath(); ctx.fill();
    if (S.current && (S.spinning || S.resultT > 0)) text(ctx, '@' + S.current.user, CX, CY - R - 44, { size: 20, color: '#fde68a', max: 300 });
    else if (!S.queue.length) text(ctx, t('Send a gift to spin!', 'أرسل هدية لتدوير العجلة!', 'Çevirmek için hediye gönder!'), CX, CY + R + 34, { size: 20, color: '#e9d5ff' });
    fxp.draw(ctx);
  }

  return { actions, sounds, update, draw };
}
