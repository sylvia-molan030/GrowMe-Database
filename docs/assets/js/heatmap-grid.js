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

/** 按方向 (FX) 汇总出单率 */
export function buildDirectionSummary(heatmap) {
  if (!heatmap?.cells?.length) return [];
  const byDir = new Map();
  heatmap.cells.forEach((c) => {
    const cur = byDir.get(c.y) || { direction: c.y, total: 0, ordered: 0 };
    cur.total += c.total;
    cur.ordered += c.ordered;
    byDir.set(c.y, cur);
  });
  const rows = [...byDir.values()].map((r) => ({
    ...r,
    rate: r.total ? Math.round((r.ordered / r.total) * 10000) / 100 : 0,
    fraction: `${r.ordered}/${r.total}`,
  }));
  const order = new Map((heatmap.y_values || []).map((v, i) => [v, i]));
  rows.sort((a, b) => {
    const oa = order.get(a.direction) ?? 99;
    const ob = order.get(b.direction) ?? 99;
    if (oa !== ob) return oa - ob;
    return b.rate - a.rate;
  });
  return rows;
}

/**
 * 人群方向表：仅方向标签维度的出单率。
 */
export function renderAudienceDirectionTable(heatmap, options = {}) {
  const rows = buildDirectionSummary(heatmap);
  if (!rows.length) {
    const hint = options.emptyHint || '当前筛选下暂无方向出单率数据';
    return options.hideIfEmpty ? '' : `<div class="card"><div class="empty">${escapeHtml(hint)}</div></div>`;
  }

  const clickable = options.clickable === true;
  const subtitle = options.subtitle
    || (clickable
      ? '（仅 FX 人群方向 · 汇总该方向下全部主题 · 点击行可切换探测箱方向）'
      : '（仅 FX 人群方向 · 汇总该方向下全部主题）');

  const body = rows.map((r) => {
    const attrs = clickable
      ? ` class="direction-row" data-fx="${escapeHtml(r.direction)}" role="button" tabindex="0"`
      : '';
    return `
      <tr${attrs}>
        <td>${escapeHtml(r.direction)}</td>
        <td>
          <span class="rate-pill" style="background:${rateBg(r.rate)}">${r.rate}%</span>
        </td>
        <td>${r.fraction}</td>
        <td>${r.total}</td>
        <td>${r.ordered}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="card" id="audience-direction-card">
      <div class="section-title">人群方向表 · 出单率 <span class="muted">${subtitle}</span></div>
      <div class="table-wrap direction-table-wrap">
        <table class="data-table direction-rate-table">
          <thead>
            <tr>
              <th>方向 (FX-)</th>
              <th>出单率</th>
              <th>出单/总数</th>
              <th>素材数</th>
              <th>出单素材</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * 交叉魔方：FX × ZT 矩阵热力格，颜色越深出单率越高。
 * options.clickable：单元格带 data-fx/data-zt，便于下钻联动。
 */
export function renderCrossRubricHeatmap(heatmap, options = {}) {
  if (!heatmap?.cells?.length) {
    const hint = options.emptyHint || '当前筛选下暂无 0629 起新命名素材（FX 人群 × ZT 主题）';
    return options.hideIfEmpty ? '' : `<div class="card"><div class="empty">${escapeHtml(hint)}</div></div>`;
  }

  const { y_values: yVals, x_values: xVals, cells } = heatmap;
  const cellMap = new Map(cells.map((c) => [`${c.y}||${c.x}`, c]));
  const clickable = options.clickable === true;
  const colMin = Math.max(88, ...xVals.map((x) => Math.min(Math.round(x.length * 6.5 + 24), 128)));
  const gridStyle = `grid-template-columns:minmax(108px,1.15fr) repeat(${xVals.length},minmax(${colMin}px,1fr))`;

  let grid = `<div class="heatmap-grid cross-cube-grid" style="${gridStyle}">`;
  grid += `<div class="heatmap-corner">${escapeHtml(heatmap.y_label || 'FX')} \\ ${escapeHtml(heatmap.x_label || 'ZT')}</div>`;
  xVals.forEach((x) => {
    grid += `<div class="heatmap-col-head" title="${escapeHtml(x)}">${escapeHtml(x)}</div>`;
  });
  yVals.forEach((y) => {
    grid += `<div class="heatmap-row-head">${escapeHtml(y)}</div>`;
    xVals.forEach((x) => {
      const c = cellMap.get(`${y}||${x}`);
      if (c) {
        const cls = clickable ? 'heatmap-cell cross-cube-cell' : 'heatmap-cell';
        const attrs = clickable
          ? ` data-fx="${escapeHtml(c.y)}" data-zt="${escapeHtml(c.x)}" role="button" tabindex="0"`
          : '';
        grid += `<div class="${cls}" style="background:${rateBg(c.rate)}" title="${escapeHtml(y)} × ${escapeHtml(x)}: ${c.fraction}"${attrs}>${c.label}<span class="fraction">${c.fraction}</span></div>`;
      } else {
        grid += '<div class="heatmap-cell heatmap-cell-empty" style="background:#f3f4f6;color:#9ca3af">-</div>';
      }
    });
  });
  grid += '</div>';

  const subtitle = options.subtitle
    || (clickable
      ? '（纵轴 FX 人群 · 横轴 ZT 主题首词 · 颜色越深出单率越高 · 仅 0629 起新命名素材 · 点击格子下钻）'
      : '（纵轴 FX 人群 · 横轴 ZT 主题首词 · 颜色越深出单率越高 · 仅 0629 起新命名素材）');

  return `
    <div class="card" id="cross-rubric-card">
      <div class="section-title">交叉魔方 · 出单率对照表 <span class="muted">${subtitle}</span></div>
      <div class="cross-cube-scroll">${grid}</div>
    </div>
  `;
}
