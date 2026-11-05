// Backgrounds for every game (dashboard → Games → Game settings → Background).
// Each one is drawn in code (no image files), most are animated. draw(ctx, W, H, t) paints the whole canvas.
// The stream page uses them through api.drawBackground(ctx); the dashboard draws them as thumbnails.

const TAU = Math.PI * 2;
/** Stable pseudo-random number in [0, 1) for an index (same layout every frame). */
const rnd = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const lin = (ctx, H, stops, W = 0) => {
  const g = W ? ctx.createLinearGradient(0, 0, W, H) : ctx.createLinearGradient(0, 0, 0, H);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
};
const fill = (ctx, W, H, style) => { ctx.fillStyle = style; ctx.fillRect(0, 0, W, H); };
const glow = (ctx, x, y, r, color) => {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
};
function starsLayer(ctx, W, H, t, n, maxY = H, size = 2) {
  ctx.fillStyle = '#fff';
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.25 + 0.6 * Math.abs(Math.sin(t * (0.6 + rnd(i + 7)) + i));
    const s = size * (0.5 + rnd(i + 3));
    ctx.fillRect(rnd(i) * W, rnd(i + 1000) * maxY, s, s);
  }
  ctx.globalAlpha = 1;
}
function heart(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.4, y - s, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.4, y - s, x + s, y - s * 0.4, x, y + s * 0.35);
  ctx.fill();
}

