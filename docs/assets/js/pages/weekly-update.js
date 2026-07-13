import { api } from '../api.js';
import { renderCrossRubricHeatmap, escapeHtml } from '../heatmap-grid.js';

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

function renderSummary(kpi, prevWeek) {
  const wow = kpi.wow || {};
  const orderRateDelta = wow.order_rate && wow.order_rate.pct !== null
    ? `(${wow.order_rate.direction === 'up' ? '+' : ''}${wow.order_rate.pct}%)`
    : '';
  const spendDelta = wow.spend && wow.spend.pct !== null
    ? `(${wow.spend.direction === 'up' ? '+' : ''}${wow.spend.pct}%)`
    : '';

  let summaryLine = `本周消耗 $${kpi.spend || 0}${spendDelta}，${kpi.total_materials || 0} 条素材`;
  if (kpi.ordered_materials != null) summaryLine += `，出单素材 ${kpi.ordered_materials} 条`;
  summaryLine += `，出单率 ${kpi.order_rate || 0}%${orderRateDelta}`;
  if (kpi.avg_roas) summaryLine += `，平均 ROAS ${kpi.avg_roas}`;

  return `
    <div class="card" style="background:#f0f7ff;border-left:4px solid #378add;padding:12px 16px;border-radius:8px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:600;color:#0c447c;margin-bottom:4px">本周一句话总结</div>
      <div style="font-size:13px;color:#185fa5;line-height:1.6">${summaryLine}</div>
    </div>
  `;
}

function renderKpiSection(kpi, prevWeek) {
  const wow = kpi.wow || {};
  const hasWow = Boolean(prevWeek);

  return `
    <div class="section-title">周度 KPI（WW 全球）${hasWow ? ' <span class="muted">（含 WoW 环比）</span>' : ''}</div>
    <div class="kpi-grid kpi-grid-4">
      ${kpiCard('WW 消耗', `$${fmt(kpi.spend)}`, hasWow ? wow.spend : null)}
      ${kpiCard('总素材量', `${kpi.total_materials} 条`, hasWow ? wow.total_materials : null)}
      ${kpiCard('出单素材数', kpi.ordered_materials, hasWow ? wow.ordered_materials : null, '有购物即计入')}
      ${kpiCard('总出单量', kpi.conversions, hasWow ? wow.conversions : null)}
      ${kpiCard('WW 出单率', `${kpi.order_rate}%`, hasWow ? wow.order_rate : null)}
      ${kpiCard('≥2 单素材率', `${kpi.ge2_rate}%`, hasWow ? wow.ge2_rate : null)}
      ${kpiCard('≥5 单素材率', `${kpi.ge5_rate}%`, hasWow ? wow.ge5_rate : null)}
      ${kpiCard('平均 ROAS', kpi.avg_roas ?? '-', hasWow ? wow.avg_roas : null)}
    </div>
  `;
}

