/** CPI / 订阅数 / 订阅率 — 全站素材指标展示 */

export function fmtCpi(value) {
  if (value === null || value === undefined || value === '') return '-';
  return `$${value}`;
}

export function fmtSubRate(value) {
  if (value === null || value === undefined || value === '') return '-';
  return `${Number(value).toFixed(2)}%`;
}

export function fmtSubs(value) {
  if (value === null || value === undefined || value === '') return '0';
  return String(Math.round(Number(value)));
}

export function inlineMetricsText(m) {
  return [
    `CPI ${fmtCpi(m?.cpi)}`,
    `订阅 ${fmtSubs(m?.subscriptions)}`,
    `订阅率 ${fmtSubRate(m?.subscription_rate)}`,
  ].join(' · ');
}

/** 素材名称 + 下方 CPI / 订阅 / 订阅率 */
export function materialNameHtml(m, escapeHtml, options = {}) {
  const name = escapeHtml(m?.material_id || '');
  const copy = options.copy !== false;
  const nameClass = options.nameClass || 'cell-material-name';
  const copyAttr = copy ? ` data-copy="${name.replace(/"/g, '&quot;')}" title="点击复制"` : '';
  const innerTag = options.innerTag || 'div';
  return `
    <div class="mat-name-cell">
      <${innerTag} class="${nameClass}"${copyAttr}>${name}</${innerTag}>
      <div class="mat-inline-metrics">${inlineMetricsText(m)}</div>
    </div>
  `;
}

export function summaryMetricsFromRows(rows) {
  const total = rows.length;
  const sumSpend = rows.reduce((s, m) => s + (m.spend || 0), 0);
  const sumInstalls = rows.reduce((s, m) => s + (m.installs || 0), 0);
  const subscribed = rows.filter((m) => (m.subscriptions || 0) >= 1).length;
  return {
    total_subscriptions: rows.reduce((s, m) => s + (m.subscriptions || 0), 0),
    subscription_rate: total ? Math.round((subscribed / total) * 10000) / 100 : 0,
    avg_cpi: sumInstalls > 0 ? Math.round((sumSpend / sumInstalls) * 100) / 100 : null,
  };
}

export const METRIC_TH = {
  cpi: 'CPI',
  subscriptions: '订阅数',
  subscription_rate: '订阅率',
};

/** 首页 / 全局顶部：CPI · 总订阅 · 素材订阅率 */
export function renderPrimaryMetricsBar(summary) {
  const cpi = summary?.avg_cpi != null ? `$${summary.avg_cpi}` : '-';
  const subs = summary?.total_subscriptions ?? 0;
  const rate = summary?.subscription_rate ?? 0;
  return `
    <div class="primary-metrics-bar">
      <div class="primary-metric">
        <div class="primary-metric-label">平均 CPI</div>
        <div class="primary-metric-value">${cpi}</div>
      </div>
      <div class="primary-metric">
        <div class="primary-metric-label">总订阅数</div>
        <div class="primary-metric-value accent">${subs}</div>
      </div>
      <div class="primary-metric">
        <div class="primary-metric-label">素材订阅率</div>
        <div class="primary-metric-value">${rate}%</div>
      </div>
    </div>
  `;
}
