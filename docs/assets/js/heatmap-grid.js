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

/**
 * 交叉魔方：表格形式展示 FX × ZT 出单率，文字完整可读。
 * options.clickable：单元格行带 data-fx/data-zt，便于下钻联动。
 */
export function renderCrossRubricHeatmap(heatmap, options = {}) {
  if (!heatmap?.cells?.length) {
    const hint = options.emptyHint || '当前筛选下暂无 0629 起新命名素材（FX 人群 × ZT 主题）';
    return options.hideIfEmpty ? '' : `<div class="card"><div class="empty">${escapeHtml(hint)}</div></div>`;
  }

  const cells = [...heatmap.cells].sort((a, b) => {
    if (b.rate !== a.rate) return b.rate - a.rate;
    return b.total - a.total;
  });

  const subtitle = options.subtitle
    || (options.clickable
      ? '（方向 FX × 主题 ZT · 按出单率排序 · 仅 0629 起新命名素材 · 点击行可下钻）'
      : '（方向 FX × 主题 ZT · 按出单率排序 · 仅 0629 起新命名素材）');

  const clickable = options.clickable === true;
  const rows = cells.map((c) => {
    const attrs = clickable
      ? ` class="cross-table-row" data-fx="${escapeHtml(c.y)}" data-zt="${escapeHtml(c.x)}" role="button" tabindex="0"`
      : '';
    return `
      <tr${attrs}>
        <td>${escapeHtml(c.y)}</td>
        <td>${escapeHtml(c.x)}</td>
        <td>
          <span class="rate-pill" style="background:${rateBg(c.rate)}">${c.rate}%</span>
        </td>
        <td>${c.ordered}/${c.total}</td>
        <td>${c.total}</td>
        <td>${c.ordered}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="card" id="cross-rubric-card">
      <div class="section-title">交叉魔方 · 出单率对照表 <span class="muted">${subtitle}</span></div>
      <div class="table-wrap">
        <table class="data-table cross-rate-table">
          <thead>
            <tr>
              <th>${escapeHtml(heatmap.y_label || '方向 (FX-)')}</th>
              <th>${escapeHtml(heatmap.x_label || '主题 (ZT-)')}</th>
              <th>出单率</th>
              <th>出单/总数</th>
              <th>素材数</th>
              <th>出单素材</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}
