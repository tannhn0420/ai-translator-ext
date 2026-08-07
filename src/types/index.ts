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
  | 'EXPLAIN_GRAMMAR'
  | 'PROOFREAD'
  | 'SUMMARIZE_PAGE'
  | 'TRANSLATE_INPLACE'
  | 'TRANSLATE_SELECTION_INLINE'
  | 'TOGGLE_PIN_HISTORY'
  | 'DELETE_HISTORY_ITEM'
  | 'SAVE_VOCAB'
  | 'GET_VOCAB'
  | 'UPDATE_VOCAB'
  | 'DELETE_VOCAB'
  | 'IMPORT_VOCAB'
  | 'GET_REMINDER_CARD'
  | 'GENERATE_PRACTICE'
  | 'CHAT_TURN'
  | 'ASSESS_SPEAKING'
  | 'GENERATE_DRILL'
  | 'OPEN_PRACTICE'
  | 'FETCH_IMAGE';

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

  // Text-to-speech
  ttsVoiceEn: string; // preferred voiceURI for English
  ttsVoiceVi: string; // preferred voiceURI for Vietnamese
  ttsRate: number; // speech rate

  // Study reminder (in-tab toast)
  reminderEnabled: boolean;
  reminderIntervalMin: number;

  // Appearance
  theme: 'dark' | 'light';

  // Vocabulary
  vocabAutoImage: boolean; // auto-attach an illustration when saving a word

  // Writing assistant
  writingAssistantEnabled: boolean; // show the ✍️ proofread button on editable fields

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

// ============================================
// Vocabulary / Flashcards (spaced repetition)
// ============================================

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface VocabCard {
  id: string;
  term: string;
  lang: Language; // language of the term ('en' | 'vi')
  meaning: string;
  ipa?: string;
  example?: string;
  context?: string; // sentence the term was saved from
  sourceUrl?: string;
  topic?: string; // category / topic
  image?: string; // small downscaled illustration (data URL)
  createdAt: number;
  // SRS (SM-2 lite)
  due: number; // next review timestamp (ms)
  interval: number; // days
  ease: number; // ease factor
  reps: number; // consecutive successful reviews
  lapses: number;
}

/** Input for creating a new card (SRS fields filled in by the SRS util). */
export type VocabCardInput = Pick<VocabCard, 'term' | 'lang' | 'meaning'> &
  Partial<Pick<VocabCard, 'ipa' | 'example' | 'context' | 'sourceUrl' | 'topic' | 'image'>>;

// ============================================
// Topic practice (speaking & listening)
// ============================================

export interface PracticeVocab {
  term: string;
  ipa?: string;
  meaning: string;
  example?: string;
}

export interface PracticePhrase {
  en: string;
  vi: string;
}

export interface DialogueLine {
  speaker: string;
  en: string;
  vi: string;
}

export interface PracticePack {
  topic: string;
  vocab: PracticeVocab[];
  phrases: PracticePhrase[];
  dialogue: DialogueLine[];
  passage: PracticePhrase[]; // a short spoken monologue, one sentence per item
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

// Pronunciation drill (minimal pairs + sentences for a target sound)
export interface MinimalPair {
  a: string;
  b: string;
  note?: string;
}
export interface DrillPack {
  sound: string;
  tip: string;
  pairs: MinimalPair[];
  sentences: PracticePhrase[];
}

// IELTS-style speaking assessment (4 official criteria)
export interface CriterionScore {
  band: number;
  comment: string;
}
export interface SpeakingAssessment {
  overall: number;
  criteria: {
    fluency: CriterionScore;
    lexical: CriterionScore;
    grammar: CriterionScore;
    pronunciation: CriterionScore;
  };
  strengths: string[];
  improvements: string[];
  better: string;
}

// ============================================
// Writing assistant (Grammarly-style proofread)
// ============================================

export type WritingMode = 'correct' | 'natural' | 'formal' | 'concise' | 'ielts';

export interface WritingIssue {
  original: string; // the problematic span from the source text
  suggestion: string; // the fix
  why: string; // short Vietnamese explanation
  type: 'grammar' | 'spelling' | 'word-choice' | 'style' | 'punctuation';
}

export interface ProofreadResult {
  corrected: string; // the improved full text
  issues: WritingIssue[];
  level?: string; // CEFR estimate of the ORIGINAL text (A1..C2)
}

// Reading helper — Vietnamese summary + key vocabulary for an article.
export interface SummaryKeyword {
  term: string; // English word/phrase worth learning
  meaning: string; // short Vietnamese meaning
}
export interface PageSummary {
  summary: string; // Vietnamese summary
  keywords: SummaryKeyword[];
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
