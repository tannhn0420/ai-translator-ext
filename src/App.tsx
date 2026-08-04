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

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    loadPopupState();
  }, []);

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

  // Save output text when changed
  useEffect(() => {
    try {
      chrome.storage.local.set({ popupOutputText: outputText });
    } catch {
      // Ignore
    }
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
      }
    } catch {
      // Extension context may not be available during development
      console.log('Running outside extension context');
    }
  };

  const handleTranslate = useCallback(async () => {
    if (!inputText.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setOutputText('');

    try {
      const response: TranslateResponse = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        payload: {
          text: inputText,
          sourceLang,
          targetLang,
        },
      });

      if (response.success && response.data) {
        setOutputText(response.data.translatedText);
      } else {
        setError(response.error || 'Dịch thất bại. Vui lòng thử lại.');
      }
    } catch {
      setError('Không thể kết nối tới service. Vui lòng reload extension.');
    } finally {
      setIsLoading(false);
    }
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_ZEN_MODE' });
      window.close(); // close popup
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

  const handleClear = () => {
    setInputText('');
    setOutputText('');
    setError(null);
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage?.();
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

  return (
    <div className="popup-app">
      {/* Header */}
      <header className="popup-header">
        <div className="popup-header-left">
          <div className="popup-logo">🌐</div>
          <h1 className="popup-title">
            <span className="text-gradient">AI Translator</span>
          </h1>
        </div>
        <div className="popup-header-actions">
          <button className="header-btn" onClick={openZenMode} title="Zen Reading Mode">
            📖
          </button>
          <button className="header-btn" onClick={openOptions} title="Settings">
            ⚙️
          </button>
        </div>
      </header>

      {/* API Key Warning */}
      {!hasApiKey && (
        <div className="api-key-banner">
          ⚠️ Chưa có API key.{' '}
          <a onClick={openOptions}>Cấu hình ngay</a>
        </div>
      )}

      {/* Language Bar */}
      <div className="language-bar">
        <select
          className="lang-select"
          value={sourceLang}
          onChange={(e) => setSourceLang(e.target.value as SourceLanguage)}
          id="source-lang-select"
        >
          <option value="auto">{LANGUAGE_LABELS.auto}</option>
          <option value="en">{LANGUAGE_LABELS.en}</option>
          <option value="vi">{LANGUAGE_LABELS.vi}</option>
        </select>

        <button className="swap-btn" onClick={handleSwap} title="Đổi ngôn ngữ">
          ⇄
        </button>

        <select
          className="lang-select"
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value as Language)}
          id="target-lang-select"
        >
          <option value="en">{LANGUAGE_LABELS.en}</option>
          <option value="vi">{LANGUAGE_LABELS.vi}</option>
        </select>
      </div>

      {/* Translation Section */}
      <div className="translation-section">
        {/* Input */}
        <div className="input-wrapper">
          <div className="textarea-container">
            <textarea
              id="translation-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Nhập hoặc paste text cần dịch... (Ctrl+Enter để dịch)"
              maxLength={MAX_TEXT_LENGTH + 100}
            />
          </div>
          <div className="textarea-footer">
            <span className={`char-count ${charClass}`}>
              {charCount}/{MAX_TEXT_LENGTH}
            </span>
            <div className="textarea-actions">
              {inputText && (
                <button className="icon-btn" onClick={handleClear} title="Xóa">
                  🗑️
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Translate Button */}
        <div className="translate-btn-wrapper">
          <button
            className={`translate-btn ${isLoading ? 'loading' : ''}`}
            onClick={handleTranslate}
            disabled={!inputText.trim() || isLoading || !hasApiKey}
            id="translate-btn"
          >
            {isLoading ? (
              <>
                <div className="spinner" />
                Đang dịch...
              </>
            ) : (
              <>✨ Dịch</>
            )}
          </button>
        </div>

        {/* Output */}
        <div className="output-wrapper">
          {outputText ? (
            <div className="textarea-container">
              <textarea
                id="translation-output"
                value={outputText}
                readOnly
                placeholder="Kết quả dịch sẽ hiển thị ở đây..."
              />
              <div className="textarea-footer">
                <span className="char-count">{outputText.length} ký tự</span>
                <div className="textarea-actions">
                  <button
                    className={`icon-btn ${copied ? 'copied' : ''}`}
                    onClick={handleCopy}
                    title="Copy"
                  >
                    {copied ? '✅' : '📋'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="output-placeholder">
              {isLoading ? '🔄 Đang xử lý...' : '✨ Kết quả dịch sẽ hiển thị ở đây'}
            </div>
          )}
        </div>
      </div>

      {/* Full-page translation */}
      <div className="quick-actions">
        <button
          className="quick-action-btn active"
          onClick={translateFullPage}
          disabled={!hasApiKey}
          title="Dịch & thay thế toàn bộ text trên trang (giữ format). Bấm lại để khôi phục bản gốc."
        >
          🌐 Dịch cả trang → {targetLang === 'vi' ? 'VI' : 'EN'}
        </button>
        <button
          className="quick-action-btn"
          onClick={togglePageMode}
          title="Chế độ hiển thị bản dịch trang"
        >
          {pageMode === 'replace' ? '🔁 Thay thế' : '📑 Song ngữ'}
        </button>
      </div>

      {/* Prompt Select */}
      <div className="prompt-select-wrapper">
        <select
          className="prompt-select"
          value={selectedPrompt}
          onChange={(e) => handlePromptChange(e.target.value)}
          id="prompt-select"
        >
          <option value="">🤖 Prompt mặc định</option>
          {PRESET_PROMPTS.map((prompt) => (
            <option key={prompt.id} value={prompt.id}>
              {prompt.name}
            </option>
          ))}
        </select>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <button
          className={`quick-action-btn ${autoTranslate ? 'active' : ''}`}
          onClick={toggleAutoTranslate}
          title="Auto dịch khi highlight text"
        >
          {autoTranslate ? '🟢' : '⚪'} Auto Highlight
        </button>
        <button className="quick-action-btn" onClick={openOptions}>
          🎨 Custom Prompt
        </button>
      </div>

      {/* Error Toast */}
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
