import { api } from '../api.js';
import { bindCopyMaterials } from '../copy-material.js';
import { fmtCpi, fmtSubRate, fmtSubs, materialNameHtml } from '../material-metrics.js';

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadHeatmapGrid() {
  return import('../heatmap-grid.js');
}

let survivalChart = null;

function isSubscriptionMode(report) {
  return report?.kpi?.metric_mode === 'subscription';
}

function metricLabels(report) {
  if (isSubscriptionMode(report)) {
    return {
      orderedMaterials: '订阅素材数',
      conversions: '总订阅量',
      rate: '订阅率',
      orderedShort: '订阅素材',
      conversionShort: '订阅量',
      sortDefault: 'subscriptions',
      goodHint: '订阅达标 · 点击表头排序',
      emptyRanked: '本板块暂无订阅素材',
    };
  }
  return {
    orderedMaterials: '出单素材数',
    conversions: '总出单量',
    rate: '出单率',
    orderedShort: '出单素材',
    conversionShort: '出单量',
    sortDefault: 'purchases',
    goodHint: '购物 + 订阅双达标 · 点击表头排序',
    emptyRanked: '本板块暂无出单素材',
  };
}

function wowBadge(wow, invert = false) {
  if (!wow || wow.direction === 'flat') return '';
  const good = invert ? wow.direction === 'down' : wow.direction === 'up';
  const cls = good ? 'up' : 'down';
  const arrow = wow.direction === 'up' ? '↑' : '↓';
  const pct = wow.pct !== null && wow.pct !== undefined ? `${Math.abs(wow.pct)}%` : '';
  return `<span class="wow-badge ${cls}">${arrow}${pct}</span>`;
}

function kpiCard(title, value, wow = null, sub = '') {
  return `
    <div class="card kpi-card">
      <div class="kpi-title">${title}</div>
      <div class="kpi-value">${value}${wow ? ` ${wowBadge(wow)}` : ''}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>
  `;
}

function fmt(v, suffix = '') {
  if (v === null || v === undefined || v === '') return '-';
  return `${v}${suffix}`;
}

function renderSummary(kpi, prevWeek, labels) {
  const wow = kpi.wow || {};
  const orderRateDelta = wow.order_rate && wow.order_rate.pct !== null
    ? `(${wow.order_rate.direction === 'up' ? '+' : ''}${wow.order_rate.pct}%)`
    : '';
  const spendDelta = wow.spend && wow.spend.pct !== null
    ? `(${wow.spend.direction === 'up' ? '+' : ''}${wow.spend.pct}%)`
    : '';

  let summaryLine = `本周消耗 $${kpi.spend || 0}${spendDelta}，${kpi.total_materials || 0} 条素材`;
  if (kpi.ordered_materials != null) summaryLine += `，${labels.orderedShort} ${kpi.ordered_materials} 条`;
  summaryLine += `，${labels.rate} ${kpi.order_rate || 0}%${orderRateDelta}`;
  if (labels.rate === '订阅率' && kpi.subscription_cost != null) {
    summaryLine += `，订阅成本 $${kpi.subscription_cost}`;
  }
  if (kpi.avg_roas && labels.rate === '出单率') summaryLine += `，平均 ROAS ${kpi.avg_roas}`;

  return `
    <div class="card" style="background:linear-gradient(135deg,#d8eee6 0%,#fbfcf9 60%);border-left:4px solid #1b6b5a;padding:12px 16px;border-radius:10px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:600;color:#0d3f35;margin-bottom:4px">本周一句话总结</div>
      <div style="font-size:13px;color:#1a2b24;line-height:1.6">${summaryLine}</div>
    </div>
  `;
}

