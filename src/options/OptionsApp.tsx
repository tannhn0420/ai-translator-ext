// ============================================
// Options Page - Main Component
// ============================================

import { useState, useEffect } from 'react';
import type { AppSettings } from '../types';
import { PRESET_PROMPTS, DEFAULT_SYSTEM_PROMPT, DEFAULT_TRANSLATION_TEMPLATE } from '../utils/constants';
import './options.css';

type Tab = 'api' | 'prompts' | 'language' | 'behavior';

function OptionsApp() {
  const [activeTab, setActiveTab] = useState<Tab>('api');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Form states
  const [provider, setProvider] = useState<'gemini' | 'groq' | 'openrouter'>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<'gemini-flash-latest' | 'gemini-pro-latest'>('gemini-flash-latest');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [groqModel, setGroqModel] = useState('llama-3.1-8b-instant');
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [openrouterModel, setOpenrouterModel] = useState('openai/gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [translationTemplate, setTranslationTemplate] = useState(DEFAULT_TRANSLATION_TEMPLATE);
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null);
  const [validating, setValidating] = useState(false);
  const [defaultSourceLang, setDefaultSourceLang] = useState('auto');
  const [defaultTargetLang, setDefaultTargetLang] = useState('vi');
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [showBubble, setShowBubble] = useState(true);
  const [bubblePosition, setBubblePosition] = useState('below');
  const [dictionaryMode, setDictionaryMode] = useState(true);
  const [contextAware, setContextAware] = useState(true);
  const [cacheEnabled, setCacheEnabled] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.success && response.data) {
        const s: AppSettings = response.data;
        setSettings(s);
        setProvider((s.provider as string) === 'openai' ? 'gemini' : (s.provider || 'gemini'));
        setApiKey(s.apiKey || '');
        setModel(s.model || 'gemini-flash-latest' as any);
        setGroqApiKey(s.groqApiKey || '');
        setGroqModel(s.groqModel || 'llama3-8b-8192');
        setOpenrouterApiKey(s.openrouterApiKey || '');
        setOpenrouterModel(s.openrouterModel || 'openai/gpt-4o-mini');
        setSystemPrompt(s.systemPrompt);
        setTranslationTemplate(s.translationTemplate);
        setDefaultSourceLang(s.defaultSourceLang);
        setDefaultTargetLang(s.defaultTargetLang);
        setAutoTranslate(s.autoTranslateOnHighlight);
        setShowBubble(s.showTranslationBubble);
        setBubblePosition(s.bubblePosition);
        setDictionaryMode(s.dictionaryModeEnabled !== false);
        setContextAware(s.contextAwareEnabled !== false);
        setCacheEnabled(s.cacheEnabled !== false);
      }
    } catch {
      console.log('Running outside extension context');
    }
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const saveField = async (updates: Partial<AppSettings>) => {
    try {
      await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: updates });
      showToast('✅ Đã lưu thành công!');
    } catch {
      showToast('❌ Lỗi khi lưu settings', 'error');
    }
  };

  const validateKey = async () => {
    let currentApiKey = '';
    let currentModel = '';
    let baseUrl: string | undefined = undefined;
    
    if (provider === 'groq') {
      currentApiKey = groqApiKey;
      currentModel = groqModel;
      baseUrl = 'https://api.groq.com/openai/v1';
    } else if (provider === 'openrouter') {
      currentApiKey = openrouterApiKey;
      currentModel = openrouterModel;
      baseUrl = 'https://openrouter.ai/api/v1';
    } else {
      currentApiKey = apiKey;
      currentModel = model;
    }
    
    if (!currentApiKey.trim()) {
      showToast('⚠️ Vui lòng nhập API key', 'error');
      return;
    }
    
    setValidating(true);
    setApiKeyValid(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'VALIDATE_API_KEY',
        payload: { 
          provider, 
          apiKey: currentApiKey, 
          model: currentModel,
          baseUrl
        },
      });
      setApiKeyValid(response?.data?.valid || false);
      if (response?.data?.valid) {
        if (provider === 'groq') {
          await saveField({ provider, groqApiKey, groqModel });
        } else if (provider === 'openrouter') {
          await saveField({ provider, openrouterApiKey, openrouterModel });
        } else {
          await saveField({ provider, apiKey, model });
        }
      }
    } catch {
      setApiKeyValid(false);
    } finally {
      setValidating(false);
    }
  };

  const applyPreset = (presetId: string) => {
    const preset = PRESET_PROMPTS.find((p) => p.id === presetId);
    if (preset) {
      setSystemPrompt(preset.systemPrompt);
      setTranslationTemplate(preset.translationTemplate);
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'api':
        return (
          <div className="options-section">
            <h2 className="section-title">🔑 API Configuration</h2>
            <p className="section-desc">
              Chọn Provider và cấu hình API key để sử dụng dịch thuật AI.
            </p>

            <div className="form-group">
              <label className="form-label">AI Provider</label>
              <select
                className="form-select"
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as 'gemini' | 'groq' | 'openrouter';
                  setProvider(p);
                  setApiKeyValid(null);
                  saveField({ provider: p });
                }}
              >
                <option value="gemini">Google Gemini (Miễn phí/Trả phí)</option>
                <option value="groq">Groq (Miễn phí/Nhanh)</option>
                <option value="openrouter">OpenRouter (Đa dạng/Rẻ)</option>
              </select>
            </div>

            {provider === 'gemini' && (
              <>
                <div className="form-group">
                  <label className="form-label">Gemini API Key</label>
                  <input
                    type="password"
                    className="form-input"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setApiKeyValid(null);
                    }}
                    placeholder="Nhập Gemini API key..."
                  />
                  <p className="form-help">
                    Lấy API key tại <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>
                  </p>
                </div>
                <div className="form-group">
                  <label className="form-label">Gemini Model</label>
                  <select
                    className="form-select"
                    value={model}
                    onChange={(e) => setModel(e.target.value as 'gemini-flash-latest' | 'gemini-pro-latest')}
                  >
                    <option value="gemini-flash-latest">Gemini Flash Latest (Nhanh)</option>
                    <option value="gemini-pro-latest">Gemini Pro Latest (Chính xác)</option>
                  </select>
                </div>
              </>
            )}

            {provider === 'groq' && (
              <>
                <div className="form-group">
                  <label className="form-label">Groq API Key</label>
                  <input
                    type="password"
                    className="form-input"
                    value={groqApiKey}
                    onChange={(e) => {
                      setGroqApiKey(e.target.value);
                      setApiKeyValid(null);
                    }}
                    placeholder="gsk_..."
                  />
                  <p className="form-help">
                    Lấy API key tại <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Groq Console</a>
                  </p>
                </div>
                <div className="form-group">
                  <label className="form-label">Groq Model</label>
                  <input
                    type="text"
                    className="form-input"
                    value={groqModel}
                    onChange={(e) => setGroqModel(e.target.value)}
                    placeholder="llama3-8b-8192"
                  />
                </div>
              </>
            )}

            {provider === 'openrouter' && (
              <>
                <div className="form-group">
                  <label className="form-label">OpenRouter API Key</label>
                  <input
                    type="password"
                    className="form-input"
                    value={openrouterApiKey}
                    onChange={(e) => {
                      setOpenrouterApiKey(e.target.value);
                      setApiKeyValid(null);
                    }}
                    placeholder="sk-or-v1-..."
                  />
                  <p className="form-help">
                    Lấy API key tại <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter</a>
                  </p>
                </div>
                <div className="form-group">
                  <label className="form-label">OpenRouter Model</label>
                  <input
                    type="text"
                    className="form-input"
                    value={openrouterModel}
                    onChange={(e) => setOpenrouterModel(e.target.value)}
                    placeholder="openai/gpt-4o-mini"
                  />
                </div>
              </>
            )}

            {apiKeyValid !== null && (
              <div className={`status-badge ${apiKeyValid ? 'success' : 'error'}`}>
                {apiKeyValid ? '✅ API key hợp lệ' : '❌ API key không hợp lệ hoặc lỗi kết nối'}
              </div>
            )}

            <div className="btn-row">
              <button className="btn btn-primary" onClick={validateKey} disabled={validating}>
                {validating ? '⏳ Đang kiểm tra...' : '🔍 Kiểm tra & Lưu'}
              </button>
            </div>

            {settings && (
              <div style={{ marginTop: '32px', padding: '16px', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-accent)' }}>📊 Thống kê</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Tổng dịch: <strong>{settings.totalTranslations}</strong> lần
                </p>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Hôm nay: <strong>{settings.apiCallsToday}</strong> API calls
                </p>
              </div>
            )}
          </div>
        );

      case 'prompts':
        return (
          <div className="options-section">
            <h2 className="section-title">🤖 Custom Prompts</h2>
            <p className="section-desc">
              Tùy chỉnh cách AI dịch. System Prompt định nghĩa "tính cách" và phong cách dịch của AI.
              Translation Template định nghĩa format yêu cầu dịch.
            </p>

            <div className="form-group">
              <label className="form-label">Preset Prompts</label>
              <div className="preset-grid">
                {PRESET_PROMPTS.map((preset) => (
                  <button
                    key={preset.id}
                    className={`preset-card ${systemPrompt === preset.systemPrompt ? 'selected' : ''}`}
                    onClick={() => applyPreset(preset.id)}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">System Prompt (AI Persona)</label>
              <textarea
                className="form-textarea"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={6}
                placeholder="Định nghĩa AI persona và phong cách dịch..."
                id="system-prompt-input"
              />
              <p className="form-help">
                Đây là instruction cho AI biết nó là ai và dịch như thế nào.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Translation Template</label>
              <textarea
                className="form-textarea"
                value={translationTemplate}
                onChange={(e) => setTranslationTemplate(e.target.value)}
                rows={6}
                placeholder="Template cho yêu cầu dịch..."
                id="translation-template-input"
              />
              <p className="form-help">
                Biến hỗ trợ: <code style={{ color: 'var(--primary-400)' }}>{'{text}'}</code>,{' '}
                <code style={{ color: 'var(--primary-400)' }}>{'{source_lang}'}</code>,{' '}
                <code style={{ color: 'var(--primary-400)' }}>{'{target_lang}'}</code>
              </p>
            </div>

            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => saveField({ systemPrompt, translationTemplate })}>
                💾 Lưu Prompts
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
                  setTranslationTemplate(DEFAULT_TRANSLATION_TEMPLATE);
                }}
              >
                ↩️ Reset mặc định
              </button>
            </div>
          </div>
        );

      case 'language':
        return (
          <div className="options-section">
            <h2 className="section-title">🌍 Language Settings</h2>
            <p className="section-desc">Cấu hình ngôn ngữ mặc định cho dịch thuật.</p>

            <div className="form-group">
              <label className="form-label">Ngôn ngữ nguồn mặc định</label>
              <select
                className="form-select"
                value={defaultSourceLang}
                onChange={(e) => setDefaultSourceLang(e.target.value)}
              >
                <option value="auto">🔍 Auto Detect</option>
                <option value="en">🇬🇧 English</option>
                <option value="vi">🇻🇳 Tiếng Việt</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Ngôn ngữ đích mặc định</label>
              <select
                className="form-select"
                value={defaultTargetLang}
                onChange={(e) => setDefaultTargetLang(e.target.value)}
              >
                <option value="en">🇬🇧 English</option>
                <option value="vi">🇻🇳 Tiếng Việt</option>
              </select>
            </div>

            <div className="btn-row">
              <button
                className="btn btn-primary"
                onClick={() => saveField({ defaultSourceLang: defaultSourceLang as 'auto' | 'en' | 'vi', defaultTargetLang: defaultTargetLang as 'en' | 'vi' })}
              >
                💾 Lưu
              </button>
            </div>
          </div>
        );

      case 'behavior':
        return (
          <div className="options-section">
            <h2 className="section-title">⚡ Behavior Settings</h2>
            <p className="section-desc">Tùy chỉnh hành vi của extension.</p>

            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-label">Auto dịch khi highlight</span>
                <span className="toggle-desc">Tự động dịch khi bôi đen text trên trang</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={autoTranslate}
                  onChange={(e) => {
                    setAutoTranslate(e.target.checked);
                    saveField({ autoTranslateOnHighlight: e.target.checked });
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-label">Hiển thị bubble dịch</span>
                <span className="toggle-desc">Hiện bubble kết quả dịch gần vùng highlight</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={showBubble}
                  onChange={(e) => {
                    setShowBubble(e.target.checked);
                    saveField({ showTranslationBubble: e.target.checked });
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="form-group" style={{ marginTop: '16px' }}>
              <label className="form-label">Vị trí bubble</label>
              <select
                className="form-select"
                value={bubblePosition}
                onChange={(e) => {
                  setBubblePosition(e.target.value);
                  saveField({ bubblePosition: e.target.value as 'above' | 'below' });
                }}
              >
                <option value="below">Bên dưới text</option>
                <option value="above">Bên trên text</option>
              </select>
            </div>

            <div className="toggle-row" style={{ marginTop: '20px' }}>
              <div className="toggle-info">
                <span className="toggle-label">📖 Chế độ từ điển (1-2 từ)</span>
                <span className="toggle-desc">Khi chọn 1-2 từ, hiển thị IPA, định nghĩa, ví dụ, synonyms thay vì chỉ dịch</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={dictionaryMode}
                  onChange={(e) => {
                    setDictionaryMode(e.target.checked);
                    saveField({ dictionaryModeEnabled: e.target.checked });
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-label">🧠 Dịch theo ngữ cảnh</span>
                <span className="toggle-desc">Gửi kèm câu văn xung quanh để AI dịch idiom/đại từ chuẩn hơn</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={contextAware}
                  onChange={(e) => {
                    setContextAware(e.target.checked);
                    saveField({ contextAwareEnabled: e.target.checked });
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-label">⚡ Cache bản dịch (24h)</span>
                <span className="toggle-desc">Lưu kết quả trong 24h, không gọi API lại cho cùng text — nhanh và tiết kiệm</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={cacheEnabled}
                  onChange={(e) => {
                    setCacheEnabled(e.target.checked);
                    saveField({ cacheEnabled: e.target.checked });
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="options-app">
      {/* Sidebar */}
      <nav className="options-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">🌐</div>
          <h1 className="sidebar-title">
            <span className="text-gradient">AI Translator</span>
          </h1>
        </div>

        <button
          className={`sidebar-nav-item ${activeTab === 'api' ? 'active' : ''}`}
          onClick={() => setActiveTab('api')}
        >
          🔑 API Settings
        </button>
        <button
          className={`sidebar-nav-item ${activeTab === 'prompts' ? 'active' : ''}`}
          onClick={() => setActiveTab('prompts')}
        >
          🤖 Custom Prompts
        </button>
        <button
          className={`sidebar-nav-item ${activeTab === 'language' ? 'active' : ''}`}
          onClick={() => setActiveTab('language')}
        >
          🌍 Language
        </button>
        <button
          className={`sidebar-nav-item ${activeTab === 'behavior' ? 'active' : ''}`}
          onClick={() => setActiveTab('behavior')}
        >
          ⚡ Behavior
        </button>
      </nav>

      {/* Content */}
      <main className="options-content">
        {renderContent()}
      </main>

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default OptionsApp;
