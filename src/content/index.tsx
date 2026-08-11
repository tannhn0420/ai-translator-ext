// ============================================
// Content Script - Entry Point
// ============================================
// Injected into all web pages to enable highlight translation

import type { TranslateResponse, PageTranslateMode, Language, VocabCard, ProofreadResult, PageSummary } from '../types';
import { handleTranslatePage } from './pageTranslate/controller';
import { translateSelection } from './pageTranslate/selection';
import { initWritingAssistant } from './writing';
import { initHighlight, toggleHighlight } from './highlight';
import { reviewCard } from '../utils/srs';

// Avoid re-injection
if (!(window as unknown as Record<string, boolean>).__AI_TRANSLATOR_INJECTED__) {
  (window as unknown as Record<string, boolean>).__AI_TRANSLATOR_INJECTED__ = true;
  initContentScript();
}

interface CachedSettings {
  sidebarToggleY: number;
  sidebarWidth: number;
  autoTranslateOnHighlight: boolean;
  dictionaryModeEnabled: boolean;
  contextAwareEnabled: boolean;
  ttsVoiceEn: string;
  ttsVoiceVi: string;
  ttsRate: number;
  reminderEnabled: boolean;
  reminderIntervalMin: number;
  vocabAutoImage: boolean;
  writingAssistantEnabled: boolean;
  highlightMinLen: number;
}

const CONTEXT_CHARS_AROUND = 250;
const DICT_WORD_LIMIT = 2;
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH_RATIO = 0.6; // max 60% of viewport
const DEFAULT_SIDEBAR_WIDTH = 360;
const DRAG_THRESHOLD_PX = 5;
const TOGGLE_HEIGHT = 44;
const TOGGLE_TOP_MARGIN = 8;