function renderKpiSection(kpi, prevWeek, labels) {
  const wow = kpi.wow || {};
  const hasWow = Boolean(prevWeek);
  const sourceHint = kpi.kpi_source === 'weekly_files'
    ? '当周测试快照'
    : kpi.kpi_source === 'account_lifecycle'
      ? '全量生命周期'
      : '';

  return `
    <div class="section-title">周度 KPI${sourceHint ? ` <span class="muted">（${sourceHint}${hasWow ? ' · 含 WoW 环比' : ''}）</span>` : (hasWow ? ' <span class="muted">（含 WoW 环比）</span>' : '')}</div>
    <div class="kpi-grid">
      ${kpiCard('总素材量', `${kpi.total_materials} 条`, hasWow ? wow.total_materials : null)}
      ${kpiCard(labels.orderedMaterials, kpi.ordered_materials, hasWow ? wow.ordered_materials : null)}
      ${kpiCard(labels.conversions, kpi.conversions, hasWow ? wow.conversions : null)}
      ${kpiCard(labels.rate, `${kpi.order_rate}%`, hasWow ? wow.order_rate : null)}
      ${kpiCard('总订阅数', kpi.subscriptions ?? 0, hasWow ? wow.subscriptions : null)}
      ${kpiCard('平均 CPI', fmtCpi(kpi.cpi), null)}
      ${labels.rate === '订阅率' ? kpiCard('订阅成本', kpi.subscription_cost != null ? `$${kpi.subscription_cost}` : '-', hasWow ? wow.subscription_cost : null, '花费 ÷ 总订阅量') : ''}
      ${labels.rate === '出单率' ? kpiCard('平均 ROAS', kpi.avg_roas ?? '-', hasWow ? wow.avg_roas : null) : ''}
    </div>
  `;
}

function sortArrow(sort, col) {
  if (!sort || sort.by !== col) return '';
  return sort.dir === 'desc' ? ' ↓' : ' ↑';
}

function sortTh(label, col, sort, extraClass = '') {
  const cls = [sort?.by === col ? 'sorted' : '', extraClass].filter(Boolean).join(' ');
  return `<th data-sort="${col}"${cls ? ` class="${cls}"` : ''}>${label}${sortArrow(sort, col)}</th>`;
}

function sortRows(rows, sort, defaults = { by: 'purchases', dir: 'desc' }) {
  const by = sort?.by || defaults.by;
  const dir = sort?.dir || defaults.dir;
  const mult = dir === 'asc' ? 1 : -1;
  const cmpVal = (av, bv, m) => {
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv), 'zh') * m;
    }
    return (av - bv) * m;
  };
  return [...(rows || [])].sort((a, b) => {
    const primary = cmpVal(a[by], b[by], mult);
    if (primary !== 0) return primary;
    // 购物一致时 ROAS 高的在前；其它列相同时也用购物 → ROAS 兜底
    if (by !== 'purchases') {
      const byPurchases = cmpVal(a.purchases, b.purchases, -1);
      if (byPurchases !== 0) return byPurchases;
    }
    if (by !== 'roas') {
      return cmpVal(a.roas, b.roas, -1);
    }
    return 0;
  });
}

function getTableSort(state, key, defaults = { by: 'purchases', dir: 'desc' }) {
  state.weeklyTableSort = state.weeklyTableSort || {};
  return state.weeklyTableSort[key] || defaults;
}

function bindTableSort(container, state, report) {
  container.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', async () => {
      const table = th.closest('table');
      const key = table?.dataset?.sortKey;
      if (!key) return;
      const col = th.dataset.sort;
      const cur = getTableSort(state, key);
      state.weeklyTableSort[key] = {
        by: col,
        dir: cur.by === col && cur.dir === 'desc' ? 'asc' : 'desc',
      };
      container.innerHTML = '<div class="empty">加载中...</div>';
      await renderWeeklyUpdate(container, state);
    });
  });
}

