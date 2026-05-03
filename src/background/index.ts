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
  incrementStats 
} from '../services/storage';
import { callGeminiAPI, validateApiKey } from '../services/gemini';
import { callOpenAIAPI, validateOpenAIApiKey } from '../services/openai';
import { IELTS_SYSTEM_PROMPT, IELTS_TRANSLATION_TEMPLATE, INPLACE_TRANSLATION_TEMPLATE } from '../utils/constants';

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
        // openai, groq, openrouter all use openai compatible format
        valid = await validateOpenAIApiKey(apiKey, model, baseUrl || 'https://api.openai.com/v1');
      }
      return { success: true, data: { valid } };
    }

    case 'GET_HISTORY':
      return { success: true, data: await getHistory() };

    case 'CLEAR_HISTORY':
      await clearHistory();
      return { success: true };

    case 'ANALYZE_IELTS':
      return await handleIeltsAnalysis(message as any);

    case 'TRANSLATE_INPLACE':
      return await handleInplaceTranslate(message as any);

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

async function handleTranslate(request: TranslateRequest): Promise<TranslateResponse> {
  const settings = await getSettings();
  const { text, sourceLang, targetLang, customPrompt } = request.payload;

  try {
    let translatedText = '';
    
    const providers = [
      { id: 'gemini', key: settings.apiKey, model: settings.model, baseUrl: '' },
      { id: 'groq', key: settings.groqApiKey, model: settings.groqModel, baseUrl: 'https://api.groq.com/openai/v1' },
      { id: 'openrouter', key: settings.openrouterApiKey, model: settings.openrouterModel, baseUrl: 'https://openrouter.ai/api/v1' },
    ];

    // Put the selected provider first
    const primaryIndex = providers.findIndex(p => p.id === settings.provider);
    if (primaryIndex > -1) {
      const primary = providers.splice(primaryIndex, 1)[0];
      providers.unshift(primary);
    }

    let lastError: Error | null = null;

    // Try providers in order
    for (const p of providers) {
      if (!p.key) continue; // Skip if no API key configured

      try {
        if (p.id === 'gemini') {
          translatedText = await callGeminiAPI(
            text,
            sourceLang,
            targetLang,
            customPrompt || settings.systemPrompt,
            settings.translationTemplate,
            p.key,
            p.model
          );
        } else {
          translatedText = await callOpenAIAPI(
            text,
            sourceLang,
            targetLang,
            customPrompt || settings.systemPrompt,
            settings.translationTemplate,
            p.key,
            p.model,
            p.baseUrl
          );
        }
        
        // If we reach here, it succeeded!
        if (p.id !== settings.provider) {
          translatedText = `[Fallback to ${p.id.toUpperCase()}]\n\n${translatedText}`;
        }
        lastError = null;
        break; // Break out of the loop
      } catch (err: any) {
        lastError = err;
        const msg = err.message?.toLowerCase() || '';
        // Check for rate limit indicators
        if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many') || msg.includes('quota')) {
          console.log(`[AI Translator] ${p.id} hit rate limit. Trying next provider...`);
          continue; // Try next provider
        } else {
          // Other errors (like bad API key) should also probably fallback, but let's fallback anyway
          console.log(`[AI Translator] ${p.id} failed: ${msg}. Trying next provider...`);
          continue; 
        }
      }
    }

    if (!translatedText) {
      if (lastError) throw lastError;
      throw new Error('Chưa cấu hình API Key hoặc Provider không hợp lệ. Vui lòng kiểm tra lại Cài đặt.');
    }

    // Save to history
    const historyItem: TranslationHistoryItem = {
      id: Date.now().toString(),
      sourceText: text.substring(0, 200), // Truncate for storage
      translatedText: translatedText.substring(0, 500),
      sourceLang,
      targetLang,
      timestamp: Date.now(),
    };
    await addToHistory(historyItem);
    await incrementStats();

    return {
      success: true,
      data: { translatedText },
    };
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
    
    const providers = [
      { id: 'gemini', key: settings.apiKey, model: settings.model, baseUrl: '' },
      { id: 'groq', key: settings.groqApiKey, model: settings.groqModel, baseUrl: 'https://api.groq.com/openai/v1' },
      { id: 'openrouter', key: settings.openrouterApiKey, model: settings.openrouterModel, baseUrl: 'https://openrouter.ai/api/v1' },
    ];

    const primaryIndex = providers.findIndex(p => p.id === settings.provider);
    if (primaryIndex > -1) {
      const primary = providers.splice(primaryIndex, 1)[0];
      providers.unshift(primary);
    }

    let lastError: Error | null = null;

    for (const p of providers) {
      if (!p.key) continue;

      try {
        if (p.id === 'gemini') {
          resultText = await callGeminiAPI(
            text,
            'en',
            'en',
            IELTS_SYSTEM_PROMPT,
            IELTS_TRANSLATION_TEMPLATE,
            p.key,
            p.model
          );
        } else {
          resultText = await callOpenAIAPI(
            text,
            'en',
            'en',
            IELTS_SYSTEM_PROMPT,
            IELTS_TRANSLATION_TEMPLATE,
            p.key,
            p.model,
            p.baseUrl
          );
        }
        
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        const msg = err.message?.toLowerCase() || '';
        if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many') || msg.includes('quota')) {
          continue; 
        } else {
          continue; 
        }
      }
    }

    if (!resultText) {
      if (lastError) throw lastError;
      throw new Error('Chưa cấu hình API Key hoặc Provider không hợp lệ.');
    }

    return { success: true, data: { text: resultText } };
  } catch (error: any) {
    console.error('IELTS Analysis error:', error);
    return {
      success: false,
      error: error.message || 'Analysis failed',
    };
  }
}

