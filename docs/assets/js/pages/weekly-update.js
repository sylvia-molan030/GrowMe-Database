import { api } from '../api.js';

let survivalChart = null;

function fmt(v, suffix = '') {
  if (v === null || v === undefined || v === '') return '-';
  return `${v}${suffix}`;
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

function renderKpiSection(kpi, prevWeek) {
  const wow = kpi.wow || {};
  const hasWow = Boolean(prevWeek);
  return `
    <div class="section-title">周度 KPI${hasWow ? ' <span class="muted">（含 WoW 环比）</span>' : ''}</div>
    <div class="kpi-grid kpi-grid-4">
      ${kpiCard('总素材量', kpi.total_materials, hasWow ? wow.total_materials : null)}
      ${kpiCard('WW 消耗', `$${fmt(kpi.ww.spend)}`, hasWow ? wow.ww_spend : null)}
      ${kpiCard('WW 有效素材', kpi.ww.effective_materials, hasWow ? wow.effective_materials : null)}
      ${kpiCard('WW 转化数', kpi.ww.conversions, hasWow ? wow.conversions : null)}
      ${kpiCard('WW 出单率', `${kpi.ww.order_rate}%`, hasWow ? wow.ww_order_rate : null)}
      ${kpiCard('T1 消耗', `$${fmt(kpi.t1.spend)}`, hasWow ? wow.t1_spend : null)}
      ${kpiCard('T1 有效素材', kpi.t1.effective_materials)}
      ${kpiCard('T1 转化数', kpi.t1.conversions)}
      ${kpiCard('T1 出单率', `${kpi.t1.order_rate}%`, hasWow ? wow.t1_order_rate : null)}
      ${kpiCard('≥2 单素材率', `${kpi.ge2_rate}%`, hasWow ? wow.ge2_rate : null)}
      ${kpiCard('≥5 单素材率', `${kpi.ge5_rate}%`, hasWow ? wow.ge5_rate : null)}
      ${kpiCard('总出单率', `${kpi.order_rate}%`, hasWow ? wow.order_rate : null)}
    </div>
  `;
}

function renderComparisonTable(rows, prevWeek) {
  if (!rows?.length) return '';
  return `
    <div class="card">
      <div class="section-title">核心指标对照${prevWeek ? ` <span class="muted">（对比 ${prevWeek}）</span>` : ''}</div>
      <div class="table-wrap">
        <table class="compare-table">
          <thead>
            <tr>
              <th>指标</th><th>本周</th><th>上周</th><th>环比</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => {
              const unit = r.unit || '';
              const cur = r.current === null || r.current === undefined ? '-' : `${r.current}${unit}`;
              const prev = r.previous === null || r.previous === undefined ? '-' : `${r.previous}${unit}`;
              const wow = r.wow;
              let wowText = '-';
              if (wow) {
                const arrow = wow.direction === 'up' ? '↑' : wow.direction === 'down' ? '↓' : '→';
                const pct = wow.pct !== null && wow.pct !== undefined ? ` ${Math.abs(wow.pct)}%` : '';
                wowText = `${arrow}${pct}`;
              }
              const invert = r.key === 'empty_spend' || r.key === 'cpi' || r.key === 'cpm';
              const wowCls = wow ? (invert ? (wow.direction === 'down' ? 'text-green' : wow.direction === 'up' ? 'text-red' : '') : (wow.direction === 'up' ? 'text-green' : wow.direction === 'down' ? 'text-red' : '')) : '';
              return `<tr><td>${r.label}</td><td>${cur}</td><td>${prev}</td><td class="${wowCls}">${wowText}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderGoodMaterials(items) {
  return `
    <div class="card">
      <div class="section-title">本周好素材 <span class="muted">（购物 + 订阅双达标）</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>素材</th><th>方向</th><th>设计师</th>
              <th>购物</th><th>订阅</th><th>ROAS</th><th>CTR</th><th>花费</th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map((m) => `
              <tr>
                <td class="cell-material-name">${m.material_id}</td>
                <td><span class="tag">${m.direction}</span></td>
                <td>${m.designer}</td>
                <td style="color:#dc2626;font-weight:700">${m.purchases}</td>
                <td>${m.subscriptions}</td>
                <td>${m.roas}</td>
                <td>${m.ctr}%</td>
                <td>$${m.spend}</td>
              </tr>
            `).join('') : '<tr><td colspan="8" class="empty">本周暂无双转化好素材</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDirectionTable(rows) {
  return `
    <div class="card">
      <div class="section-title">各方向标签表现对比</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>方向</th><th>CTR</th><th>CPI</th><th>ROAS</th><th>有效素材</th>
              <th>订阅</th><th>购物</th><th>钩子率</th><th>留存率</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td><span class="tag">${r.direction}</span></td>
                <td>${r.ctr}%</td>
                <td>${r.cpi !== null ? `$${r.cpi}` : '-'}</td>
                <td>${r.roas}</td>
                <td>${r.effective_materials}</td>
                <td>${r.subscriptions}</td>
                <td style="color:#dc2626;font-weight:700">${r.purchases}</td>
                <td>${r.hook_rate ? `${r.hook_rate}%` : '-'}</td>
                <td>${r.retention_rate ? `${r.retention_rate}%` : '-'}</td>
              </tr>
            `).join('') || '<tr><td colspan="9" class="empty">暂无方向数据</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderSurvivalChart(el, trend) {
  if (!survivalChart) survivalChart = echarts.init(el);
  survivalChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['每日素材数', '成活数（有购物）'] },
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: trend.dates },
    yAxis: { type: 'value', name: '数量', minInterval: 1 },
    series: [
      { name: '每日素材数', type: 'bar', data: trend.counts, itemStyle: { color: '#1677ff' } },
      {
        name: '成活数（有购物）',
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
        ${items.map((t) => `<li>${t}</li>`).join('')}
      </ol>
    </div>
  `;
}

export async function renderWeeklyUpdate(container, state) {
  const week = state.weeklyWeek || state.meta?.weekly_labels?.slice(-1)[0];
  const data = await api.weeklyReport(week);
  const report = data.report;
  if (!report) {
    container.innerHTML = '<div class="empty">暂无周度数据，请将周度文件放入 data_inputs/</div>';
    return;
  }

  state.weeklyWeek = report.week;

  container.innerHTML = `
    <div class="week-tabs">
      ${report.weeks.map((w) => `
        <button class="tab ${w === report.week ? 'active' : ''}" data-week="${w}">${w}</button>
      `).join('')}
    </div>
    ${renderKpiSection(report.kpi, report.prev_week)}
    ${renderComparisonTable(report.core_comparison, report.prev_week)}
    ${renderGoodMaterials(report.good_materials)}
    ${renderDirectionTable(report.direction_table)}
    <div class="card">
      <div class="section-title">本周 First-Seen 成活趋势图</div>
      <div id="weekly-survival-chart" class="chart"></div>
    </div>
    ${renderInsights(report.insights)}
  `;

  container.querySelectorAll('[data-week]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.weeklyWeek = btn.dataset.week;
      renderWeeklyUpdate(container, state);
    });
  });

  renderSurvivalChart(container.querySelector('#weekly-survival-chart'), report.survival_trend);
  window.addEventListener('resize', () => survivalChart && survivalChart.resize());
}
