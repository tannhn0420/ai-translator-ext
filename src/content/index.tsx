// ============================================
// Content Script - Entry Point
// ============================================
// Injected into all web pages to enable highlight translation

import type { TranslateResponse, PageTranslateMode, Language } from '../types';
import { handleTranslatePage } from './pageTranslate/controller';

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
  };

  // Bubble drag-position memory (per-session, viewport coords)
  let bubbleDragState: { left: number; top: number } | null = null;

  initSidebar();

  // Listen for text selection
  document.addEventListener('mouseup', (e) => {
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
  document.addEventListener('mousedown', (e) => {
    if (iconNode && !iconNode.contains(e.target as Node)) {
      removeIcon();
    }
  });

  // Double Shift in-place translation
  let lastShiftTime = 0;
  document.addEventListener('keyup', (e) => {
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
  document.addEventListener('keydown', (e) => {
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

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRANSLATE_SELECTION' && message.payload?.text) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        showTranslationBubble(rect, message.payload.text, extractContext(range));
      }
    } else if (message.type === 'TRIGGER_ZEN_MODE') {
      activateZenMode();
    } else if (message.type === 'TRANSLATE_PAGE') {
      const mode: PageTranslateMode = message.payload?.mode === 'bilingual' ? 'bilingual' : 'replace';
      const targetLang: Language = message.payload?.targetLang === 'en' ? 'en' : 'vi';
      handleTranslatePage(mode, targetLang);
    }
  });

  // Load settings on startup
  loadSettings();

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
        };
        applySidebarSettings();
      }
    } catch {
      // keep defaults
    }
  }

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

    if (autoTranslate && wordCount >= 2) {
      showTranslationBubble({ left: x - 150, top: y + 10, width: 300 } as DOMRect, selectedText, context);
    } else if (autoTranslate && wordCount <= DICT_WORD_LIMIT && cachedSettings.dictionaryModeEnabled) {
      // Single-word lookups auto-translate as dictionary
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

  function showTranslateIcon(rect: DOMRect, text: string, e: MouseEvent, context: string) {
    removeBubble();
    removeIcon();

    iconNode = document.createElement('div');
    iconNode.id = 'ai-translator-icon';
    iconNode.innerHTML = `🌐`;

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const iconX = e.clientX + scrollX + 10;
    const iconY = e.clientY + scrollY + 15;

    iconNode.style.cssText = `
      position: absolute; left: ${iconX}px; top: ${iconY}px;
      z-index: 2147483647; cursor: pointer; font-size: 20px;
      background: rgba(15,15,35,0.95); border: 1px solid rgba(99,102,241,0.3);
      border-radius: 50%; padding: 4px 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: transform 0.1s ease;
    `;
    iconNode.addEventListener('mouseenter', () => { if (iconNode) iconNode.style.transform = 'scale(1.1)'; });
    iconNode.addEventListener('mouseleave', () => { if (iconNode) iconNode.style.transform = 'scale(1)'; });
    iconNode.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
    iconNode.addEventListener('mouseup', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      removeIcon();
      showTranslationBubble(rect, text, context);
    });

    document.body.appendChild(iconNode);
  }

  function showTranslationBubble(rect: DOMRect, text: string, context: string) {
    removeBubble();

    bubble = document.createElement('div');
    bubble.id = 'ai-translator-bubble';
    bubble.innerHTML = `
      <div class="ai-translator-bubble-content">
        <div class="ai-translator-bubble-header" data-drag-handle="1">
          <span class="ai-translator-bubble-logo">🌐</span>
          <span class="ai-translator-bubble-title">AI Translator</span>
          <button class="ai-translator-bubble-pin" id="ai-translator-bubble-pin" title="Pin to position">📌</button>
          <button class="ai-translator-bubble-close" id="ai-translator-close" title="Close">✕</button>
        </div>
        <div class="ai-translator-bubble-body">
          <div class="ai-translator-bubble-loading">
            <div class="ai-translator-spinner"></div>
            <span>Đang dịch...</span>
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

    const closeBtn = bubble.querySelector('#ai-translator-close');
    closeBtn?.addEventListener('click', removeBubble);

    // Enable drag from header
    enableBubbleDrag(bubble);

    translateText(text, context);
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

  async function translateText(text: string, context: string) {
    try {
      const isVietnamese = /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i.test(text);
      const targetLang = isVietnamese ? 'en' : 'vi';
      const wordCount = text.trim().split(/\s+/).length;
      const dictionaryMode = wordCount <= DICT_WORD_LIMIT && cachedSettings.dictionaryModeEnabled;

      const response: TranslateResponse = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        payload: {
          text,
          sourceLang: 'auto',
          targetLang: targetLang,
          context: cachedSettings.contextAwareEnabled ? context : undefined,
          dictionaryMode,
        },
      });

      if (!bubble) return;
      const body = bubble.querySelector('.ai-translator-bubble-body');
      if (!body) return;

      if (response.success && response.data) {
        renderTranslationResult(body as HTMLElement, response.data.translatedText, text, dictionaryMode);

        // Refresh sidebar if open
        const sidebar = document.getElementById('ai-translator-sidebar');
        if (sidebar && sidebar.classList.contains('ai-translator-sidebar-open')) {
          loadHistoryIntoSidebar(sidebar);
        }
      } else {
        body.innerHTML = `
          <div class="ai-translator-bubble-error">
            ⚠️ ${escapeHtml(response.error || 'Translation failed')}
          </div>
        `;
      }
    } catch {
      if (!bubble) return;
      const body = bubble.querySelector('.ai-translator-bubble-body');
      if (body) {
        body.innerHTML = `
          <div class="ai-translator-bubble-error">
            ⚠️ Không thể kết nối. Kiểm tra API key trong settings.
          </div>
        `;
      }
    }
  }

  function renderTranslationResult(body: HTMLElement, raw: string, originalText: string, dictionaryMode: boolean) {
    if (dictionaryMode) {
      body.innerHTML = `
        <div class="ai-translator-bubble-result-container">
          <div class="ai-dict-content">${renderMarkdown(raw)}</div>
          <div class="ai-action-bar">
            <button class="ai-tts-btn" data-text="${escapeHtml(originalText)}" data-lang="auto" title="Phát âm">🔊 Phát âm</button>
            <button class="ai-copy-all-btn" data-text="${escapeHtml(raw)}" title="Copy">📋 Copy</button>
          </div>
        </div>
      `;
      wireActionBar(body);
      return;
    }

    const formatted = formatTranslatedText(raw);
    const rawEnMatch = raw.match(/(- )?(English|Tiếng Anh):\s*([\s\S]*?)(?=(- )?(Vietnamese|Tiếng Việt):|$)/i);
    const enText = rawEnMatch ? rawEnMatch[3].trim() : originalText;

    body.innerHTML = `
      <div class="ai-translator-bubble-result-container">
        ${formatted.fallback ? `<div class="ai-translator-fallback-badge">${formatted.fallback}</div>` : ''}
        <div class="ai-translator-sections">${formatted.html}</div>
        <button class="ai-ielts-btn" data-text="${escapeHtml(enText)}" title="Rewrite to IELTS 8.0">🎓 Rewrite (IELTS 8.0)</button>
        <div class="ai-ielts-result" style="display: none;"></div>
      </div>
    `;

    wireActionBar(body);
    wireIeltsButton(body);
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
      const resultDiv = b.nextElementSibling as HTMLElement;

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

  /**
   * Web Speech API TTS. lang='auto' picks based on Vietnamese chars in text.
   */
  function speak(text: string, lang: string) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const isVi = /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i.test(text);
    const targetLang = lang === 'auto' ? (isVi ? 'vi-VN' : 'en-US') : lang;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = targetLang;
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
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
    toggleBtn.title = 'AI Translator History (kéo để di chuyển, click để mở)';
    toggleBtn.style.cssText = `
      position: fixed; top: 50%; right: 0; transform: translateY(-50%);
      background: rgba(99, 102, 241, 0.9); color: white; width: 36px; height: ${TOGGLE_HEIGHT}px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 8px 0 0 8px; cursor: grab; z-index: 2147483647;
      box-shadow: -2px 0 10px rgba(0,0,0,0.3); font-size: 18px;
      transition: background 0.2s, right 0.3s ease;
      user-select: none; touch-action: none;
    `;

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
    return div.innerHTML;
  }

  async function activateZenMode() {
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

    const contentElement = document.querySelector('article') || document.querySelector('main') || document.body;
    const clone = contentElement.cloneNode(true) as HTMLElement;
    const noisySelectors = ['nav', 'header', 'footer', 'script', 'style', 'noscript', 'iframe', 'svg', 'aside'];
    noisySelectors.forEach((sel) => clone.querySelectorAll(sel).forEach((el) => el.remove()));

    const textToTranslate = clone.innerText.trim().substring(0, 15000);
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