function initContentScript() {
  let bubble: HTMLDivElement | null = null;
  let iconNode: HTMLDivElement | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  let cachedSettings: CachedSettings = {
    sidebarToggleY: 0,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    autoTranslateOnHighlight: true,
    dictionaryModeEnabled: true,
    contextAwareEnabled: true,
    ttsVoiceEn: '',
    ttsVoiceVi: '',
    ttsRate: 0.95,
    reminderEnabled: true,
    reminderIntervalMin: 10,
    vocabAutoImage: true,
    writingAssistantEnabled: true,
    highlightMinLen: 7,
  };
  let reminderTimer: ReturnType<typeof setInterval> | null = null;
  let reminderIntervalCur = 0; // minutes the current timer was created with

  // Bubble drag-position memory (per-session, viewport coords)
  let bubbleDragState: { left: number; top: number } | null = null;

  const VI_RE = /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i;
  const detectLang = (s: string): Language => (VI_RE.test(s) ? 'vi' : 'en');

  // Cloned selection range for in-place selection translation (survives selection collapse).
  let currentSelectionRange: Range | null = null;

  // Cached TTS voices. getVoices() is empty on first call after load until voiceschanged
  // fires, so prime it once and keep it fresh (otherwise the first 🔊 ignores the chosen voice).
  let ttsVoices: SpeechSynthesisVoice[] = [];
  if ('speechSynthesis' in window) {
    const loadVoices = () => { ttsVoices = window.speechSynthesis.getVoices() || []; };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  }

  // With all_frames enabled, this script also runs inside sub-frames (e.g. Jira's TinyMCE
  // editor iframe). Only the writing assistant should run everywhere; all the page-level
  // features stay in the TOP frame so we don't duplicate the sidebar / reminder / page-
  // translate / selection bubble across every embedded iframe.
  const IS_TOP = (() => {
    try {
      return window.top === window.self;
    } catch {
      return false; // cross-origin access threw → we're in a sub-frame
    }
  })();

  if (IS_TOP) initSidebar();

  // Listen for text selection
  if (IS_TOP) document.addEventListener('mouseup', (e) => {
    if (bubble && bubble.contains(e.target as Node)) return;
    if (iconNode && iconNode.contains(e.target as Node)) return;
    const sidebar = document.getElementById('ai-translator-sidebar');
    const toggle = document.getElementById('ai-translator-sidebar-toggle');
    if (sidebar && sidebar.contains(e.target as Node)) return;
    if (toggle && toggle.contains(e.target as Node)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      handleSelection(e);
    }, 300);
  });

  // Click outside to dismiss icon (but not bubble — bubble has explicit close)
  if (IS_TOP) document.addEventListener('mousedown', (e) => {
    if (iconNode && !iconNode.contains(e.target as Node)) {
      removeIcon();
    }
  });

  // Double Shift in-place translation
  let lastShiftTime = 0;
  if (IS_TOP) document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      const now = Date.now();
      if (now - lastShiftTime < 500) {
        lastShiftTime = 0;
        handleInplaceTranslation();
      } else {
        lastShiftTime = now;
      }
    }
  });

  // Keyboard shortcut: Ctrl+Shift+H (Cmd+Shift+H on Mac) toggles sidebar
  if (IS_TOP) document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (cmdOrCtrl && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
      e.preventDefault();
      e.stopPropagation();
      toggleSidebar();
    }
    // ESC closes bubble
    if (e.key === 'Escape' && bubble) {
      removeBubble();
    }
  });

  // Listen for messages from background (top frame only — tabs.sendMessage broadcasts to
  // all frames, and page-translate / zen / selection must run once, in the main document).
  if (IS_TOP) chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRANSLATE_SELECTION' && message.payload?.text) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        currentSelectionRange = range.cloneRange();
        const rect = range.getBoundingClientRect();
        showTranslationBubble(rect, message.payload.text, extractContext(range));
      }
    } else if (message.type === 'TRIGGER_ZEN_MODE') {
      activateZenMode();
    } else if (message.type === 'TRIGGER_SUMMARY') {
      showReadingHelper();
    } else if (message.type === 'TRIGGER_HIGHLIGHT') {
      void toggleHighlight(cachedSettings.highlightMinLen).then((count) => {
        if (count === -1) showInlineToast('Đã tắt tô sáng từ khó.', true);
        else if (count === 0) showInlineToast('Không thấy từ khó theo danh sách (thử giảm độ dài tối thiểu trong Cài đặt).', false);
        else showInlineToast(`Đã tô ${count} từ khó — bấm vào từ để xem nghĩa hoặc đánh dấu "đã biết".`, true);
      });
    } else if (message.type === 'TRANSLATE_PAGE') {
      const mode: PageTranslateMode = message.payload?.mode === 'bilingual' ? 'bilingual' : 'replace';
      const targetLang: Language = message.payload?.targetLang === 'en' ? 'en' : 'vi';
      handleTranslatePage(mode, targetLang);
    } else if (message.type === 'TRANSLATE_SELECTION_INLINE') {
      const mode: PageTranslateMode = message.payload?.mode === 'bilingual' ? 'bilingual' : 'replace';
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        runInlineSelectionTranslate(selection.getRangeAt(0).cloneRange(), mode);
      }
    }
  });

  // Load settings on startup (in every frame — the writing assistant needs them too).
  loadSettings();
  if (IS_TOP) maybeAutoTranslatePage();
  initWritingAssistant(() => cachedSettings.writingAssistantEnabled);
  if (IS_TOP) initHighlight((word, rect) => showTranslationBubble(rect, word, ''));

  /**
   * Auto-translate the whole page on load if the current host is in the user's
   * remembered auto-translate list (Phase 3, per-site). The MutationObserver in the
   * page-translate controller then keeps up with any content that loads later.
   */
  async function maybeAutoTranslatePage() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      const s = resp?.data;
      if (!s) return;

      const domains: string[] = s.pageAutoDomains || [];
      const host = location.hostname.replace(/^www\./, '');
      if (!domains.some((d) => d.replace(/^www\./, '') === host)) return;

      let hasKey = !!s.apiKey; // gemini default
      if (s.provider === 'groq') hasKey = !!s.groqApiKey;
      else if (s.provider === 'openrouter') hasKey = !!s.openrouterApiKey;
      if (!hasKey) return;

      const mode: PageTranslateMode = s.pageTranslateMode === 'bilingual' ? 'bilingual' : 'replace';
      const targetLang: Language = s.pageTargetLang === 'en' ? 'en' : 'vi';
      const run = () => handleTranslatePage(mode, targetLang);

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(run, 800);
      } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(run, 800));
      }
    } catch {
      // ignore
    }
  }

  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.data) {
        cachedSettings = {
          sidebarToggleY: response.data.sidebarToggleY || 0,
          sidebarWidth: response.data.sidebarWidth || DEFAULT_SIDEBAR_WIDTH,
          autoTranslateOnHighlight: response.data.autoTranslateOnHighlight !== false,
          dictionaryModeEnabled: response.data.dictionaryModeEnabled !== false,
          contextAwareEnabled: response.data.contextAwareEnabled !== false,
          ttsVoiceEn: response.data.ttsVoiceEn || '',
          ttsVoiceVi: response.data.ttsVoiceVi || '',
          ttsRate: response.data.ttsRate || 0.95,
          reminderEnabled: response.data.reminderEnabled !== false,
          reminderIntervalMin: response.data.reminderIntervalMin || 10,
          vocabAutoImage: response.data.vocabAutoImage !== false,
          writingAssistantEnabled: response.data.writingAssistantEnabled !== false,
          highlightMinLen: response.data.highlightMinLen || 7,
        };
        if (IS_TOP) applySidebarSettings();
        if (IS_TOP) startReminderTimer();
      }
    } catch {
      // keep defaults
    }
  }

  // Reflect settings changed elsewhere (Options page, other tabs) into this already-open tab,
  // so e.g. the reminder interval / TTS voice / toggles apply without a reload. Ignore the
  // high-frequency stats keys (incrementStats writes them on every translation) to avoid churn.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const STATS_ONLY = new Set(['totalTranslations', 'apiCallsToday', 'lastResetDate']);
    if (Object.keys(changes).every((k) => STATS_ONLY.has(k))) return;
    void loadSettings();
  });

  async function persistSettings(updates: Partial<CachedSettings>) {
    cachedSettings = { ...cachedSettings, ...updates };
    try {
      await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: updates });
    } catch {
      // ignore
    }
  }

  /**
   * Extract context paragraph around the selection range for context-aware translation.
   */
  function extractContext(range: Range): string {
    try {
      let node: Node | null = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      if (!node || !(node instanceof Element)) return '';
      // Walk up to find a paragraph-like ancestor
      const blockTags = new Set(['P', 'DIV', 'LI', 'TD', 'BLOCKQUOTE', 'ARTICLE', 'SECTION']);
      let el: Element | null = node;
      while (el && !blockTags.has(el.tagName) && el.parentElement) {
        el = el.parentElement;
        if (el === document.body) break;
      }
      const text = (el?.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text) return '';
      const selected = range.toString();
      const idx = text.indexOf(selected);
      if (idx === -1) return text.substring(0, CONTEXT_CHARS_AROUND * 2);
      const start = Math.max(0, idx - CONTEXT_CHARS_AROUND);
      const end = Math.min(text.length, idx + selected.length + CONTEXT_CHARS_AROUND);
      return text.substring(start, end);
    } catch {
      return '';
    }
  }

  async function handleSelection(e: MouseEvent) {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (!selectedText || selectedText.length < 2) return;

    const range = selection!.getRangeAt(0);
    currentSelectionRange = range.cloneRange();
    const rect = range.getBoundingClientRect();
    const x = rect.left + rect.width / 2 || e.clientX;
    const y = rect.bottom || e.clientY;
    const context = extractContext(range);

    let autoTranslate = cachedSettings.autoTranslateOnHighlight;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      let hasKey = !!response?.data?.apiKey;
      if (response?.data?.provider === 'openai') hasKey = !!response?.data?.openaiApiKey;
      else if (response?.data?.provider === 'groq') hasKey = !!response?.data?.groqApiKey;
      else if (response?.data?.provider === 'openrouter') hasKey = !!response?.data?.openrouterApiKey;
      if (!hasKey) {
        showTranslationBubble({ left: x - 150, top: y + 10, width: 300 } as DOMRect, selectedText, context);
        return;
      }
      autoTranslate = response.data.autoTranslateOnHighlight !== false;
    } catch {
      // keep defaults
    }

    const wordCount = selectedText.split(/\s+/).length;

    // Short lookups (1–2 words) pop the dictionary straight away — that's the quick vocab flow.
    // Anything longer (a passage) shows the icon; hovering it lets the user pick Dịch / Viết lại.
    if (autoTranslate && wordCount <= DICT_WORD_LIMIT && cachedSettings.dictionaryModeEnabled) {
      showTranslationBubble({ left: x - 150, top: y + 10, width: 300 } as DOMRect, selectedText, context);
    } else {
      showTranslateIcon(rect, selectedText, e, context);
    }
  }

  async function handleInplaceTranslation() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString();
    if (!selectedText.trim()) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.bottom;

    const loaderId = 'ai-translator-inplace-loader';
    let loader = document.getElementById(loaderId);
    if (!loader) {
      loader = document.createElement('div');
      loader.id = loaderId;
      loader.style.cssText = `
        position: absolute; left: ${x + window.scrollX}px; top: ${y + window.scrollY + 10}px;
        z-index: 2147483647; background: rgba(15,15,35,0.9); color: #34d399;
        padding: 4px 10px; border-radius: 20px; font-size: 12px;
        display: flex; align-items: center; gap: 6px;
      `;
      loader.innerHTML = '<div class="ai-translator-spinner" style="width:12px;height:12px;"></div> Đang dịch...';
      document.body.appendChild(loader);
    }

    const isVietnamese = /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i.test(selectedText);
    const targetLang = isVietnamese ? 'en' : 'vi';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_INPLACE',
        payload: { text: selectedText, targetLang }
      });

      if (loader) loader.remove();

      if (response?.success && response.data) {
        let textResult = response.data.text.trim();
        textResult = textResult.replace(/^\[Fallback to [^\]]+\]\s*/i, '');
        range.deleteContents();
        range.insertNode(document.createTextNode(textResult));

        const flash = document.createElement('div');
        flash.style.cssText = `
          position: absolute; left: ${x + window.scrollX}px; top: ${y + window.scrollY + 10}px;
          z-index: 2147483647; background: rgba(16,185,129,0.9); color: #fff;
          padding: 4px 10px; border-radius: 20px; font-size: 12px;
        `;
        flash.textContent = '✅ Đã dịch xong';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 1500);

        removeBubble();
        removeIcon();
      } else {
        alert('Lỗi dịch thuật: ' + (response?.error || 'Không rõ nguyên nhân'));
      }
    } catch {
      if (loader) loader.remove();
      alert('Lỗi kết nối. Vui lòng thử lại.');
    }
  }

  /** Show a small icon near the selection; hovering it reveals "Dịch" and "Viết lại". */
  function showTranslateIcon(rect: DOMRect, text: string, e: MouseEvent, context: string) {
    removeBubble();
    removeIcon();

    iconNode = document.createElement('div');
    iconNode.id = 'ai-translator-icon';
    iconNode.innerHTML = `
      <div class="ai-tr-badge" title="AI Translator">✨</div>
      <div class="ai-tr-menu">
        <button class="ai-tr-opt" data-act="translate">🌐 Dịch</button>
        <button class="ai-tr-opt" data-act="rewrite">✨ Viết lại</button>
      </div>
    `;

    const iconX = e.clientX + window.scrollX + 10;
    const iconY = e.clientY + window.scrollY + 12;
    iconNode.style.cssText = `position: absolute; left: ${iconX}px; top: ${iconY}px; z-index: 2147483647;`;

    // Keep the page selection while interacting with the icon/menu.
    iconNode.addEventListener('mousedown', (ev) => ev.preventDefault());
    iconNode.querySelectorAll('.ai-tr-opt').forEach((b) =>
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const act = (b as HTMLElement).dataset.act;
        removeIcon();
        if (act === 'rewrite') showRewriteBubble(rect, text);
        else showTranslationBubble(rect, text, context);
      }),
    );

    document.body.appendChild(iconNode);
  }

  const REWRITE_MODES: { key: string; label: string }[] = [
    { key: 'natural', label: 'Tự nhiên' },
    { key: 'correct', label: 'Sửa lỗi' },
    { key: 'simplify', label: 'Đơn giản' },
    { key: 'formal', label: 'Trang trọng' },
    { key: 'concise', label: 'Ngắn gọn' },
    { key: 'ielts', label: 'IELTS' },
  ];

  /** Build the bubble scaffold (header + empty loading body), position + wire it, return it. */
  function createBubble(rect: DOMRect, logo: string, title: string, loadingText: string): HTMLElement {
    removeBubble();

    bubble = document.createElement('div');
    bubble.id = 'ai-translator-bubble';
    bubble.innerHTML = `
      <div class="ai-translator-bubble-content">
        <div class="ai-translator-bubble-header" data-drag-handle="1">
          <span class="ai-translator-bubble-logo">${logo}</span>
          <span class="ai-translator-bubble-title">${escapeHtml(title)}</span>
          <button class="ai-translator-bubble-pin" id="ai-translator-bubble-pin" title="Pin to position">📌</button>
          <button class="ai-translator-bubble-close" id="ai-translator-close" title="Close">✕</button>
        </div>
        <div class="ai-translator-bubble-body">
          <div class="ai-translator-bubble-loading">
            <div class="ai-translator-spinner"></div>
            <span>${escapeHtml(loadingText)}</span>
          </div>
        </div>
      </div>
    `;

    // Initial position: either remembered fixed-position (from prior drag) or near selection
    if (bubbleDragState) {
      bubble.style.position = 'fixed';
      bubble.style.left = `${bubbleDragState.left}px`;
      bubble.style.top = `${bubbleDragState.top}px`;
    } else {
      bubble.style.position = 'absolute';
      bubble.style.left = `${Math.max(10, rect.left + window.scrollX)}px`;
      bubble.style.top = `${rect.top + window.scrollY + (rect.height || 0) + 8}px`;
    }
    bubble.style.zIndex = '2147483647';

    document.body.appendChild(bubble);
    bubble.querySelector('#ai-translator-close')?.addEventListener('click', removeBubble);
    enableBubbleDrag(bubble);
    return bubble;
  }

  function showTranslationBubble(rect: DOMRect, text: string, context: string) {
    createBubble(rect, '🌐', 'AI Translator', 'Đang dịch...');
    translateText(text, context);
  }

  /** Rewrite/improve the selected English text; read-only result the user can copy or listen to.
   *  A mode bar (Tự nhiên / Sửa lỗi / Trang trọng / Ngắn gọn / IELTS) re-runs on the same text. */
  function showRewriteBubble(rect: DOMRect, text: string) {
    createBubble(rect, '✨', 'Viết lại', '…');
    const body = bubble?.querySelector('.ai-translator-bubble-body') as HTMLElement | null;
    if (!body) return;

    let mode = 'natural';
    body.innerHTML = `
      <div class="ai-rw-modes">
        ${REWRITE_MODES.map(
          (m) => `<button class="ai-rw-mode${m.key === mode ? ' on' : ''}" data-mode="${m.key}">${m.label}</button>`,
        ).join('')}
      </div>
      <div class="ai-rw-result"></div>
    `;
    const resultEl = body.querySelector('.ai-rw-result') as HTMLElement;

    const run = (m: string) => {
      mode = m;
      body.querySelectorAll('.ai-rw-mode').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.mode === m));
      resultEl.innerHTML = `<div class="ai-translator-bubble-loading"><div class="ai-translator-spinner"></div><span>Đang viết lại...</span></div>`;
      chrome.runtime
        .sendMessage({ type: 'PROOFREAD', payload: { text, mode: m } })
        .then((res: { success?: boolean; data?: ProofreadResult; error?: string }) => {
          if (!bubble || !resultEl.isConnected) return;
          if (!res?.success || !res.data) {
            resultEl.innerHTML = `<div class="ai-translator-bubble-error">⚠️ ${escapeHtml(res?.error || 'Không viết lại được')}</div>`;
            return;
          }
          renderRewriteResult(resultEl, res.data, text);
        })
        .catch(() => {
          if (resultEl.isConnected) resultEl.innerHTML = `<div class="ai-translator-bubble-error">⚠️ Lỗi kết nối</div>`;
        });
    };

    body.querySelectorAll('.ai-rw-mode').forEach((b) =>
      b.addEventListener('click', () => run((b as HTMLElement).dataset.mode as string)),
    );
    run(mode);
  }

  function renderRewriteResult(body: HTMLElement, data: ProofreadResult, original: string) {
    const changed = data.corrected.trim() !== original.trim();
    const issuesHtml = (data.issues || []).length
      ? `<div class="ai-rw-issues">${data
          .issues!.map(
            (i) =>
              `<div class="ai-rw-issue"><span class="ai-rw-fix"><s>${escapeHtml(i.original)}</s> → <b>${escapeHtml(i.suggestion)}</b></span>${i.why ? `<div class="ai-rw-why">${escapeHtml(i.why)}</div>` : ''}</div>`,
          )
          .join('')}</div>`
      : '';
    body.innerHTML = `
      <div class="ai-translator-bubble-result-container">
        ${data.level ? `<span class="ai-rw-level">CEFR ${escapeHtml(data.level)}</span>` : ''}
        <div class="ai-rw-corrected">${escapeHtml(data.corrected)}</div>
        <div class="ai-action-bar">
          <button class="ai-tts-btn" data-text="${escapeHtml(data.corrected)}" data-lang="en" title="Phát âm">🔊 Nghe</button>
          <button class="ai-copy-all-btn" data-text="${escapeHtml(data.corrected)}" title="Copy">📋 Copy</button>
        </div>
        ${changed ? issuesHtml : '<div class="ai-rw-note">👍 Câu đã khá ổn, không cần sửa nhiều.</div>'}
      </div>
    `;
    wireActionBar(body);
  }

  /** Extract the main readable text of the page (article/main/body), minus noise + our UI. */
  function getReadableText(maxChars: number): string {
    const root = document.querySelector('article') || document.querySelector('main') || document.body;
    if (!root) return '';
    const clone = root.cloneNode(true) as HTMLElement;
    ['nav', 'header', 'footer', 'script', 'style', 'noscript', 'iframe', 'svg', 'aside', '[id^="ai-translator"]', '.ai-tr-bilingual'].forEach(
      (sel) => clone.querySelectorAll(sel).forEach((el) => el.remove()),
    );
    return clone.innerText.trim().slice(0, maxChars);
  }

  /** Reading helper: Vietnamese summary + key vocabulary for the current article. */
  async function showReadingHelper() {
    if (document.getElementById('ai-translator-reading')) return; // don't stack
    const text = getReadableText(12000);
    if (text.length < 80) {
      showInlineToast('Không tìm thấy đủ nội dung để tóm tắt trên trang này.', false);
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'ai-translator-reading';
    overlay.innerHTML = `
      <div class="ai-rh-card">
        <div class="ai-rh-head">
          <span>📄 Tóm tắt &amp; từ khoá</span>
          <button class="ai-rh-close" title="Đóng">✕</button>
        </div>
        <div class="ai-rh-body">
          <div class="ai-translator-bubble-loading"><div class="ai-translator-spinner"></div><span>Đang đọc và tóm tắt…</span></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.ai-rh-close')?.addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    const body = overlay.querySelector('.ai-rh-body') as HTMLElement;

    let res: { success?: boolean; data?: PageSummary; error?: string } | undefined;
    try {
      res = await chrome.runtime.sendMessage({ type: 'SUMMARIZE_PAGE', payload: { text } });
    } catch {
      body.innerHTML = `<div class="ai-translator-bubble-error">⚠️ Lỗi kết nối.</div>`;
      return;
    }
    if (!document.getElementById('ai-translator-reading')) return; // closed while waiting
    if (!res?.success || !res.data) {
      body.innerHTML = `<div class="ai-translator-bubble-error">⚠️ ${escapeHtml(res?.error || 'Không tóm tắt được')}</div>`;
      return;
    }
    renderReadingHelp(body, res.data);
  }

  function renderReadingHelp(body: HTMLElement, data: PageSummary) {
    const kw = data.keywords
      .map(
        (k) => `
      <div class="ai-rh-kw">
        <div class="ai-rh-kw-main"><b>${escapeHtml(k.term)}</b> — ${escapeHtml(k.meaning)}</div>
        <div class="ai-rh-kw-acts">
          <button class="ai-tts-btn ai-rh-mini" data-text="${escapeHtml(k.term)}" data-lang="en" title="Nghe">🔊</button>
          <button class="ai-rh-save ai-rh-mini" data-term="${escapeHtml(k.term)}" data-meaning="${escapeHtml(k.meaning)}" title="Lưu vào sổ từ vựng">📇</button>
        </div>
      </div>`,
      )
      .join('');
    body.innerHTML = `
      ${data.summary ? `<div class="ai-rh-summary">${escapeHtml(data.summary).replace(/\n/g, '<br>')}</div>` : ''}
      ${data.keywords.length ? `<h4 class="ai-rh-h">Từ khoá đáng học</h4><div class="ai-rh-kws">${kw}</div>` : ''}
    `;
    wireActionBar(body);
    body.querySelectorAll('.ai-rh-save').forEach((b) =>
      b.addEventListener('click', async () => {
        const el = b as HTMLButtonElement;
        if (el.disabled) return;
        try {
          const r = await chrome.runtime.sendMessage({
            type: 'SAVE_VOCAB',
            payload: { term: el.dataset.term || '', meaning: el.dataset.meaning || '', lang: 'en', sourceUrl: location.href },
          });
          el.textContent = r?.data?.added === false ? '↺' : '✓';
          el.disabled = true;
        } catch {
          /* ignore */
        }
      }),
    );
  }

  /** Append a follow-up "ask the tutor" box to a bubble result container (keeps context). */
  function attachFollowUp(scope: HTMLElement, context: string) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-followup';
    wrap.innerHTML = `
      <div class="ai-fu-log"></div>
      <div class="ai-fu-row">
        <input class="ai-fu-input" type="text" placeholder="💬 Hỏi thêm về câu/từ này…" />
        <button class="ai-fu-send" title="Gửi">➤</button>
      </div>
    `;
    scope.appendChild(wrap);
    const log = wrap.querySelector('.ai-fu-log') as HTMLElement;
    const input = wrap.querySelector('.ai-fu-input') as HTMLInputElement;
    const history: { role: 'user' | 'assistant'; text: string }[] = [];

    const addMsg = (role: 'user' | 'assistant', text: string): HTMLElement => {
      const el = document.createElement('div');
      el.className = `ai-fu-msg ${role}`;
      el.textContent = text;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    };

    let busy = false;
    const ask = async () => {
      const q = input.value.trim();
      if (!q || busy) return;
      busy = true;
      input.value = '';
      addMsg('user', q);
      const priorHistory = history.slice();
      history.push({ role: 'user', text: q });
      const answerEl = addMsg('assistant', '…');
      try {
        const res = await chrome.runtime.sendMessage({ type: 'ASK_FOLLOWUP', payload: { context, question: q, history: priorHistory } });
        const ans = res?.success ? res.data?.answer || '' : res?.error || 'Không trả lời được.';
        answerEl.textContent = ans;
        if (res?.success) history.push({ role: 'assistant', text: ans });
      } catch {
        answerEl.textContent = 'Lỗi kết nối.';
      }
      busy = false;
    };
    wrap.querySelector('.ai-fu-send')?.addEventListener('click', ask);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ask();
      }
    });
  }

  /**
   * Make the bubble draggable. Uses its header as the drag handle.
   * Switches to position: fixed during/after drag so it stays put while scrolling.
   */
  function enableBubbleDrag(el: HTMLDivElement) {
    const handle = el.querySelector('[data-drag-handle]') as HTMLElement | null;
    if (!handle) return;
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', (e: MouseEvent) => {
      // Don't start drag when clicking buttons inside header
      if ((e.target as HTMLElement).closest('button')) return;

      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = el.getBoundingClientRect();
      let dragging = false;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        handle.style.cursor = 'grabbing';

        // Switch to fixed positioning relative to viewport
        if (el.style.position !== 'fixed') {
          el.style.position = 'fixed';
        }
        const newLeft = clamp(rect.left + dx, 0, window.innerWidth - el.offsetWidth);
        const newTop = clamp(rect.top + dy, 0, window.innerHeight - 40);
        el.style.left = `${newLeft}px`;
        el.style.top = `${newTop}px`;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.style.cursor = 'grab';
        if (dragging) {
          bubbleDragState = {
            left: parseFloat(el.style.left) || 0,
            top: parseFloat(el.style.top) || 0,
          };
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }

  function translateText(text: string, context: string) {
    const isVietnamese = /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i.test(text);
    const targetLang = isVietnamese ? 'en' : 'vi';
    const wordCount = text.trim().split(/\s+/).length;
    const dictionaryMode = wordCount <= DICT_WORD_LIMIT && cachedSettings.dictionaryModeEnabled;

    const payload = {
      text,
      sourceLang: 'auto',
      targetLang,
      context: cachedSettings.contextAwareEnabled ? context : undefined,
      dictionaryMode,
    };

    const getBody = () => bubble?.querySelector('.ai-translator-bubble-body') as HTMLElement | null;

    const finalize = (full: string) => {
      const body = getBody();
      if (!body) return;
      renderTranslationResult(body, full, text, dictionaryMode);
      const sidebar = document.getElementById('ai-translator-sidebar');
      if (sidebar && sidebar.classList.contains('ai-translator-sidebar-open')) {
        loadHistoryIntoSidebar(sidebar);
      }
    };

    const showError = (err?: string) => {
      const body = getBody();
      if (body) body.innerHTML = `<div class="ai-translator-bubble-error">⚠️ ${escapeHtml(err || 'Translation failed')}</div>`;
    };

    const fallbackNonStream = async () => {
      try {
        const response: TranslateResponse = await chrome.runtime.sendMessage({ type: 'TRANSLATE_TEXT', payload });
        if (response.success && response.data) finalize(response.data.translatedText);
        else showError(response.error);
      } catch {
        showError('Không thể kết nối. Kiểm tra API key trong settings.');
      }
    };

    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: 'translate-stream' });
    } catch {
      fallbackNonStream();
      return;
    }

    let settled = false;
    let gotDelta = false;
    port.onMessage.addListener((msg: { type: string; full?: string; error?: string }) => {
      if (msg.type === 'delta') {
        gotDelta = true;
        const body = getBody();
        if (body) {
          body.innerHTML = `<div class="ai-translator-bubble-text ai-streaming">${escapeHtml(msg.full || '').replace(/\n/g, '<br>')}</div>`;
        }
      } else if (msg.type === 'done') {
        settled = true;
        finalize(msg.full || '');
        try { port.disconnect(); } catch { /* noop */ }
      } else if (msg.type === 'error') {
        settled = true;
        try { port.disconnect(); } catch { /* noop */ }
        if (gotDelta) showError(msg.error);
        else fallbackNonStream();
      }
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      if (gotDelta) showError('Kết nối bị gián đoạn.');
      else fallbackNonStream();
    });
    port.postMessage(payload);
  }

  function renderTranslationResult(body: HTMLElement, raw: string, originalText: string, dictionaryMode: boolean) {
    if (dictionaryMode) {
      body.innerHTML = `
        <div class="ai-translator-bubble-result-container">
          <img class="ai-dict-img" alt="" style="display:none;" />
          <div class="ai-dict-content">${renderMarkdown(raw)}</div>
          <div class="ai-action-bar">
            <button class="ai-tts-btn" data-text="${escapeHtml(originalText)}" data-lang="auto" title="Phát âm">🔊 Phát âm</button>
            <button class="ai-copy-all-btn" data-text="${escapeHtml(raw)}" title="Copy">📋 Copy</button>
            <button class="ai-vocab-save-btn" title="Lưu vào sổ từ vựng">📇 Lưu từ</button>
          </div>
        </div>
      `;
      wireActionBar(body);
      attachVocabSave(body, parseDictCard(raw, originalText));
      const dictContainer = body.querySelector('.ai-translator-bubble-result-container') as HTMLElement | null;
      if (dictContainer) attachFollowUp(dictContainer, originalText);

      // Illustrative image for the looked-up word (free, Openverse).
      if (detectLang(originalText) === 'en') {
        const imgEl = body.querySelector('.ai-dict-img') as HTMLImageElement | null;
        chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', payload: { query: originalText } })
          .then((r) => {
            const url = r?.data?.urls?.[0];
            if (url && imgEl && bubble) {
              imgEl.src = url;
              imgEl.style.display = 'block';
            }
          })
          .catch(() => {});
      }
      return;
    }

    const formatted = formatTranslatedText(raw);
    const rawEnMatch = raw.match(/(- )?(English|Tiếng Anh):\s*([\s\S]*?)(?=(- )?(Vietnamese|Tiếng Việt):|$)/i);
    const enText = rawEnMatch ? rawEnMatch[3].trim() : originalText;
    const rawViMatch = raw.match(/(- )?(Vietnamese|Tiếng Việt):\s*([\s\S]*?)(?=(- )?(English|Tiếng Anh):|$)/i);
    const viText = rawViMatch ? rawViMatch[3].trim() : '';

    const lang = detectLang(originalText);
    const meaning = lang === 'en' ? viText || enText : enText;

    body.innerHTML = `
      <div class="ai-translator-bubble-result-container">
        ${formatted.fallback ? `<div class="ai-translator-fallback-badge">${formatted.fallback}</div>` : ''}
        <div class="ai-translator-sections">${formatted.html}</div>
        <div class="ai-action-bar">
          <button class="ai-inline-bi-btn" title="Chèn bản dịch song ngữ vào đoạn trên trang">📑 Song ngữ</button>
          <button class="ai-inline-rep-btn" title="Ghi đè đoạn bằng bản dịch (giữ format)">✍️ Ghi đè</button>
          <button class="ai-grammar-btn" data-text="${escapeHtml(enText)}" title="Giải thích ngữ pháp bằng tiếng Việt">🔎 Ngữ pháp</button>
          <button class="ai-ielts-btn" data-text="${escapeHtml(enText)}" title="Rewrite to IELTS 8.0">🎓 IELTS</button>
          <button class="ai-vocab-save-btn" title="Lưu vào sổ từ vựng">📇 Lưu</button>
        </div>
        <div class="ai-grammar-result" style="display: none;"></div>
        <div class="ai-ielts-result" style="display: none;"></div>
      </div>
    `;

    wireActionBar(body);
    wireIeltsButton(body);
    wireGrammarButton(body);
    wireInlineTranslate(body);
    attachVocabSave(body, {
      term: originalText,
      lang,
      meaning,
      example: '',
      context: '',
      sourceUrl: location.href,
    });
    const container = body.querySelector('.ai-translator-bubble-result-container') as HTMLElement | null;
    if (container) attachFollowUp(container, originalText);
  }

  /** Wire the "Song ngữ" / "Ghi đè" buttons in the bubble to translate the selected block(s) in place. */
  function wireInlineTranslate(scope: HTMLElement) {
    const run = (mode: PageTranslateMode) => {
      try {
        // Prefer the range captured at highlight time; fall back to the live selection
        // (in case it was never captured), so the buttons don't dead-end.
        let range = currentSelectionRange?.cloneRange() || null;
        if (!range || !range.toString().trim()) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0 && !sel.isCollapsed) range = sel.getRangeAt(0).cloneRange();
        }
        if (!range || !range.toString().trim()) {
          console.warn('[AI Translator] inline translate: no selection range available');
          showInlineToast('Không còn vùng chọn. Hãy bôi đen lại rồi bấm.', false);
          return;
        }
        void runInlineSelectionTranslate(range, mode);
      } catch (err) {
        console.warn('[AI Translator] inline translate error:', err);
        showInlineToast('Lỗi khi dịch đoạn. Mở Console (F12) để xem chi tiết.', false);
      }
    };
    const bi = scope.querySelector('.ai-inline-bi-btn');
    const rep = scope.querySelector('.ai-inline-rep-btn');
    if (!bi || !rep) console.warn('[AI Translator] inline translate buttons not found in bubble');
    bi?.addEventListener('click', () => run('bilingual'));
    rep?.addEventListener('click', () => run('replace'));
  }

  /** Show a loader near the selection, translate the block(s) in place, then confirm. */
  async function runInlineSelectionTranslate(range: Range, mode: PageTranslateMode) {
    const rect = range.getBoundingClientRect();
    const loader = document.createElement('div');
    loader.style.cssText = `
      position: absolute; left: ${rect.left + window.scrollX}px; top: ${rect.bottom + window.scrollY + 8}px;
      z-index: 2147483647; background: rgba(15,15,35,0.95); color: #34d399;
      padding: 4px 10px; border-radius: 20px; font-size: 12px;
      display: flex; align-items: center; gap: 6px; font-family: Inter, sans-serif;
    `;
    loader.innerHTML = '<div class="ai-translator-spinner" style="width:12px;height:12px;"></div> Đang dịch...';
    document.body.appendChild(loader);

    removeBubble();
    removeIcon();

    try {
      const res = await translateSelection(range, mode);
      loader.remove();
      showInlineToast(res.msg, res.ok);
    } catch (err) {
      console.warn('[AI Translator] translateSelection threw:', err);
      loader.remove();
      showInlineToast('Lỗi dịch thuật. Vui lòng thử lại.', false);
    }
  }

  /** Small transient toast near the top-right for inline-translate feedback. */
  function showInlineToast(message: string, ok: boolean) {
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      background: ${ok ? 'rgba(16,185,129,0.95)' : 'rgba(239,68,68,0.95)'}; color: #fff;
      padding: 8px 14px; border-radius: 10px; font-size: 13px; font-family: Inter, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    `;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  /** Extract a compact vocab card from a dictionary-mode markdown result. */
  function parseDictCard(raw: string, term: string) {
    const lang = detectLang(term);
    const ipa = (raw.match(/\*\*IPA:\*\*\s*([^\n]+)/i)?.[1] || '').trim();
    const viMeaning = (raw.match(/\*\*Vietnamese:\*\*\s*\n?\s*[-*]?\s*([^\n]+)/i)?.[1] || '').trim();
    const enDef = (raw.match(/\*\*English definition:\*\*\s*\n?\s*([^\n]+)/i)?.[1] || '').trim();
    const example = (raw.match(/\*\*Examples?:\*\*[\s\S]*?\n\s*1\.\s*([^\n]+)/i)?.[1] || '').trim();
    const meaning = lang === 'en' ? viMeaning || enDef : enDef || viMeaning;
    return {
      term,
      lang,
      meaning,
      ipa: ipa || undefined,
      example: example || undefined,
      context: '',
      sourceUrl: location.href,
    };
  }

  /** Wire a "Lưu từ" button that saves a card to the vocabulary deck. */
  function attachVocabSave(
    scope: HTMLElement,
    payload: { term: string; lang: Language; meaning: string; ipa?: string; example?: string; context?: string; sourceUrl?: string },
  ) {
    const btn = scope.querySelector('.ai-vocab-save-btn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!payload.term.trim() || !payload.meaning.trim()) {
        btn.textContent = '⚠️ Thiếu nghĩa';
        return;
      }
      btn.disabled = true;
      try {
        const res = await chrome.runtime.sendMessage({ type: 'SAVE_VOCAB', payload });
        btn.textContent = res?.success ? (res.data?.added ? '✅ Đã lưu' : 'ℹ️ Đã có') : '⚠️ Lỗi';
        // Auto-enrich the newly saved card with a free illustration (Openverse).
        if (res?.success && res.data?.added && res.data.card && cachedSettings.vocabAutoImage) {
          chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', payload: { query: payload.term } })
            .then((imgRes) => {
              const url = imgRes?.data?.urls?.[0];
              if (url) {
                chrome.runtime.sendMessage({ type: 'UPDATE_VOCAB', payload: { card: { ...res.data.card, image: url } } }).catch(() => {});
              }
            })
            .catch(() => {});
        }
      } catch {
        btn.textContent = '⚠️ Lỗi';
      }
    });
  }

  function wireActionBar(scope: HTMLElement) {
    // Copy buttons (per-section)
    scope.querySelectorAll('.ai-section-copy').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        const txt = b.getAttribute('data-copy-text') || '';
        navigator.clipboard.writeText(txt);
        const orig = b.textContent;
        b.textContent = '✅';
        setTimeout(() => { b.textContent = orig; }, 1500);
      });
    });

    // TTS buttons
    scope.querySelectorAll('.ai-tts-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        const txt = b.getAttribute('data-text') || '';
        const lang = b.getAttribute('data-lang') || 'auto';
        speak(txt, lang);
      });
    });

    // Copy-all buttons
    scope.querySelectorAll('.ai-copy-all-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        const txt = b.getAttribute('data-text') || '';
        navigator.clipboard.writeText(txt);
        const orig = b.textContent;
        b.textContent = '✅ Copied';
        setTimeout(() => { b.textContent = orig; }, 1500);
      });
    });
  }

  function wireIeltsButton(scope: HTMLElement) {
    const ieltsBtn = scope.querySelector('.ai-ielts-btn');
    if (!ieltsBtn) return;
    ieltsBtn.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      const textToAnalyze = b.getAttribute('data-text') || '';
      const resultDiv = b
        .closest('.ai-translator-bubble-result-container')
        ?.querySelector('.ai-ielts-result') as HTMLElement | null;
      if (!resultDiv) return;

      if (resultDiv.style.display === 'block') {
        resultDiv.style.display = 'none';
        return;
      }
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = '<div class="ai-translator-spinner" style="margin: 10px auto;"></div><div style="text-align:center;font-size:12px;color:#94a3b8;">Đang viết lại...</div>';

      try {
        const res = await chrome.runtime.sendMessage({
          type: 'ANALYZE_IELTS',
          payload: { text: textToAnalyze }
        });
        if (res?.success && res.data) {
          resultDiv.innerHTML = `<div class="ai-ielts-content">${renderMarkdown(res.data.text)}</div>`;
        } else {
          resultDiv.innerHTML = `<div class="ai-translator-bubble-error">⚠️ ${res?.error || 'Phân tích thất bại'}</div>`;
        }
      } catch {
        resultDiv.innerHTML = '<div class="ai-translator-bubble-error">⚠️ Lỗi kết nối</div>';
      }
    });
  }

  function wireGrammarButton(scope: HTMLElement) {
    const btn = scope.querySelector('.ai-grammar-btn');
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      const text = b.getAttribute('data-text') || '';
      const resultDiv = b
        .closest('.ai-translator-bubble-result-container')
        ?.querySelector('.ai-grammar-result') as HTMLElement | null;
      if (!resultDiv) return;

      if (resultDiv.style.display === 'block') {
        resultDiv.style.display = 'none';
        return;
      }
      resultDiv.style.display = 'block';
      resultDiv.innerHTML =
        '<div class="ai-translator-spinner" style="margin: 10px auto;"></div><div style="text-align:center;font-size:12px;color:#94a3b8;">Đang phân tích ngữ pháp...</div>';

      try {
        const res = await chrome.runtime.sendMessage({ type: 'EXPLAIN_GRAMMAR', payload: { text } });
        if (res?.success && res.data) {
          resultDiv.innerHTML = `<div class="ai-ielts-content">${renderMarkdown(res.data.text)}</div>`;
        } else {
          resultDiv.innerHTML = `<div class="ai-translator-bubble-error">⚠️ ${res?.error || 'Phân tích thất bại'}</div>`;
        }
      } catch {
        resultDiv.innerHTML = '<div class="ai-translator-bubble-error">⚠️ Lỗi kết nối</div>';
      }
    });
  }

  /**
   * Web Speech API TTS. lang='auto' picks based on Vietnamese chars in text.
   */
  function speak(text: string, lang: string) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const isVi = lang === 'auto' ? VI_RE.test(text) : lang.toLowerCase().startsWith('vi');
    const utter = new SpeechSynthesisUtterance(text);
    const uri = isVi ? cachedSettings.ttsVoiceVi : cachedSettings.ttsVoiceEn;
    const voices = ttsVoices.length ? ttsVoices : window.speechSynthesis.getVoices();
    const voice = uri ? voices.find((v) => v.voiceURI === uri) : undefined;
    if (voice) utter.voice = voice;
    else utter.lang = isVi ? 'vi-VN' : 'en-US';
    utter.rate = cachedSettings.ttsRate || 0.95;
    window.speechSynthesis.speak(utter);
  }

  // --- Study reminder (in-tab toast) ---

  function startReminderTimer() {
    if (!cachedSettings.reminderEnabled) {
      if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = null; reminderIntervalCur = 0; }
      return;
    }
    const min = Math.max(1, cachedSettings.reminderIntervalMin || 10);
    // Already running at this interval → leave it (don't reset the countdown on unrelated
    // settings changes). Only (re)create when the interval actually changed.
    if (reminderTimer && min === reminderIntervalCur) return;
    if (reminderTimer) clearInterval(reminderTimer);
    reminderIntervalCur = min;
    reminderTimer = setInterval(async () => {
      // Only nudge on the tab the user is actively viewing.
      if (document.visibilityState !== 'visible') return;
      if (document.getElementById('ai-translator-reminder')) return; // one at a time
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_REMINDER_CARD' });
        const card = res?.data?.card as VocabCard | null | undefined;
        if (card) showReminderToast(card);
      } catch {
        // ignore
      }
    }, min * 60 * 1000);
  }

  function showReminderToast(card: VocabCard) {
    const el = document.createElement('div');
    el.id = 'ai-translator-reminder';
    el.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      width: 300px; max-width: calc(100vw - 32px);
      background: rgba(15,15,35,0.97); color: #e2e8f0; border: 1px solid rgba(99,102,241,0.4);
      border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,0.45);
      font-family: Inter, system-ui, sans-serif; padding: 14px 16px;
      animation: ai-translator-fadeIn 0.25s ease;
    `;
    const ipa = card.ipa
      ? ` <span style="color:#94a3b8;font-size:12px;">/${escapeHtml(card.ipa.replace(/^\/|\/$/g, ''))}/</span>`
      : '';
    const example = card.example
      ? `<div style="color:#94a3b8;font-size:12px;font-style:italic;margin-top:6px;">"${escapeHtml(card.example)}"</div>`
      : '';
    const img = card.image
      ? `<img src="${escapeHtml(card.image)}" alt="" style="max-width:100%;max-height:110px;border-radius:8px;margin-top:8px;display:block;">`
      : '';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:12px;color:#a5b4fc;">📇 Ôn từ vựng</span>
        <button class="rem-close" title="Ẩn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">✕</button>
      </div>
      <div style="font-size:18px;font-weight:700;">${escapeHtml(card.term)}${ipa}
        <button class="rem-tts" title="Nghe" style="background:none;border:none;cursor:pointer;font-size:15px;margin-left:6px;">🔊</button>
      </div>
      <div style="color:#6ee7b7;font-size:14px;margin-top:4px;">${escapeHtml(card.meaning)}</div>
      ${example}
      ${img}
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="rem-known" style="flex:1;padding:7px;border:none;border-radius:8px;background:rgba(16,185,129,0.9);color:#fff;font-size:13px;cursor:pointer;">✓ Đã thuộc</button>
        <button class="rem-hide" style="flex:1;padding:7px;border:1px solid rgba(99,102,241,0.4);border-radius:8px;background:transparent;color:#e2e8f0;font-size:13px;cursor:pointer;">Ẩn</button>
      </div>
      <div style="text-align:center;margin-top:8px;">
        <button class="rem-practice" style="background:none;border:none;color:#a5b4fc;cursor:pointer;font-size:12px;">🎯 Luyện nói hôm nay →</button>
      </div>
    `;
    document.body.appendChild(el);

    const timer = setTimeout(() => el.remove(), 9000);
    const dismiss = () => {
      clearTimeout(timer);
      el.remove();
    };

    el.querySelector('.rem-close')?.addEventListener('click', dismiss);
    el.querySelector('.rem-hide')?.addEventListener('click', dismiss);
    el.querySelector('.rem-tts')?.addEventListener('click', () => speak(card.term, card.lang));
    el.querySelector('.rem-practice')?.addEventListener('click', () => {
      dismiss();
      chrome.runtime.sendMessage({ type: 'OPEN_PRACTICE' }).catch(() => {});
    });
    el.querySelector('.rem-known')?.addEventListener('click', async () => {
      dismiss();
      try {
        const updated = reviewCard(card, 'good', Date.now());
        await chrome.runtime.sendMessage({ type: 'UPDATE_VOCAB', payload: { card: updated } });
      } catch {
        // ignore
      }
    });
  }

  function removeBubble() {
    if (bubble) {
      bubble.remove();
      bubble = null;
    }
  }

  function removeIcon() {
    if (iconNode) {
      iconNode.remove();
      iconNode = null;
    }
  }

  // --- Sidebar Logic ---
  function initSidebar() {
    const sidebar = document.createElement('div');
    sidebar.id = 'ai-translator-sidebar';
    sidebar.className = 'ai-translator-sidebar-closed';
    sidebar.style.cssText = `
      position: fixed; top: 0; right: -${DEFAULT_SIDEBAR_WIDTH}px;
      width: ${DEFAULT_SIDEBAR_WIDTH}px; height: 100vh;
      background: rgba(15, 15, 35, 0.95); backdrop-filter: blur(20px);
      border-left: 1px solid rgba(99, 102, 241, 0.3); box-shadow: -5px 0 30px rgba(0,0,0,0.5);
      z-index: 2147483646; transition: right 0.3s ease; color: #e2e8f0;
      font-family: 'Inter', sans-serif; display: flex; flex-direction: column;
    `;

    // Resize handle on the left edge
    const resizeHandle = document.createElement('div');
    resizeHandle.id = 'ai-translator-sidebar-resize';
    resizeHandle.style.cssText = `
      position: absolute; left: -3px; top: 0; width: 6px; height: 100%;
      cursor: ew-resize; z-index: 2147483647;
    `;
    sidebar.appendChild(resizeHandle);
    enableSidebarResize(sidebar, resizeHandle);

    const toggleBtn = document.createElement('div');
    toggleBtn.id = 'ai-translator-sidebar-toggle';
    toggleBtn.innerHTML = '📝';
    toggleBtn.title = 'AI Translator — lịch sử dịch (kéo để di chuyển, click để mở)';
    toggleBtn.style.cssText = `
      position: fixed; top: 50%; right: 0; transform: translateY(-50%);
      background: rgba(99, 102, 241, 0.85); color: white; width: 30px; height: ${TOGGLE_HEIGHT}px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 8px 0 0 8px; cursor: grab; z-index: 2147483647;
      box-shadow: -2px 0 10px rgba(0,0,0,0.25); font-size: 15px;
      opacity: 0.35; transition: opacity 0.2s ease, background 0.2s, right 0.3s ease;
      user-select: none; touch-action: none;
    `;

    // Small dismiss button (hides the toggle for this page load; returns on refresh).
    const toggleClose = document.createElement('div');
    toggleClose.className = 'ai-toggle-close';
    toggleClose.textContent = '×';
    toggleClose.title = 'Ẩn nút (hiện lại khi tải lại trang)';
    toggleClose.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
    toggleClose.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBtn.style.display = 'none';
      closeSidebar();
    });
    toggleBtn.appendChild(toggleClose);

    enableToggleDrag(toggleBtn, sidebar);

    const appendSidebar = () => {
      if (!document.getElementById('ai-translator-sidebar')) {
        const target = document.body || document.documentElement;
        if (target) {
          target.appendChild(sidebar);
          target.appendChild(toggleBtn);
        }
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', appendSidebar);
    } else {
      appendSidebar();
    }
    setTimeout(appendSidebar, 1000);

    // Close on clicking outside
    document.addEventListener('mousedown', (e) => {
      if (sidebar.classList.contains('ai-translator-sidebar-open') &&
          !sidebar.contains(e.target as Node) &&
          !toggleBtn.contains(e.target as Node)) {
        closeSidebar();
      }
    });
  }

  function applySidebarSettings() {
    const sidebar = document.getElementById('ai-translator-sidebar') as HTMLElement | null;
    const toggle = document.getElementById('ai-translator-sidebar-toggle') as HTMLElement | null;
    if (!sidebar || !toggle) return;

    const width = clamp(cachedSettings.sidebarWidth, MIN_SIDEBAR_WIDTH, window.innerWidth * MAX_SIDEBAR_WIDTH_RATIO);
    sidebar.style.width = `${width}px`;
    if (!sidebar.classList.contains('ai-translator-sidebar-open')) {
      sidebar.style.right = `-${width}px`;
    }

    if (cachedSettings.sidebarToggleY > 0) {
      const maxY = window.innerHeight - TOGGLE_HEIGHT - TOGGLE_TOP_MARGIN;
      const y = clamp(cachedSettings.sidebarToggleY, TOGGLE_TOP_MARGIN, maxY);
      toggle.style.top = `${y}px`;
      toggle.style.transform = 'none';
    }
  }

  /**
   * Make the sidebar toggle button vertically draggable.
   * Distinguishes drag vs click via DRAG_THRESHOLD_PX threshold.
   */
  function enableToggleDrag(toggle: HTMLElement, sidebar: HTMLElement) {
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const rect = toggle.getBoundingClientRect();
      const startTop = rect.top;
      let dragging = false;
      toggle.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const dy = ev.clientY - startY;
        if (!dragging && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        toggle.style.cursor = 'grabbing';
        const maxY = window.innerHeight - TOGGLE_HEIGHT - TOGGLE_TOP_MARGIN;
        const newTop = clamp(startTop + dy, TOGGLE_TOP_MARGIN, maxY);
        toggle.style.top = `${newTop}px`;
        toggle.style.transform = 'none';
      };

      const onUp = async () => {
        toggle.removeEventListener('pointermove', onMove);
        toggle.removeEventListener('pointerup', onUp);
        toggle.removeEventListener('pointercancel', onUp);
        toggle.style.cursor = 'grab';

        if (dragging) {
          const y = parseFloat(toggle.style.top) || 0;
          await persistSettings({ sidebarToggleY: y });
        } else {
          // Treat as click → toggle sidebar
          toggleSidebar();
        }
      };

      toggle.addEventListener('pointermove', onMove);
      toggle.addEventListener('pointerup', onUp);
      toggle.addEventListener('pointercancel', onUp);
    };

    toggle.addEventListener('pointerdown', onPointerDown);
  }

  /**
   * Make the sidebar resizable by dragging its left edge.
   */
  function enableSidebarResize(sidebar: HTMLElement, handle: HTMLElement) {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebar.offsetWidth;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';

      const onMove = (ev: MouseEvent) => {
        const dx = startX - ev.clientX;
        const maxWidth = window.innerWidth * MAX_SIDEBAR_WIDTH_RATIO;
        const newWidth = clamp(startWidth + dx, MIN_SIDEBAR_WIDTH, maxWidth);
        sidebar.style.width = `${newWidth}px`;
        if (!sidebar.classList.contains('ai-translator-sidebar-open')) {
          sidebar.style.right = `-${newWidth}px`;
        }
        // If sidebar is open, also offset the toggle so it stays glued to its edge
        const toggle = document.getElementById('ai-translator-sidebar-toggle');
        if (toggle && sidebar.classList.contains('ai-translator-sidebar-open')) {
          toggle.style.right = `${newWidth}px`;
        }
      };

      const onUp = async () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        await persistSettings({ sidebarWidth: sidebar.offsetWidth });
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('ai-translator-sidebar') as HTMLElement | null;
    if (!sidebar) return;
    if (sidebar.classList.contains('ai-translator-sidebar-open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  function openSidebar() {
    const sidebar = document.getElementById('ai-translator-sidebar') as HTMLElement | null;
    const toggle = document.getElementById('ai-translator-sidebar-toggle') as HTMLElement | null;
    if (!sidebar || !toggle) return;
    sidebar.style.right = '0px';
    toggle.style.right = `${sidebar.offsetWidth}px`;
    sidebar.classList.add('ai-translator-sidebar-open');
    sidebar.classList.remove('ai-translator-sidebar-closed');
    loadHistoryIntoSidebar(sidebar);
  }

  function closeSidebar() {
    const sidebar = document.getElementById('ai-translator-sidebar') as HTMLElement | null;
    const toggle = document.getElementById('ai-translator-sidebar-toggle') as HTMLElement | null;
    if (!sidebar || !toggle) return;
    sidebar.style.right = `-${sidebar.offsetWidth}px`;
    toggle.style.right = '0px';
    sidebar.classList.remove('ai-translator-sidebar-open');
    sidebar.classList.add('ai-translator-sidebar-closed');
  }

  async function loadHistoryIntoSidebar(sidebar: HTMLElement) {
    // Preserve resize handle when re-rendering
    const resizeHandle = sidebar.querySelector('#ai-translator-sidebar-resize');

    sidebar.innerHTML = `
      <div class="ai-translator-sidebar-header">
        <h3>Lịch sử dịch</h3>
        <button id="ai-translator-clear-history" title="Xoá hết (giữ lại các mục đã pin)">Xoá hết</button>
      </div>
      <div class="ai-translator-sidebar-search">
        <input type="text" id="ai-translator-search" placeholder="🔍 Tìm trong lịch sử..." />
      </div>
      <div class="ai-translator-sidebar-content" id="ai-translator-history-list">
        <div style="padding: 20px; text-align: center; color: #94a3b8;">
          <div class="ai-translator-spinner" style="margin: 0 auto 10px auto;"></div>
          Đang tải...
        </div>
      </div>
    `;
    if (resizeHandle) sidebar.appendChild(resizeHandle);

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      const list = sidebar.querySelector('#ai-translator-history-list') as HTMLElement;

      if (!response?.success || !response.data) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #f87171;">Lỗi tải lịch sử</div>';
        return;
      }

      const history = response.data as Array<{
        id: string; sourceText: string; translatedText: string; timestamp: number; pinned?: boolean;
      }>;

      let currentFilter = '';

      const render = () => {
        const q = currentFilter.toLowerCase().trim();
        const filtered = history.filter((item) => {
          if (!q) return true;
          return (
            item.sourceText.toLowerCase().includes(q) ||
            item.translatedText.toLowerCase().includes(q)
          );
        });

        // Sort: pinned first, then newest first
        filtered.sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return b.timestamp - a.timestamp;
        });

        if (filtered.length === 0) {
          list.innerHTML = `<div style="padding: 20px; text-align: center; color: #94a3b8;">${q ? 'Không tìm thấy kết quả.' : 'Chưa có lịch sử dịch.'}</div>`;
          return;
        }

        let html = '';
        for (const item of filtered) {
          const formatted = formatTranslatedText(item.translatedText);
          const rawEnMatch = item.translatedText.match(/(- )?(English|Tiếng Anh):\s*([\s\S]*?)(?=(- )?(Vietnamese|Tiếng Việt):|$)/i);
          const enText = rawEnMatch ? rawEnMatch[3].trim() : item.sourceText;

          html += `
            <div class="ai-translator-history-item ${item.pinned ? 'pinned' : ''}" data-id="${item.id}">
              <div class="ai-history-item-actions">
                <button class="ai-history-pin-btn" data-id="${item.id}" title="${item.pinned ? 'Bỏ pin' : 'Pin'}">${item.pinned ? '📌' : '📍'}</button>
                <button class="ai-history-delete-btn" data-id="${item.id}" title="Xoá">🗑️</button>
              </div>
              <div class="source-text">${escapeHtml(item.sourceText)}</div>
              <div class="translated-text">${formatted.html}</div>
              <div class="ai-action-bar">
                <button class="ai-tts-btn" data-text="${escapeHtml(enText)}" data-lang="en-US" title="Phát âm EN">🔊 EN</button>
                <button class="ai-ielts-btn" data-text="${escapeHtml(enText)}" title="Rewrite to IELTS 8.0">🎓 IELTS 8.0</button>
              </div>
              <div class="ai-ielts-result" style="display: none;"></div>
            </div>
          `;
        }
        list.innerHTML = html;

        wireActionBar(list);
        list.querySelectorAll('.ai-ielts-btn').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            const b = e.currentTarget as HTMLButtonElement;
            const textToAnalyze = b.getAttribute('data-text') || '';
            const item = b.closest('.ai-translator-history-item') as HTMLElement | null;
            const resultDiv = item?.querySelector('.ai-ielts-result') as HTMLElement | null;
            if (!resultDiv) return;

            if (resultDiv.style.display === 'block') {
              resultDiv.style.display = 'none';
              return;
            }
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = '<div class="ai-translator-spinner" style="margin: 10px auto;"></div><div style="text-align:center;font-size:12px;color:#94a3b8;">Đang viết lại...</div>';

            try {
              const res = await chrome.runtime.sendMessage({
                type: 'ANALYZE_IELTS',
                payload: { text: textToAnalyze }
              });
              if (res?.success && res.data) {
                resultDiv.innerHTML = `<div class="ai-ielts-content">${renderMarkdown(res.data.text)}</div>`;
              } else {
                resultDiv.innerHTML = `<div class="ai-translator-bubble-error">⚠️ ${res?.error || 'Phân tích thất bại'}</div>`;
              }
            } catch {
              resultDiv.innerHTML = '<div class="ai-translator-bubble-error">⚠️ Lỗi kết nối</div>';
            }
          });
        });

        list.querySelectorAll('.ai-history-pin-btn').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
            if (!id) return;
            await chrome.runtime.sendMessage({ type: 'TOGGLE_PIN_HISTORY', payload: { id } });
            const target = history.find((h) => h.id === id);
            if (target) target.pinned = !target.pinned;
            render();
          });
        });

        list.querySelectorAll('.ai-history-delete-btn').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
            if (!id) return;
            await chrome.runtime.sendMessage({ type: 'DELETE_HISTORY_ITEM', payload: { id } });
            const idx = history.findIndex((h) => h.id === id);
            if (idx >= 0) history.splice(idx, 1);
            render();
          });
        });
      };

      render();

      const searchInput = sidebar.querySelector('#ai-translator-search') as HTMLInputElement;
      searchInput?.addEventListener('input', (e) => {
        currentFilter = (e.target as HTMLInputElement).value;
        render();
      });

      const clearBtn = sidebar.querySelector('#ai-translator-clear-history');
      clearBtn?.addEventListener('click', async () => {
        if (confirm('Bạn có chắc chắn muốn xoá toàn bộ lịch sử? (Các mục đã pin sẽ được giữ lại)')) {
          await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
          loadHistoryIntoSidebar(sidebar);
        }
      });
    } catch {
      const list = sidebar.querySelector('#ai-translator-history-list') as HTMLElement | null;
      if (list) list.innerHTML = '<div style="padding: 20px; text-align: center; color: #f87171;">Lỗi tải lịch sử</div>';
    }
  }

  /**
   * Markdown subset → HTML (bold, italic, line breaks, escaped first).
   */
  function renderMarkdown(text: string): string {
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.*?)__/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  function formatTranslatedText(text: string) {
    let fallback = '';
    let processedText = text;

    const fallbackMatch = processedText.match(/^\[Fallback to ([^\]]+)\]/i);
    if (fallbackMatch) {
      fallback = `Fallback: ${fallbackMatch[1]}`;
      processedText = processedText.replace(/^\[Fallback to [^\]]+\]\s*/i, '');
    }

    const viRegex = /(- )?(Vietnamese|Tiếng Việt):\s*([\s\S]*?)(?=(- )?(English|Tiếng Anh):|$)/i;
    const enRegex = /(- )?(English|Tiếng Anh):\s*([\s\S]*?)(?=(- )?(Vietnamese|Tiếng Việt):|$)/i;

    const viMatch = processedText.match(viRegex);
    const enMatch = processedText.match(enRegex);

    const formatBlock = (label: string, content: string, type: 'vi' | 'en') => {
      const trimmed = content.trim();
      const escapedContent = escapeHtml(trimmed);
      const markdownContent = escapedContent
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.*?)__/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
      const lang = type === 'vi' ? 'vi-VN' : 'en-US';
      const labelText = type === 'vi' ? '🇻🇳 Vietnamese' : '🇬🇧 English';

      return `
        <div class="ai-lang-section">
          <div class="ai-lang-header">
            <div class="ai-lang-label ${type}">${labelText}</div>
            <div class="ai-lang-actions">
              <button class="ai-tts-btn" data-text="${escapedContent}" data-lang="${lang}" title="Phát âm ${label}">🔊</button>
              <button class="ai-section-copy" data-copy-text="${escapedContent}" title="Copy ${label}">📋</button>
            </div>
          </div>
          <div class="ai-lang-body">${markdownContent}</div>
        </div>
      `;
    };

    let html = '';
    if (viMatch) html += formatBlock('Vietnamese', viMatch[3], 'vi');
    if (enMatch) html += formatBlock('English', enMatch[3], 'en');

    if (!html) {
      html = `<div class="ai-translator-bubble-text">${escapeHtml(processedText).replace(/\n/g, '<br>')}</div>`;
    }

    return { html, fallback, plainText: processedText };
  }

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    // textContent escapes & < >, but NOT quotes — escape them too so the result
    // is safe inside double/single-quoted attributes (e.g. data-text="…").
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function activateZenMode() {
    if (document.getElementById('ai-translator-zen-overlay')) return; // don't stack overlays

    // Capture & clean the content root BEFORE injecting our overlay, so we never feed our
    // own UI (overlay / sidebar / toggle / bubble / injected translations) to the model —
    // important when the root falls back to <body>.
    const contentElement = document.querySelector('article') || document.querySelector('main') || document.body;
    const clone = contentElement.cloneNode(true) as HTMLElement;
    const noisySelectors = [
      'nav', 'header', 'footer', 'script', 'style', 'noscript', 'iframe', 'svg', 'aside',
      '[id^="ai-translator"]', '.ai-tr-bilingual',
    ];
    noisySelectors.forEach((sel) => clone.querySelectorAll(sel).forEach((el) => el.remove()));

    const textToTranslate = clone.innerText.trim().substring(0, 15000);

    const overlay = document.createElement('div');
    overlay.id = 'ai-translator-zen-overlay';
    overlay.innerHTML = `
      <div class="zen-container">
        <div class="zen-header">
          <h2>📖 Zen Reading Mode</h2>
          <button class="zen-close">✕</button>
        </div>
        <div class="zen-content">
          <div class="ai-translator-spinner" style="margin: 40px auto; width: 30px; height: 30px;"></div>
          <p style="text-align: center; color: #94a3b8; font-family: Inter, sans-serif;">Đang bóc tách và dịch nội dung...</p>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.zen-close')?.addEventListener('click', () => overlay.remove());
    const isVietnamese = /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i.test(textToTranslate);
    const targetLang = isVietnamese ? 'en' : 'vi';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_INPLACE',
        payload: { text: textToTranslate, targetLang }
      });
      const contentDiv = overlay.querySelector('.zen-content') as HTMLElement;
      if (response?.success && response.data) {
        let textResult = response.data.text.trim();
        textResult = textResult.replace(/^\[Fallback to [^\]]+\]\s*/i, '');
        const mdHtml = escapeHtml(textResult)
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n\s*\n/g, '</p><p>')
          .replace(/\n/g, '<br>');
        contentDiv.innerHTML = `<div class="zen-text"><p>${mdHtml}</p></div>`;
      } else {
        contentDiv.innerHTML = `<div style="text-align:center; color:#ef4444; padding: 40px;">⚠️ Lỗi dịch thuật: ${escapeHtml(response?.error || 'Unknown error')}</div>`;
      }
    } catch {
      const contentDiv = overlay.querySelector('.zen-content') as HTMLElement;
      if (contentDiv) contentDiv.innerHTML = `<div style="text-align:center; color:#ef4444; padding: 40px;">⚠️ Lỗi kết nối.</div>`;
    }
  }
}
