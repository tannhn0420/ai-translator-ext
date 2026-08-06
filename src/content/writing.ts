// ============================================
// Writing Assistant — Grammarly-style proofread panel for editable fields.
// ============================================
// Shows a floating ✍️ button when an editable field (textarea / text input /
// contenteditable) is focused. Clicking it proofreads the field's text via the
// PROOFREAD message and shows a panel: corrected text, issues with Vietnamese
// explanations, a CEFR level estimate, and mode chips (Sửa / Tự nhiên / Trang
// trọng / Ngắn gọn / IELTS). "Áp dụng" writes the corrected text back.
//
// Cost/privacy by design: text is sent to the model ONLY when the user clicks —
// there is no as-you-type checking. A global setting gates the button entirely.

import type { ProofreadResult, WritingMode } from '../types';

const MODES: { key: WritingMode; label: string }[] = [
  { key: 'correct', label: 'Sửa lỗi' },
  { key: 'natural', label: 'Tự nhiên' },
  { key: 'formal', label: 'Trang trọng' },
  { key: 'concise', label: 'Ngắn gọn' },
  { key: 'ielts', label: 'IELTS' },
];

const TYPE_LABEL: Record<string, string> = {
  grammar: 'Ngữ pháp',
  spelling: 'Chính tả',
  'word-choice': 'Từ vựng',
  style: 'Văn phong',
  punctuation: 'Dấu câu',
};

const MIN_CHARS = 6;

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML.replace(/"/g, '&quot;');
}

// --- Field detection & IO ---

function isEditableField(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.id && el.id.startsWith('ai-translator')) return false;
  if (el.closest('#ai-wa-btn, #ai-wa-panel')) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') {
    const t = el as HTMLTextAreaElement;
    return !t.readOnly && !t.disabled;
  }
  if (tag === 'INPUT') {
    const inp = el as HTMLInputElement;
    const t = (inp.type || 'text').toLowerCase();
    // Text-like inputs only — never password / payment / search-chips / etc.
    return ['text', 'search', 'email', 'url', ''].includes(t) && !inp.readOnly && !inp.disabled;
  }
  if (el.isContentEditable) return true;
  // Rich editors (ProseMirror/Jira, Slate, Draft.js…) expose role="textbox"; the focused
  // node may be a wrapper, so accept it if it or an ancestor is an editable host.
  if (el.closest(EDITOR_HOST_SELECTOR)) return true;
  return false;
}

/** Selector for editable "hosts" of rich editors. */
const EDITOR_HOST_SELECTOR = '[contenteditable="true"],[contenteditable=""],[role="textbox"]';

/** Resolve the editing host of a rich editor (or the field element itself). */
function resolveField(el: HTMLElement): HTMLElement {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el;
  if (el.isContentEditable) {
    return (el.closest('[contenteditable="true"],[contenteditable=""]') as HTMLElement) || el;
  }
  return (el.closest(EDITOR_HOST_SELECTOR) as HTMLElement) || el;
}

function readText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return el.innerText;
}

/** Write text back so framework-controlled inputs (React etc.) actually update. */
function writeText(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.focus();
    let ok = false;
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel?.removeAllRanges();
      sel?.addRange(range);
      ok = document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }
    if (!ok) el.innerText = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// --- UI state ---

let getEnabled: () => boolean = () => true;
let currentField: HTMLElement | null = null;
let btn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let curMode: WritingMode = 'correct';
let onDocDown: ((e: MouseEvent) => void) | null = null;
let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

export function initWritingAssistant(enabledGetter: () => boolean): void {
  getEnabled = enabledGetter;
  injectStyles();
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', positionButton, true);
  window.addEventListener('resize', positionButton);
}

function onFocusIn(e: FocusEvent): void {
  if (!getEnabled()) return;
  const target = e.target as Element | null;
  if (!isEditableField(target)) return;
  currentField = resolveField(target as HTMLElement);
  console.debug('[AI Translator] writing: editable field detected', currentField.tagName, currentField.getAttribute('role') || '');
  showButton();
}

function onFocusOut(): void {
  // Delay so focus can move to our button/panel without it vanishing.
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    const a = document.activeElement;
    if (a && (a.id === 'ai-wa-btn' || a.closest?.('#ai-wa-panel'))) return;
    if (!panel) hideButton();
  }, 150);
}

function showButton(): void {
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'ai-wa-btn';
    btn.type = 'button';
    btn.title = 'Kiểm tra & cải thiện câu tiếng Anh';
    btn.textContent = '✍️';
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep field focus
    btn.addEventListener('click', () => currentField && openPanel(currentField));
    document.body.appendChild(btn);
  }
  btn.style.display = 'flex';
  positionButton();
}

function hideButton(): void {
  if (btn) btn.style.display = 'none';
}

function positionButton(): void {
  if (!btn || btn.style.display === 'none' || !currentField || !currentField.isConnected) return;
  const r = currentField.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) {
    hideButton();
    return;
  }
  const left = Math.max(8, Math.min(window.innerWidth - 40, r.right - 34));
  const top = Math.max(8, Math.min(window.innerHeight - 40, r.bottom - 34));
  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
}

