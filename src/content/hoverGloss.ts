// ============================================
// Hover-to-translate — quick word gloss on hover (no selection needed).
// ============================================
// When enabled, dwelling the cursor on an English word for ~450ms shows a small
// tooltip with its Vietnamese meaning + a 🔊 button. Results are cached in-session
// and (via the background) across sessions, so it's cheap. Opt-in via a setting.

import { pickVoice } from '../utils/voice';

let getEnabled: () => boolean = () => false;
let tip: HTMLElement | null = null;
let dwellTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let lastKey = '';
let voices: SpeechSynthesisVoice[] = [];
const cache = new Map<string, string>(); // word(lower) -> Vietnamese gloss

const WORD_CHAR = /[A-Za-z'’-]/;

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function initHoverGloss(enabled: () => boolean): void {
  getEnabled = enabled;
  if ('speechSynthesis' in window) {
    const load = () => { voices = window.speechSynthesis.getVoices() || []; };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
  }
  injectStyle();
  document.addEventListener('mousemove', onMove);
  document.addEventListener('scroll', hideNow, true);
}

function onMove(e: MouseEvent): void {
  if (!getEnabled()) { hideNow(); return; }
  const t = e.target as HTMLElement | null;
  if (
    !t ||
    (t.closest && t.closest('#ai-gloss-tip, #ai-translator-bubble, #ai-translator-sidebar, #ai-translator-icon, #ai-translator-reminder, input, textarea, select, [contenteditable="true"]')) ||
    t.isContentEditable
  ) {
    scheduleHide();
    return;
  }
  // Ignore while the user has an active text selection (that's the bubble's job).
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().trim()) return;

  if (dwellTimer) clearTimeout(dwellTimer);
  const x = e.clientX;
  const y = e.clientY;
  dwellTimer = setTimeout(() => void handleHover(x, y), 450);
}

function wordAtPoint(x: number, y: number): { word: string; rect: DOMRect } | null {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const caret = doc.caretRangeFromPoint ? doc.caretRangeFromPoint(x, y) : null;
  if (!caret) return null;
  const node = caret.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.nodeValue || '';
  const i = caret.startOffset;
  if (!WORD_CHAR.test(text[i] || '') && !WORD_CHAR.test(text[i - 1] || '')) return null;
  let a = i;
  while (a > 0 && WORD_CHAR.test(text[a - 1])) a--;
  let b = i;
  while (b < text.length && WORD_CHAR.test(text[b])) b++;
  const word = text.slice(a, b).replace(/^['’-]+|['’-]+$/g, '');
  if (word.length < 3 || !/[A-Za-z]/.test(word)) return null;
  try {
    const range = document.createRange();
    range.setStart(node, a);
    range.setEnd(node, a + word.length);
    return { word, rect: range.getBoundingClientRect() };
  } catch {
    return null;
  }
}

async function handleHover(x: number, y: number): Promise<void> {
  if (!getEnabled()) return;
  const hit = wordAtPoint(x, y);
  if (!hit) { scheduleHide(); return; }
  const key = hit.word.toLowerCase();
  if (key === lastKey && tip && tip.style.display === 'block') return;
  lastKey = key;

  const cached = cache.get(key);
  if (cached !== undefined) {
    showTip(hit.rect, hit.word, cached || '(?)');
    return;
  }
  showTip(hit.rect, hit.word, '…');
  let gloss = '';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'TRANSLATE_BATCH', payload: { items: [{ i: 0, text: hit.word }], targetLang: 'vi' } });
    gloss = res?.data?.[0] || '';
  } catch {
    gloss = '';
  }
  cache.set(key, gloss);
  if (lastKey === key) showTip(hit.rect, hit.word, gloss || '(?)');
}

function speakWord(word: string): void {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  const v = pickVoice(voices, 'en');
  if (v) u.voice = v;
  else u.lang = 'en-US';
  window.speechSynthesis.speak(u);
}

function showTip(rect: DOMRect, word: string, gloss: string): void {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'ai-gloss-tip';
    document.body.appendChild(tip);
    tip.addEventListener('mouseenter', () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
    tip.addEventListener('mouseleave', scheduleHide);
  }
  tip.innerHTML = `<div class="ag-head"><span class="ag-w">${esc(word)}</span><button class="ag-tts" title="Nghe">🔊</button></div><div class="ag-m">${esc(gloss)}</div>`;
  tip.querySelector('.ag-tts')?.addEventListener('click', (ev) => { ev.stopPropagation(); speakWord(word); });
  tip.style.display = 'block';
  const tw = 220;
  const left = Math.max(8, Math.min(window.innerWidth - tw - 8, rect.left) + window.scrollX);
  const top = rect.bottom + window.scrollY + 6;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function scheduleHide(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hideNow, 250);
}

function hideNow(): void {
  if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
  if (tip) tip.style.display = 'none';
  lastKey = '';
}

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
#ai-gloss-tip{position:absolute;z-index:2147483646;display:none;max-width:220px;
  background:rgba(15,15,35,.98);color:#e2e8f0;border:1px solid rgba(99,102,241,.45);
  border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.45);padding:8px 10px;
  font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.4;}
#ai-gloss-tip .ag-head{display:flex;align-items:center;gap:6px;}
#ai-gloss-tip .ag-w{font-weight:700;color:#fff;}
#ai-gloss-tip .ag-tts{all:unset;cursor:pointer;font-size:13px;margin-left:auto;}
#ai-gloss-tip .ag-m{color:#6ee7b7;margin-top:3px;}
`;
  (document.head || document.documentElement).appendChild(s);
}