async function handleInplaceTranslate(request: any): Promise<any> {
  const settings = await getSettings();
  const { text, targetLang } = request.payload;

  try {
    let resultText = '';
    
    const providers = [
      { id: 'gemini', key: settings.apiKey, model: settings.model, baseUrl: '' },
      { id: 'groq', key: settings.groqApiKey, model: settings.groqModel, baseUrl: 'https://api.groq.com/openai/v1' },
      { id: 'openrouter', key: settings.openrouterApiKey, model: settings.openrouterModel, baseUrl: 'https://openrouter.ai/api/v1' },
    ];

    const primaryIndex = providers.findIndex(p => p.id === settings.provider);
    if (primaryIndex > -1) {
      const primary = providers.splice(primaryIndex, 1)[0];
      providers.unshift(primary);
    }

    let lastError: Error | null = null;

    for (const p of providers) {
      if (!p.key) continue;

      try {
        if (p.id === 'gemini') {
          resultText = await callGeminiAPI(
            text,
            'auto',
            targetLang,
            settings.systemPrompt,
            INPLACE_TRANSLATION_TEMPLATE,
            p.key,
            p.model
          );
        } else {
          resultText = await callOpenAIAPI(
            text,
            'auto',
            targetLang,
            settings.systemPrompt,
            INPLACE_TRANSLATION_TEMPLATE,
            p.key,
            p.model,
            p.baseUrl
          );
        }
        
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

    // Save to history as a normal translation
    await addToHistory({
      id: Date.now().toString(),
      sourceText: text.substring(0, 200),
      translatedText: resultText.substring(0, 500),
      sourceLang: 'auto',
      targetLang,
      timestamp: Date.now(),
    });
    await incrementStats();

    return { success: true, data: { text: resultText } };
  } catch (error: any) {
    console.error('Inplace translation error:', error);
    return {
      success: false,
      error: error.message || 'Translation failed',
    };
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
    // Send the selected text to content script for translation
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRANSLATE_SELECTION',
      payload: { text: info.selectionText },
    });
  }
});