function renderComparisonTable(rows, prevWeek) {
  if (!rows?.length) return '';
  return `
    <div class="card">
      <div class="section-title">核心指标对照${prevWeek ? ` <span class="muted">（对比 ${formatWeekLabel(prevWeek)}）</span>` : ''}</div>
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
              <th>花费</th><th>购物</th><th>订阅</th><th>ROAS</th><th>CTR</th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map((m) => `
              <tr>
                <td class="cell-material-name">${escapeHtml(m.material_id)}</td>
                <td><span class="tag">${escapeHtml(m.direction)}</span></td>
                <td>${escapeHtml(m.designer)}</td>
                <td>$${m.spend}</td>
                <td style="color:#dc2626;font-weight:700">${m.purchases}</td>
                <td>${m.subscriptions}</td>
                <td>${m.roas}</td>
                <td>${m.ctr}%</td>
              </tr>
            `).join('') : '<tr><td colspan="8" class="empty">本周暂无双转化好素材</td></tr>'}
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

function renderDirectionTable(rows) {
  return `
    <div class="card">
      <div class="section-title">各方向标签表现对比</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>方向</th><th>素材量</th><th>出单素材</th><th>消耗</th><th>CTR</th><th>CPI</th><th>ROAS</th>
              <th>订阅</th><th>购物</th><th>钩子率</th><th>留存率</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td><span class="tag">${escapeHtml(r.direction)}</span></td>
                <td>${r.total_materials ?? '-'}</td>
                <td><strong>${r.ordered_ratio || `${r.ordered_materials}/${r.total_materials || '-'}`}</strong></td>
                <td>$${r.spend ?? '-'}</td>
                <td>${r.ctr}%</td>
                <td>${r.cpi !== null ? `$${r.cpi}` : '-'}</td>
                <td>${r.roas}</td>
                <td>${r.subscriptions}</td>
                <td style="color:#dc2626;font-weight:700">${r.purchases}</td>
                <td>${r.hook_rate ? `${r.hook_rate}%` : '-'}</td>
                <td>${r.retention_rate ? `${r.retention_rate}%` : '-'}</td>
              </tr>
            `).join('') || '<tr><td colspan="11" class="empty">暂无方向数据</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAudienceTest(block) {
  if (!block?.materials?.length) return '';
  return `
    <div class="card weekly-callout">
      <div class="section-title">新方向 · 人群测试</div>
      <p class="weekly-callout-note">${escapeHtml(block.note || '')}</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>目标人群</th><th>设计师</th>
              <th>花费</th><th>购物</th><th>订阅</th><th>ROAS</th><th>CTR</th>
              <th>3秒播放率</th><th>留存率</th>
            </tr>
          </thead>
          <tbody>
            ${block.materials.map((m) => `
              <tr>
                <td>
                  <div style="font-weight:600">${escapeHtml(m.target_audience)}</div>
                  <div class="cell-material-name" style="font-size:11px;margin-top:4px">${escapeHtml(m.material_id)}</div>
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

function renderMaterialTestBlock(block) {
  if (!block) return '';
  const s = block.summary || {};
  return `
    <div class="card weekly-callout">
      <div class="section-title">本周测试 · ${escapeHtml(block.label)}</div>
      <p class="weekly-callout-note">${escapeHtml(block.note || '')}</p>
      <div class="kpi-grid kpi-grid-3 weekly-callout-kpi">
        ${kpiCard('测试素材量', `${s.total_materials ?? 0} 条`)}
        ${kpiCard('出单量', s.conversions ?? 0)}
        ${kpiCard('出单率', `${s.order_rate ?? 0}%`, null, s.ordered_materials != null ? `出单素材 ${s.ordered_materials} 条` : '')}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>素材</th><th>方向</th><th>主题</th><th>设计师</th>
              <th>花费</th><th>购物</th><th>ROAS</th><th>CTR</th>
              <th>3秒播放率</th><th>留存率</th>
            </tr>
          </thead>
          <tbody>
            ${block.materials?.length ? block.materials.map((m) => `
              <tr>
                <td class="cell-material-name">${escapeHtml(m.material_id)}</td>
                <td><span class="tag">${escapeHtml(m.direction || '-')}</span></td>
                <td>${escapeHtml(m.theme || '-')}</td>
                <td>${escapeHtml(m.designer || '-')}</td>
                <td>$${m.spend}</td>
                <td style="color:#dc2626;font-weight:700">${m.purchases}</td>
                <td>${m.roas}</td>
                <td>${m.ctr}%</td>
                <td>${m.hook_rate != null ? `${m.hook_rate}%` : '-'}</td>
                <td>${m.retention_rate != null ? `${m.retention_rate}%` : '-'}</td>
              </tr>
            `).join('') : '<tr><td colspan="10" class="empty">本板块暂无出单素材</td></tr>'}
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
        ${items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
      </ol>
    </div>
  `;
}

function sortMaterialTestBlocks(report) {
  const blocks = report.material_test_blocks || [];
  const order = { 老形式: 0, 新创意: 1, 图片: 2 };
  return [...blocks].sort((a, b) => (order[a.label] ?? 9) - (order[b.label] ?? 9));
}

export async function renderWeeklyUpdate(container, state) {
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

  container.innerHTML = `
    <div class="week-tabs">
      ${weeks.map((w) => `
        <button class="tab ${w === report.week ? 'active' : ''}" data-week="${escapeHtml(w)}">${escapeHtml(formatWeekLabel(w))}</button>
      `).join('')}
    </div>
    ${renderSummary(report.kpi, report.prev_week)}
    ${renderKpiSection(report.kpi, report.prev_week)}
    ${renderComparisonTable(report.core_comparison, report.prev_week)}
    ${renderCrossRubricHeatmap(report.cross_rubric_heatmap)}
    ${renderDirectionTable(report.direction_table)}
    ${renderGoodMaterials(report.good_materials)}
    ${sortMaterialTestBlocks(report).map((block) => renderMaterialTestBlock(block)).join('')}
    ${renderAudienceTest(report.audience_test)}
    <div class="card">
      <div class="section-title">本周 First-Seen 成活趋势图</div>
      <div id="weekly-survival-chart" class="chart"></div>
    </div>
    ${renderInsights(report.insights)}
  `;

  container.querySelectorAll('[data-week]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.weeklyWeek = btn.dataset.week;
      container.innerHTML = '<div class="empty">加载中...</div>';
      await renderWeeklyUpdate(container, state);
    });
  });

  const chartEl = container.querySelector('#weekly-survival-chart');
  if (chartEl && report.survival_trend) {
    renderSurvivalChart(chartEl, report.survival_trend);
  }
  window.addEventListener('resize', () => survivalChart && survivalChart.resize());
}
