// Word Guess: a hidden word shows a letter at a time; the first viewer to type it in chat scores.
import { text, sky, stars, particles, GOLD } from './_lib.js';

export default function create(api) {
  const { W, H, clamp, t } = api;
  const fxp = particles(api);
  const S = { word: '', hint: '', shown: new Set(), nextLetter: 0, double: 0, scores: {}, phase: 'play', phaseT: 0, solvedBy: null, used: [] };
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ًͯ-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]/gu, '');
  const letterEvery = () => clamp(Number(api.options.letterEvery) || 12, 3, 120);
  // Built-in word lists per stream language; used while the list in Settings is still the default English one.
  const DEFAULT_WORDS = {
    en: ['rainbow|weather', 'giraffe|animal', 'pizza|food', 'guitar|music', 'rocket|space', 'dolphin|animal', 'volcano|nature', 'football|sport', 'castle|place', 'diamond|treasure', 'penguin|animal', 'chocolate|food'],
    ar: ['قوس قزح|طقس', 'زرافة|حيوان', 'بيتزا|طعام', 'جيتار|موسيقى', 'صاروخ|فضاء', 'دلفين|حيوان', 'بركان|طبيعة', 'كرة القدم|رياضة', 'قلعة|مكان', 'ألماس|كنز', 'بطريق|حيوان', 'شوكولاتة|طعام'],
    tr: ['gökkuşağı|hava', 'zürafa|hayvan', 'pizza|yemek', 'gitar|müzik', 'roket|uzay', 'yunus|hayvan', 'yanardağ|doğa', 'futbol|spor', 'kale|yer', 'elmas|hazine', 'penguen|hayvan', 'çikolata|yemek'],
  };
  const list = () => {
    const w = Array.isArray(api.options.words) && api.options.words.length ? api.options.words : DEFAULT_WORDS.en;
    return JSON.stringify(w) === JSON.stringify(DEFAULT_WORDS.en) ? DEFAULT_WORDS[api.lang] || w : w;
  };
  const isRtl = () => /[֐-ࣿ]/.test(S.word);

  function newWord() {
    const pool = list().filter((w) => !S.used.includes(w));
    const pick = (pool.length ? pool : list())[Math.floor(Math.random() * (pool.length || list().length))];
    S.used.push(pick); if (S.used.length > Math.max(1, list().length - 1)) S.used.shift();
    const [w, h] = String(pick).split('|');
    S.word = w.trim(); S.hint = (h || '').trim();
    S.shown = new Set();
    S.phase = 'play'; S.solvedBy = null;
    S.nextLetter = api.now + letterEvery();
  }
  function reveal(n = 1) {
    const hidden = [...S.word].map((ch, i) => i).filter((i) => !S.shown.has(i) && /\S/.test(S.word[i]));
    for (let k = 0; k < n && hidden.length; k++) S.shown.add(hidden.splice(Math.floor(Math.random() * hidden.length), 1)[0]);
    if (!hidden.length && S.phase === 'play') { S.phase = 'solved'; S.phaseT = api.num('solvedPause', 4.5, 1, 20); api.banner(S.word.toUpperCase(), t('Nobody got it!', 'لم يعرفها أحد!', 'Kimse bilemedi!'), '#94a3b8', 3500); api.sfx('bad'); }
  }
  function solved(user) {
    const hiddenCount = [...S.word].filter((ch, i) => !S.shown.has(i) && /\S/.test(ch)).length;
    const pts = (api.options.points === 'fixed' ? 1 : Math.max(1, hiddenCount)) * (S.double > api.now ? 2 : 1);
    S.scores[user] = (S.scores[user] || 0) + pts;
    S.phase = 'solved'; S.phaseT = api.num('solvedPause', 4.5, 1, 20); S.solvedBy = user;
    S.shown = new Set([...S.word].map((_, i) => i));
    api.banner(S.word.toUpperCase(), t(`@${user} got it! +${pts}`, `@${user} عرفها! +${pts}`, `@${user} bildi! +${pts}`), GOLD, 4000);
    api.sfx('win');
    fxp.burst(W / 2, 600, GOLD, 50, 300);
    api.announce(t(`${user} guessed it! The word was ${S.word}. Plus ${pts} points!`, `${user} عرف الكلمة! الكلمة هي ${S.word}. ${pts} نقاط!`, `${user} bildi! Kelime ${S.word} idi. ${pts} puan!`));
    api.reportScore(pts);
  }
  newWord();

  const actions = {
    REVEAL_LETTER: (ev) => { if (S.phase === 'play') reveal(clamp(Math.round(ev.value) || 1, 1, 10)); },
    DOUBLE_POINTS: (ev) => { S.double = Math.max(S.double, api.now) + clamp(Number(ev.value) || 30, 5, 600); },
    SKIP_WORD: () => { api.banner(S.word.toUpperCase(), t('skipped', 'تم التخطي', 'geçildi'), '#c4b5fd', 2000); newWord(); },
  };
  const sounds = { REVEAL_LETTER: 'blip', DOUBLE_POINTS: 'good', SKIP_WORD: 'whoosh' };

  function update(dt) {
    fxp.update(dt);
    if (S.phase === 'play' && api.now >= S.nextLetter) { reveal(1); S.nextLetter = api.now + letterEvery(); api.sfx('tick'); }
    if (S.phase === 'solved') { S.phaseT -= dt; if (S.phaseT <= 0) newWord(); }
    const top = Object.entries(S.scores).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([u, p], i) => `<div class="sub" style="text-transform:none;font-size:.62em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:14em">${i + 1}. @${api.esc(u)} · <b style="color:#fde68a">${p}</b></div>`).join('');
    api.setHud(`<div class="sub">${t('Leaderboard', 'المتصدرون', 'Sıralama')}</div><div class="big">${api.icon('spell-check')}${Object.keys(S.scores).length}</div>${top}`);
    api.setEffects(S.double > api.now ? [{ icon: 'badge-plus', color: '#6ee7b7', label: t('Double points', 'نقاط مضاعفة', 'Çift puan'), secs: S.double - api.now }] : []);
  }

  function draw(ctx) {
    sky(ctx, W, H, '#0b1a2e', '#102a43');
    stars(ctx, W, H, api.now, 50, 450);
    const chars = [...S.word];
    const n = chars.length, gap = 6;
    const size = clamp(Math.floor((W - 60 - gap * (n - 1)) / n), 26, 54);
    const total = n * size + (n - 1) * gap;
    const y = 560;
    chars.forEach((ch, i) => {
      const slot = isRtl() ? n - 1 - i : i;
      const x = (W - total) / 2 + slot * (size + gap);
      if (ch === ' ') return;
      api.roundRect(ctx, x, y, size, size * 1.2, 8);
      ctx.fillStyle = S.shown.has(i) ? (S.phase === 'solved' && S.solvedBy ? '#facc15' : '#e2e8f0') : 'rgba(255,255,255,.12)'; ctx.fill();
      if (S.shown.has(i)) text(ctx, ch.toUpperCase(), x + size / 2, y + size * 0.62, { size: size * 0.62, color: '#0b1026', weight: 900, shadow: false });
    });
    if (S.hint && api.flag('showHint')) text(ctx, t(`Hint: ${S.hint}`, `تلميح: ${S.hint}`, `İpucu: ${S.hint}`), W / 2, y - 34, { size: 22, color: '#93c5fd' });
    text(ctx, t('Type your guess in chat!', 'اكتب تخمينك في الشات!', 'Tahminini sohbete yaz!'), W / 2, y + size * 1.2 + 40, { size: 22, color: '#fde68a' });
    if (S.phase === 'play' && api.flag('showTimer')) {
      const k = clamp((S.nextLetter - api.now) / letterEvery(), 0, 1);
      api.roundRect(ctx, 80, y + size * 1.2 + 70, W - 160, 10, 5); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fill();
      ctx.fillStyle = '#38bdf8'; ctx.fillRect(80, y + size * 1.2 + 70, (W - 160) * k, 10);
      text(ctx, t(`next letter in ${Math.ceil(S.nextLetter - api.now)}s`, `الحرف التالي بعد ${Math.ceil(S.nextLetter - api.now)} ث`, `sonraki harf ${Math.ceil(S.nextLetter - api.now)} sn`), W / 2, y + size * 1.2 + 98, { size: 14, color: '#94a3b8', weight: 600 });
    }
    fxp.draw(ctx);
  }

  return {
    actions, sounds, update, draw,
    onChat(m) { if (S.phase === 'play' && norm(m.comment) && norm(m.comment) === norm(S.word)) solved(m.user); },
    onOptions() { if (!list().some((w) => norm(String(w).split('|')[0]) === norm(S.word))) newWord(); },
  };
}
