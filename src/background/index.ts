// ============================================
// Background Service Worker
// ============================================

import type { ChromeMessage, TranslateRequest, TranslateResponse, TranslationHistoryItem } from '../types';
import {
  getSettings,
  saveSettings,
  addToHistory,
  getHistory,
  clearHistory,
  togglePinHistoryItem,
  deleteHistoryItem,
  incrementStats,
  getCachedTranslation,
  setCachedTranslation,
  makeCacheKey,
} from '../services/storage';
import { callGeminiAPI, validateApiKey } from '../services/gemini';
import { callOpenAIAPI, validateOpenAIApiKey } from '../services/openai';
import {
  IELTS_SYSTEM_PROMPT,
  IELTS_TRANSLATION_TEMPLATE,
  INPLACE_TRANSLATION_TEMPLATE,
  CONTEXT_TRANSLATION_TEMPLATE,
  DICTIONARY_TEMPLATE,
  DICTIONARY_MAX_WORDS,
  CONTEXT_MAX_CHARS,
} from '../utils/constants';

// Listen for messages from popup, options, and content scripts
chrome.runtime.onMessage.addListener(
  (message: ChromeMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    return true; // Keep message channel open for async response
  }
);

async function handleMessage(message: ChromeMessage): Promise<unknown> {
  switch (message.type) {
    case 'TRANSLATE_TEXT':
      return handleTranslate(message as TranslateRequest);

    case 'GET_SETTINGS':
      return { success: true, data: await getSettings() };

    case 'SAVE_SETTINGS':
      await saveSettings(message.payload as Record<string, unknown>);
      return { success: true };

    case 'VALIDATE_API_KEY': {
      const { provider, apiKey, model, baseUrl } = message.payload as { provider: string, apiKey: string; model: string; baseUrl?: string };
      let valid = false;
      if (provider === 'gemini') {
        valid = await validateApiKey(apiKey, model);
      } else {
        valid = await validateOpenAIApiKey(apiKey, model, baseUrl || 'https://api.openai.com/v1');
      }
      return { success: true, data: { valid } };
    }

    case 'GET_HISTORY':
      return { success: true, data: await getHistory() };

    case 'CLEAR_HISTORY':
      await clearHistory();
      return { success: true };

    case 'TOGGLE_PIN_HISTORY':
      await togglePinHistoryItem((message.payload as { id: string }).id);
      return { success: true };

    case 'DELETE_HISTORY_ITEM':
      await deleteHistoryItem((message.payload as { id: string }).id);
      return { success: true };

    case 'ANALYZE_IELTS':
      return await handleIeltsAnalysis(message as any);

    case 'TRANSLATE_INPLACE':
      return await handleInplaceTranslate(message as any);

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

interface ProviderEntry {
  id: 'gemini' | 'groq' | 'openrouter';
  key: string;
  model: string;
  baseUrl: string;
}

function buildProviderList(settings: Awaited<ReturnType<typeof getSettings>>): ProviderEntry[] {
  const providers: ProviderEntry[] = [
    { id: 'gemini', key: settings.apiKey, model: settings.model, baseUrl: '' },
    { id: 'groq', key: settings.groqApiKey, model: settings.groqModel, baseUrl: 'https://api.groq.com/openai/v1' },
    { id: 'openrouter', key: settings.openrouterApiKey, model: settings.openrouterModel, baseUrl: 'https://openrouter.ai/api/v1' },
  ];
  const primaryIndex = providers.findIndex((p) => p.id === settings.provider);
  if (primaryIndex > -1) {
    const primary = providers.splice(primaryIndex, 1)[0];
    providers.unshift(primary);
  }
  return providers;
}

async function callProvider(
  p: ProviderEntry,
  text: string,
  sourceLang: 'auto' | 'en' | 'vi',
  targetLang: 'en' | 'vi',
  systemPrompt: string,
  template: string,
): Promise<string> {
  if (p.id === 'gemini') {
    return await callGeminiAPI(text, sourceLang, targetLang, systemPrompt, template, p.key, p.model);
  }
  return await callOpenAIAPI(text, sourceLang, targetLang, systemPrompt, template, p.key, p.model, p.baseUrl);
}

async function handleTranslate(request: TranslateRequest): Promise<TranslateResponse> {
  const settings = await getSettings();
  const { text, sourceLang, targetLang, customPrompt, context, dictionaryMode } = request.payload;

  // Decide which template to use
  let template = settings.translationTemplate;
  let mode: 'translate' | 'dictionary' | 'context' = 'translate';

  const wordCount = text.trim().split(/\s+/).length;
  const isShortLookup = dictionaryMode === true ||
    (dictionaryMode !== false && settings.dictionaryModeEnabled && wordCount <= DICTIONARY_MAX_WORDS);

  if (isShortLookup) {
    template = DICTIONARY_TEMPLATE;
    mode = 'dictionary';
  } else if (context && settings.contextAwareEnabled && context.trim().length > 0) {
    template = CONTEXT_TRANSLATION_TEMPLATE.replace('{context}', context.substring(0, CONTEXT_MAX_CHARS));
    mode = 'context';
  }

  try {
    // Check cache first
    if (settings.cacheEnabled) {
      const activeProvider = buildProviderList(settings)[0];
      const cacheKey = makeCacheKey(text, targetLang, activeProvider?.model || 'unknown', mode);
      const cached = await getCachedTranslation(cacheKey);
      if (cached) {
        return { success: true, data: { translatedText: cached } };
      }
    }

    let translatedText = '';
    let usedProviderId: string | null = null;
    const providers = buildProviderList(settings);
    let lastError: Error | null = null;

    for (const p of providers) {
      if (!p.key) continue;
      try {
        translatedText = await callProvider(
          p,
          text,
          sourceLang,
          targetLang,
          customPrompt || settings.systemPrompt,
          template,
        );
        usedProviderId = p.id;
        if (p.id !== settings.provider) {
          translatedText = `[Fallback to ${p.id.toUpperCase()}]\n\n${translatedText}`;
        }
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        console.log(`[AI Translator] ${p.id} failed: ${err.message}. Trying next provider...`);
        continue;
      }
    }

    if (!translatedText) {
      if (lastError) throw lastError;
      throw new Error('Chưa cấu hình API Key hoặc Provider không hợp lệ. Vui lòng kiểm tra lại Cài đặt.');
    }

    // Cache successful translation
    if (settings.cacheEnabled && usedProviderId) {
      const usedProvider = providers.find((p) => p.id === usedProviderId);
      const cacheKey = makeCacheKey(text, targetLang, usedProvider?.model || 'unknown', mode);
      await setCachedTranslation(cacheKey, translatedText);
    }

    // Save to history (skip dictionary lookups to avoid clutter)
    if (mode !== 'dictionary') {
      const historyItem: TranslationHistoryItem = {
        id: Date.now().toString(),
        sourceText: text.substring(0, 200),
        translatedText: translatedText.substring(0, 800),
        sourceLang,
        targetLang,
        timestamp: Date.now(),
      };
      await addToHistory(historyItem);
    }
    await incrementStats();

    return { success: true, data: { translatedText } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Translation failed',
    };
  }
}

async function handleIeltsAnalysis(request: any): Promise<any> {
  const settings = await getSettings();
  const { text } = request.payload;

  try {
    let resultText = '';
    const providers = buildProviderList(settings);
    let lastError: Error | null = null;

    for (const p of providers) {
      if (!p.key) continue;
      try {
        resultText = await callProvider(p, text, 'en', 'en', IELTS_SYSTEM_PROMPT, IELTS_TRANSLATION_TEMPLATE);
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        continue;
      }
    }

    if (!resultText) {
      if (lastError) throw lastError;
      throw new Error('Chưa cấu hình API Key hoặc Provider không hợp lệ.');
    }

    return { success: true, data: { text: resultText } };
  } catch (error: any) {
    console.error('IELTS Analysis error:', error);
    return { success: false, error: error.message || 'Analysis failed' };
  }
}

async function handleInplaceTranslate(request: any): Promise<any> {
  const settings = await getSettings();
  const { text, targetLang } = request.payload;

  try {
    let resultText = '';
    const providers = buildProviderList(settings);
    let lastError: Error | null = null;

    for (const p of providers) {
      if (!p.key) continue;
      try {
        resultText = await callProvider(p, text, 'auto', targetLang, settings.systemPrompt, INPLACE_TRANSLATION_TEMPLATE);
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        continue;
      }
    }

    if (!resultText) {
      if (lastError) throw lastError;
      throw new Error('Chưa cấu hình API Key hoặc Provider không hợp lệ.');
    }

    await addToHistory({
      id: Date.now().toString(),
      sourceText: text.substring(0, 200),
      translatedText: resultText.substring(0, 800),
      sourceLang: 'auto',
      targetLang,
      timestamp: Date.now(),
    });
    await incrementStats();

    return { success: true, data: { text: resultText } };
  } catch (error: any) {
    console.error('Inplace translation error:', error);
    return { success: false, error: error.message || 'Translation failed' };
  }
}

// Context menu for right-click translate
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '🌐 Dịch với AI Translator',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translate-selection' && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRANSLATE_SELECTION',
      payload: { text: info.selectionText },
    });
  }
});
