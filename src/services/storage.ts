// ============================================
// Chrome Storage Service
// ============================================

import type { AppSettings, TranslationHistoryItem } from '../types';
import {
  DEFAULT_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TRANSLATION_TEMPLATE,
  MAX_HISTORY_ITEMS,
  OPENAI_API_URL,
  GROQ_API_URL,
  OPENROUTER_API_URL,
} from '../utils/constants';

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'gemini',
  apiKey: '',
  model: DEFAULT_MODEL,
  openaiApiKey: '',
  openaiModel: DEFAULT_OPENAI_MODEL,
  openaiBaseUrl: OPENAI_API_URL,
  groqApiKey: '',
  groqModel: DEFAULT_GROQ_MODEL,
  openrouterApiKey: '',
  openrouterModel: DEFAULT_OPENROUTER_MODEL,
  defaultSourceLang: 'auto',
  defaultTargetLang: 'vi',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  translationTemplate: DEFAULT_TRANSLATION_TEMPLATE,
  savedPrompts: [],
  autoTranslateOnHighlight: true,
  showTranslationBubble: true,
  bubblePosition: 'below',
  totalTranslations: 0,
  apiCallsToday: 0,
  lastResetDate: new Date().toISOString().split('T')[0],
};

/**
 * Get all settings from chrome.storage.sync
 */
export async function getSettings(): Promise<AppSettings> {
  try {
    const result = await chrome.storage.sync.get({ ...DEFAULT_SETTINGS });
    return result as unknown as AppSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save settings to chrome.storage.sync
 */
export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  try {
    await chrome.storage.sync.set(settings);
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw error;
  }
}

/**
 * Get translation history from chrome.storage.local (larger quota)
 */
export async function getHistory(): Promise<TranslationHistoryItem[]> {
  try {
    const result = await chrome.storage.local.get({ translationHistory: [] });
    return result.translationHistory as TranslationHistoryItem[];
  } catch {
    return [];
  }
}

/**
 * Add a translation to history
 */
export async function addToHistory(item: TranslationHistoryItem): Promise<void> {
  try {
    const history = await getHistory();
    history.unshift(item);
    // Keep only recent items
    const trimmed = history.slice(0, MAX_HISTORY_ITEMS);
    await chrome.storage.local.set({ translationHistory: trimmed });
  } catch (error) {
    console.error('Failed to save history:', error);
  }
}

/**
 * Clear translation history
 */
export async function clearHistory(): Promise<void> {
  try {
    await chrome.storage.local.set({ translationHistory: [] });
  } catch (error) {
    console.error('Failed to clear history:', error);
  }
}

/**
 * Increment translation counter and reset daily counter if needed
 */
export async function incrementStats(): Promise<void> {
  const settings = await getSettings();
  const today = new Date().toISOString().split('T')[0];

  const updates: Partial<AppSettings> = {
    totalTranslations: settings.totalTranslations + 1,
  };

  if (settings.lastResetDate !== today) {
    updates.apiCallsToday = 1;
    updates.lastResetDate = today;
  } else {
    updates.apiCallsToday = settings.apiCallsToday + 1;
  }

  await saveSettings(updates);
}
