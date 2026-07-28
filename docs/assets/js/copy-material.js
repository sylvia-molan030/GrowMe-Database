function copySync(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function readCopyText(el) {
  if (el.dataset.copy) return el.dataset.copy;
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.copy-hint').forEach((n) => n.remove());
  return clone.textContent.trim();
}

function showCopyHint(anchor, message = '已复制到剪贴板') {
  const host = anchor.closest('td') || anchor.closest('.detail-item') || anchor;
  host.querySelectorAll('.copy-hint').forEach((n) => n.remove());
  const hint = document.createElement('div');
  hint.className = 'copy-hint';
  hint.textContent = message;
  host.appendChild(hint);
  clearTimeout(host._copyHintTimer);
  host._copyHintTimer = setTimeout(() => hint.remove(), 1600);
}

export async function copyMaterialName(text, options = {}) {
  const value = String(text || '').trim();
  if (!value) return false;

  let ok = copySync(value);
  if (!ok && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      ok = false;
    }
  }

  if (ok && options.toast !== false && options.anchor) {
    showCopyHint(options.anchor, options.toastMessage || '已复制到剪贴板');
  }
  return ok;
}

export function bindCopyMaterials(container) {
  if (!container) return;
  container.querySelectorAll('[data-copy], .mat-copy, .cell-material-name').forEach((el) => {
    if (el.dataset.copyBound === '1') return;
    el.dataset.copyBound = '1';
    if (!el.classList.contains('mat-copy')) el.classList.add('mat-copy');
    if (!el.title) el.title = '点击复制素材名';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const text = readCopyText(el);
      const ok = copySync(text);
      if (ok) {
        showCopyHint(el, '已复制到剪贴板');
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 800);
        return;
      }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showCopyHint(el, '已复制到剪贴板');
          el.classList.add('copied');
          setTimeout(() => el.classList.remove('copied'), 800);
        }).catch(() => {
          showCopyHint(el, '复制失败，请手动选择复制');
        });
        return;
      }
      showCopyHint(el, '复制失败，请手动选择复制');
    });
  });
}