// --- Panel ---

function closePanel(): void {
  if (onDocDown) {
    document.removeEventListener('mousedown', onDocDown, true);
    onDocDown = null;
  }
  if (onKeyDown) {
    document.removeEventListener('keydown', onKeyDown, true);
    onKeyDown = null;
  }
  panel?.remove();
  panel = null;
}

function openPanel(field: HTMLElement): void {
  closePanel();
  panel = document.createElement('div');
  panel.id = 'ai-wa-panel';
  panel.innerHTML = `
    <div class="ai-wa-head">
      <span>✍️ Trợ lý viết</span>
      <button class="ai-wa-close" title="Đóng">✕</button>
    </div>
    <div class="ai-wa-modes">
      ${MODES.map((m) => `<button class="ai-wa-mode${m.key === curMode ? ' on' : ''}" data-mode="${m.key}">${m.label}</button>`).join('')}
    </div>
    <div class="ai-wa-body"></div>
  `;
  document.body.appendChild(panel);
  panel.querySelector('.ai-wa-close')?.addEventListener('click', closePanel);
  panel.querySelectorAll('.ai-wa-mode').forEach((b) =>
    b.addEventListener('click', () => {
      curMode = (b as HTMLElement).dataset.mode as WritingMode;
      panel?.querySelectorAll('.ai-wa-mode').forEach((x) => x.classList.toggle('on', x === b));
      void runProofread(field);
    }),
  );

  positionPanel(field);
  makeDraggable();

  // Close on click outside (≈ "blur thì tắt") or Esc.
  onDocDown = (e: MouseEvent) => {
    const t = e.target as Node;
    if (panel && !panel.contains(t) && btn && !btn.contains(t)) {
      closePanel();
      if (document.activeElement !== field) hideButton();
    }
  };
  document.addEventListener('mousedown', onDocDown, true);
  onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closePanel();
  };
  document.addEventListener('keydown', onKeyDown, true);

  void runProofread(field);
}

/** Place the panel next to the field (below if there's room, otherwise above). */
function positionPanel(field: HTMLElement): void {
  if (!panel) return;
  const r = field.getBoundingClientRect();
  const pw = 360;
  const ph = Math.min(panel.offsetHeight || 340, Math.round(window.innerHeight * 0.7));
  const left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left));
  let top = r.bottom + 8;
  if (top + ph > window.innerHeight - 8) {
    const above = r.top - ph - 8;
    top = above >= 8 ? above : Math.max(8, window.innerHeight - ph - 8);
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
}

/** Make the panel draggable by its header. */
function makeDraggable(): void {
  const head = panel?.querySelector('.ai-wa-head') as HTMLElement | null;
  if (!head || !panel) return;
  head.style.cursor = 'move';
  head.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.ai-wa-close') || !panel) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const move = (ev: MouseEvent) => {
      if (!panel) return;
      const left = Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - offX));
      const top = Math.max(0, Math.min(window.innerHeight - 36, ev.clientY - offY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function setBody(html: string): void {
  const body = panel?.querySelector('.ai-wa-body');
  if (body) body.innerHTML = html;
}

async function runProofread(field: HTMLElement): Promise<void> {
  const text = readText(field).trim();
  if (text.length < MIN_CHARS) {
    setBody(`<div class="ai-wa-note">Hãy viết ít nhất vài chữ tiếng Anh rồi thử lại.</div>`);
    return;
  }
  setBody(`<div class="ai-wa-loading"><div class="ai-translator-spinner"></div> Đang kiểm tra…</div>`);

  let res: { success?: boolean; data?: ProofreadResult; error?: string } | undefined;
  try {
    res = await chrome.runtime.sendMessage({ type: 'PROOFREAD', payload: { text, mode: curMode } });
  } catch {
    setBody(`<div class="ai-wa-note ai-wa-err">Lỗi kết nối. Kiểm tra API key / reload extension.</div>`);
    return;
  }
  if (!panel) return; // closed while waiting
  if (!res?.success || !res.data) {
    setBody(`<div class="ai-wa-note ai-wa-err">${esc(res?.error || 'Không kiểm tra được.')}</div>`);
    return;
  }
  renderResult(field, res.data);
}

function renderResult(field: HTMLElement, data: ProofreadResult): void {
  const original = readText(field).trim();
  const unchanged = data.corrected.trim() === original;
  const levelBadge = data.level ? `<span class="ai-wa-level" title="Trình độ ước lượng của đoạn gốc">CEFR ${esc(data.level)}</span>` : '';

  const issues = data.issues.length
    ? data.issues
        .map(
          (i) => `
        <div class="ai-wa-issue">
          <div class="ai-wa-issue-top">
            <span class="ai-wa-badge ai-wa-${esc(i.type)}">${esc(TYPE_LABEL[i.type] || i.type)}</span>
            <span class="ai-wa-fix"><s>${esc(i.original)}</s> → <b>${esc(i.suggestion)}</b></span>
          </div>
          ${i.why ? `<div class="ai-wa-why">${esc(i.why)}</div>` : ''}
        </div>`,
        )
        .join('')
    : `<div class="ai-wa-note">👍 Không tìm thấy lỗi đáng kể.</div>`;

  setBody(`
    <div class="ai-wa-row">
      ${levelBadge}
      <span class="ai-wa-count">${data.issues.length} gợi ý</span>
    </div>
    <div class="ai-wa-corrected" title="Bản đã sửa">${esc(data.corrected)}</div>
    <div class="ai-wa-actions">
      <button class="ai-wa-apply"${unchanged ? ' disabled' : ''}>✅ Áp dụng</button>
      <button class="ai-wa-copy">📋 Chép</button>
    </div>
    <div class="ai-wa-issues">${issues}</div>
  `);

  panel?.querySelector('.ai-wa-apply')?.addEventListener('click', () => {
    writeText(field, data.corrected);
    closePanel();
  });
  panel?.querySelector('.ai-wa-copy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(data.corrected).catch(() => {});
  });
}

// --- Styles (self-contained; dark, matches the bubble/toast look) ---

let styleInjected = false;
function injectStyles(): void {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
#ai-wa-btn{position:fixed;z-index:2147483646;width:30px;height:30px;border:none;border-radius:50%;
  background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:15px;cursor:pointer;
  display:none;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.35);padding:0;line-height:1;}
