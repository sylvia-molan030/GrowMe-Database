import { api } from '../api.js';

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function renderReviewBoard(container, state) {
  try {
    const all = await api.materials({}, { mode: 'account', page_size: 9999 });
    const items = all.rows || [];

    const today = new Date().toISOString().slice(0, 10);

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const newItems = items.filter((m) => m.first_seen && m.first_seen >= sevenDaysAgo);

    const byDay = {};
    newItems.forEach((m) => {
      const day = m.first_seen;
      if (!byDay[day]) byDay[day] = { total: 0, withOrders: 0, spend: 0, purchases: 0, items: [] };
      byDay[day].total++;
      byDay[day].spend += m.spend || 0;
      byDay[day].purchases += m.purchases || 0;
      if (m.purchases >= 1) byDay[day].withOrders++;
      byDay[day].items.push(m);
    });

    const days = Object.keys(byDay).sort().reverse();

    const oldItems = items.filter((m) =>
      m.first_seen && m.first_seen < sevenDaysAgo
      && m.first_seen >= new Date(Date.now() - 37 * 86400000).toISOString().slice(0, 10));
    const oldDay1Rate = oldItems.length
      ? oldItems.filter((m) => m.purchases >= 1).length / oldItems.length
      : 0;

    let html = '<div class="section-title">每日新素材冷启动监控 (近7日)</div>';
    html += `<div style="margin-bottom:16px;font-size:12px;color:#6b7280">历史基准 Day1 出单率：${(oldDay1Rate * 100).toFixed(1)}%，总素材 ${oldItems.length} 条</div>`;

    days.forEach((day) => {
      const d = byDay[day];
      const orderRate = d.total ? (d.withOrders / d.total * 100).toFixed(1) : 0;
      const avgSpend = d.total ? Math.round(d.spend / d.total) : 0;

      let statusColor = '#d1d5db';
      let statusText = '数据不足';
      let statusBg = '#f9fafb';
      if (avgSpend >= 50) {
        const rate = d.withOrders / d.total;
        if (rate >= oldDay1Rate * 1.2) {
          statusColor = '#16a34a'; statusText = '有潜力'; statusBg = '#f0fdf4';
        } else if (rate >= oldDay1Rate * 0.5) {
          statusColor = '#ef9f27'; statusText = '观察中'; statusBg = '#fffbeb';
        } else {
          statusColor = '#dc2626'; statusText = '需关注'; statusBg = '#fef2f2';
        }
      }

      const isToday = day === today;

      html += `
        <div class="card" style="margin-bottom:12px; border-left:4px solid ${statusColor}; background:${statusBg}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-weight:500;font-size:14px">${day} ${isToday ? '<span style="font-size:11px;background:#dbeafe;color:#1d4ed8;padding:2px 6px;border-radius:4px">今天</span>' : ''}</div>
            <div style="font-size:13px;font-weight:500;color:${statusColor}">${statusText}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;font-size:12px">
            <div><span style="color:#6b7280">上新</span><br/><strong>${d.total} 条</strong></div>
            <div><span style="color:#6b7280">已出单</span><br/><strong>${d.withOrders} 条 (${orderRate}%)</strong></div>
            <div><span style="color:#6b7280">总出单</span><br/><strong style="color:#dc2626">${d.purchases}</strong></div>
            <div><span style="color:#6b7280">平均花费</span><br/><strong>$${avgSpend}</strong></div>
          </div>
        </div>
      `;
    });

    if (days.length === 0) {
      html += '<div class="card"><div class="empty">近 7 日无新素材上线</div></div>';
    }

    container.innerHTML = html;
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="empty">加载失败：${escapeHtml(err.message)}</div>`;
  }
}