function renderGoodMaterials(items, sort, kpiSource, labels, subMode) {
  const rows = sortRows(items, sort, { by: labels.sortDefault, dir: 'desc' });
  const hint = kpiSource === 'account_lifecycle'
    ? `全量生命周期 · ${labels.goodHint}`
    : labels.goodHint;
  const purchaseCol = subMode ? '' : `${sortTh('购物', 'purchases', sort)}`;
  const subCostCol = subMode ? `${sortTh('订阅成本', 'subscription_cost', sort, 'num')}` : '';
  return `
    <div class="card">
      <div class="section-title">本周好素材 <span class="muted">（${hint}）</span></div>
      <div class="table-wrap">
        <table data-sort-key="good">
          <thead>
            <tr>
              ${sortTh('素材', 'material_id', sort)}
              ${sortTh('方向', 'direction', sort)}
              ${sortTh('设计师', 'designer', sort)}
              ${sortTh('花费', 'spend', sort)}
              ${purchaseCol}
              ${sortTh('订阅', 'subscriptions', sort)}
              ${sortTh('CPI', 'cpi', sort)}
              ${sortTh('订阅率', 'subscription_rate', sort, 'num')}
              ${subCostCol}
              ${subMode ? '' : sortTh('ROAS', 'roas', sort)}
              ${sortTh('CTR', 'ctr', sort)}
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((m) => `
              <tr>
                <td>${materialNameHtml(m, escapeHtml)}</td>
                <td><span class="tag">${escapeHtml(m.direction)}</span></td>
                <td>${escapeHtml(m.designer)}</td>
                <td>$${m.spend}</td>
                ${subMode ? '' : `<td style="color:#dc2626;font-weight:700">${m.purchases}</td>`}
                <td style="${subMode ? 'color:#dc2626;font-weight:700' : ''}">${m.subscriptions ?? 0}</td>
                <td>${fmtCpi(m.cpi)}</td>
                <td>${fmtSubRate(m.subscription_rate)}</td>
                ${subMode ? `<td>${m.subscription_cost != null ? `$${m.subscription_cost}` : '-'}</td>` : ''}
                ${subMode ? '' : `<td>${m.roas}</td>`}
                <td>${m.ctr}%</td>
              </tr>
            `).join('') : `<tr><td colspan="${subMode ? 9 : 10}" class="empty">本周暂无${subMode ? '订阅' : '双转化'}好素材</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function formatWeekLabel(label) {
  if (!label) return label;
  return String(label).replace(/(\d{4})week$/i, '$1周');
}

function renderCoreComparison(rows, labels, subMode) {
  if (!rows?.length) return '';
  const visible = subMode
    ? rows.filter((r) => !['roas'].includes(r.key))
    : rows;
  return `
    <div class="card">
      <div class="section-title">核心指标对比 <span class="muted">（本周 vs 上周）</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>指标</th>
              <th>本周</th>
              <th>上周</th>
              <th>环比</th>
            </tr>
          </thead>
          <tbody>
            ${visible.map((r) => {
              const unit = r.unit || '';
              const fmtVal = (v) => {
                if (v === null || v === undefined) return '-';
                if (unit === '$') return `$${v}`;
                if (unit === '%') return `${v}%`;
                return `${v}${unit}`;
              };
              return `
                <tr${subMode && (r.key === 'order_rate' || r.key === 'subscription_cost') ? ' style="background:#f0f9f6"' : ''}>
                  <td><strong>${escapeHtml(r.label)}</strong></td>
                  <td>${fmtVal(r.current)}</td>
                  <td>${fmtVal(r.previous)}</td>
                  <td>${wowBadge(r.wow)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDirectionTable(rows, sort, kpiSource, labels, subMode) {
  const sorted = sortRows(rows, sort, { by: labels.sortDefault, dir: 'desc' });
  const hint = kpiSource === 'account_lifecycle'
    ? '全量生命周期 · 点击表头排序'
    : '点击表头排序';
  const orderedLabel = subMode ? '订阅素材' : '出单素材';
  const rateCol = subMode ? `${sortTh('订阅率', 'order_rate', sort, 'num')}` : '';
  const subCostCol = subMode ? `${sortTh('订阅成本', 'subscription_cost', sort, 'num')}` : '';
  const purchaseCol = subMode ? '' : `${sortTh('购物', 'purchases', sort)}`;
  return `
    <div class="card">
      <div class="section-title">各方向标签表现对比 <span class="muted">（${hint}）</span></div>
      <div class="table-wrap">
        <table data-sort-key="direction">
          <thead>
            <tr>
              ${sortTh('方向', 'direction', sort)}
              ${sortTh('素材量', 'total_materials', sort)}
              ${rateCol}
              ${sortTh(orderedLabel, 'ordered_materials', sort)}
              ${sortTh('消耗', 'spend', sort)}
              ${subCostCol}
              ${sortTh('CTR', 'ctr', sort)}
              ${sortTh('CPI', 'cpi', sort)}
              ${subMode ? '' : sortTh('ROAS', 'roas', sort)}
              ${sortTh('订阅量', 'subscriptions', sort)}
              ${purchaseCol}
              ${sortTh('钩子率', 'hook_rate', sort)}
              ${sortTh('留存率', 'retention_rate', sort)}
            </tr>
          </thead>
          <tbody>
            ${sorted.map((r) => `
              <tr>
                <td><span class="tag">${escapeHtml(r.direction)}</span></td>
                <td>${r.total_materials ?? '-'}</td>
                ${subMode ? `<td><strong style="color:#0d3f35">${r.order_rate ?? 0}%</strong></td>` : ''}
                <td><strong>${r.ordered_ratio || `${r.ordered_materials}/${r.total_materials || '-'}`}</strong></td>
                <td>$${r.spend ?? '-'}</td>
                ${subMode ? `<td>${r.subscription_cost != null ? `$${r.subscription_cost}` : '-'}</td>` : ''}
                <td>${r.ctr}%</td>
                <td>${r.cpi !== null && r.cpi !== undefined ? `$${r.cpi}` : '-'}</td>
                ${subMode ? '' : `<td>${r.roas}</td>`}
                <td style="${subMode ? 'color:#dc2626;font-weight:700' : ''}">${r.subscriptions}</td>
                ${subMode ? '' : `<td style="color:#dc2626;font-weight:700">${r.purchases}</td>`}
                <td>${r.hook_rate ? `${r.hook_rate}%` : '-'}</td>
                <td>${r.retention_rate ? `${r.retention_rate}%` : '-'}</td>
              </tr>
            `).join('') || `<tr><td colspan="${subMode ? 11 : 11}" class="empty">暂无方向数据</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAudienceTest(block, sort) {
  if (!block?.materials?.length) return '';
  const rows = sortRows(block.materials, sort);
  return `
    <div class="card weekly-callout">
      <div class="section-title">新方向 · 人群测试 <span class="muted">（点击表头排序）</span></div>
      <p class="weekly-callout-note">${escapeHtml(block.note || '')}</p>
      <div class="table-wrap">
        <table data-sort-key="audience">
          <thead>
            <tr>
              ${sortTh('目标人群', 'target_audience', sort)}
              ${sortTh('设计师', 'designer', sort)}
              ${sortTh('花费', 'spend', sort)}
              ${sortTh('购物', 'purchases', sort)}
              ${sortTh('订阅', 'subscriptions', sort)}
              ${sortTh('ROAS', 'roas', sort)}
              ${sortTh('CTR', 'ctr', sort)}
              ${sortTh('3秒播放率', 'hook_rate', sort)}
              ${sortTh('留存率', 'retention_rate', sort)}
            </tr>
          </thead>
          <tbody>
            ${rows.map((m) => `
              <tr>
                <td>
                  <div style="font-weight:600">${escapeHtml(m.target_audience)}</div>
                  <div class="cell-material-name" style="font-size:11px;margin-top:4px">${escapeHtml(m.material_id)}</div>
                  <div class="mat-inline-metrics">${fmtCpi(m.cpi)} · 订阅 ${fmtSubs(m.subscriptions)} · 订阅率 ${fmtSubRate(m.subscription_rate)}</div>
                </td>
                <td>${escapeHtml(m.designer || '-')}</td>
                <td>$${m.spend}</td>
                <td style="color:#dc2626;font-weight:700">${m.purchases}</td>
                <td>${m.subscriptions}</td>
                <td>${m.roas}</td>
                <td>${m.ctr}%</td>
                <td>${m.hook_rate != null ? `${m.hook_rate}%` : '-'}</td>
                <td>${m.retention_rate != null ? `${m.retention_rate}%` : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderMaterialTestBlock(block, sort, labels, subMode) {
  if (!block) return '';
  const s = block.summary || {};
  const blockLabels = subMode ? {
    orderedMaterials: '订阅素材量',
    conversions: '总订阅量',
    rate: '订阅率',
    cost: '订阅成本',
    emptyRanked: '本板块暂无订阅素材',
  } : {
    orderedMaterials: '出单素材量',
    conversions: '总出单量',
    rate: '出单率',
    emptyRanked: labels.emptyRanked,
  };
  const sortKey = `test_${block.label}`;
  const rows = sortRows(block.materials || [], sort, { by: labels.sortDefault, dir: 'desc' });
  const purchaseCol = subMode ? '' : `${sortTh('购物', 'purchases', sort)}`;
  const roasCol = subMode ? '' : `${sortTh('ROAS', 'roas', sort)}`;
  const subCol = `${sortTh('订阅', 'subscriptions', sort)}`;
  const cpiCol = `${sortTh('CPI', 'cpi', sort, 'num')}`;
  const subRateCol = `${sortTh('订阅率', 'subscription_rate', sort, 'num')}`;
  const subCostCol = subMode ? `${sortTh('订阅成本', 'subscription_cost', sort, 'num')}` : '';
  const colCount = subMode ? 12 : 13;
  const subCostFooter = subMode && s.subscription_cost != null
    ? `
      <div style="margin-top:12px;padding:10px 12px;background:#f0f9f6;border-radius:8px;font-size:13px;color:#0d3f35">
        <strong>订阅成本</strong>：$${s.subscription_cost}
        <span class="muted">（板块花费 $${s.spend ?? 0} ÷ 总订阅量 ${s.conversions ?? 0}）</span>
      </div>`
    : '';
  return `
    <div class="card weekly-callout">
      <div class="section-title">本周测试 · ${escapeHtml(block.label)} <span class="muted">（点击表头排序）</span></div>
      <p class="weekly-callout-note">${escapeHtml(block.note || '')}</p>
      <div class="kpi-grid kpi-grid-5 weekly-callout-kpi">
        ${kpiCard('测试素材量', `${s.total_materials ?? 0} 条`)}
        ${kpiCard(blockLabels.orderedMaterials, `${s.ordered_materials ?? 0} 条`)}
        ${kpiCard(blockLabels.conversions, s.conversions ?? 0)}
        ${kpiCard(blockLabels.rate, `${s.order_rate ?? 0}%`)}
        ${subMode ? kpiCard(blockLabels.cost, s.subscription_cost != null ? `$${s.subscription_cost}` : '-', null, '花费 ÷ 总订阅量') : ''}
      </div>
      <div class="table-wrap">
        <table data-sort-key="${escapeHtml(sortKey)}">
          <thead>
            <tr>
              ${sortTh('素材', 'material_id', sort)}
              ${sortTh('方向', 'direction', sort)}
              ${sortTh('主题', 'theme', sort)}
              ${sortTh('设计师', 'designer', sort)}
              ${sortTh('花费', 'spend', sort)}
              ${subCol}
              ${cpiCol}
              ${subRateCol}
              ${subCostCol}
              ${purchaseCol}
              ${roasCol}
              ${sortTh('CTR', 'ctr', sort)}
              ${sortTh('3秒播放率', 'hook_rate', sort)}
              ${sortTh('留存率', 'retention_rate', sort)}
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((m) => `
              <tr>
                <td>${materialNameHtml(m, escapeHtml)}</td>
                <td><span class="tag">${escapeHtml(m.direction || '-')}</span></td>
                <td>${escapeHtml(m.theme || '-')}</td>
                <td>${escapeHtml(m.designer || '-')}</td>
                <td>$${m.spend}</td>
                <td style="color:#dc2626;font-weight:700">${m.subscriptions ?? 0}</td>
                <td>${fmtCpi(m.cpi)}</td>
                <td>${fmtSubRate(m.subscription_rate)}</td>
                ${subMode ? `<td>${m.subscription_cost != null ? `$${m.subscription_cost}` : '-'}</td>` : ''}
                ${subMode ? '' : `<td style="color:#dc2626;font-weight:700">${m.purchases}</td>`}
                ${subMode ? '' : `<td>${m.roas}</td>`}
                <td>${m.ctr}%</td>
                <td>${m.hook_rate != null ? `${m.hook_rate}%` : '-'}</td>
                <td>${m.retention_rate != null ? `${m.retention_rate}%` : '-'}</td>
              </tr>
            `).join('') : `<tr><td colspan="${colCount}" class="empty">${blockLabels.emptyRanked}</td></tr>`}
          </tbody>
        </table>
      </div>
      ${subCostFooter}
    </div>
  `;
}

function renderSurvivalChart(el, trend) {
  if (!survivalChart) survivalChart = echarts.init(el);
  const survivedName = trend.survived_label || '成活数（有购物）';
  survivalChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['每日素材数', survivedName] },
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: trend.dates },
    yAxis: { type: 'value', name: '数量', minInterval: 1 },
    series: [
      { name: '每日素材数', type: 'bar', data: trend.counts, itemStyle: { color: '#1b6b5a' } },
      {
        name: survivedName,
        type: 'line',
        data: trend.survived_counts,
        itemStyle: { color: '#16a34a' },
        lineStyle: { width: 2 },
        symbol: 'circle',
        symbolSize: 6,
      },
    ],
  });
}

function renderInsights(items) {
  return `
    <div class="card insights-card">
      <div class="section-title">核心洞察</div>
      <ol class="insights-list">
        ${items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
      </ol>
    </div>
  `;
}

function sortMaterialTestBlocks(report) {
  const blocks = (report.material_test_blocks || []).filter(
    (b) => (b?.summary?.total_materials ?? 0) > 0
  );
  if (isSubscriptionMode(report)) {
    const order = { 高价值用户: 0, 英语: 1 };
    return [...blocks].sort((a, b) => (order[a.label] ?? 9) - (order[b.label] ?? 9));
  }
  const order = { 新素材: 0, 新方向: 0, 新创意: 0, 老素材: 1, 老方向: 1, 老形式: 1, 图片: 2 };
  return [...blocks].sort((a, b) => (order[a.label] ?? 9) - (order[b.label] ?? 9));
}

export async function renderWeeklyUpdate(container, state) {
  const { renderCrossRubricHeatmap, renderAudienceDirectionTable } = await loadHeatmapGrid();
  const week = state.weeklyWeek || state.meta?.weekly_labels?.slice(-1)[0];
  let data;
  try {
    data = await api.weeklyReport(week);
  } catch (err) {
    container.innerHTML = `<div class="empty">周度数据加载失败：${escapeHtml(err.message)}<br/>请强制刷新页面后重试。</div>`;
    return;
  }
  const report = data.report;
  if (!report) {
    container.innerHTML = '<div class="empty">暂无周度数据，请将周度文件放入 data_inputs/</div>';
    return;
  }

  const weeks = report.weeks || data.weeks || [];
  state.weeklyWeek = report.week;
  const testBlocks = sortMaterialTestBlocks(report);
  const labels = metricLabels(report);
  const subMode = isSubscriptionMode(report);

  container.innerHTML = `
    <div class="week-tabs">
      ${weeks.map((w) => `
        <button class="tab ${w === report.week ? 'active' : ''}" data-week="${escapeHtml(w)}">${escapeHtml(formatWeekLabel(w))}</button>
      `).join('')}
    </div>
    ${renderSummary(report.kpi, report.prev_week, labels)}
    ${renderKpiSection(report.kpi, report.prev_week, labels)}
    ${subMode ? renderCoreComparison(report.core_comparison, labels, subMode) : ''}
    ${testBlocks.map((block) => renderMaterialTestBlock(block, getTableSort(state, `test_${block.label}`, { by: labels.sortDefault, dir: 'desc' }), labels, subMode)).join('')}
    ${renderCrossRubricHeatmap(report.cross_rubric_heatmap, { hideIfEmpty: true, metricMode: subMode ? 'subscription' : 'purchase' })}
    ${renderAudienceDirectionTable(report.cross_rubric_heatmap, { hideIfEmpty: true, metricMode: subMode ? 'subscription' : 'purchase' })}
    ${renderDirectionTable(report.direction_table, getTableSort(state, 'direction', { by: labels.sortDefault, dir: 'desc' }), report.kpi?.kpi_source, labels, subMode)}
    ${renderGoodMaterials(report.good_materials, getTableSort(state, 'good', { by: labels.sortDefault, dir: 'desc' }), report.kpi?.kpi_source, labels, subMode)}
    ${renderAudienceTest(report.audience_test, getTableSort(state, 'audience'))}
    <div class="card">
      <div class="section-title">本周 First-Seen 成活趋势图</div>
      <div id="weekly-survival-chart" class="chart"></div>
    </div>
    ${renderInsights(report.insights)}
  `;

  container.querySelectorAll('[data-week]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.weeklyWeek = btn.dataset.week;
      state.weeklyTableSort = {};
      container.innerHTML = '<div class="empty">加载中...</div>';
      await renderWeeklyUpdate(container, state);
    });
  });

  bindTableSort(container, state, report);

  const chartEl = container.querySelector('#weekly-survival-chart');
  if (chartEl && report.survival_trend) {
    renderSurvivalChart(chartEl, report.survival_trend);
  }
  bindCopyMaterials(container);
  window.addEventListener('resize', () => survivalChart && survivalChart.resize());
}
