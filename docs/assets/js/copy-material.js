export async function copyMaterialName(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function bindCopyMaterials(container) {
  if (!container) return;
  container.querySelectorAll('[data-copy], .mat-copy, .cell-material-name').forEach((el) => {
    if (el.dataset.copyBound === '1') return;
    el.dataset.copyBound = '1';
    if (!el.classList.contains('mat-copy')) el.classList.add('mat-copy');
    if (!el.title) el.title = '点击复制素材名';
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = el.dataset.copy || el.textContent.trim();
      const ok = await copyMaterialName(text);
      if (ok) {
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 800);
      }
    });
  });
}
