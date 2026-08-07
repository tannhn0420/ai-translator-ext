// ============================================
// Highlight hard words — mark uncommon/long words on the page for a learner.
// ============================================
// A content word is "hard" if it's not in the bundled common-words list (after
// light lemmatisation) and long enough. Only the FIRST occurrence of each distinct
// word is highlighted, capped per page, so the page never gets cluttered even
// though the common list is only a heuristic. Clicking a highlight → mini popup:
// see the meaning (opens the dictionary bubble) or mark the word as already known
// (persisted, never highlighted again).

import { isCommon, lemma } from './commonWords';

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA',
  'INPUT', 'SELECT', 'OPTION', 'SVG', 'CANVAS', 'A', 'BUTTON', 'H1',
]);
const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;
const CAP = 80;

let on = false;
let known = new Set<string>();
let knownLoaded = false;
const spans: HTMLElement[] = [];
let popup: HTMLElement | null = null;
let onTranslate: (word: string, rect: DOMRect) => void = () => {};

export async function initHighlight(translateCb: (word: string, rect: DOMRect) => void): Promise<void> {
  onTranslate = translateCb;
  document.addEventListener('click', onDocClick, true);
}

async function ensureKnown(): Promise<void> {
  if (knownLoaded) return;
  knownLoaded = true;
  try {
    const r = await chrome.storage.local.get({ highlightKnown: [] });
    known = new Set((r.highlightKnown as string[]) || []);
  } catch {
    /* ignore */
  }
}

/** Toggle highlighting. Returns -1 when turned OFF, otherwise the number highlighted. */
export async function toggleHighlight(minLen: number): Promise<number> {
  if (on) {
    clearHighlights();
    on = false;
    return -1;
  }
  await ensureKnown();
  applyHighlights(Math.max(4, minLen || 7));
  on = true;
  return spans.length;
}

function isSkipped(el: Element | null): boolean {
  let e: Element | null = el;
  while (e) {
    const tag = e.tagName;
    if (SKIP_TAGS.has(tag)) return true;
    if ((e as HTMLElement).isContentEditable) return true;
    if (e.id && e.id.startsWith('ai-translator')) return true;
    if (e.classList && (e.classList.contains('ai-hw') || e.classList.contains('ai-tr-bilingual'))) return true;
    e = e.parentElement;
  }
  return false;
}

function applyHighlights(minLen: number): void {
  const root = document.querySelector('article') || document.querySelector('main') || document.body;
  if (!root) return;
  const seen = new Set<string>();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.nodeValue.trim().length < minLen) return NodeFilter.FILTER_REJECT;
      return isSkipped(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    targets.push(n as Text);
    n = walker.nextNode();
  }

  for (const tn of targets) {
    if (spans.length >= CAP) break;
    wrapTextNode(tn, minLen, seen);
  }
}

function wrapTextNode(tn: Text, minLen: number, seen: Set<string>): void {
  const text = tn.nodeValue || '';
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last = 0;
  let any = false;
  const frag = document.createDocumentFragment();

  while ((m = WORD_RE.exec(text)) !== null) {
    if (spans.length >= CAP) break;
    const word = m[0];
    if (word.length < minLen) continue;
    const lem = lemma(word);
    if (isCommon(word) || known.has(lem) || seen.has(lem)) continue; // common / known / already shown
    seen.add(lem);

    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const span = document.createElement('span');
    span.className = 'ai-hw';
    span.dataset.w = word;
    span.dataset.lem = lem;
    span.textContent = word;
    frag.appendChild(span);
    spans.push(span);
    last = m.index + word.length;
    any = true;
  }

  if (any) {
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    tn.parentNode?.replaceChild(frag, tn);
  }
}

function unwrap(span: HTMLElement): void {
  const t = document.createTextNode(span.dataset.w || span.textContent || '');
  span.parentNode?.replaceChild(t, span);
}

function clearHighlights(): void {
  for (const span of spans) unwrap(span);
  spans.length = 0;
  closePopup();
}

function markKnown(lem: string): void {
  known.add(lem);
  chrome.storage.local.set({ highlightKnown: [...known] }).catch(() => {});
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].dataset.lem === lem) {
      unwrap(spans[i]);
      spans.splice(i, 1);
    }
  }
}

function onDocClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (popup && target && popup.contains(target)) return;
  const span = target?.closest?.('.ai-hw') as HTMLElement | null;
  if (span) {
    e.preventDefault();
    e.stopPropagation();
    showWordPopup(span);
    return;
  }
  closePopup();
}

function showWordPopup(span: HTMLElement): void {
  closePopup();
  const word = span.dataset.w || span.textContent || '';
  const lem = span.dataset.lem || lemma(word);
  const rect = span.getBoundingClientRect();

  popup = document.createElement('div');
  popup.className = 'ai-hw-pop';
  popup.innerHTML = `
    <button class="ai-hw-b" data-a="dich">🌐 Nghĩa</button>
    <button class="ai-hw-b" data-a="known">✓ Đã biết</button>
  `;
  popup.style.left = `${rect.left + window.scrollX}px`;
  popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
  document.body.appendChild(popup);

  popup.querySelector('[data-a="dich"]')?.addEventListener('click', () => {
    const r = span.getBoundingClientRect();
    closePopup();
    onTranslate(word, r);
  });
  popup.querySelector('[data-a="known"]')?.addEventListener('click', () => {
    closePopup();
    markKnown(lem);
  });
}

function closePopup(): void {
  popup?.remove();
  popup = null;
}
