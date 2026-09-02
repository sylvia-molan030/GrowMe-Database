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

export function fmtSubCost(spend, subs) {
  const n = Number(subs) || 0;
  if (n <= 0) return '-';
  return `$${(Number(spend || 0) / n).toFixed(2)}`;
}

export function inlineMetricsText(m) {
  return [
    `CPI ${fmtCpi(m?.cpi)}`,
    `订阅 ${fmtSubs(m?.subscriptions)}`,
    `订阅率 ${fmtSubRate(m?.subscription_rate)}`,
  ].join(' · ');
}

/** 素材名下方显示：CPI · 订阅 · 订阅成本（消耗/订阅数） */
export function inlineCostText(m) {
  return [
    `CPI ${fmtCpi(m?.cpi)}`,
    `订阅 ${fmtSubs(m?.subscriptions)}`,
    `订阅成本 ${fmtSubCost(m?.spend, m?.subscriptions)}`,
  ].join(' · ');
}

/** 素材名称 + 下方 CPI / 订阅 / 订阅率 */
export function materialNameHtml(m, escapeHtml, options = {}) {
  const name = escapeHtml(m?.material_id || '');
  const copy = options.copy !== false;
  const nameClass = options.nameClass || 'cell-material-name';
  const copyAttr = copy ? ` data-copy="${name.replace(/"/g, '&quot;')}" title="点击复制"` : '';
  const innerTag = options.innerTag || 'div';
  const metricsText = options.metricsText || inlineMetricsText(m);
  return `
    <div class="mat-name-cell">
      <${innerTag} class="${nameClass}"${copyAttr}>${name}</${innerTag}>
      <div class="mat-inline-metrics">${metricsText}</div>
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
