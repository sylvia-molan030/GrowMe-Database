function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatRate(value) {
  if (value === null || value === undefined || value === '' || Number(value) <= 0) return '-';
  return `${Number(value).toFixed(2)}%`;
}

export function showMaterialDetail(mat) {
  const old = document.getElementById('material-modal');
  if (old) old.remove();

  const roas = mat.roas || 0;
  const scalingCls = mat.scaling_status === '增长期' ? 'green'
    : mat.scaling_status === '炮灰' ? 'red'
    : mat.scaling_status === '衰退期' ? 'orange' : '';

  const overlay = document.createElement('div');
  overlay.id = 'material-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3>素材详情</h3>
        <button class="modal-close" id="modal-close" type="button">&times;</button>
      </div>
      <div class="modal-body">
        <div class="detail-grid">
          <div class="detail-item"><span class="label">素材 ID</span><span class="value">${escapeHtml(mat.material_id)}</span></div>
          <div class="detail-item"><span class="label">首次上线</span><span class="value">${escapeHtml(mat.first_seen || '-')}</span></div>
          <div class="detail-item"><span class="label">设计师</span><span class="value">${escapeHtml(mat.designer || '-')}</span></div>
          <div class="detail-item"><span class="label">方向（用户人群）</span><span class="value"><span class="tag">${escapeHtml(mat.direction || '-')}</span></span></div>
          <div class="detail-item"><span class="label">主题（ZT-）</span><span class="value">${escapeHtml(mat.theme || '-')}</span></div>
          <div class="detail-item"><span class="label">优化标签</span><span class="value">${escapeHtml(mat.optimization || '-')}</span></div>
          <div class="detail-item"><span class="label">渠道</span><span class="value">${escapeHtml(mat.channel || '-')}</span></div>
          <div class="detail-item"><span class="label">放量状态</span><span class="value"><span class="tag ${scalingCls}">${escapeHtml(mat.scaling_status || '-')}</span></span></div>
          <div class="detail-item"><span class="label">吸睛率</span><span class="value" style="font-weight:600">${formatRate(mat.hook_rate)}</span></div>
          <div class="detail-item"><span class="label">持续播放率</span><span class="value" style="font-weight:600">${formatRate(mat.retention_rate)}</span></div>
          <div class="detail-item"><span class="label">消耗</span><span class="value" style="color:var(--red)">$${mat.spend || 0}</span></div>
          <div class="detail-item"><span class="label">出单</span><span class="value" style="font-weight:700;color:#dc2626">${mat.purchases || 0}</span></div>
          <div class="detail-item"><span class="label">ROAS</span><span class="value" style="color:${roas >= 1.5 ? '#16a34a' : '#dc2626'}">${mat.roas ?? '-'}</span></div>
          <div class="detail-item"><span class="label">CTR</span><span class="value">${mat.ctr ?? '-'}%</span></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('#modal-close').addEventListener('click', () => overlay.remove());
  const escClose = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escClose);
    }
  };
  document.addEventListener('keydown', escClose);
}

export function bindMaterialDetailLinks(container, rows) {
  const links = container.querySelectorAll('.mat-detail-link');
  links.forEach((el, i) => {
    el.addEventListener('click', () => showMaterialDetail(rows[i]));
  });
}
