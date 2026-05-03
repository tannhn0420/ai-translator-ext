// ============================================
// Content Script - Entry Point
// ============================================
// Injected into all web pages to enable highlight translation

import type { TranslateResponse } from '../types';

// Avoid re-injection
if (!(window as unknown as Record<string, boolean>).__AI_TRANSLATOR_INJECTED__) {
  (window as unknown as Record<string, boolean>).__AI_TRANSLATOR_INJECTED__ = true;
  initContentScript();
}

function initContentScript() {
  let bubble: HTMLDivElement | null = null;
  let iconNode: HTMLDivElement | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  
  initSidebar();

  // Listen for text selection
  document.addEventListener('mouseup', (e) => {
    // Don't trigger on our own UI
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

  // Click outside to dismiss
  document.addEventListener('mousedown', (e) => {
    if (bubble && !bubble.contains(e.target as Node)) {
      removeBubble();
    }
    if (iconNode && !iconNode.contains(e.target as Node)) {
      removeIcon();
    }
  });

  // Double Shift In-place Translation
  let lastShiftTime = 0;
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      const now = Date.now();
      if (now - lastShiftTime < 500) {
        // Double shift detected
        lastShiftTime = 0; // reset
        handleInplaceTranslation();
      } else {
        lastShiftTime = now;
      }
    }
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRANSLATE_SELECTION' && message.payload?.text) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        showTranslationBubble(rect, message.payload.text);
      }
    } else if (message.type === 'TRIGGER_ZEN_MODE') {
      activateZenMode();
    }
  });

  async function handleSelection(e: MouseEvent) {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (!selectedText || selectedText.length < 2) {
      return;
    }

    const range = selection!.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Use mouse position as fallback
    const x = rect.left + rect.width / 2 || e.clientX;
    const y = rect.bottom || e.clientY;

    let autoTranslate = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      let hasKey = !!response?.data?.apiKey;
      if (response?.data?.provider === 'openai') hasKey = !!response?.data?.openaiApiKey;
      else if (response?.data?.provider === 'groq') hasKey = !!response?.data?.groqApiKey;
      else if (response?.data?.provider === 'openrouter') hasKey = !!response?.data?.openrouterApiKey;
        
      if (!hasKey) {
        // Show an error bubble instead of silently failing
        showTranslationBubble({ left: x - 150, top: y + 10, width: 300 } as DOMRect, selectedText);
        return;
      }
      autoTranslate = response.data.autoTranslateOnHighlight !== false;
    } catch {
      // Keep defaults
    }

    const wordCount = selectedText.trim().split(/\s+/).length;

    if (autoTranslate && wordCount >= 2) {
      showTranslationBubble({ left: x - 150, top: y + 10, width: 300 } as DOMRect, selectedText);
    } else {
      showTranslateIcon(rect, selectedText, e);
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

    // Show a small loader next to the text
    const loaderId = 'ai-translator-inplace-loader';
    let loader = document.getElementById(loaderId);
    if (!loader) {
      loader = document.createElement('div');
      loader.id = loaderId;
      loader.style.position = 'absolute';
      loader.style.left = `${x + window.scrollX}px`;
      loader.style.top = `${y + window.scrollY + 10}px`;
      loader.style.zIndex = '2147483647';
      loader.style.background = 'rgba(15, 15, 35, 0.9)';
      loader.style.color = '#34d399';
      loader.style.padding = '4px 10px';
      loader.style.borderRadius = '20px';
      loader.style.fontSize = '12px';
      loader.style.display = 'flex';
      loader.style.alignItems = 'center';
      loader.style.gap = '6px';
      loader.innerHTML = '<div class="ai-translator-spinner" style="width:12px;height:12px;"></div> Đang dịch...';
      document.body.appendChild(loader);
    }

    // Determine target lang based on content (Vietnamese -> English, English -> Vietnamese)
    const isVietnamese = /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i.test(selectedText);
    const targetLang = isVietnamese ? 'en' : 'vi';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_INPLACE',
        payload: { text: selectedText, targetLang }
      });

      if (loader) loader.remove();

      if (response?.success && response.data) {
        // Extract plain text and insert it
        let textResult = response.data.text.trim();
        // Fallback badge might be present in text
        textResult = textResult.replace(/^\[Fallback to [^\]]+\]\s*/i, '');

        range.deleteContents();
        range.insertNode(document.createTextNode(textResult));

        // Show success flash
        const flash = document.createElement('div');
        flash.style.position = 'absolute';
        flash.style.left = `${x + window.scrollX}px`;
        flash.style.top = `${y + window.scrollY + 10}px`;
        flash.style.zIndex = '2147483647';
        flash.style.background = 'rgba(16, 185, 129, 0.9)';
        flash.style.color = '#fff';
        flash.style.padding = '4px 10px';
        flash.style.borderRadius = '20px';
        flash.style.fontSize = '12px';
        flash.textContent = '✅ Đã dịch xong';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 1500);

        // Remove bubble/icon if any
        removeBubble();
        removeIcon();
      } else {
        alert('Lỗi dịch thuật: ' + (response?.error || 'Không rõ nguyên nhân'));
      }
    } catch (err) {
      if (loader) loader.remove();
      alert('Lỗi kết nối. Vui lòng thử lại.');
    }
  }

  function showTranslateIcon(rect: DOMRect, text: string, e: MouseEvent) {
    removeBubble();
    removeIcon();

    iconNode = document.createElement('div');
    iconNode.id = 'ai-translator-icon';
    iconNode.innerHTML = `🌐`;
    
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    
    // Position icon near the mouse cursor for better UX
    const iconX = e.clientX + scrollX + 10;
    const iconY = e.clientY + scrollY + 15;
    
    iconNode.style.position = 'absolute';
    iconNode.style.left = `${iconX}px`;
    iconNode.style.top = `${iconY}px`;
    iconNode.style.zIndex = '2147483647';
    iconNode.style.cursor = 'pointer';
    iconNode.style.fontSize = '20px';
    iconNode.style.background = 'rgba(15, 15, 35, 0.95)';
    iconNode.style.border = '1px solid rgba(99, 102, 241, 0.3)';
    iconNode.style.borderRadius = '50%';
    iconNode.style.padding = '4px 8px';
    iconNode.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
    iconNode.style.transition = 'transform 0.1s ease';

    iconNode.addEventListener('mouseenter', () => {
      if (iconNode) iconNode.style.transform = 'scale(1.1)';
    });
    iconNode.addEventListener('mouseleave', () => {
      if (iconNode) iconNode.style.transform = 'scale(1)';
    });

    iconNode.addEventListener('mousedown', (e) => {
       e.preventDefault();
       e.stopPropagation();
    });

    iconNode.addEventListener('mouseup', (e) => {
       e.preventDefault();
       e.stopPropagation();
       removeIcon();
       showTranslationBubble(rect, text);
    });

    document.body.appendChild(iconNode);
  }

  function showTranslationBubble(rect: DOMRect, text: string) {
    removeBubble();

    bubble = document.createElement('div');
    bubble.id = 'ai-translator-bubble';
    bubble.innerHTML = `
      <div class="ai-translator-bubble-content">
        <div class="ai-translator-bubble-header">
          <span class="ai-translator-bubble-logo">🌐</span>
          <span class="ai-translator-bubble-title">AI Translator</span>
          <button class="ai-translator-bubble-close" id="ai-translator-close">✕</button>
        </div>
        <div class="ai-translator-bubble-body">
          <div class="ai-translator-bubble-loading">
            <div class="ai-translator-spinner"></div>
            <span>Đang dịch...</span>
          </div>
        </div>
      </div>
    `;

    // Position the bubble
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    bubble.style.position = 'absolute';
    bubble.style.left = `${Math.max(10, rect.left + scrollX)}px`;
    bubble.style.top = `${rect.top + scrollY + (rect.height || 0) + 8}px`;
    bubble.style.zIndex = '2147483647';

    document.body.appendChild(bubble);

    // Close button
    const closeBtn = bubble.querySelector('#ai-translator-close');
    closeBtn?.addEventListener('click', removeBubble);

    // Request translation
    translateText(text);
  }

  async function translateText(text: string) {
    try {
      // Auto-detect Vietnamese characters to swap target language
      const isVietnamese = /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i.test(text);
      const targetLang = isVietnamese ? 'en' : 'vi';

      const response: TranslateResponse = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        payload: {
          text,
          sourceLang: 'auto',
          targetLang: targetLang,
        },
      });

      if (!bubble) return;

      const body = bubble.querySelector('.ai-translator-bubble-body');
      if (!body) return;

      if (response.success && response.data) {
        const formatted = formatTranslatedText(response.data.translatedText);
        const rawEnMatch = response.data.translatedText.match(/(- )?(English|Tiếng Anh):\s*([\s\S]*?)(?=(- )?(Vietnamese|Tiếng Việt):|$)/i);
        const enText = rawEnMatch ? rawEnMatch[3].trim() : text;

        body.innerHTML = `
          <div class="ai-translator-bubble-result-container">
            ${formatted.fallback ? `<div class="ai-translator-fallback-badge">${formatted.fallback}</div>` : ''}
            <div class="ai-translator-sections">${formatted.html}</div>
            <button class="ai-ielts-btn" data-text="${escapeHtml(enText)}" title="Rewrite to IELTS 8.0">🎓 Rewrite (IELTS 8.0)</button>
            <div class="ai-ielts-result" style="display: none;"></div>
          </div>
        `;

        // Section copy buttons
        const copyBtns = body.querySelectorAll('.ai-section-copy');
        copyBtns.forEach(btn => {
          btn.addEventListener('click', (e) => {
            const b = e.currentTarget as HTMLButtonElement;
            const copyText = b.getAttribute('data-copy-text') || '';
            navigator.clipboard.writeText(copyText);
            const original = b.textContent;
            b.textContent = '✅';
            setTimeout(() => { b.textContent = original; }, 2000);
          });
        });

        // IELTS Button
        const ieltsBtn = body.querySelector('.ai-ielts-btn');
        if (ieltsBtn) {
          ieltsBtn.addEventListener('click', async (e) => {
            const b = e.currentTarget as HTMLButtonElement;
            const textToAnalyze = b.getAttribute('data-text') || '';
            const resultDiv = b.nextElementSibling as HTMLElement;
            
            if (resultDiv.style.display === 'block') {
              resultDiv.style.display = 'none';
              return;
            }

            resultDiv.style.display = 'block';
            resultDiv.innerHTML = '<div class="ai-translator-spinner" style="margin: 10px auto;"></div><div style="text-align: center; font-size: 12px; color: #94a3b8;">Đang viết lại...</div>';

            try {
              const res = await chrome.runtime.sendMessage({
                type: 'ANALYZE_IELTS',
                payload: { text: textToAnalyze }
              });

              if (res?.success && res.data) {
                const mdHtml = escapeHtml(res.data.text)
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/__(.*?)__/g, '<strong>$1</strong>')
                  .replace(/\*(.*?)\*/g, '<em>$1</em>')
                  .replace(/\n/g, '<br>');
                resultDiv.innerHTML = `<div class="ai-ielts-content">${mdHtml}</div>`;
              } else {
                resultDiv.innerHTML = `<div class="ai-translator-bubble-error">⚠️ ${res?.error || 'Phân tích thất bại'}</div>`;
              }
            } catch (err) {
              resultDiv.innerHTML = '<div class="ai-translator-bubble-error">⚠️ Lỗi kết nối</div>';
            }
          });
        }

        // Refresh sidebar if it's open
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
    } catch (error) {
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
    // Add inline styles to guarantee it's positioned correctly regardless of CSS loading
    sidebar.style.cssText = `
      position: fixed; top: 0; right: -320px; width: 320px; height: 100vh;
      background: rgba(15, 15, 35, 0.95); backdrop-filter: blur(20px);
      border-left: 1px solid rgba(99, 102, 241, 0.3); box-shadow: -5px 0 30px rgba(0,0,0,0.5);
      z-index: 2147483646; transition: right 0.3s ease; color: #e2e8f0;
      font-family: sans-serif; display: flex; flex-direction: column;
    `;
    
    const toggleBtn = document.createElement('div');
    toggleBtn.id = 'ai-translator-sidebar-toggle';
    toggleBtn.innerHTML = '📝';
    toggleBtn.title = 'AI Translator History';
    // Inline styles for toggle button
    toggleBtn.style.cssText = `
      position: fixed; top: 50%; right: 0; transform: translateY(-50%);
      background: rgba(99, 102, 241, 0.9); color: white; width: 36px; height: 44px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 8px 0 0 8px; cursor: pointer; z-index: 2147483647;
      box-shadow: -2px 0 10px rgba(0,0,0,0.3); font-size: 18px; transition: right 0.3s ease;
    `;
    
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
    
    // Ensure appending if it failed initially
    setTimeout(appendSidebar, 1000);
    
    toggleBtn.addEventListener('click', () => {
      const isClosed = sidebar.style.right !== '0px';
      if (isClosed) {
        sidebar.style.right = '0px';
        toggleBtn.style.right = '320px';
        sidebar.classList.add('ai-translator-sidebar-open');
        sidebar.classList.remove('ai-translator-sidebar-closed');
        loadHistoryIntoSidebar(sidebar);
      } else {
        sidebar.style.right = '-320px';
        toggleBtn.style.right = '0px';
        sidebar.classList.remove('ai-translator-sidebar-open');
        sidebar.classList.add('ai-translator-sidebar-closed');
      }
    });

    // Close on clicking outside
    document.addEventListener('mousedown', (e) => {
      if (
        sidebar.style.right === '0px' && 
        !sidebar.contains(e.target as Node) && 
        !toggleBtn.contains(e.target as Node)
      ) {
        sidebar.style.right = '-320px';
        toggleBtn.style.right = '0px';
        sidebar.classList.remove('ai-translator-sidebar-open');
        sidebar.classList.add('ai-translator-sidebar-closed');
      }
    });
  }

  async function loadHistoryIntoSidebar(sidebar: HTMLElement) {
    sidebar.innerHTML = `
      <div class="ai-translator-sidebar-header">
        <h3>Lịch sử dịch</h3>
      </div>
      <div style="padding: 20px; text-align: center; color: #94a3b8;">
        <div class="ai-translator-spinner" style="margin: 0 auto 10px auto;"></div>
        Đang tải...
      </div>
    `;
    
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      if (response?.success && response.data) {
        const history = response.data;
        if (history.length === 0) {
          sidebar.innerHTML = `
            <div class="ai-translator-sidebar-header">
              <h3>Lịch sử dịch</h3>
            </div>
            <div style="padding: 20px; text-align: center; color: #94a3b8;">Chưa có lịch sử dịch.</div>
          `;
          return;
        }
        
        // Sort history by newest first
        history.sort((a: any, b: any) => b.timestamp - a.timestamp);

        let html = `
          <div class="ai-translator-sidebar-header">
            <h3>Lịch sử dịch</h3>
            <button id="ai-translator-clear-history">Xóa hết</button>
          </div>
          <div class="ai-translator-sidebar-content">
        `;
        
        for (const item of history) {
          const formatted = formatTranslatedText(item.translatedText);
          const rawEnMatch = item.translatedText.match(/(- )?(English|Tiếng Anh):\s*([\s\S]*?)(?=(- )?(Vietnamese|Tiếng Việt):|$)/i);
          const enText = rawEnMatch ? rawEnMatch[3].trim() : escapeHtml(item.sourceText);

          html += `
            <div class="ai-translator-history-item">
              <div class="source-text">${escapeHtml(item.sourceText)}</div>
              <div class="translated-text">${formatted.html}</div>
              <button class="ai-ielts-btn" data-text="${escapeHtml(enText)}" title="Rewrite to IELTS 8.0">🎓 Rewrite (IELTS 8.0)</button>
              <div class="ai-ielts-result" style="display: none;"></div>
            </div>
          `;
        }
        
        html += '</div>';
        sidebar.innerHTML = html;
        
        const clearBtn = sidebar.querySelector('#ai-translator-clear-history');
        if (clearBtn) {
          clearBtn.addEventListener('click', async () => {
            if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử?')) {
              await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
              loadHistoryIntoSidebar(sidebar);
            }
          });
        }

        // Section copy buttons in history
        const copyBtns = sidebar.querySelectorAll('.ai-section-copy');
        copyBtns.forEach(btn => {
          btn.addEventListener('click', (e) => {
            const b = e.currentTarget as HTMLButtonElement;
            const text = b.getAttribute('data-copy-text') || '';
            navigator.clipboard.writeText(text);
            const original = b.textContent;
            b.textContent = '✅';
            setTimeout(() => { b.textContent = original; }, 2000);
          });
        });

        // IELTS Analysis Buttons
        const ieltsBtns = sidebar.querySelectorAll('.ai-ielts-btn');
        ieltsBtns.forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const b = e.currentTarget as HTMLButtonElement;
            const textToAnalyze = b.getAttribute('data-text') || '';
            const resultDiv = b.nextElementSibling as HTMLElement;
            
            if (resultDiv.style.display === 'block') {
              resultDiv.style.display = 'none';
              return;
            }

            resultDiv.style.display = 'block';
            resultDiv.innerHTML = '<div class="ai-translator-spinner" style="margin: 10px auto;"></div><div style="text-align: center; font-size: 12px; color: #94a3b8;">Đang viết lại...</div>';

            try {
              const response = await chrome.runtime.sendMessage({
                type: 'ANALYZE_IELTS',
                payload: { text: textToAnalyze }
              });

              if (response?.success && response.data) {
                const mdHtml = escapeHtml(response.data.text)
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/__(.*?)__/g, '<strong>$1</strong>')
                  .replace(/\*(.*?)\*/g, '<em>$1</em>')
                  .replace(/\n/g, '<br>');
                resultDiv.innerHTML = `<div class="ai-ielts-content">${mdHtml}</div>`;
              } else {
                resultDiv.innerHTML = `<div class="ai-translator-bubble-error">⚠️ ${response?.error || 'Phân tích thất bại'}</div>`;
              }
            } catch (err) {
              resultDiv.innerHTML = '<div class="ai-translator-bubble-error">⚠️ Lỗi kết nối</div>';
            }
          });
        });
      }
    } catch (e) {
      sidebar.innerHTML = `
        <div class="ai-translator-sidebar-header">
          <h3>Lịch sử dịch</h3>
        </div>
        <div style="padding: 20px; text-align: center; color: #f87171;">Lỗi tải lịch sử</div>
      `;
    }
  }

  function formatTranslatedText(text: string) {
    let fallback = '';
    let processedText = text;

    // Extract fallback info
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
      const escapedContent = escapeHtml(content.trim());
      const markdownContent = escapedContent
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.*?)__/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');

      return `
        <div class="ai-lang-section">
          <div class="ai-lang-header">
            <div class="ai-lang-label ${type}">${type === 'vi' ? '🇻🇳 Vietnamese' : '🇬🇧 English'}</div>
            <button class="ai-section-copy" data-copy-text="${escapedContent}" title="Copy ${label}">📋</button>
          </div>
          <div class="ai-lang-body">${markdownContent}</div>
        </div>
      `;
    };

    let html = '';
    if (viMatch) html += formatBlock('Vietnamese', viMatch[3], 'vi');
    if (enMatch) html += formatBlock('English', enMatch[3], 'en');

    // Fallback if regex fails
    if (!html) {
      html = `<div class="ai-translator-bubble-text">${escapeHtml(processedText).replace(/\n/g, '<br>')}</div>`;
    }

    return {
      html,
      fallback,
      plainText: processedText
    };
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

    overlay.querySelector('.zen-close')?.addEventListener('click', () => {
      overlay.remove();
    });

    let contentElement = document.querySelector('article') || document.querySelector('main') || document.body;
    const clone = contentElement.cloneNode(true) as HTMLElement;
    const noisySelectors = ['nav', 'header', 'footer', 'script', 'style', 'noscript', 'iframe', 'svg', 'aside'];
    noisySelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });
    
    // Grab text and limit length to save tokens (~15000 chars)
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
    } catch (err) {
      const contentDiv = overlay.querySelector('.zen-content') as HTMLElement;
      if (contentDiv) contentDiv.innerHTML = `<div style="text-align:center; color:#ef4444; padding: 40px;">⚠️ Lỗi kết nối.</div>`;
    }
  }
}
