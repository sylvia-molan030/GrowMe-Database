import { api, initApi, IS_STATIC } from './api.js';
import { createDefaultFilters, renderFilters } from './filters.js';
import { renderGoldenCross } from './pages/golden-cross.js';
import { renderLeaderboard } from './pages/leaderboard.js';
import { renderDesigner } from './pages/designer.js';
import { renderAssetLibrary } from './pages/asset-library.js';
import { renderWeeklyUpdate } from './pages/weekly-update.js';
import { renderRollback } from './pages/rollback.js';
import { renderReviewBoard } from './pages/review-board.js';

const PAGE_TITLES = {
  'golden-cross': '素材黄金交叉复盘',
  leaderboard: '智能排行榜',
  designer: '设计师绩效看板',
  'asset-library': '核心资产晋级库',
  'weekly-update': '周维度更新',
  rollback: '回滚素材',
  'review-board': '每日决策面板',
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

async function refreshPage() {
  contentEl.innerHTML = '<div class="empty">加载中...</div>';
  try {
    if (state.view === 'golden-cross') await renderGoldenCross(contentEl, state);
    else if (state.view === 'leaderboard') await renderLeaderboard(contentEl, state);
    else if (state.view === 'designer') await renderDesigner(contentEl, state);
    else if (state.view === 'asset-library') await renderAssetLibrary(contentEl, state);
    else if (state.view === 'weekly-update') await renderWeeklyUpdate(contentEl, state);
    else if (state.view === 'rollback') await renderRollback(contentEl);
    else if (state.view === 'review-board') await renderReviewBoard(contentEl, state);
    else contentEl.innerHTML = '<div class="empty">页面不存在或脚本未更新，请强制刷新（Cmd+Shift+R）</div>';
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
  state.tablePage = 1;
  state.assetPage = 1;
  titleEl.textContent = PAGE_TITLES[view] || 'GrowMe';
  filtersEl.style.display = (view === 'weekly-update' || view === 'rollback' || view === 'review-board') ? 'none' : '';
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === view);
  });
  refreshPage();
}

function renderMeta(meta, scannedAt) {
  const catalog = meta.catalog || {};
  const modeLabel = IS_STATIC ? 'GitHub 静态站' : '本地服务';
  const buildAt = meta.generated_at || meta.scanned_at || scannedAt || '-';
  metaEl.innerHTML = `
    ${modeLabel}<br/>
    已加载 ${meta.files_loaded.length} 个文件<br/>
    共 ${meta.records} 条原始记录<br/>
    账户素材 ${catalog.total_materials || '-'} 条 · 周度上新 ${catalog.weekly_materials || '-'} 条<br/>
    周度：${(meta.weekly_labels || []).join('、') || '-'}<br/>
    数据快照：${buildAt}${meta.static ? '<br/><span style="color:#6b7280">≠本地时请 push 后等 1 分钟</span>' : ''}
  `;
}

let apiMode = 'live';

async function bootstrap() {
  apiMode = await initApi();
  state.meta = await api.meta();
  state.filters = createDefaultFilters(state.meta);
  renderMeta(state.meta, state.meta.scanned_at);

  const uploadBtn = document.getElementById('btn-upload');
  const fileInput = document.getElementById('file-upload');

  if (IS_STATIC || apiMode === 'static-fallback') {
    uploadBtn.textContent = '↑ 上传数据';
    uploadBtn.title = '线上静态站无法直接上传，请本地 ./start.sh 使用，或 push 到 GitHub';
  } else {
    uploadBtn.title = '上传 CSV/Excel：账户全量、周度 WW、回滚素材、数字人';
  }

  renderFilters(filtersEl, state, onFiltersChange);

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.page));
  });

  uploadBtn.addEventListener('click', () => {
    if (IS_STATIC || apiMode === 'static-fallback') {
      alert(
        'GitHub 线上站无法直接上传文件。\n\n'
        + '【本地预览上传】\n'
        + '终端执行 ./start.sh，打开 http://localhost:8000/ 后点「上传数据」\n\n'
        + '【更新线上】\n'
        + '本地执行 ./scripts/update_account.sh --push 或 ./scripts/update_weekly.sh --push'
      );
      return;
    }
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const files = fileInput.files;
    if (!files?.length) return;
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