export const BACKGROUNDS = [
  // ---- utility ----
  { id: 'transparent', name: 'Transparent (camera behind)', draw: (ctx, W, H) => ctx.clearRect(0, 0, W, H) },
  { id: 'green', name: 'Green screen', draw: (ctx, W, H) => fill(ctx, W, H, '#00b140') },

  // ---- calm gradients ----
  { id: 'midnight', name: 'Midnight', draw: (ctx, W, H, t) => { fill(ctx, W, H, lin(ctx, H, ['#020617', '#0f172a', '#1e1b4b'])); starsLayer(ctx, W, H, t, 40, H * 0.5, 1.5); } },
  { id: 'sunset', name: 'Sunset', draw: (ctx, W, H) => { fill(ctx, W, H, lin(ctx, H, ['#1e1b4b', '#7c3aed', '#f43f5e', '#fb923c', '#fde68a'])); glow(ctx, W / 2, H * 0.78, 160, 'rgba(254,240,138,.55)'); } },
  { id: 'ocean', name: 'Deep ocean', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#0e7490', '#0c4a6e', '#082f49', '#020617']));
    ctx.globalAlpha = 0.12; ctx.fillStyle = '#e0f2fe';
    for (let i = 0; i < 6; i++) { const x = W * (i / 5) + Math.sin(t * 0.4 + i) * 30; ctx.beginPath(); ctx.moveTo(x - 20, 0); ctx.lineTo(x + 20, 0); ctx.lineTo(x + 90, H); ctx.lineTo(x - 10, H); ctx.fill(); }
    ctx.globalAlpha = 1;
  } },
  { id: 'neon', name: 'Neon glow', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#0a0118');
    glow(ctx, W * 0.2 + Math.sin(t * 0.5) * 40, H * 0.3, 320, 'rgba(254,44,85,.55)');
    glow(ctx, W * 0.8 + Math.cos(t * 0.4) * 40, H * 0.7, 340, 'rgba(37,244,238,.45)');
  } },
  { id: 'forest', name: 'Forest night', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#020617', '#052e16', '#14532d']));
    starsLayer(ctx, W, H, t, 30, H * 0.35, 1.5);
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ['#064e3b', '#065f46', '#022c22'][layer];
      for (let i = 0; i < 9; i++) { const x = ((i + layer * 0.37) / 8) * W, base = H * (0.55 + layer * 0.12), h = 140 + rnd(i + layer * 20) * 120; ctx.beginPath(); ctx.moveTo(x, base - h); ctx.lineTo(x - 45, base + 40); ctx.lineTo(x + 45, base + 40); ctx.fill(); }
      ctx.fillRect(0, H * (0.55 + layer * 0.12) + 38, W, H);
    }
  } },
  { id: 'desert', name: 'Desert dusk', draw: (ctx, W, H) => {
    fill(ctx, W, H, lin(ctx, H, ['#312e81', '#c2410c', '#fdba74']));
    glow(ctx, W * 0.7, H * 0.45, 120, 'rgba(254,243,199,.9)');
    [['#b45309', 0.62], ['#92400e', 0.72], ['#78350f', 0.84]].forEach(([c, y], k) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H * y + Math.sin(x / (90 + k * 30) + k) * 30);
      ctx.lineTo(W, H); ctx.fill();
    });
  } },

  // ---- space ----
  { id: 'starfield', name: 'Starfield', draw: (ctx, W, H, t) => { fill(ctx, W, H, '#000'); starsLayer(ctx, W, H, t, 160, H, 2.2); } },
  { id: 'warp', name: 'Hyperspace', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#01010a');
    const cx = W / 2, cy = H / 2;
    ctx.strokeStyle = '#c7d2fe'; ctx.lineCap = 'round';
    for (let i = 0; i < 120; i++) {
      const a = rnd(i) * TAU, z = (rnd(i + 50) + t * 0.25) % 1, r = z * z * Math.hypot(W, H) * 0.7;
      ctx.globalAlpha = z; ctx.lineWidth = 1 + z * 2.5;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } },
  { id: 'nebula', name: 'Nebula', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#05010f');
    const cols = ['rgba(168,85,247,.35)', 'rgba(236,72,153,.3)', 'rgba(59,130,246,.3)', 'rgba(20,184,166,.25)'];
    for (let i = 0; i < 7; i++) glow(ctx, W * rnd(i) + Math.sin(t * 0.15 + i) * 30, H * rnd(i + 9) + Math.cos(t * 0.12 + i) * 30, 180 + rnd(i + 4) * 160, cols[i % 4]);
    starsLayer(ctx, W, H, t, 90, H, 1.6);
  } },
  { id: 'galaxy', name: 'Spiral galaxy', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#020010');
    const cx = W / 2, cy = H * 0.42;
    glow(ctx, cx, cy, 160, 'rgba(253,230,138,.5)');
    for (let i = 0; i < 420; i++) {
      const arm = i % 3, d = rnd(i) ** 0.7 * 300, a = arm * (TAU / 3) + d / 70 + t * 0.06 + (rnd(i + 3) - 0.5) * 0.5;
      ctx.globalAlpha = 0.9 - d / 400; ctx.fillStyle = d < 80 ? '#fde68a' : i % 4 ? '#c4b5fd' : '#f0abfc';
      ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.55, 2, 2);
    }
    ctx.globalAlpha = 1;
  } },
  { id: 'aurora', name: 'Aurora', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#020617', '#042f2e', '#020617']));
    starsLayer(ctx, W, H, t, 60, H * 0.6, 1.5);
    [['rgba(52,211,153,.35)', 0.25], ['rgba(56,189,248,.3)', 0.33], ['rgba(167,139,250,.25)', 0.41]].forEach(([c, y], k) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, H * y + 140);
      for (let x = 0; x <= W; x += 15) ctx.lineTo(x, H * y + Math.sin(x / 80 + t * 0.6 + k * 2) * 45 + Math.sin(x / 33 - t * 0.4) * 12);
      for (let x = W; x >= 0; x -= 15) ctx.lineTo(x, H * y + 140 + Math.sin(x / 70 + t * 0.5 + k) * 30);
      ctx.fill();
    });
  } },

  // ---- retro / city ----
  { id: 'synthwave', name: 'Synthwave', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#1e0536', '#4c0b5f', '#ff2a6d']));
    const hz = H * 0.58;
    const sg = lin(ctx, 220, ['#fde047', '#f97316', '#ec4899']);
    ctx.save(); ctx.translate(W / 2, hz - 120); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 120, 120, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#4c0b5f'; for (let i = 0; i < 6; i++) ctx.fillRect(-130, 30 + i * 16, 260, 3 + i);
    ctx.restore();
    ctx.fillStyle = '#12002a'; ctx.fillRect(0, hz, W, H - hz);
    ctx.strokeStyle = 'rgba(244,114,182,.8)'; ctx.lineWidth = 2;
    for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 12, hz); ctx.lineTo(W / 2 + i * 110, H); ctx.stroke(); }
    for (let i = 0; i < 12; i++) { const k = ((i + (t * 0.6) % 1) / 12) ** 2, y = hz + k * (H - hz); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } },
  { id: 'city', name: 'City at night', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#0f172a', '#1e1b4b', '#312e81']));
    glow(ctx, W * 0.8, H * 0.18, 60, 'rgba(254,249,195,.8)');
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < 12; i++) {
        const bw = 40 + rnd(i + layer * 40) * 40, x = (i / 11) * W - 20 + layer * 22, bh = 180 + rnd(i * 3 + layer) * (layer ? 300 : 220), y = H - bh;
        ctx.fillStyle = layer ? '#0b1026' : '#1e293b'; ctx.fillRect(x, y, bw, bh);
        if (layer) for (let wy = y + 12; wy < H - 10; wy += 18) for (let wx = x + 6; wx < x + bw - 8; wx += 12) {
          const on = rnd(wx * 7 + wy) > 0.55 !== (rnd(wx + wy * 3 + Math.floor(t / 4)) > 0.97);
          if (on) { ctx.fillStyle = rnd(wx + wy) > 0.5 ? '#fde68a' : '#93c5fd'; ctx.fillRect(wx, wy, 5, 8); }
        }
      }
    }
  } },
  { id: 'hexagons', name: 'Hex grid', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#030712');
    const r = 30, h = r * Math.sqrt(3);
    for (let row = -1; row * h * 0.5 < H + h; row++) for (let col = -1; col * r * 3 < W + r * 3; col++) {
      const x = col * r * 3 + (row % 2 ? r * 1.5 : 0), y = row * h * 0.5;
      const k = 0.5 + 0.5 * Math.sin(t * 1.2 - (x + y) / 120);
      ctx.strokeStyle = `rgba(37,244,238,${0.08 + k * 0.35})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); ctx.stroke();
    }
  } },
  { id: 'matrix', name: 'Digital rain', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#000');
    ctx.font = '700 16px monospace'; ctx.textAlign = 'center';
    for (let c = 0; c < 30; c++) {
      const x = (c + 0.5) * (W / 30), speed = 80 + rnd(c) * 140, head = ((t * speed + rnd(c + 9) * H) % (H + 300)) - 100;
      for (let k = 0; k < 18; k++) {
        const y = head - k * 18; if (y < -20 || y > H) continue;
        ctx.fillStyle = k === 0 ? '#d1fae5' : `rgba(34,197,94,${1 - k / 18})`;
        ctx.fillText(String.fromCharCode(0x30a0 + Math.floor(rnd(c * 31 + k + Math.floor(t * 8)) * 90)), x, y);
      }
    }
  } },
  { id: 'disco', name: 'Disco lights', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#09090b');
    const cols = ['rgba(244,63,94,.28)', 'rgba(59,130,246,.28)', 'rgba(234,179,8,.25)', 'rgba(16,185,129,.25)', 'rgba(168,85,247,.28)'];
    ctx.save(); ctx.translate(W / 2, -20);
    for (let i = 0; i < 10; i++) {
      ctx.rotate(Math.sin(t * 0.5 + i) * 0.02 + (i ? 0 : Math.sin(t * 0.3) * 0.3));
      const a = -0.9 + (i / 9) * 1.8 + Math.sin(t * 0.7 + i * 1.3) * 0.25;
      ctx.fillStyle = cols[i % 5]; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(a - 0.07) * H * 1.3, Math.cos(a - 0.07) * H * 1.3); ctx.lineTo(Math.sin(a + 0.07) * H * 1.3, Math.cos(a + 0.07) * H * 1.3); ctx.fill();
    }
    ctx.restore();
    glow(ctx, W / 2, 10, 60, 'rgba(255,255,255,.7)');
  } },
  { id: 'gold', name: 'Gold luxury', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#1c1917', '#292524', '#0c0a09']));
    glow(ctx, W / 2, H * 0.4, 380, 'rgba(234,179,8,.18)');
    for (let i = 0; i < 70; i++) {
      const k = Math.max(0, Math.sin(t * 1.5 + i * 2.1)); if (k < 0.2) continue;
      const x = rnd(i) * W, y = rnd(i + 70) * H, s = 2 + k * 5;
      ctx.fillStyle = `rgba(253,224,71,${k})`; ctx.fillRect(x - s / 2, y - 0.75, s, 1.5); ctx.fillRect(x - 0.75, y - s / 2, 1.5, s);
    }
  } },

  // ---- moving particles ----
  { id: 'bokeh', name: 'Bokeh lights', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#0b0b1a');
    const cols = ['254,44,85', '37,244,238', '251,191,36', '167,139,250', '52,211,153'];
    for (let i = 0; i < 26; i++) { const x = (rnd(i) * W + t * (8 + rnd(i + 2) * 14)) % (W + 120) - 60, y = rnd(i + 30) * H + Math.sin(t * 0.4 + i) * 20; glow(ctx, x, y, 30 + rnd(i + 5) * 60, `rgba(${cols[i % 5]},.35)`); }
  } },
  { id: 'fireflies', name: 'Fireflies', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#020617', '#052e16']));
    for (let i = 0; i < 45; i++) {
      const x = rnd(i) * W + Math.sin(t * 0.5 + i) * 40, y = rnd(i + 9) * H + Math.cos(t * 0.4 + i * 1.7) * 30;
      const k = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.4 + i)); glow(ctx, x, y, 14, `rgba(190,242,100,${k * 0.6})`);
      ctx.fillStyle = `rgba(236,252,203,${k})`; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  } },
  { id: 'snow', name: 'Snowfall', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#0c1a33', '#1e3a5f', '#475569']));
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 140; i++) {
      const s = 1 + rnd(i) * 3.5, y = (rnd(i + 3) * H + t * (25 + s * 18)) % (H + 10) - 5, x = (rnd(i + 8) * W + Math.sin(t * 0.8 + i) * 18 + W) % W;
      ctx.globalAlpha = 0.5 + s / 9; ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } },
  { id: 'rain', name: 'Rainy night', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#0f172a', '#1e293b']));
    ctx.strokeStyle = 'rgba(186,230,253,.45)'; ctx.lineWidth = 1.4;
    for (let i = 0; i < 130; i++) { const y = (rnd(i) * H + t * (650 + rnd(i + 2) * 300)) % (H + 40) - 20, x = (rnd(i + 5) * (W + 60) - t * 90 % (W + 60) + W + 60) % (W + 60) - 30; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 16); ctx.stroke(); }
  } },
  { id: 'bubbles', name: 'Bubbles', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#0369a1', '#0c4a6e', '#082f49']));
    for (let i = 0; i < 40; i++) {
      const r = 4 + rnd(i) * 16, y = H + 30 - ((rnd(i + 4) * H + t * (30 + r * 3)) % (H + 60)), x = rnd(i + 9) * W + Math.sin(t + i) * 12;
      ctx.strokeStyle = 'rgba(224,242,254,.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.2, 0, TAU); ctx.fill();
    }
  } },
  { id: 'hearts', name: 'Floating hearts', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#3b0a2a', '#831843', '#4a044e']));
    for (let i = 0; i < 30; i++) {
      const s = 8 + rnd(i) * 18, y = H + 40 - ((rnd(i + 2) * H + t * (35 + s * 2)) % (H + 80)), x = rnd(i + 6) * W + Math.sin(t * 0.8 + i) * 20;
      ctx.globalAlpha = 0.35 + rnd(i + 1) * 0.4; ctx.fillStyle = i % 3 ? '#fb7185' : '#f9a8d4'; heart(ctx, x, y, s);
    }
    ctx.globalAlpha = 1;
  } },
  { id: 'confetti', name: 'Confetti party', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#1e1b4b', '#312e81']));
    const cols = ['#f43f5e', '#facc15', '#22d3ee', '#a3e635', '#c084fc', '#fb923c'];
    for (let i = 0; i < 110; i++) {
      const y = (rnd(i) * H + t * (60 + rnd(i + 1) * 90)) % (H + 20) - 10, x = rnd(i + 2) * W + Math.sin(t * 1.5 + i) * 15;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * (1 + rnd(i + 3) * 3) + i); ctx.fillStyle = cols[i % 6]; ctx.fillRect(-4, -2, 8 * Math.abs(Math.cos(t * 3 + i)) + 1, 4); ctx.restore();
    }
  } },
  { id: 'lava', name: 'Lava lamp', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#1a0505');
    for (let i = 0; i < 8; i++) glow(ctx, W * (0.2 + rnd(i) * 0.6) + Math.sin(t * 0.3 + i) * 80, H * 0.5 + Math.sin(t * (0.15 + rnd(i + 2) * 0.2) + i * 2) * H * 0.42, 110 + rnd(i + 5) * 90, i % 2 ? 'rgba(249,115,22,.55)' : 'rgba(225,29,72,.5)');
  } },

  // ---- nature / day ----
  { id: 'waves', name: 'Ocean waves', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#38bdf8', '#bae6fd']));
    glow(ctx, W * 0.75, H * 0.15, 90, 'rgba(254,249,195,.9)');
    ['#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e'].forEach((c, k) => {
      const y0 = H * (0.45 + k * 0.11);
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 10) ctx.lineTo(x, y0 + Math.sin(x / (60 + k * 10) + t * (1 + k * 0.2) + k) * (10 + k * 3));
      ctx.lineTo(W, H); ctx.fill();
    });
  } },
  { id: 'clouds', name: 'Blue sky', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, lin(ctx, H, ['#0ea5e9', '#7dd3fc', '#e0f2fe']));
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 9; i++) {
      const x = (rnd(i) * (W + 300) + t * (8 + rnd(i + 1) * 12)) % (W + 300) - 150, y = rnd(i + 4) * H * 0.85, s = 0.6 + rnd(i + 7) * 0.9;
      for (const [dx, dy, r] of [[0, 0, 36], [34, -14, 30], [64, 0, 34], [30, 12, 30]]) { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, TAU); ctx.fill(); }
    }
  } },
  { id: 'mountains', name: 'Mountain dawn', draw: (ctx, W, H) => {
    fill(ctx, W, H, lin(ctx, H, ['#fda4af', '#fdba74', '#fef3c7']));
    glow(ctx, W * 0.35, H * 0.42, 130, 'rgba(255,255,255,.8)');
    [['#a78bfa', 0.45, 160], ['#7c3aed', 0.56, 120], ['#4c1d95', 0.68, 100], ['#2e1065', 0.8, 80]].forEach(([c, y, amp], k) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 30) ctx.lineTo(x, H * y - Math.abs(Math.sin(x / (110 - k * 12) + k * 1.7)) * amp + rnd(x + k) * 14);
      ctx.lineTo(W, H); ctx.fill();
    });
  } },
  { id: 'candy', name: 'Candy stripes', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#fdf2f8');
    ctx.save(); ctx.translate(((t * 30) % 80), 0); ctx.fillStyle = '#f9a8d4';
    for (let x = -H - 80; x < W + 80; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 40, 0); ctx.lineTo(x + 40 + H, H); ctx.lineTo(x + H, H); ctx.fill(); }
    ctx.restore();
    fill(ctx, W, H, 'rgba(76,5,25,.35)');
  } },
  { id: 'plasma', name: 'Color flow', draw: (ctx, W, H, t) => {
    const g = ctx.createLinearGradient(0, 0, W * Math.cos(t * 0.2), H);
    for (let i = 0; i <= 5; i++) g.addColorStop(i / 5, `hsl(${(t * 25 + i * 60) % 360} 70% 35%)`);
    fill(ctx, W, H, g);
    glow(ctx, W / 2 + Math.sin(t * 0.7) * 150, H / 2 + Math.cos(t * 0.5) * 250, 300, `hsla(${(t * 40) % 360} 90% 60% / .35)`);
  } },
  { id: 'carbon', name: 'Dark carbon', draw: (ctx, W, H) => {
    fill(ctx, W, H, '#111214');
    ctx.fillStyle = '#1a1b1f';
    for (let y = 0; y < H; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < W; x += 8) ctx.fillRect(x, y, 4, 4);
    glow(ctx, W / 2, H * 0.3, 380, 'rgba(255,255,255,.06)');
  } },
  { id: 'tiktok', name: 'Red & cyan', draw: (ctx, W, H, t) => {
    fill(ctx, W, H, '#010101');
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i % 2 ? '#25f4ee' : '#fe2c55'; ctx.lineWidth = 30;
      ctx.beginPath(); for (let x = -20; x <= W + 20; x += 15) ctx.lineTo(x, H * (0.3 + i * 0.2) + Math.sin(x / 90 + t * 0.8 + i * 2) * 60); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } },
];

export const BACKGROUND_BY_ID = Object.fromEntries(BACKGROUNDS.map((b) => [b.id, b]));
