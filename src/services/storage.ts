// ============================================
// Chrome Storage Service
// ============================================

import type { AppSettings, TranslationHistoryItem, VocabCard } from '../types';
import {
  DEFAULT_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TRANSLATION_TEMPLATE,
  MAX_HISTORY_ITEMS,
  OPENAI_API_URL,
  TRANSLATION_CACHE_TTL_MS,
  MAX_CACHE_ENTRIES,
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
  dictionaryModeEnabled: true,
  contextAwareEnabled: true,
  cacheEnabled: true,
  pageTranslateMode: 'replace',
  pageTargetLang: 'vi',
  pageAutoDomains: [],
  ttsVoiceEn: '',
  ttsVoiceVi: '',
  ttsRate: 0.95,
  reminderEnabled: true,
  reminderIntervalMin: 10,
  sidebarToggleY: 0,    // 0 means use default (50%)
  sidebarWidth: 360,
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
 * Add a translation to history. Pinned items are always preserved when trimming.
 */
export async function addToHistory(item: TranslationHistoryItem): Promise<void> {
  try {
    const history = await getHistory();
    history.unshift(item);

    // Split pinned vs unpinned, trim only unpinned to MAX_HISTORY_ITEMS
    const pinned = history.filter((h) => h.pinned);
    const unpinned = history.filter((h) => !h.pinned).slice(0, MAX_HISTORY_ITEMS);
    const trimmed = [...pinned, ...unpinned];

    await chrome.storage.local.set({ translationHistory: trimmed });
  } catch (error) {
    console.error('Failed to save history:', error);
  }
}

/**
 * Clear translation history (pinned items are kept).
 */
export async function clearHistory(): Promise<void> {
  try {
    const history = await getHistory();
    const pinnedOnly = history.filter((h) => h.pinned);
    await chrome.storage.local.set({ translationHistory: pinnedOnly });
  } catch (error) {
    console.error('Failed to clear history:', error);
  }
}

/**
 * Toggle pinned flag on a history item.
 */
export async function togglePinHistoryItem(id: string): Promise<void> {
  const history = await getHistory();
  const updated = history.map((h) => (h.id === id ? { ...h, pinned: !h.pinned } : h));
  await chrome.storage.local.set({ translationHistory: updated });
}

/**
 * Delete a single history item by id.
 */
export async function deleteHistoryItem(id: string): Promise<void> {
  const history = await getHistory();
  const updated = history.filter((h) => h.id !== id);
  await chrome.storage.local.set({ translationHistory: updated });
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

// ============================================
// Translation Cache
// ============================================

interface CacheEntry {
  text: string;
  timestamp: number;
}

const CACHE_KEY = 'translationCache';

/**
 * Cheap, deterministic non-crypto hash for cache keys.
 * Avoids storing the full prompt text as the key.
 */
function hashKey(parts: string[]): string {
  const input = parts.join('|');
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  // Convert to unsigned then base36 for compactness
  return (h >>> 0).toString(36);
}

export function makeCacheKey(text: string, targetLang: string, model: string, mode: string): string {
  return hashKey([text.trim(), targetLang, model, mode]);
}

export async function getCachedTranslation(key: string): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get({ [CACHE_KEY]: {} });
    const cache = (result[CACHE_KEY] || {}) as Record<string, CacheEntry>;
    const entry = cache[key];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TRANSLATION_CACHE_TTL_MS) {
      return null;
    }
    return entry.text;
  } catch {
    return null;
  }
}

export async function setCachedTranslation(key: string, text: string): Promise<void> {
  try {
    const result = await chrome.storage.local.get({ [CACHE_KEY]: {} });
    const cache = (result[CACHE_KEY] || {}) as Record<string, CacheEntry>;
    cache[key] = { text, timestamp: Date.now() };

    // Evict oldest entries if over capacity
    const entries = Object.entries(cache);
    if (entries.length > MAX_CACHE_ENTRIES) {
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const trimmed = Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
      await chrome.storage.local.set({ [CACHE_KEY]: trimmed });
    } else {
      await chrome.storage.local.set({ [CACHE_KEY]: cache });
    }
  } catch (error) {
    console.error('Failed to write cache:', error);
  }
}

// ============================================
// Vocabulary deck (flashcards)
// ============================================

const VOCAB_KEY = 'vocabDeck';

export async function getVocab(): Promise<VocabCard[]> {
  try {
    const result = await chrome.storage.local.get({ [VOCAB_KEY]: [] });
    return result[VOCAB_KEY] as VocabCard[];
  } catch {
    return [];
  }
}

/** Add a card unless an equivalent term (same normalized text + language) already exists. */
export async function saveVocabCard(card: VocabCard): Promise<boolean> {
  const deck = await getVocab();
  const norm = (s: string) => s.trim().toLowerCase();
  if (deck.some((c) => c.lang === card.lang && norm(c.term) === norm(card.term))) {
    return false; // duplicate
  }
  deck.unshift(card);
  await chrome.storage.local.set({ [VOCAB_KEY]: deck });
  return true;
}

export async function updateVocabCard(card: VocabCard): Promise<void> {
  const deck = await getVocab();
  const i = deck.findIndex((c) => c.id === card.id);
  if (i >= 0) {
    deck[i] = card;
    await chrome.storage.local.set({ [VOCAB_KEY]: deck });
  }
}

export async function deleteVocabCard(id: string): Promise<void> {
  const deck = await getVocab();
  await chrome.storage.local.set({ [VOCAB_KEY]: deck.filter((c) => c.id !== id) });
}

/** Bulk-add cards, deduping against the existing deck (and within the import). Single read/write. */
export async function importVocabCards(cards: VocabCard[]): Promise<{ added: number; skipped: number }> {
  const deck = await getVocab();
  const norm = (s: string) => s.trim().toLowerCase();
  const seen = new Set(deck.map((c) => `${c.lang}|${norm(c.term)}`));
  let added = 0;
  let skipped = 0;
  for (const c of cards) {
    const term = (c.term || '').trim();
    const meaning = (c.meaning || '').trim();
    if (!term || !meaning) {
      skipped++;
      continue;
    }
    const key = `${c.lang}|${norm(term)}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    deck.unshift(c);
    added++;
  }
  await chrome.storage.local.set({ [VOCAB_KEY]: deck });
  return { added, skipped };
}
