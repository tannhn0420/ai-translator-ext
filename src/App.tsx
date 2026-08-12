// ============================================
// Popup App - Main Component
// ============================================

import { useState, useEffect, useCallback } from 'react';
import type { SourceLanguage, Language, TranslateResponse, AppSettings, PageTranslateMode } from './types';
import { LANGUAGE_LABELS, PRESET_PROMPTS, MAX_TEXT_LENGTH } from './utils/constants';
import './App.css';

function App() {
  // Translation state
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [sourceLang, setSourceLang] = useState<SourceLanguage>('auto');
  const [targetLang, setTargetLang] = useState<Language>('vi');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Settings state
  const [hasApiKey, setHasApiKey] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState('');
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [pageMode, setPageMode] = useState<PageTranslateMode>('replace');
  const [currentHost, setCurrentHost] = useState('');
  const [autoSite, setAutoSite] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    loadPopupState();
    loadAutoSite();
  }, []);

  const loadAutoSite = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let host = '';
      // Only real web pages have a translatable host — skip chrome://, extension pages, file://…
      if (tab?.url && /^https?:/i.test(tab.url)) {
        try {
          host = new URL(tab.url).hostname.replace(/^www\./, '');
        } catch {
          // ignore
        }
      }
      setCurrentHost(host);
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      const domains: string[] = resp?.data?.pageAutoDomains || [];
      setAutoSite(!!host && domains.some((d) => d.replace(/^www\./, '') === host));
    } catch {
      // ignore
    }
  };

  const toggleAutoSite = async () => {
    if (!currentHost) return;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      const existing: string[] = (resp?.data?.pageAutoDomains || []).map((d: string) =>
        d.replace(/^www\./, ''),
      );
      const isOn = existing.includes(currentHost);
      const next = isOn ? existing.filter((d) => d !== currentHost) : [...existing, currentHost];
      await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { pageAutoDomains: next } });
      setAutoSite(!isOn);
    } catch {
      // ignore
    }
  };

  const loadPopupState = async () => {
    try {
      const data = await chrome.storage.local.get(['popupInputText', 'popupOutputText']);
      if (data.popupInputText) setInputText(data.popupInputText as string);
      if (data.popupOutputText) setOutputText(data.popupOutputText as string);
    } catch {
      // Ignore
    }
  };

  // Save input text when changed
  useEffect(() => {
    try {
      chrome.storage.local.set({ popupInputText: inputText });
    } catch {
      // Ignore
    }
  }, [inputText]);

  // Save output text when changed — debounced so streaming (one update per delta) doesn't
  // fire hundreds of storage.local writes; persist ~400ms after the last change.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        chrome.storage.local.set({ popupOutputText: outputText });
      } catch {
        // Ignore
      }
    }, 400);
    return () => clearTimeout(id);
  }, [outputText]);

  const loadSettings = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.success && response.data) {
        const settings: AppSettings = response.data;
        let key = settings.apiKey;
        if (settings.provider === 'groq') key = settings.groqApiKey;
        else if (settings.provider === 'openrouter') key = settings.openrouterApiKey;
        setHasApiKey(!!key);
        setSourceLang(settings.defaultSourceLang);
        setTargetLang(settings.defaultTargetLang);
        setAutoTranslate(settings.autoTranslateOnHighlight);
        setPageMode(settings.pageTranslateMode || 'replace');
        setReminderEnabled(settings.reminderEnabled !== false);
        const th = settings.theme === 'light' ? 'light' : 'dark';
        setTheme(th);
        document.documentElement.dataset.theme = th;
      }
    } catch {
      // Extension context may not be available during development
      console.log('Running outside extension context');
    }
  };

  const handleTranslate = useCallback(() => {
    if (!inputText.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setOutputText('');

    const payload = { text: inputText, sourceLang, targetLang };

    const fallbackNonStream = async () => {
      try {
        const response: TranslateResponse = await chrome.runtime.sendMessage({ type: 'TRANSLATE_TEXT', payload });
        if (response.success && response.data) setOutputText(response.data.translatedText);
        else setError(response.error || 'Dịch thất bại. Vui lòng thử lại.');
      } catch {
        setError('Không thể kết nối tới service. Vui lòng reload extension.');
      } finally {
        setIsLoading(false);
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
        setOutputText(msg.full || '');
      } else if (msg.type === 'done') {
        settled = true;
        setOutputText(msg.full || '');
        setIsLoading(false);
        try { port.disconnect(); } catch { /* noop */ }
      } else if (msg.type === 'error') {
        settled = true;
        try { port.disconnect(); } catch { /* noop */ }
        if (gotDelta) {
          setError(msg.error || 'Dịch thất bại.');
          setIsLoading(false);
        } else {
          fallbackNonStream();
        }
      }
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      if (gotDelta) {
        setError('Kết nối bị gián đoạn.');
        setIsLoading(false);
      } else {
        fallbackNonStream();
      }
    });
    port.postMessage(payload);
  }, [inputText, sourceLang, targetLang, isLoading]);

  const handleSwap = () => {
    if (sourceLang === 'auto') {
      setSourceLang('vi');
      setTargetLang('en');
    } else {
      const temp = sourceLang;
      setSourceLang(targetLang);
      setTargetLang(temp);
    }
    // Swap texts too
    if (outputText) {
      setInputText(outputText);
      setOutputText(inputText);
    }
  };

  const handleCopy = async () => {
    if (!outputText) return;
    try {
      await navigator.clipboard.writeText(outputText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy
      const textArea = document.createElement('textarea');
      textArea.value = outputText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const openZenMode = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      // Rejects on restricted pages (chrome://, Web Store, PDF viewer) with no content script.
      await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_ZEN_MODE' });
      window.close(); // close popup only after the content script accepted the trigger
    } catch {
      setError('Không mở được chế độ đọc trên trang này.');
    }
  };

  const summarizePage = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_SUMMARY' });
      window.close();
    } catch {
      setError('Không tóm tắt được trên trang này.');
    }
  };

  const toggleHighlight = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_HIGHLIGHT' });
      window.close();
    } catch {
      setError('Không tô sáng được trên trang này.');
    }
  };

  const translateFullPage = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      // Persist the chosen mode + target so the context-menu path uses the same.
      chrome.runtime
        .sendMessage({ type: 'SAVE_SETTINGS', payload: { pageTranslateMode: pageMode, pageTargetLang: targetLang } })
        .catch(() => {});
      chrome.tabs.sendMessage(tab.id, {
        type: 'TRANSLATE_PAGE',
        payload: { mode: pageMode, targetLang },
      });
      window.close();
    } catch {
      setError('Không thể dịch trang. Hãy reload tab rồi thử lại.');
    }
  };

  const togglePageMode = () => {
    const next: PageTranslateMode = pageMode === 'replace' ? 'bilingual' : 'replace';
    setPageMode(next);
    chrome.runtime
      .sendMessage({ type: 'SAVE_SETTINGS', payload: { pageTranslateMode: next } })
      .catch(() => {});
  };

  const toggleReminder = () => {
    const next = !reminderEnabled;
    setReminderEnabled(next);
    chrome.runtime
      .sendMessage({ type: 'SAVE_SETTINGS', payload: { reminderEnabled: next } })
      .catch(() => {});
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { theme: next } }).catch(() => {});
  };

  const handleClear = () => {
    setInputText('');
    setOutputText('');
    setError(null);
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage?.();
  };

  const openFlashcards = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/flashcards/flashcards.html') });
    window.close();
  };

  const openPractice = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/practice/practice.html') });
    window.close();
  };

  const openDictation = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dictation/dictation.html') });
    window.close();
  };

  const openProgress = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/progress/progress.html') });
    window.close();
  };

  const toggleAutoTranslate = async () => {
    const newValue = !autoTranslate;
    setAutoTranslate(newValue);
    try {
      await chrome.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        payload: { autoTranslateOnHighlight: newValue },
      });
    } catch {
      // Ignore
    }
  };

  const handlePromptChange = (promptId: string) => {
    setSelectedPrompt(promptId);
    // Apply prompt via settings
    const preset = PRESET_PROMPTS.find((p) => p.id === promptId);
    if (preset) {
      chrome.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        payload: {
          systemPrompt: preset.systemPrompt,
          translationTemplate: preset.translationTemplate,
        },
      }).catch(() => {});
    }
  };

  // Keyboard shortcut
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleTranslate();
    }
  };

  const charCount = inputText.length;
  const charClass = charCount > MAX_TEXT_LENGTH ? 'error' : charCount > MAX_TEXT_LENGTH * 0.8 ? 'warning' : '';

  const targetName = targetLang === 'vi' ? 'Tiếng Việt' : 'English';

  return (
    <div className="popup-app">
      {/* Header */}
      <header className="popup-header">
        <div className="popup-header-left">
          <div className="popup-logo">🌐</div>
          <h1 className="popup-title">AI Translator</h1>
        </div>
        <div className="popup-header-actions">
          <button className="header-btn" onClick={toggleTheme} title="Giao diện sáng/tối">{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className="header-btn" onClick={openProgress} title="Tiến độ học tập">📊</button>
          <button className="header-btn" onClick={openPractice} title="Luyện tập theo chủ đề">🎯</button>
          <button className="header-btn" onClick={openDictation} title="Chép chính tả (đoạn văn / phụ đề)">🎧</button>
          <button className="header-btn" onClick={openFlashcards} title="Sổ từ vựng">📇</button>
          <button className="header-btn" onClick={openZenMode} title="Đọc tập trung (Zen)">📖</button>
          <button className="header-btn" onClick={summarizePage} title="Tóm tắt &amp; từ khoá trang">📄</button>
          <button className="header-btn" onClick={toggleHighlight} title="Tô sáng từ khó trên trang">🖍️</button>
          <button className="header-btn" onClick={openOptions} title="Cài đặt">⚙️</button>
        </div>
      </header>

      <div className="popup-body">
        {!hasApiKey && (
          <div className="api-key-banner">
            <span>Chưa có API key.</span>
            <a onClick={openOptions}>Cấu hình ngay</a>
          </div>
        )}

        {/* Language bar */}
        <div className="language-bar">
          <select
            className="lang-select"
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value as SourceLanguage)}
          >
            <option value="auto">{LANGUAGE_LABELS.auto}</option>
            <option value="en">{LANGUAGE_LABELS.en}</option>
            <option value="vi">{LANGUAGE_LABELS.vi}</option>
          </select>
          <button className="swap-btn" onClick={handleSwap} title="Đổi chiều dịch">⇄</button>
          <select
            className="lang-select"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value as Language)}
          >
            <option value="en">{LANGUAGE_LABELS.en}</option>
            <option value="vi">{LANGUAGE_LABELS.vi}</option>
          </select>
        </div>

        {/* Quick translate */}
        <div className="translate-panel">
          <div className="field">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Nhập hoặc dán văn bản… (Ctrl+Enter để dịch)"
              maxLength={MAX_TEXT_LENGTH + 100}
            />
            <div className="field-footer">
              <span className={`char-count ${charClass}`}>{charCount}/{MAX_TEXT_LENGTH}</span>
              {inputText && (
                <button className="link-btn" onClick={handleClear}>Xoá</button>
              )}
            </div>
          </div>

          <button
            className={`translate-btn ${isLoading ? 'loading' : ''}`}
            onClick={handleTranslate}
            disabled={!inputText.trim() || isLoading || !hasApiKey}
          >
            {isLoading ? (<><span className="spinner" /> Đang dịch…</>) : (<>✨ Dịch</>)}
          </button>

          {(isLoading || outputText) && (
            <div className="output-card">
              <div className="output-head">
                <span className="output-label">Kết quả</span>
                {outputText && (
                  <button className={`link-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
                    {copied ? '✓ Đã copy' : 'Copy'}
                  </button>
                )}
              </div>
              <div className="output-text">{outputText || 'Đang dịch…'}</div>
            </div>
          )}
        </div>

        {/* Section: whole page */}
        <section className="popup-section">
          <div className="popup-section-label">Dịch cả trang</div>
          <button
            className="page-btn"
            onClick={translateFullPage}
            disabled={!hasApiKey}
            title="Dịch & thay thế toàn trang, giữ format. Bấm lại để khôi phục bản gốc."
          >
            🌐 Dịch cả trang → {targetName}
          </button>
          <div className="segmented" role="group" aria-label="Chế độ hiển thị">
            <button
              className={`segment ${pageMode === 'replace' ? 'active' : ''}`}
              onClick={() => pageMode !== 'replace' && togglePageMode()}
            >
              🔁 Thay thế
            </button>
            <button
              className={`segment ${pageMode === 'bilingual' ? 'active' : ''}`}
              onClick={() => pageMode !== 'bilingual' && togglePageMode()}
            >
              📑 Song ngữ
            </button>
          </div>
        </section>

        {/* Section: options */}
        <section className="popup-section">
          <div className="popup-section-label">Tuỳ chọn</div>
          <div className="pill-row">
            <button
              className={`toggle-pill ${autoTranslate ? 'on' : ''}`}
              onClick={toggleAutoTranslate}
              title="Tự dịch ngay khi bôi đen văn bản"
            >
              <span className="dot" /> Auto dịch chọn
            </button>
            <button
              className={`toggle-pill ${reminderEnabled ? 'on' : ''}`}
              onClick={toggleReminder}
              title="Nhắc ôn từ vựng ~10 phút/lần trên tab đang dùng"
            >
              <span className="dot" /> Nhắc học
            </button>
            <button
              className={`toggle-pill ${autoSite ? 'on' : ''}`}
              onClick={toggleAutoSite}
              disabled={!currentHost}
              title={currentHost ? `Tự dịch mỗi khi mở ${currentHost}` : 'Chỉ dùng được trên trang web'}
            >
              <span className="dot" /> {currentHost ? `Tự dịch ${currentHost}` : 'Tự dịch site'}
            </button>
          </div>
          <select
            className="prompt-select"
            value={selectedPrompt}
            onChange={(e) => handlePromptChange(e.target.value)}
          >
            <option value="">🤖 Phong cách dịch: Mặc định</option>
            {PRESET_PROMPTS.map((prompt) => (
              <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
            ))}
          </select>
        </section>
      </div>

      {error && (
        <div className="error-toast">
          <span>⚠️ {error}</span>
          <button className="close-error" onClick={() => setError(null)}>✕</button>
        </div>
      )}
    </div>
  );
}

export default App;
