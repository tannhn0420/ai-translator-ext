// ============================================
// AI Translator - Type Definitions
// ============================================

// Language types
export type Language = 'en' | 'vi';
export type SourceLanguage = Language | 'auto';

// Translation request/response
export interface TranslateRequest {
  type: 'TRANSLATE_TEXT';
  payload: {
    text: string;
    sourceLang: SourceLanguage;
    targetLang: Language;
    customPrompt?: string;
    context?: string;
    dictionaryMode?: boolean;
  };
}

export interface TranslateResponse {
  success: boolean;
  data?: {
    translatedText: string;
    detectedLang?: Language;
  };
  error?: string;
}

// Message types for Chrome runtime messaging
export type MessageType =
  | 'TRANSLATE_TEXT'
  | 'TRANSLATE_PAGE'
  | 'TRANSLATE_BATCH'
  | 'TOGGLE_PAGE_TRANSLATION'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'VALIDATE_API_KEY'
  | 'GET_HISTORY'
  | 'CLEAR_HISTORY'
  | 'ANALYZE_IELTS'
  | 'TRANSLATE_INPLACE'
  | 'TOGGLE_PIN_HISTORY'
  | 'DELETE_HISTORY_ITEM';

export interface ChromeMessage {
  type: MessageType;
  payload?: unknown;
}

// Full-page translation display modes
export type PageTranslateMode = 'replace' | 'bilingual';

// Batch translation (full-page): translate many blocks in one API round-trip.
export interface BatchTranslateItem {
  /** Stable index used to map the response back to the source block. */
  i: number;
  /** Serialized block text, with inline elements encoded as <n>…</n> / <n/> tokens. */
  text: string;
}

export interface BatchTranslateRequest {
  type: 'TRANSLATE_BATCH';
  payload: {
    items: BatchTranslateItem[];
    targetLang: Language;
  };
}

export interface BatchTranslateResponse {
  success: boolean;
  /** Map of item index -> translated text. Missing keys = that item failed (keep original). */
  data?: Record<number, string>;
  error?: string;
}

// Message sent from popup/context-menu to a tab's content script.
export interface TranslatePageMessage {
  type: 'TRANSLATE_PAGE';
  payload: {
    mode: PageTranslateMode;
    targetLang: Language;
  };
}

// Settings / Storage
export interface SavedPrompt {
  id: string;
  name: string;
  systemPrompt: string;
  translationTemplate: string;
}

export interface TranslationHistoryItem {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: SourceLanguage;
  targetLang: Language;
  timestamp: number;
  pinned?: boolean;
}

export interface AppSettings {
  // Provider Settings
  provider: 'gemini' | 'groq' | 'openrouter';

  // Gemini API
  apiKey: string;
  model: 'gemini-flash-latest' | 'gemini-pro-latest';

  // OpenAI API
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;

  // Groq API
  groqApiKey: string;
  groqModel: string;

  // OpenRouter API
  openrouterApiKey: string;
  openrouterModel: string;

  // Language
  defaultSourceLang: SourceLanguage;
  defaultTargetLang: Language;

  // Prompts
  systemPrompt: string;
  translationTemplate: string;
  savedPrompts: SavedPrompt[];

  // Behavior
  autoTranslateOnHighlight: boolean;
  showTranslationBubble: boolean;
  bubblePosition: 'above' | 'below';
  dictionaryModeEnabled: boolean;
  contextAwareEnabled: boolean;
  cacheEnabled: boolean;

  // Full-page translation
  pageTranslateMode: PageTranslateMode; // 'replace' | 'bilingual'
  pageTargetLang: Language;
  pageAutoDomains: string[]; // hostnames (without leading www.) to auto-translate on load

  // UI state
  sidebarToggleY: number; // px from top, persisted icon position
  sidebarWidth: number;   // px

  // Stats
  totalTranslations: number;
  apiCallsToday: number;
  lastResetDate: string;
}

export interface TranslationHistory {
  items: TranslationHistoryItem[];
}

// Gemini API types
export interface GeminiRequest {
  system_instruction?: {
    parts: Array<{ text: string }>;
  };
  contents: Array<{
    parts: Array<{ text: string }>;
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
  error?: {
    code: number;
    message: string;
  };
}
