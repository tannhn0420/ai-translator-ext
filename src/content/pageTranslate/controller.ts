// ============================================
// Page Translate — Controller (Phase 2: lazy, viewport-first)
// ============================================
// Collects candidate blocks, then translates them lazily via an IntersectionObserver:
// blocks in (or near) the viewport translate first, and more translate as the user
// scrolls. This makes the page feel instant and avoids spending tokens on content the
// user never scrolls to. A per-page snapshot of both original and translated DOM keeps
// toggling (revert ↔ show) instant and free.

import { collectBlocks } from './segmenter';
import { serializeBlock, applyTranslation } from './serialize';
import {
  PAGE_BATCH_MAX_ITEMS,
  PAGE_BATCH_MAX_CHARS,
  PAGE_TRANSLATE_CONCURRENCY,
} from '../../utils/constants';
import type {
  Language,
  PageTranslateMode,
  BatchTranslateItem,
  BatchTranslateResponse,
} from '../../types';

interface TrackedBlock {
  el: HTMLElement;
  original?: Node[]; // replace mode: pristine original children (clones)
  translatedNodes?: Node[]; // replace mode: translated children (clones)
  bilingualNode?: HTMLElement; // bilingual mode: inserted translation node
}

/** A single block can't exceed this serialized size (avoids token blow-ups). */
const HARD_BLOCK_CHAR_CAP = 8000;
/** Preload translations this far outside the viewport for a seamless scroll. */
const OBSERVER_ROOT_MARGIN = '800px 0px';
/** Debounce window to coalesce scroll-triggered blocks into batches. */
const FLUSH_DEBOUNCE_MS = 120;

// --- Per-page state ---
let active = false; // page-translate mode engaged
let showing = false; // translations currently displayed (vs reverted)
let displayMode: PageTranslateMode = 'replace';
let currentLang: Language = 'vi';

let observer: IntersectionObserver | null = null;
let candidates: HTMLElement[] = []; // all collected blocks
const tracked = new Map<HTMLElement, TrackedBlock>(); // successfully translated blocks
let queue: HTMLElement[] = []; // visible blocks awaiting a batch

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let pendingReflush = false;

let translatedCount = 0;
let processedAny = false;
let errorShown = false;

export function isPageTranslated(): boolean {
  return showing;
}

/**
 * Entry point for popup / context-menu. Toggles translation on/off. Re-showing an
 * existing translation is a local DOM swap (no API); scrolling keeps translating.
 */
export async function handleTranslatePage(mode: PageTranslateMode, targetLang: Language): Promise<void> {
  if (active && showing) {
    pause();
    return;
  }
  if (active && !showing && mode === displayMode && targetLang === currentLang) {
    resume();
    return;
  }
  deactivate();
  activate(mode, targetLang);
}

// --- Lifecycle ---

function activate(mode: PageTranslateMode, targetLang: Language): void {
  const blocks = collectBlocks(targetLang);
  if (blocks.length === 0) {
    showToast('Không tìm thấy nội dung cần dịch trên trang.');
    return;
  }

  active = true;
  showing = true;
  displayMode = mode;
  currentLang = targetLang;
  candidates = blocks;
  translatedCount = 0;
  processedAny = false;
  errorShown = false;

  observer = new IntersectionObserver(onIntersect, { rootMargin: OBSERVER_ROOT_MARGIN });
  for (const el of candidates) observer.observe(el);
  setStatus('Đang dịch…', true);
}

/** Revert to original but keep the snapshot + candidate list for an instant resume. */
function pause(): void {
  observer?.disconnect();
  observer = null;
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const [el, t] of tracked) revertBlock(el, t);
  showing = false;
  setStatus('↩️ Đã khôi phục bản gốc', false);
}

/** Re-show existing translations and resume observing for on-scroll translation. */
function resume(): void {
  for (const [el, t] of tracked) reShowBlock(el, t);
  observer = new IntersectionObserver(onIntersect, { rootMargin: OBSERVER_ROOT_MARGIN });
  for (const el of candidates) {
    if (!tracked.has(el) && el.isConnected) observer.observe(el);
  }
  showing = true;
  setStatus(`🌐 Đã dịch ${translatedCount} đoạn`, false);
}

/** Fully tear down (used before a fresh translation in a different mode/target). */
function deactivate(): void {
  observer?.disconnect();
  observer = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const [el, t] of tracked) revertBlock(el, t);
  tracked.clear();
  candidates = [];
  queue = [];
  active = false;
  showing = false;
  translatedCount = 0;
}

// --- Observation → queue → batch ---

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const el = entry.target as HTMLElement;
    observer?.unobserve(el); // translate each block once
    if (!tracked.has(el) && !el.hasAttribute('data-ai-translated')) {
      queue.push(el);
    }
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer || queue.length === 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, FLUSH_DEBOUNCE_MS);
}