#ai-wa-btn:hover{transform:scale(1.08);}
#ai-wa-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:360px;max-width:calc(100vw - 32px);
  max-height:70vh;display:flex;flex-direction:column;background:rgba(15,15,35,.98);color:#e2e8f0;
  border:1px solid rgba(99,102,241,.4);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.5);
  font-family:Inter,system-ui,sans-serif;font-size:13px;overflow:hidden;}
#ai-wa-panel .ai-wa-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;
  font-weight:600;border-bottom:1px solid rgba(255,255,255,.08);}
#ai-wa-panel .ai-wa-close{all:unset;cursor:pointer;color:#94a3b8;font-size:14px;padding:2px 6px;}
#ai-wa-panel .ai-wa-close:hover{color:#e2e8f0;}
#ai-wa-panel .ai-wa-modes{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px 4px;}
#ai-wa-panel .ai-wa-mode{all:unset;cursor:pointer;font-size:12px;padding:4px 10px;border-radius:999px;
  background:rgba(255,255,255,.06);color:#c7d2fe;border:1px solid transparent;}
#ai-wa-panel .ai-wa-mode.on{background:rgba(99,102,241,.28);border-color:rgba(99,102,241,.5);color:#fff;}
#ai-wa-panel .ai-wa-body{padding:10px 14px 14px;overflow-y:auto;}
#ai-wa-panel .ai-wa-loading{display:flex;align-items:center;gap:8px;color:#94a3b8;padding:14px 0;}
#ai-wa-panel .ai-wa-note{color:#94a3b8;padding:8px 0;}
#ai-wa-panel .ai-wa-err{color:#fca5a5;}
#ai-wa-panel .ai-wa-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
#ai-wa-panel .ai-wa-level{background:rgba(16,185,129,.2);border:1px solid rgba(16,185,129,.45);color:#6ee7b7;
  font-size:11px;padding:2px 8px;border-radius:999px;}
#ai-wa-panel .ai-wa-count{color:#94a3b8;font-size:12px;}
#ai-wa-panel .ai-wa-corrected{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
  border-radius:8px;padding:8px 10px;white-space:pre-wrap;line-height:1.5;max-height:120px;overflow-y:auto;}
#ai-wa-panel .ai-wa-actions{display:flex;gap:8px;margin:8px 0 4px;}
#ai-wa-panel .ai-wa-actions button{all:unset;cursor:pointer;font-size:12px;padding:6px 12px;border-radius:8px;}
#ai-wa-panel .ai-wa-apply{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;}
#ai-wa-panel .ai-wa-apply[disabled]{opacity:.45;cursor:not-allowed;}
#ai-wa-panel .ai-wa-copy{background:rgba(255,255,255,.08);color:#e2e8f0;}
#ai-wa-panel .ai-wa-issues{margin-top:6px;display:flex;flex-direction:column;gap:8px;}
#ai-wa-panel .ai-wa-issue{border-top:1px solid rgba(255,255,255,.06);padding-top:8px;}
#ai-wa-panel .ai-wa-issue-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
#ai-wa-panel .ai-wa-badge{font-size:10px;padding:1px 6px;border-radius:6px;background:rgba(99,102,241,.25);color:#c7d2fe;white-space:nowrap;}
#ai-wa-panel .ai-wa-fix{color:#e2e8f0;}
#ai-wa-panel .ai-wa-fix s{color:#fca5a5;}
#ai-wa-panel .ai-wa-fix b{color:#6ee7b7;}
#ai-wa-panel .ai-wa-why{color:#94a3b8;font-size:12px;margin-top:3px;line-height:1.45;}
`;
  (document.head || document.documentElement).appendChild(s);
}
