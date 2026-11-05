// Shared drawing + game helpers for the game modules (games/<id>.js).
// Layout note: the stream page puts overlays on the top band (HUD), the left column (alerts) and the
// right column (gift list), so each game keeps its main action roughly between y = 460 and y = 850.

export const RED = '#fe2c55';
export const BLUE = '#25f4ee';
export const GOLD = '#fbbf24';

/** Text with a soft shadow. */
export function text(ctx, str, x, y, { size = 24, color = '#fff', align = 'center', weight = 800, base = 'middle', shadow = true, max } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px system-ui, "Noto Sans Arabic", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; }
  ctx.fillStyle = color;
  ctx.fillText(String(str), x, y, max);
  ctx.restore();
}

/** Vertical gradient background. */
export function sky(ctx, W, H, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Twinkling stars (deterministic positions). */
export function stars(ctx, W, H, now, n = 70, maxY = H * 0.6) {
  for (let i = 0; i < n; i++) {
    const x = (i * 97.13) % W, y = (i * 53.71) % maxY;
    ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(now * 1.3 + i));
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

/** Simple particle system: burst(x, y, color, n) then update(dt) + draw(ctx) every frame. */
export function particles() {
  const list = [];
  return {
    burst(x, y, color, n = 20, speed = 220, gravity = 300) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
        list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life: 0.7 + Math.random() * 0.6, color, g: gravity, s: 3 + Math.random() * 4 });
      }
    },
    update(dt) {
      for (const p of list) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.life -= dt; }
      for (let i = list.length - 1; i >= 0; i--) if (list[i].life <= 0) list.splice(i, 1);
    },
    draw(ctx) {
      for (const p of list) { ctx.globalAlpha = Math.max(0, Math.min(1, p.life)); ctx.fillStyle = p.color; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
      ctx.globalAlpha = 1;
    },
  };
}

/** Team names from the game options. */
export function teamNames(api) {
  // Game option first, then the Teams names (dashboard → Teams), then the stream language.
  return { red: api.options.redName || api.teams?.names?.red || api.t('Red', 'الأحمر', 'Kırmızı'), blue: api.options.blueName || api.teams?.names?.blue || api.t('Blue', 'الأزرق', 'Mavi') };
}

/** Per-team contribution tracking for "team MVP". */
export function teamBoard() {
  const by = { red: {}, blue: {} };
  return {
    add(team, user, amount) { if (user) by[team][user] = (by[team][user] || 0) + amount; },
    mvp(team) { const e = Object.entries(by[team]).sort((a, b) => b[1] - a[1])[0]; return e ? e[0] : null; },
    reset() { by.red = {}; by.blue = {}; },
  };
}

/** HUD panel html for two teams: "Red 2 – 1 Blue". */
export function teamHud(api, names, rounds, extraLeft = '', extraRight = '') {
  const e = api.esc;
  return [
    `<div class="sub" style="color:${RED}">${e(names.red)}</div><div class="big" style="color:${RED}">${api.icon('trophy')}${rounds.red}</div>${extraLeft}`,
    `<div class="sub" style="color:${BLUE}">${e(names.blue)}</div><div class="big" style="color:${BLUE}">${api.icon('trophy')}${rounds.blue}</div>${extraRight}`,
  ];
}