async function flushQueue(): Promise<void> {
  if (flushing) {
    pendingReflush = true;
    return;
  }
  flushing = true;

  try {
    while (queue.length > 0) {
      const take = queue.splice(0, queue.length);
      const entries: { el: HTMLElement; map: Node[] }[] = [];
      const items: BatchTranslateItem[] = [];

      for (const el of take) {
        if (!el.isConnected || tracked.has(el)) continue;
        const { text, map } = serializeBlock(el);
        if (!text.trim() || text.length > HARD_BLOCK_CHAR_CAP) continue;
        const i = entries.length;
        entries.push({ el, map });
        items.push({ i, text });
      }
      if (items.length === 0) continue;

      processedAny = true;
      setStatus(`Đang dịch… ${translatedCount} đoạn`, true);

      const batches = chunkItems(items);
      await runPool(batches, PAGE_TRANSLATE_CONCURRENCY, async (batch) => {
        let data: Record<number, string> = {};
        try {
          const resp: BatchTranslateResponse = await chrome.runtime.sendMessage({
            type: 'TRANSLATE_BATCH',
            payload: { items: batch, targetLang: currentLang },
          });
          data = resp?.data || {};
        } catch {
          // Extension context lost / provider error — leave these blocks as original.
        }
        for (const it of batch) {
          const translated = data[it.i];
          const entry = entries[it.i];
          if (entry && typeof translated === 'string' && translated.length > 0) {
            if (applyToBlock(entry.el, entry.map, translated, displayMode)) translatedCount++;
          }
        }
        setStatus(`Đang dịch… ${translatedCount} đoạn`, true);
      });
    }
  } finally {
    flushing = false;
    if (pendingReflush) {
      pendingReflush = false;
      scheduleFlush();
    } else {
      if (processedAny && translatedCount === 0 && !errorShown) {
        errorShown = true;
        setStatus('⚠️ Chưa dịch được đoạn nào — kiểm tra API key / hạn mức.', false);
      } else {
        setStatus(`🌐 Đã dịch ${translatedCount} đoạn`, false);
      }
    }
  }
}

// --- Per-block apply / show / revert ---

function applyToBlock(el: HTMLElement, map: Node[], translated: string, mode: PageTranslateMode): boolean {
  if (!el.isConnected) return false;

  const t: TrackedBlock = { el };
  if (mode === 'bilingual') {
    const wrap = document.createElement('div');
    wrap.className = 'ai-tr-bilingual';
    wrap.setAttribute('data-ai-translated', '1');
    applyTranslation(wrap, translated, map);
    el.insertAdjacentElement('afterend', wrap);
    t.bilingualNode = wrap;
  } else {
    t.original = Array.from(el.childNodes).map((n) => n.cloneNode(true));
    applyTranslation(el, translated, map);
    t.translatedNodes = Array.from(el.childNodes).map((n) => n.cloneNode(true));
  }

  el.setAttribute('data-ai-translated', '1');
  tracked.set(el, t);
  return true;
}

function reShowBlock(el: HTMLElement, t: TrackedBlock): void {
  if (!el.isConnected) return;
  if (t.bilingualNode) {
    el.insertAdjacentElement('afterend', t.bilingualNode);
  } else if (t.translatedNodes) {
    el.replaceChildren(...t.translatedNodes.map((n) => n.cloneNode(true)));
  }
  el.setAttribute('data-ai-translated', '1');
}

function revertBlock(el: HTMLElement, t: TrackedBlock): void {
  if (t.bilingualNode) t.bilingualNode.remove();
  if (t.original && el.isConnected) {
    el.replaceChildren(...t.original.map((n) => n.cloneNode(true)));
  }
  el.removeAttribute('data-ai-translated');
}

// --- Batching helpers ---

function chunkItems(items: BatchTranslateItem[]): BatchTranslateItem[][] {
  const batches: BatchTranslateItem[][] = [];
  let cur: BatchTranslateItem[] = [];
  let chars = 0;
  for (const it of items) {
    if (
      cur.length > 0 &&
      (cur.length >= PAGE_BATCH_MAX_ITEMS || chars + it.text.length > PAGE_BATCH_MAX_CHARS)
    ) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += it.text.length;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

async function runPool<T>(
  tasks: T[],
  limit: number,
  worker: (task: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (index < tasks.length) {
      const task = tasks[index++];
      try {
        await worker(task);
      } catch {
        // one batch failing must not abort the rest
      }
    }
  });
  await Promise.all(runners);
}

// --- Status pill (persistent while active, auto-hides when idle) ---

const STATUS_BASE =
  'position:fixed;right:16px;bottom:16px;z-index:2147483647;font-family:Inter,system-ui,sans-serif;' +
  'font-size:13px;color:#e2e8f0;background:rgba(15,15,35,0.95);border:1px solid rgba(99,102,241,0.35);' +
  'border-radius:20px;box-shadow:0 8px 24px rgba(0,0,0,0.4);padding:8px 14px;display:flex;' +
  'align-items:center;gap:8px;transition:opacity .3s ease;';

let statusEl: HTMLElement | null = null;
let statusHideTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(message: string, busy: boolean): void {
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'ai-translator-page-status';
    (document.body || document.documentElement).appendChild(statusEl);
  }
  statusEl.style.cssText = STATUS_BASE + 'opacity:1;';
  statusEl.innerHTML = busy
    ? `<div class="ai-translator-spinner" style="width:13px;height:13px;flex:0 0 auto;"></div><span>${escapeText(message)}</span>`
    : `<span>${escapeText(message)}</span>`;

  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }
  if (!busy) {
    statusHideTimer = setTimeout(() => {
      if (statusEl) statusEl.style.opacity = '0';
      statusHideTimer = setTimeout(() => {
        statusEl?.remove();
        statusEl = null;
      }, 350);
    }, 1800);
  }
}

/** Transient toast for one-off notices (empty page, etc.). */
function showToast(message: string): void {
  const el = document.createElement('div');
  el.id = 'ai-translator-page-toast';
  el.style.cssText = STATUS_BASE + 'opacity:1;';
  el.textContent = message;
  (document.body || document.documentElement).appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function escapeText(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
