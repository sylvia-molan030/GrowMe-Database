import { api, initApi, IS_STATIC } from './api.js';
import { createDefaultFilters, renderFilters } from './filters.js';

const V = document.documentElement.dataset.build || '0';
const pageModules = {
  'golden-cross': () => import(`./pages/golden-cross.js?v=${V}`),
  leaderboard: () => import(`./pages/leaderboard.js?v=${V}`),
  designer: () => import(`./pages/designer.js?v=${V}`),
  'asset-library': () => import(`./pages/asset-library.js?v=${V}`),
  'weekly-update': () => import(`./pages/weekly-update.js?v=${V}`),
  rollback: () => import(`./pages/rollback.js?v=${V}`),
};

const PAGE_TITLES = {
  'golden-cross': '素材黄金交叉复盘',
  leaderboard: '智能排行榜',
  designer: '设计师绩效看板',
  'asset-library': '核心资产晋级库',
  'weekly-update': '周维度更新',
  rollback: '回滚素材',
};

const RENDERERS = {
  'golden-cross': 'renderGoldenCross',
  leaderboard: 'renderLeaderboard',
  designer: 'renderDesigner',
  'asset-library': 'renderAssetLibrary',
  'weekly-update': 'renderWeeklyUpdate',
  rollback: 'renderRollback',
};

const state = {
  view: 'golden-cross',
  meta: null,
  filters: null,
  tablePage: 1,
  keyword: '',
  sortBy: 'purchases',
  sortDir: 'desc',
  assetTier: 0,
  assetPage: 1,
  assetKeyword: '',
  assetScopeMode: 'weekly',
  weeklyWeek: null,
};

const filtersEl = document.getElementById('filters');
const contentEl = document.getElementById('page-content');
const titleEl = document.getElementById('page-title');
const metaEl = document.getElementById('sidebar-meta');

function loadingSkeletonHtml() {
  return `
    <div class="skeleton-block">
      <div class="skeleton" style="width:30%;height:24px;margin-bottom:16px"></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
        ${Array(6).fill('<div class="skeleton-card"><div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:40%;height:28px;margin-top:8px"></div></div>').join('')}
      </div>
      <div class="skeleton-card">
        <div class="skeleton" style="width:40%"></div>
        <div class="skeleton" style="width:100%;height:360px;margin-top:12px"></div>
      </div>
    </div>
  `;
}

async function refreshPage() {
  contentEl.innerHTML = loadingSkeletonHtml();
  try {
    const loader = pageModules[state.view];
    if (!loader) {
      contentEl.innerHTML = '<div class="empty">页面不存在或脚本未更新，请强制刷新（Cmd+Shift+R）</div>';
      return;
    }
    const mod = await loader();
    const fn = mod[RENDERERS[state.view]];
    if (typeof fn !== 'function') throw new Error(`页面模块缺少 ${RENDERERS[state.view]}`);
    await fn(contentEl, state);
    updateFilterBadge(state);
  } catch (err) {
    console.error(err);
    contentEl.innerHTML = `<div class="empty">加载失败：${err.message}</div>`;
  }
}

function onFiltersChange(next) {
  state.filters = next;
  renderFilters(filtersEl, state, onFiltersChange);
  refreshPage();
}

function setView(view) {
  state.view = view;
  titleEl.textContent = PAGE_TITLES[view] || view;
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === view);
  });
  refreshPage();
}

function renderMeta(meta, scannedAt) {
  if (!metaEl || !meta) return;
  const catalog = meta.catalog || {};
  const weeks = (meta.weekly_labels || []).join(' · ') || '-';
  const recent = (meta.recent_weekly_labels || []).join(' · ') || '-';
  metaEl.innerHTML = `
    <div>${IS_STATIC ? 'GitHub 静态站' : '本地 API'}</div>
    <div>已加载 ${(meta.files_loaded || []).length} 个文件</div>
    <div>共 ${meta.records || 0} 条原始记录</div>
    <div>账户素材 ${catalog.total_materials ?? '-'} 条</div>
    <div>上新素材 ${catalog.weekly_materials ?? '-'} 条（近2周）</div>
    <div>周度：${weeks}</div>
    <div>近2周：${recent}</div>
    <div>数据快照：${scannedAt || meta.scanned_at || meta.generated_at || '-'}</div>
  `;
  const freshness = document.getElementById('data-freshness');
  if (freshness) {
    const t = scannedAt || meta.scanned_at || meta.generated_at;
    freshness.textContent = t ? `数据更新于 ${t}` : '';
  }
}

function updateFilterBadge(state) {
  const badge = document.getElementById('filter-badge');
  if (!badge) return;
  const f = state.filters || {};
  const active = [];
  if (f.channel && f.channel !== 'ALL' && f.channel !== '全部') active.push(f.channel);
  if (f.direction && f.direction !== '全部') active.push(`FX:${f.direction}`);
  if (f.theme && f.theme !== '全部') active.push(`ZT:${f.theme}`);
  if (f.designer && f.designer !== '全部') active.push(`设计师:${f.designer}`);
  if (f.mode === 'new') active.push('上新素材(全量·近2周)');
  if (f.preset && f.preset !== 'all') active.push('日期范围');
  if (active.length) {
    badge.textContent = `筛选: ${active.join(', ')}`;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

async function bootstrap() {
  await initApi();
  state.meta = await api.meta();
  state.filters = createDefaultFilters(state.meta);
  renderMeta(state.meta);
  renderFilters(filtersEl, state, onFiltersChange);

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.page));
  });

  const menuToggle = document.getElementById('menu-toggle');
  menuToggle?.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.toggle('open');
  });

  const fileInput = document.getElementById('file-upload');
  const uploadBtn = document.getElementById('btn-upload');
  uploadBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const files = [...(fileInput.files || [])];
    if (!files.length) return;
    uploadBtn.classList.add('is-loading');
    uploadBtn.textContent = '上传中…';
    try {
      const result = await api.upload(files);
      state.meta = await api.meta();
      renderMeta(state.meta, result.scan?.scanned_at);
      renderFilters(filtersEl, state, onFiltersChange);
      await refreshPage();
      const lines = (result.saved || []).map((s) => `· ${s.original_name} → ${s.saved_as}\n  ${s.label}`);
      const err = (result.errors || []).length ? `\n\n部分失败：\n${result.errors.join('\n')}` : '';
      alert(`${result.message || '上传成功'}\n\n${lines.join('\n')}${err}`);
    } catch (err) {
      alert(`上传失败：${err.message}`);
    } finally {
      uploadBtn.classList.remove('is-loading');
      uploadBtn.textContent = '↑ 上传数据';
      fileInput.value = '';
    }
  });

  setView('golden-cross');
}

bootstrap().catch((err) => {
  contentEl.innerHTML = `<div class="empty">初始化失败：${err.message}<br/>请确认后端已启动（./start.sh）。</div>`;
});
