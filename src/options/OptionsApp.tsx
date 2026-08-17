// ============================================
// Options Page - Main Component
// ============================================

import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import type { AppSettings, PageTranslateMode, Language } from '../types';
import { PRESET_PROMPTS, DEFAULT_SYSTEM_PROMPT, DEFAULT_TRANSLATION_TEMPLATE } from '../utils/constants';
import { pickVoice, sortedVoices, isNaturalVoice } from '../utils/voice';
import { getSession, lastSyncedAt, signIn, signOut, signUp, syncNow } from '../services/sync';
import type { Session } from '@supabase/supabase-js';
import './options.css';

type Tab = 'api' | 'prompts' | 'language' | 'behavior' | 'appearance' | 'sync' | 'backup';

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

  // Appearance & learning (previously only reachable from popup/practice/flashcards headers)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [pageTranslateMode, setPageTranslateMode] = useState<PageTranslateMode>('replace');
  const [pageTargetLang, setPageTargetLang] = useState<Language>('vi');
  const [pageAutoDomains, setPageAutoDomains] = useState('');
  const [ttsVoiceEn, setTtsVoiceEn] = useState('');
  const [ttsVoiceVi, setTtsVoiceVi] = useState('');
  const [ttsRate, setTtsRate] = useState(0.95);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderIntervalMin, setReminderIntervalMin] = useState(10);
  const [vocabAutoImage, setVocabAutoImage] = useState(true);
  const [writingAssistantEnabled, setWritingAssistantEnabled] = useState(true);
  const [hoverTranslate, setHoverTranslate] = useState(false);
  const [highlightMinLen, setHighlightMinLen] = useState(7);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync (Supabase, chung project với PWA ai-english-companion)
  const [session, setSession] = useState<Session | null>(null);
  const [syncEmail, setSyncEmail] = useState('');
  const [syncPassword, setSyncPassword] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastSync, setLastSync] = useState<number | undefined>(undefined);

  useEffect(() => {
    void getSession().then(async (s) => {
      setSession(s);
      if (s) setLastSync(await lastSyncedAt(s.user.id));
    });
  }, []);

  const runSync = async () => {
    setSyncBusy(true);
    const r = await syncNow();
    setSyncBusy(false);
    if (r.status === 'ok') {
      setSyncMsg(`✅ Đã đồng bộ (nhận ${r.pulled ?? 0}, gửi ${r.pushed ?? 0}). Mở lại tab Flashcards để thấy thay đổi.`);
      const s = await getSession();
      if (s) setLastSync(await lastSyncedAt(s.user.id));
    } else if (r.status === 'error') {
      setSyncMsg(`❌ Lỗi đồng bộ: ${r.message}`);
    }
  };

  const doSignIn = async () => {
    setSyncBusy(true);
    setSyncMsg('');
    const err = await signIn(syncEmail.trim(), syncPassword);
    setSyncBusy(false);
    if (err) { setSyncMsg(`❌ ${err}`); return; }
    setSession(await getSession());
    void runSync();
  };

  const doSignUp = async () => {
    setSyncBusy(true);
    setSyncMsg('');
    const err = await signUp(syncEmail.trim(), syncPassword);
    setSyncBusy(false);
    if (err) { setSyncMsg(`❌ ${err}`); return; }
    const s = await getSession();
    setSession(s);
    if (!s) setSyncMsg('📧 Kiểm tra email xác nhận rồi đăng nhập lại.');
    else void runSync();
  };

  useEffect(() => {
    loadSettings();
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices() || []);
    loadVoices();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; };
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

        const th = s.theme === 'light' ? 'light' : 'dark';
        setTheme(th);
        document.documentElement.dataset.theme = th;
        setPageTranslateMode(s.pageTranslateMode === 'bilingual' ? 'bilingual' : 'replace');
        setPageTargetLang(s.pageTargetLang === 'en' ? 'en' : 'vi');
        setPageAutoDomains((s.pageAutoDomains || []).join('\n'));
        setTtsVoiceEn(s.ttsVoiceEn || '');
        setTtsVoiceVi(s.ttsVoiceVi || '');
        setTtsRate(typeof s.ttsRate === 'number' ? s.ttsRate : 0.95);
        setReminderEnabled(s.reminderEnabled !== false);
        setReminderIntervalMin(s.reminderIntervalMin || 10);
        setVocabAutoImage(s.vocabAutoImage !== false);
        setWritingAssistantEnabled(s.writingAssistantEnabled !== false);
        setHoverTranslate(s.hoverTranslate === true);
        setHighlightMinLen(typeof s.highlightMinLen === 'number' ? s.highlightMinLen : 7);
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

  const speakPreview = (lang: 'en' | 'vi') => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const text = lang === 'vi' ? 'Xin chào, đây là giọng đọc mẫu.' : 'Hello, this is a sample of the selected voice.';
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(voices, lang, lang === 'vi' ? ttsVoiceVi : ttsVoiceEn);
    if (v) u.voice = v;
    else u.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
    u.rate = ttsRate || 0.95;
    window.speechSynthesis.speak(u);
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

  // ---- Backup / Restore ----
  // Regenerable data (translation cache, image cache, generated practice packs) is
  // intentionally excluded to keep the file small.
  const BACKUP_LOCAL_KEYS = [
    'vocabDeck',
    'practiceStats',
    'practiceDays',
    'dailyChallenge',
    'translationHistory',
  ];

  const exportBackup = async () => {
    try {
      const settingsData = await chrome.storage.sync.get(null);
      const localData = await chrome.storage.local.get(BACKUP_LOCAL_KEYS);
      const backup = {
        _type: 'ai-translator-backup',
        _version: 1,
        exportedAt: new Date().toISOString(),
        settings: settingsData,
        data: localData,
      };
      const deckCount = Array.isArray(localData.vocabDeck) ? localData.vocabDeck.length : 0;
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-translator-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`✅ Đã xuất sao lưu (${deckCount} từ vựng).`);
    } catch {
      showToast('❌ Xuất sao lưu thất bại.', 'error');
    }
  };

  const importBackup = async (file: File) => {
    let backup: { _type?: string; settings?: Record<string, unknown>; data?: Record<string, unknown> };
    try {
      backup = JSON.parse(await file.text());
    } catch {
      showToast('❌ File không hợp lệ (không phải JSON).', 'error');
      return;
    }
    if (backup._type !== 'ai-translator-backup' || !backup.settings) {
      showToast('❌ Đây không phải file sao lưu của AI Translator.', 'error');
      return;
    }
    const deck = backup.data?.vocabDeck;
    const deckCount = Array.isArray(deck) ? deck.length : 0;
    const ok = window.confirm(
      `Khôi phục sẽ GHI ĐÈ cài đặt và dữ liệu hiện tại bằng bản sao lưu` +
        (deckCount ? ` (${deckCount} từ vựng)` : '') +
        `.\n\nBạn có chắc muốn tiếp tục?`,
    );
    if (!ok) return;
    try {
      await chrome.storage.sync.set(backup.settings);
      if (backup.data && Object.keys(backup.data).length) {
        await chrome.storage.local.set(backup.data);
      }
      await loadSettings();
      showToast('✅ Đã khôi phục. Mở lại các tab đang mở để áp dụng.');
    } catch {
      showToast('❌ Khôi phục thất bại.', 'error');
    }
  };

  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void importBackup(file);
    e.target.value = ''; // allow re-importing the same file
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

      case 'appearance':
        return (
          <div className="options-section">
            <h2 className="section-title">🎨 Giao diện &amp; Học tập</h2>
            <p className="section-desc">
              Các tuỳ chọn trước đây nằm rải rác ở popup / trang luyện tập / flashcards, nay gom về đây.
            </p>

            <div className="form-group">
              <label className="form-label">Giao diện (theme)</label>
              <select
                className="form-select"
                value={theme}
                onChange={(e) => {
                  const t = e.target.value as 'dark' | 'light';
                  setTheme(t);
                  document.documentElement.dataset.theme = t;
                  saveField({ theme: t });
                }}
              >
                <option value="dark">🌙 Tối (Dark)</option>
                <option value="light">☀️ Sáng (Light)</option>
              </select>
            </div>

            <h3 className="subsection-title">📄 Dịch toàn trang</h3>
            <div className="form-group">
              <label className="form-label">Kiểu hiển thị</label>
              <select
                className="form-select"
                value={pageTranslateMode}
                onChange={(e) => {
                  const m = e.target.value as PageTranslateMode;
                  setPageTranslateMode(m);
                  saveField({ pageTranslateMode: m });
                }}
              >
                <option value="replace">Thay thế (chỉ hiện bản dịch)</option>
                <option value="bilingual">Song ngữ (gốc + bản dịch)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Dịch sang</label>
              <select
                className="form-select"
                value={pageTargetLang}
                onChange={(e) => {
                  const l = e.target.value as Language;
                  setPageTargetLang(l);
                  saveField({ pageTargetLang: l });
                }}
              >
                <option value="vi">🇻🇳 Tiếng Việt</option>
                <option value="en">🇬🇧 English</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Tự dịch khi mở các trang này</label>
              <textarea
                className="form-textarea"
                value={pageAutoDomains}
                onChange={(e) => setPageAutoDomains(e.target.value)}
                rows={3}
                placeholder="Mỗi dòng một tên miền, ví dụ:&#10;vnexpress.net&#10;bbc.com"
              />
              <p className="form-help">Mỗi dòng một tên miền (không cần www.). Để trống nếu không muốn tự dịch.</p>
              <div className="btn-row">
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    saveField({
                      pageAutoDomains: pageAutoDomains
                        .split('\n')
                        .map((d) => d.trim().replace(/^www\./, '').toLowerCase())
                        .filter(Boolean),
                    })
                  }
                >
                  💾 Lưu danh sách
                </button>
              </div>
            </div>

            <h3 className="subsection-title">🔊 Giọng đọc (Text-to-Speech)</h3>
            <p className="form-help" style={{ marginTop: 0 }}>
              ⭐ = giọng neural/tự nhiên. Để <b>“Tự động”</b> để hệ thống chọn giọng tự nhiên nhất. Bấm <b>Nghe thử</b> để nghe.
            </p>
            <div className="form-group">
              <label className="form-label">Giọng tiếng Anh</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  className="form-select"
                  style={{ flex: 1 }}
                  value={ttsVoiceEn}
                  onChange={(e) => {
                    setTtsVoiceEn(e.target.value);
                    saveField({ ttsVoiceEn: e.target.value });
                  }}
                >
                  <option value="">Tự động (giọng tự nhiên)</option>
                  {sortedVoices(voices.filter((v) => v.lang.toLowerCase().startsWith('en')), 'en').map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>{isNaturalVoice(v) ? '⭐ ' : ''}{v.name} ({v.lang})</option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary" onClick={() => speakPreview('en')}>🔊 Nghe thử</button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Giọng tiếng Việt</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  className="form-select"
                  style={{ flex: 1 }}
                  value={ttsVoiceVi}
                  onChange={(e) => {
                    setTtsVoiceVi(e.target.value);
                    saveField({ ttsVoiceVi: e.target.value });
                  }}
                >
                  <option value="">Tự động (giọng tự nhiên)</option>
                  {sortedVoices(voices.filter((v) => v.lang.toLowerCase().startsWith('vi')), 'vi').map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>{isNaturalVoice(v) ? '⭐ ' : ''}{v.name} ({v.lang})</option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary" onClick={() => speakPreview('vi')}>🔊 Nghe thử</button>
              </div>
            </div>
            {voices.filter((v) => v.lang.toLowerCase().startsWith('en')).length === 0 && (
              <p className="form-help">Máy chưa có giọng tiếng Anh. Trên Windows: Settings → Time &amp; language → Speech → Manage voices → Add, chọn giọng <b>“Natural”</b>, rồi mở lại trang.</p>
            )}
            <div className="form-group">
              <label className="form-label">Tốc độ đọc: {ttsRate.toFixed(2)}×</label>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                value={ttsRate}
                style={{ width: '100%' }}
                onChange={(e) => setTtsRate(parseFloat(e.target.value))}
                onMouseUp={() => saveField({ ttsRate })}
                onTouchEnd={() => saveField({ ttsRate })}
              />
              <p className="form-help">Kéo để chỉnh; thả ra để lưu.</p>
            </div>

            <h3 className="subsection-title">📖 Đọc</h3>
            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-label">👆 Rê chuột dịch nhanh 1 từ</span>
                <span className="toggle-desc">Dừng chuột trên một từ tiếng Anh ~0.5s → hiện nghĩa tiếng Việt + 🔊 (có cache, tốn ít token)</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={hoverTranslate}
                  onChange={(e) => {
                    setHoverTranslate(e.target.checked);
                    saveField({ hoverTranslate: e.target.checked });
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <h3 className="subsection-title">✍️ Trợ lý viết</h3>
            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-label">✍️ Trợ lý viết tiếng Anh</span>
                <span className="toggle-desc">Hiện nút ✍️ ở ô soạn thảo để kiểm tra &amp; cải thiện câu (chỉ gọi AI khi bạn bấm)</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={writingAssistantEnabled}
                  onChange={(e) => {
                    setWritingAssistantEnabled(e.target.checked);
                    saveField({ writingAssistantEnabled: e.target.checked });
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="form-group">
              <label className="form-label">🖍️ Tô sáng từ khó — độ dài từ tối thiểu: {highlightMinLen} chữ cái</label>
              <input
                type="range"
                min="5"
                max="10"
                step="1"
                value={highlightMinLen}
                style={{ width: '100%' }}
                onChange={(e) => setHighlightMinLen(parseInt(e.target.value))}
                onMouseUp={() => saveField({ highlightMinLen })}
                onTouchEnd={() => saveField({ highlightMinLen })}
              />
              <p className="form-help">Thấp = tô nhiều từ hơn (kể cả từ trung bình); cao = chỉ tô từ dài/khó. Bật tô sáng bằng nút 🖍️ trên popup.</p>
            </div>

            <h3 className="subsection-title">📚 Học từ vựng</h3>
            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-label">🖼️ Tự động thêm ảnh minh hoạ</span>
                <span className="toggle-desc">Tự tải ảnh cho từ (có cache) để dễ nhớ. Tắt nếu mạng yếu.</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={vocabAutoImage}
                  onChange={(e) => {
                    setVocabAutoImage(e.target.checked);
                    saveField({ vocabAutoImage: e.target.checked });
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-label">⏰ Nhắc học định kỳ</span>
                <span className="toggle-desc">Hiện toast ôn từ trên tab đang mở theo chu kỳ bên dưới</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={reminderEnabled}
                  onChange={(e) => {
                    setReminderEnabled(e.target.checked);
                    saveField({ reminderEnabled: e.target.checked });
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="form-group">
              <label className="form-label">Chu kỳ nhắc (phút)</label>
              <input
                type="number"
                className="form-input"
                min="1"
                max="180"
                value={reminderIntervalMin}
                onChange={(e) => setReminderIntervalMin(Math.max(1, parseInt(e.target.value) || 10))}
                onBlur={() => saveField({ reminderIntervalMin })}
              />
              <p className="form-help">Áp dụng khi mở lại tab / reload extension.</p>
            </div>
          </div>
        );

      case 'sync':
        return (
          <div className="options-section">
            <h2 className="section-title">☁️ Đồng bộ đám mây</h2>
            <p className="section-desc">
              Đồng bộ sổ từ vựng &amp; tiến độ với app điện thoại (AI English Companion) — dùng
              chung tài khoản. Đăng nhập cùng email ở cả hai nơi.
            </p>

            {session ? (
              <>
                <div className="status-badge success">Đã đăng nhập: {session.user.email}</div>
                <p className="form-help" style={{ marginTop: 8 }}>
                  {lastSync ? `Lần đồng bộ cuối: ${new Date(lastSync).toLocaleString()}` : 'Chưa đồng bộ lần nào.'}
                </p>
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={runSync} disabled={syncBusy}>
                    {syncBusy ? '⏳ Đang đồng bộ...' : '🔄 Đồng bộ ngay'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={async () => { await signOut(); setSession(null); }}
                  >
                    Đăng xuất
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    type="email"
                    className="form-input"
                    value={syncEmail}
                    onChange={(e) => setSyncEmail(e.target.value)}
                    placeholder="ban@example.com"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Mật khẩu (≥ 6 ký tự)</label>
                  <input
                    type="password"
                    className="form-input"
                    value={syncPassword}
                    onChange={(e) => setSyncPassword(e.target.value)}
                  />
                </div>
                <div className="btn-row">
                  <button
                    className="btn btn-primary"
                    onClick={doSignIn}
                    disabled={syncBusy || !syncEmail.trim() || syncPassword.length < 6}
                  >
                    Đăng nhập
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={doSignUp}
                    disabled={syncBusy || !syncEmail.trim() || syncPassword.length < 6}
                  >
                    Tạo tài khoản
                  </button>
                </div>
              </>
            )}
            {syncMsg && <p className="form-help" style={{ marginTop: 12 }}>{syncMsg}</p>}
          </div>
        );

      case 'backup':
        return (
          <div className="options-section">
            <h2 className="section-title">💾 Sao lưu &amp; Khôi phục</h2>
            <p className="section-desc">
              Xuất toàn bộ cài đặt, sổ từ vựng và tiến độ luyện tập ra một file JSON — để chuyển sang
              máy khác hoặc giữ làm bản dự phòng.
            </p>

            <div className="form-group">
              <label className="form-label">Xuất sao lưu</label>
              <p className="form-help">Bao gồm: cài đặt (kể cả API key), sổ từ vựng, thống kê &amp; chuỗi ngày luyện, lịch sử dịch.</p>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={exportBackup}>⬇️ Xuất file JSON</button>
              </div>
            </div>

            <div className="form-group" style={{ marginTop: '24px' }}>
              <label className="form-label">Khôi phục từ file</label>
              <p className="form-help">
                ⚠️ Sẽ <strong>ghi đè</strong> cài đặt và dữ liệu hiện tại. Sẽ có bước xác nhận trước khi ghi.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={onImportFile}
              />
              <div className="btn-row">
                <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                  ⬆️ Chọn file &amp; khôi phục
                </button>
              </div>
            </div>

            <div
              style={{
                marginTop: '24px',
                padding: '12px 16px',
                background: 'var(--bg-glass)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
              }}
            >
              🔒 File sao lưu chứa API key của bạn ở dạng văn bản thường — hãy giữ nó ở nơi an toàn và
              không chia sẻ công khai.
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
        <button
          className={`sidebar-nav-item ${activeTab === 'appearance' ? 'active' : ''}`}
          onClick={() => setActiveTab('appearance')}
        >
          🎨 Giao diện &amp; Học
        </button>
        <button
          className={`sidebar-nav-item ${activeTab === 'sync' ? 'active' : ''}`}
          onClick={() => setActiveTab('sync')}
        >
          ☁️ Đồng bộ
        </button>
        <button
          className={`sidebar-nav-item ${activeTab === 'backup' ? 'active' : ''}`}
          onClick={() => setActiveTab('backup')}
        >
          💾 Sao lưu
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
