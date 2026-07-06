export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rateBg(rate) {
  const t = Math.min(Math.max(rate / 100, 0), 1);
  const r = Math.round(255 - t * 180);
  const g = Math.round(240 - t * 80);
  const b = Math.round(255 - t * 200);
  return `rgb(${r},${g},${b})`;
}

export function renderCrossRubricHeatmap(heatmap, options = {}) {
  if (!heatmap?.cells?.length) {
    const hint = options.emptyHint || '当前筛选下暂无 0629 起新命名素材（FX 人群 × ZT 主题）';
    return options.hideIfEmpty ? '' : `<div class="card"><div class="empty">${escapeHtml(hint)}</div></div>`;
  }

  const { y_values: yVals, x_values: xVals, cells } = heatmap;
  const cellMap = new Map(cells.map((c) => [`${c.y}||${c.x}`, c]));
  const cols = xVals.length + 1;
  const gridStyle = `grid-template-columns:minmax(88px,1fr) repeat(${xVals.length},minmax(52px,1fr))`;

  let grid = `<div class="heatmap-grid" style="${gridStyle}">`;
  grid += `<div class="heatmap-corner">${escapeHtml(heatmap.y_label || 'FX')} \\ ${escapeHtml(heatmap.x_label || 'ZT')}</div>`;
  xVals.forEach((x) => {
    const short = x.length > 10 ? `${x.slice(0, 9)}…` : x;
    grid += `<div class="heatmap-col-head" title="${escapeHtml(x)}">${escapeHtml(short)}</div>`;
  });
  yVals.forEach((y) => {
    grid += `<div class="heatmap-row-head">${escapeHtml(y)}</div>`;
    xVals.forEach((x) => {
      const c = cellMap.get(`${y}||${x}`);
      if (c) {
        grid += `<div class="heatmap-cell" style="background:${rateBg(c.rate)}" title="${escapeHtml(y)} × ${escapeHtml(x)}: ${c.fraction}">${c.label}<span class="fraction">${c.fraction}</span></div>`;
      } else {
        grid += `<div class="heatmap-cell" style="background:#f3f4f6;color:#9ca3af">-</div>`;
      }
    });
  });
  grid += '</div>';

  const subtitle = options.subtitle
    || '（纵轴 FX- 用户人群 · 横轴 ZT- 主题首词，颜色越深出单率越高 · 仅 0629 起新命名素材）';

  return `
    <div class="card">
      <div class="section-title">交叉魔方 · 出单率热力图 <span class="muted">${subtitle}</span></div>
      ${grid}
    </div>
  `;
}
