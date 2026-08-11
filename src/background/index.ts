// ============================================
// Background Service Worker
// ============================================

import type {
  ChromeMessage,
  TranslateRequest,
  TranslateResponse,
  TranslationHistoryItem,
  BatchTranslateRequest,
  BatchTranslateResponse,
  BatchTranslateItem,
  Language,
  VocabCard,
  VocabCardInput,
  PracticePack,
  ChatMessage,
  SpeakingAssessment,
  DrillPack,
} from '../types';
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
  getVocab,
  saveVocabCard,
  updateVocabCard,
  deleteVocabCard,
  importVocabCards,
} from '../services/storage';
import { createCard } from '../utils/srs';
import { callGeminiAPI, callGeminiAPIStream, validateApiKey } from '../services/gemini';
import { callOpenAIAPI, callOpenAIAPIStream, validateOpenAIApiKey } from '../services/openai';
import {
  IELTS_SYSTEM_PROMPT,
  IELTS_TRANSLATION_TEMPLATE,
  GRAMMAR_SYSTEM_PROMPT,
  GRAMMAR_TEMPLATE,
  WRITING_SYSTEM_PROMPT,
  WRITING_TEMPLATE,
  WRITING_MODE_INSTRUCTION,
  SUMMARIZE_SYSTEM_PROMPT,
  SUMMARIZE_TEMPLATE,
  ASK_SYSTEM_PROMPT,
  INPLACE_TRANSLATION_TEMPLATE,
  CONTEXT_TRANSLATION_TEMPLATE,
  DICTIONARY_TEMPLATE,
  DICTIONARY_MAX_WORDS,
  CONTEXT_MAX_CHARS,
  PAGE_BATCH_TEMPLATE,
  PAGE_BATCH_MAX_OUTPUT_TOKENS,
  PRACTICE_SYSTEM_PROMPT,
  PRACTICE_TEMPLATE,
  CHAT_SYSTEM_PROMPT,
  CHAT_TEMPLATE,
  IELTS_SPEAKING_SYSTEM,
  IELTS_SPEAKING_TEMPLATE,
  DRILL_SYSTEM_PROMPT,
  DRILL_TEMPLATE,
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

// ============================================
// Streaming translation (long-lived Port)
// ============================================

interface StreamRequest {
  text: string;
  sourceLang?: 'auto' | 'en' | 'vi';
  targetLang: 'en' | 'vi';
  context?: string;
  dictionaryMode?: boolean;
  customPrompt?: string;
}

function safePost(port: chrome.runtime.Port, msg: unknown): void {
  try {
    port.postMessage(msg);
  } catch {
    // port already disconnected
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate-stream') return;
  port.onMessage.addListener((msg: StreamRequest) => {
    streamTranslate(port, msg).catch((err) => {
      safePost(port, { type: 'error', error: err instanceof Error ? err.message : 'Stream failed' });
    });
  });
});

async function streamTranslate(port: chrome.runtime.Port, req: StreamRequest): Promise<void> {
  const settings = await getSettings();
  const { text, targetLang, context, dictionaryMode, customPrompt } = req;
  const sourceLang = req.sourceLang || 'auto';
  const { template, mode } = selectTemplate(settings, text, context, dictionaryMode);
  const systemPrompt = customPrompt || settings.systemPrompt;

  // Cache hit → deliver immediately, no stream. Key on the primary (first configured-with-
  // key) model for both read and write so the streaming path shares cache with handleTranslate.
  const providers = buildProviderList(settings);
  const cacheModel = providers.find((p) => p.key)?.model || 'unknown';
  const cacheKey = makeCacheKey(text, targetLang, cacheModel, mode);
  if (settings.cacheEnabled) {
    const cached = await getCachedTranslation(cacheKey);
    if (cached) {
      safePost(port, { type: 'done', full: cached });
      return;
    }
  }

  let full = '';
  let usedProviderId: string | null = null;
  let lastError: Error | null = null;

  for (const p of providers) {
    if (!p.key) continue;
    let emitted = false;
    try {
      full = await callProviderStream(p, text, sourceLang, targetLang, systemPrompt, template, (f) => {
        emitted = true;
        safePost(port, { type: 'delta', full: f });
      });
      usedProviderId = p.id;
      if (p.id !== settings.provider) full = `[Fallback to ${p.id.toUpperCase()}]\n\n${full}`;
      lastError = null;
      break;
    } catch (err) {
      lastError = err as Error;
      if (emitted) break; // already streamed partial output — don't switch providers
    }
  }

  if (!full) {
    safePost(port, {
      type: 'error',
      error: lastError?.message || 'Chưa cấu hình API Key hoặc Provider không hợp lệ.',
    });
    return;
  }

  if (settings.cacheEnabled && usedProviderId) {
    await setCachedTranslation(cacheKey, full);
  }
  if (mode !== 'dictionary') {
    await addToHistory({
      id: Date.now().toString(),
      sourceText: text.substring(0, 200),
      translatedText: full.substring(0, 800),
      sourceLang,
      targetLang,
      timestamp: Date.now(),
    });
  }
  await incrementStats();

  safePost(port, { type: 'done', full });
}

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

    case 'EXPLAIN_GRAMMAR':
      return await handleExplainGrammar(message as any);

    case 'PROOFREAD':
      return await handleProofread(message as any);

    case 'SUMMARIZE_PAGE':
      return await handleSummarize(message as any);

    case 'ASK_FOLLOWUP':
      return await handleAsk(message as any);

    case 'TRANSLATE_INPLACE':
      return await handleInplaceTranslate(message as any);

    case 'TRANSLATE_BATCH':
      return await handleTranslateBatch(message as BatchTranslateRequest);

    case 'SAVE_VOCAB': {
      const card = createCard(message.payload as VocabCardInput, Date.now());
      const added = await saveVocabCard(card);
      return { success: true, data: { added, card } };
    }

    case 'GET_VOCAB':
      return { success: true, data: await getVocab() };

    case 'UPDATE_VOCAB':
      await updateVocabCard((message.payload as { card: VocabCard }).card);
      return { success: true };

    case 'DELETE_VOCAB':
      await deleteVocabCard((message.payload as { id: string }).id);
      return { success: true };

    case 'IMPORT_VOCAB': {
      const raw = (message.payload as { cards: unknown[] }).cards || [];
      const now = Date.now();
      const cards: VocabCard[] = raw.map((r) => {
        const item = r as Partial<VocabCard>;
        // A full backup card (has id + SRS) is kept as-is; otherwise create a fresh card.
        return item && item.id && typeof item.due === 'number'
          ? (item as VocabCard)
          : createCard(item as VocabCardInput, now);
      });
      const result = await importVocabCards(cards);
      return { success: true, data: result };
    }

    case 'GET_REMINDER_CARD':
      return { success: true, data: { card: await pickReminderCard() } };

    case 'GENERATE_PRACTICE':
      return await handleGeneratePractice(message as { payload: { topic: string; level?: string; words?: string[] } });

    case 'CHAT_TURN':
      return await handleChatTurn(message as { payload: { messages: ChatMessage[]; topic: string; level?: string } });

    case 'ASSESS_SPEAKING':
      return await handleAssessSpeaking(message as { payload: { transcript: string; question: string } });

    case 'GENERATE_DRILL':
      return await handleGenerateDrill(message as { payload: { sound: string } });

    case 'OPEN_PRACTICE':
      chrome.tabs.create({ url: chrome.runtime.getURL('src/practice/practice.html') });
      return { success: true };

    case 'FETCH_IMAGE':
      return await handleFetchImage((message.payload as { query: string }).query);

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

/**
 * Pick a card to surface in the in-tab study reminder: a due card first, otherwise a
 * not-yet-learned (reps < 2) card at random. Returns null when reminders are disabled
 * or the deck has nothing to show.
 */
async function pickReminderCard(): Promise<VocabCard | null> {
  const settings = await getSettings();
  if (!settings.reminderEnabled) return null;

  const deck = await getVocab();
  if (deck.length === 0) return null;

  const now = Date.now();
  const due = deck.filter((c) => c.due <= now);
  const pool = due.length > 0 ? due : deck.filter((c) => c.reps < 2);
  if (pool.length === 0) return null;

  return pool[Math.floor(Math.random() * pool.length)];
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
  maxTokens?: number,
): Promise<string> {
  if (p.id === 'gemini') {
    return await callGeminiAPI(text, sourceLang, targetLang, systemPrompt, template, p.key, p.model, maxTokens ?? 8192);
  }
  return await callOpenAIAPI(text, sourceLang, targetLang, systemPrompt, template, p.key, p.model, p.baseUrl, maxTokens);
}

async function callProviderStream(
  p: ProviderEntry,
  text: string,
  sourceLang: 'auto' | 'en' | 'vi',
  targetLang: 'en' | 'vi',
  systemPrompt: string,
  template: string,
  onDelta: (full: string) => void,
): Promise<string> {
  if (p.id === 'gemini') {
    return await callGeminiAPIStream(text, sourceLang, targetLang, systemPrompt, template, p.key, p.model, onDelta);
  }
  return await callOpenAIAPIStream(text, sourceLang, targetLang, systemPrompt, template, p.key, p.model, p.baseUrl, onDelta);
}

type TranslateMode = 'translate' | 'dictionary' | 'context';

/** Pick the prompt template + mode for a single-text translation (dictionary / context / default). */
function selectTemplate(
  settings: Awaited<ReturnType<typeof getSettings>>,
  text: string,
  context: string | undefined,
  dictionaryMode: boolean | undefined,
): { template: string; mode: TranslateMode } {
  let template = settings.translationTemplate;
  let mode: TranslateMode = 'translate';

  const wordCount = text.trim().split(/\s+/).length;
  const isShortLookup =
    dictionaryMode === true ||
    (dictionaryMode !== false && settings.dictionaryModeEnabled && wordCount <= DICTIONARY_MAX_WORDS);

  if (isShortLookup) {
    template = DICTIONARY_TEMPLATE;
    mode = 'dictionary';
  } else if (context && settings.contextAwareEnabled && context.trim().length > 0) {
    template = CONTEXT_TRANSLATION_TEMPLATE.replace('{context}', () => context.substring(0, CONTEXT_MAX_CHARS));
    mode = 'context';
  }
  return { template, mode };
}

async function handleTranslate(request: TranslateRequest): Promise<TranslateResponse> {
  const settings = await getSettings();
  const { text, sourceLang, targetLang, customPrompt, context, dictionaryMode } = request.payload;

  const { template, mode } = selectTemplate(settings, text, context, dictionaryMode);

  const providers = buildProviderList(settings);
  // Key the cache on the primary (first configured-with-key) provider's model so reads
  // and writes always agree — even when a fallback provider ends up answering the call.
  const cacheModel = providers.find((p) => p.key)?.model || 'unknown';
  const cacheKey = makeCacheKey(text, targetLang, cacheModel, mode);

  try {
    // Check cache first
    if (settings.cacheEnabled) {
      const cached = await getCachedTranslation(cacheKey);
      if (cached) {
        return { success: true, data: { translatedText: cached } };
      }
    }

    let translatedText = '';
    let usedProviderId: string | null = null;
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

    // Cache successful translation (same key used for the lookup above).
    if (settings.cacheEnabled && usedProviderId) {
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

/** Explain the grammar of a selected English sentence, in Vietnamese. */
async function handleExplainGrammar(request: any): Promise<any> {
  const settings = await getSettings();
  const text: string = (request.payload?.text || '').trim();
  if (!text) return { success: false, error: 'Không có nội dung để giải thích.' };

  try {
    let resultText = '';
    const providers = buildProviderList(settings);
    let lastError: Error | null = null;

    for (const p of providers) {
      if (!p.key) continue;
      try {
        resultText = await callProvider(p, text, 'auto', 'vi', GRAMMAR_SYSTEM_PROMPT, GRAMMAR_TEMPLATE);
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
    console.error('Grammar explain error:', error);
    return { success: false, error: error.message || 'Giải thích thất bại.' };
  }
}

const PROOFREAD_MAX_CHARS = 6000;
const VALID_ISSUE_TYPES = new Set(['grammar', 'spelling', 'word-choice', 'style', 'punctuation']);

/** Proofread/improve English text (writing assistant). Returns corrected text + issues (VN why) + CEFR level. */
async function handleProofread(request: any): Promise<any> {
  const settings = await getSettings();
  const text: string = (request.payload?.text || '').toString();
  const mode: string = request.payload?.mode || 'correct';
  if (!text.trim()) return { success: false, error: 'Không có nội dung để kiểm tra.' };
  if (text.length > PROOFREAD_MAX_CHARS) {
    return { success: false, error: `Đoạn quá dài (tối đa ${PROOFREAD_MAX_CHARS} ký tự).` };
  }

  const providers = buildProviderList(settings);
  if (!providers.some((p) => p.key)) {
    return { success: false, error: 'Chưa cấu hình API Key hoặc Provider không hợp lệ.' };
  }

  const instruction = WRITING_MODE_INSTRUCTION[mode] || WRITING_MODE_INSTRUCTION.correct;
  const template = WRITING_TEMPLATE.replace('{mode_instruction}', () => instruction);

  let raw = '';
  let lastError: Error | null = null;
  for (const p of providers) {
    if (!p.key) continue;
    try {
      await pace();
      raw = await callProvider(p, text, 'auto', 'en', WRITING_SYSTEM_PROMPT, template, PAGE_BATCH_MAX_OUTPUT_TOKENS);
      lastError = null;
      break;
    } catch (err) {
      lastError = err as Error;
    }
  }
  if (!raw) return { success: false, error: lastError?.message || 'Không kiểm tra được.' };

  const parsed = extractJson(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    return { success: false, error: 'Kết quả AI không hợp lệ, thử lại nhé.' };
  }

  const corrected = typeof parsed.corrected === 'string' && parsed.corrected.trim() ? parsed.corrected : text;
  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const issues = rawIssues
    .map((x) => {
      const o = (x || {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const type = str(o.type);
      return {
        original: str(o.original),
        suggestion: str(o.suggestion),
        why: str(o.why),
        type: VALID_ISSUE_TYPES.has(type) ? type : 'grammar',
      };
    })
    .filter((i) => i.original || i.suggestion)
    .slice(0, 8);
  const level = typeof parsed.level === 'string' ? parsed.level.trim().toUpperCase() : '';

  return { success: true, data: { corrected, issues, level } };
}

const SUMMARIZE_MAX_CHARS = 12000;

/** Summarize an article in Vietnamese + surface key vocabulary. */
async function handleSummarize(request: any): Promise<any> {
  const settings = await getSettings();
  const text: string = (request.payload?.text || '').toString().slice(0, SUMMARIZE_MAX_CHARS);
  if (text.trim().length < 40) return { success: false, error: 'Không đủ nội dung để tóm tắt.' };

  const providers = buildProviderList(settings);
  if (!providers.some((p) => p.key)) {
    return { success: false, error: 'Chưa cấu hình API Key hoặc Provider không hợp lệ.' };
  }

  let raw = '';
  let lastError: Error | null = null;
  for (const p of providers) {
    if (!p.key) continue;
    try {
      await pace();
      raw = await callProvider(p, text, 'auto', 'vi', SUMMARIZE_SYSTEM_PROMPT, SUMMARIZE_TEMPLATE, PAGE_BATCH_MAX_OUTPUT_TOKENS);
      lastError = null;
      break;
    } catch (err) {
      lastError = err as Error;
    }
  }
  if (!raw) return { success: false, error: lastError?.message || 'Không tóm tắt được.' };

  const parsed = extractJson(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    return { success: false, error: 'Kết quả AI không hợp lệ, thử lại nhé.' };
  }
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  const rawKw = Array.isArray(parsed.keywords) ? parsed.keywords : [];
  const keywords = rawKw
    .map((x) => {
      const o = (x || {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      return { term: str(o.term), meaning: str(o.meaning) };
    })
    .filter((k) => k.term)
    .slice(0, 15);
  if (!summary && keywords.length === 0) {
    return { success: false, error: 'Không tóm tắt được, thử lại nhé.' };
  }
  return { success: true, data: { summary, keywords } };
}

/** Answer a learner's follow-up question about the word/sentence they looked up. */
async function handleAsk(request: any): Promise<any> {
  const settings = await getSettings();
  const context: string = (request.payload?.context || '').toString().slice(0, 1200);
  const question: string = (request.payload?.question || '').toString().slice(0, 600);
  const history = Array.isArray(request.payload?.history) ? request.payload.history.slice(-6) : [];
  if (!question.trim()) return { success: false, error: 'Chưa có câu hỏi.' };

  const providers = buildProviderList(settings);
  if (!providers.some((p) => p.key)) {
    return { success: false, error: 'Chưa cấu hình API Key hoặc Provider không hợp lệ.' };
  }

  const convo = history
    .map((h: { role?: string; text?: string }) => `${h.role === 'user' ? 'Học viên' : 'Gia sư'}: ${(h.text || '').toString()}`)
    .join('\n');
  const userText =
    `Từ/câu đang xem: "${context}"\n` + (convo ? `${convo}\n` : '') + `Học viên hỏi: ${question}`;

  let raw = '';
  let lastError: Error | null = null;
  for (const p of providers) {
    if (!p.key) continue;
    try {
      await pace();
      raw = await callProvider(p, userText, 'auto', 'vi', ASK_SYSTEM_PROMPT, '{text}', 1024);
      lastError = null;
      break;
    } catch (err) {
      lastError = err as Error;
    }
  }
  if (!raw.trim()) return { success: false, error: lastError?.message || 'Không trả lời được.' };
  return { success: true, data: { answer: raw.trim() } };
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

// ============================================
// Full-page batch translation
// ============================================

const RATE_LIMIT_RE = /429|quota|rate.?limit|giới hạn|resource.?exhausted/i;

/**
 * Minimal non-blocking spacing between request starts. Unlike a hard per-minute
 * gate, this never stalls long enough for the MV3 worker to be recycled mid-run;
 * bursts are absorbed by per-request retry-on-429 below.
 */
let nextRequestAt = 0;
async function pace(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + 150;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Extract a JSON value from a model response that may be wrapped in prose or code fences.
 */
function extractJson(raw: string): unknown {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(s);
  } catch {
    // Fall through to brace/bracket slicing
  }
  const firstObj = s.indexOf('{');
  const lastObj = s.lastIndexOf('}');
  const firstArr = s.indexOf('[');
  const lastArr = s.lastIndexOf(']');
  const candidates: string[] = [];
  if (firstArr !== -1 && lastArr > firstArr) candidates.push(s.slice(firstArr, lastArr + 1));
  if (firstObj !== -1 && lastObj > firstObj) candidates.push(s.slice(firstObj, lastObj + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Parse a batch response into an index -> translation map. */
function mapBatchResponse(parsed: unknown, items: BatchTranslateItem[]): Record<number, string> {
  const out: Record<number, string> = {};
  if (!parsed || typeof parsed !== 'object') return out;

  if (Array.isArray(parsed)) {
    parsed.forEach((entry, k) => {
      if (entry && typeof entry === 'object' && 'i' in entry) {
        const e = entry as { i: number; text?: unknown };
        if (typeof e.text === 'string' && e.text.length) out[Number(e.i)] = e.text;
      } else if (typeof entry === 'string' && entry.length && items[k]) {
        out[items[k].i] = entry;
      }
    });
  } else {
    const mp = parsed as Record<string, unknown>;
    for (const it of items) {
      const v = mp[String(it.i)];
      if (typeof v === 'string' && v.length) out[it.i] = v;
    }
  }
  return out;
}

/**
 * One provider round-trip for a set of items. Retries on rate-limit (429/quota)
 * errors with backoff, then falls back through the provider chain. Returns whatever
 * subset of translations came back (partial results are fine — the caller recovers
 * the rest).
 */
async function translateBatchItems(
  items: BatchTranslateItem[],
  targetLang: 'en' | 'vi',
  systemPrompt: string,
  providers: ProviderEntry[],
): Promise<{ map: Record<number, string>; model: string }> {
  const payloadText = JSON.stringify(items.map((it) => ({ i: it.i, text: it.text })));
  let raw = '';
  let usedModel = providers[0]?.model || 'unknown';

  outer: for (const p of providers) {
    if (!p.key) continue;
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await pace();
        raw = await callProvider(
          p,
          payloadText,
          'auto',
          targetLang,
          systemPrompt,
          PAGE_BATCH_TEMPLATE,
          PAGE_BATCH_MAX_OUTPUT_TOKENS,
        );
        usedModel = p.model;
        break outer;
      } catch (err) {
        const msg = (err as Error).message || '';
        if (RATE_LIMIT_RE.test(msg) && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue; // retry same provider after backoff
        }
        break; // non-rate error → move to next provider
      }
    }
  }

  return { map: raw ? mapBatchResponse(extractJson(raw), items) : {}, model: usedModel };
}

async function handleTranslateBatch(request: BatchTranslateRequest): Promise<BatchTranslateResponse> {
  const settings = await getSettings();
  const { items, targetLang } = request.payload;
  if (!items || items.length === 0) return { success: true, data: {} };

  const providers = buildProviderList(settings);
  if (!providers.some((p) => p.key)) {
    return { success: false, data: {}, error: 'Chưa cấu hình API Key hoặc Provider không hợp lệ.' };
  }

  const result: Record<number, string> = {};
  // Key every item on the primary (first configured-with-key) model, for both lookup and
  // write, so a fallback provider answering doesn't scatter entries under an unread key.
  const activeModel = providers.find((p) => p.key)?.model || 'unknown';

  // 1. Per-item cache lookup — only send cache misses to the API.
  const uncached: BatchTranslateItem[] = [];
  if (settings.cacheEnabled) {
    for (const it of items) {
      const cached = await getCachedTranslation(makeCacheKey(it.text, targetLang, activeModel, 'page'));
      if (cached != null) result[it.i] = cached;
      else uncached.push(it);
    }
  } else {
    uncached.push(...items);
  }
  if (uncached.length === 0) return { success: true, data: result };

  const commit = async (subset: BatchTranslateItem[], map: Record<number, string>) => {
    for (const it of subset) {
      const v = map[it.i];
      if (typeof v === 'string' && v.length) {
        result[it.i] = v;
        if (settings.cacheEnabled) {
          await setCachedTranslation(makeCacheKey(it.text, targetLang, activeModel, 'page'), v);
        }
      }
    }
  };

  // 2. First pass over the whole (uncached) batch.
  const first = await translateBatchItems(uncached, targetLang, settings.systemPrompt, providers);
  await commit(uncached, first.map);

  // 3. Recover items the model dropped/truncated by retrying them in smaller halves.
  const pending = uncached.filter((it) => result[it.i] === undefined);
  if (pending.length > 0) {
    const mid = Math.ceil(pending.length / 2);
    const subs = pending.length > 1 ? [pending.slice(0, mid), pending.slice(mid)] : [pending];
    for (const sub of subs) {
      if (sub.length === 0) continue;
      const retry = await translateBatchItems(sub, targetLang, settings.systemPrompt, providers);
      await commit(sub, retry.map);
    }
  }

  await incrementStats();
  return { success: true, data: result };
}

// ============================================
// Topic practice generation
// ============================================

function normalizePack(parsed: unknown, topic: string): PracticePack {
  const p = (parsed || {}) as Record<string, unknown>;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  return {
    topic,
    vocab: arr(p.vocab)
      .map((x) => {
        const o = (x || {}) as Record<string, unknown>;
        return { term: str(o.term), ipa: str(o.ipa) || undefined, meaning: str(o.meaning), example: str(o.example) || undefined };
      })
      .filter((v) => v.term && v.meaning),
    phrases: arr(p.phrases)
      .map((x) => {
        const o = (x || {}) as Record<string, unknown>;
        return { en: str(o.en), vi: str(o.vi) };
      })
      .filter((v) => v.en),
    dialogue: arr(p.dialogue)
      .map((x) => {
        const o = (x || {}) as Record<string, unknown>;
        return { speaker: str(o.speaker) || 'A', en: str(o.en), vi: str(o.vi) };
      })
      .filter((v) => v.en),
    passage: arr(p.passage)
      .map((x) => {
        const o = (x || {}) as Record<string, unknown>;
        return { en: str(o.en), vi: str(o.vi) };
      })
      .filter((v) => v.en),
  };
}

async function handleGeneratePractice(request: { payload: { topic: string; level?: string; words?: string[] } }): Promise<{
  success: boolean;
  data?: PracticePack;
  error?: string;
}> {
  const settings = await getSettings();
  const topic = (request.payload.topic || '').trim();
  const level = request.payload.level || 'intermediate';
  const words = (request.payload.words || []).filter(Boolean);
  if (!topic) return { success: false, error: 'Hãy nhập chủ đề.' };

  const providers = buildProviderList(settings);
  if (!providers.some((p) => p.key)) {
    return { success: false, error: 'Chưa cấu hình API Key hoặc Provider không hợp lệ.' };
  }

  const text =
    `Topic: ${topic}\nLevel: ${level}` +
    (words.length
      ? `\n\nIMPORTANT: The learner is revising these specific words. Make the "vocab" list EXACTLY these words (add correct IPA, a short Vietnamese meaning, and a natural example for each), and write the phrases and the dialogue so they naturally reuse these words: ${words.join(', ')}`
      : '');
  const activeModel = providers[0]?.model || 'unknown';

  if (settings.cacheEnabled) {
    const cached = await getCachedTranslation(makeCacheKey(text, 'vi', activeModel, 'practice3'));
    if (cached) {
      try {
        return { success: true, data: JSON.parse(cached) as PracticePack };
      } catch {
        /* stale/corrupt → regenerate */
      }
    }
  }

  let raw = '';
  let usedModel = activeModel;
  let lastError: Error | null = null;
  for (const p of providers) {
    if (!p.key) continue;
    try {
      await pace();
      raw = await callProvider(p, text, 'auto', 'vi', PRACTICE_SYSTEM_PROMPT, PRACTICE_TEMPLATE, PAGE_BATCH_MAX_OUTPUT_TOKENS);
      usedModel = p.model;
      lastError = null;
      break;
    } catch (err) {
      lastError = err as Error;
    }
  }
  if (!raw) return { success: false, error: lastError?.message || 'Không tạo được bài luyện.' };

  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { success: false, error: 'Kết quả AI không hợp lệ, thử lại nhé.' };
  }
  const pack = normalizePack(parsed, topic);
  if (pack.vocab.length === 0 && pack.phrases.length === 0) {
    return { success: false, error: 'Không tạo được nội dung. Thử chủ đề khác.' };
  }

  if (settings.cacheEnabled) {
    await setCachedTranslation(makeCacheKey(text, 'vi', usedModel, 'practice3'), JSON.stringify(pack));
  }
  await incrementStats();
  return { success: true, data: pack };
}

async function handleGenerateDrill(request: { payload: { sound: string } }): Promise<{
  success: boolean;
  data?: DrillPack;
  error?: string;
}> {
  const settings = await getSettings();
  const sound = (request.payload.sound || '').trim();
  if (!sound) return { success: false, error: 'Hãy chọn một âm.' };

  const providers = buildProviderList(settings);
  if (!providers.some((p) => p.key)) {
    return { success: false, error: 'Chưa cấu hình API Key hoặc Provider không hợp lệ.' };
  }
  const activeModel = providers[0]?.model || 'unknown';

  if (settings.cacheEnabled) {
    const cached = await getCachedTranslation(makeCacheKey(sound, 'vi', activeModel, 'drill'));
    if (cached) {
      try {
        return { success: true, data: JSON.parse(cached) as DrillPack };
      } catch {
        /* regenerate */
      }
    }
  }

  let raw = '';
  let usedModel = activeModel;
  let lastError: Error | null = null;
  for (const p of providers) {
    if (!p.key) continue;
    try {
      await pace();
      raw = await callProvider(p, sound, 'auto', 'vi', DRILL_SYSTEM_PROMPT, DRILL_TEMPLATE, PAGE_BATCH_MAX_OUTPUT_TOKENS);
      usedModel = p.model;
      lastError = null;
      break;
    } catch (err) {
      lastError = err as Error;
    }
  }
  if (!raw) return { success: false, error: lastError?.message || 'Không tạo được bài drill.' };

  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') return { success: false, error: 'Kết quả không hợp lệ, thử lại.' };
  const o = parsed as Record<string, unknown>;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  const pack: DrillPack = {
    sound,
    tip: str(o.tip),
    pairs: arr(o.pairs)
      .map((x) => {
        const p = (x || {}) as Record<string, unknown>;
        return { a: str(p.a), b: str(p.b), note: str(p.note) || undefined };
      })
      .filter((p) => p.a),
    sentences: arr(o.sentences)
      .map((x) => {
        const p = (x || {}) as Record<string, unknown>;
        return { en: str(p.en), vi: str(p.vi) };
      })
      .filter((s) => s.en),
  };
  if (pack.pairs.length === 0 && pack.sentences.length === 0) {
    return { success: false, error: 'Không tạo được nội dung, thử lại.' };
  }

  if (settings.cacheEnabled) {
    await setCachedTranslation(makeCacheKey(sound, 'vi', usedModel, 'drill'), JSON.stringify(pack));
  }
  await incrementStats();
  return { success: true, data: pack };
}

async function handleChatTurn(request: { payload: { messages: ChatMessage[]; topic: string; level?: string } }): Promise<{
  success: boolean;
  data?: { reply: string; correction?: string };
  error?: string;
}> {
  const settings = await getSettings();
  const { messages, topic } = request.payload;
  const level = request.payload.level || 'intermediate';

  const providers = buildProviderList(settings);
  if (!providers.some((p) => p.key)) {
    return { success: false, error: 'Chưa cấu hình API Key hoặc Provider không hợp lệ.' };
  }

  const history = (messages || []).map((m) => `${m.role === 'user' ? 'Learner' : 'You'}: ${m.text}`).join('\n');
  const text =
    `Situation: ${topic}. Learner level: ${level}.\n` +
    (history
      ? `Conversation so far (most recent last):\n${history}`
      : 'The conversation has not started yet — greet the learner warmly and open the topic with a question.');

  let raw = '';
  let lastError: Error | null = null;
  for (const p of providers) {
    if (!p.key) continue;
    try {
      await pace();
      raw = await callProvider(p, text, 'auto', 'en', CHAT_SYSTEM_PROMPT, CHAT_TEMPLATE, 1024);
      lastError = null;
      break;
    } catch (err) {
      lastError = err as Error;
    }
  }
  if (!raw) return { success: false, error: lastError?.message || 'Không phản hồi được.' };

  const parsed = extractJson(raw);
  let reply = '';
  let correction = '';
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    reply = typeof o.reply === 'string' ? o.reply : '';
    correction = typeof o.correction === 'string' ? o.correction : '';
  }
  if (!reply) reply = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

  await incrementStats();
  return { success: true, data: { reply, correction: correction || undefined } };
}

function clampBand(n: unknown): number {
  const v = typeof n === 'number' ? n : parseFloat(String(n));
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(9, Math.round(v * 2) / 2));
}

async function handleAssessSpeaking(request: { payload: { transcript: string; question: string } }): Promise<{
  success: boolean;
  data?: SpeakingAssessment;
  error?: string;
}> {
  const settings = await getSettings();
  const transcript = (request.payload.transcript || '').trim();
  const question = (request.payload.question || '').trim();
  if (!transcript) return { success: false, error: 'Chưa có nội dung nói để chấm.' };

  const providers = buildProviderList(settings);
  if (!providers.some((p) => p.key)) {
    return { success: false, error: 'Chưa cấu hình API Key hoặc Provider không hợp lệ.' };
  }

  const text = `Speaking prompt: ${question || '(general topic)'}\n\nCandidate's spoken answer (auto-transcribed):\n"""\n${transcript}\n"""`;

  let raw = '';
  let lastError: Error | null = null;
  for (const p of providers) {
    if (!p.key) continue;
    try {
      await pace();
      raw = await callProvider(p, text, 'auto', 'vi', IELTS_SPEAKING_SYSTEM, IELTS_SPEAKING_TEMPLATE, PAGE_BATCH_MAX_OUTPUT_TOKENS);
      lastError = null;
      break;
    } catch (err) {
      lastError = err as Error;
    }
  }
  if (!raw) return { success: false, error: lastError?.message || 'Không chấm được.' };

  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') return { success: false, error: 'Kết quả chấm không hợp lệ, thử lại.' };

  const o = parsed as Record<string, unknown>;
  const crit = (o.criteria || {}) as Record<string, { band?: unknown; comment?: unknown }>;
  const c = (k: string) => ({ band: clampBand(crit[k]?.band), comment: String(crit[k]?.comment || '') });
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);

  const assessment: SpeakingAssessment = {
    overall: clampBand(o.overall),
    criteria: {
      fluency: c('fluency'),
      lexical: c('lexical'),
      grammar: c('grammar'),
      pronunciation: c('pronunciation'),
    },
    strengths: arr(o.strengths),
    improvements: arr(o.improvements),
    better: String(o.better || ''),
  };

  await incrementStats();
  return { success: true, data: assessment };
}

/**
 * Fetch a relevant illustration for a term from Openverse (CC-licensed, no API key).
 * Returns a thumbnail URL served from api.openverse.org.
 */
const IMAGE_CACHE_KEY = 'imageCache';
const IMAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const IMAGE_CACHE_MAX = 600;

async function handleFetchImage(query: string): Promise<{ success: boolean; data?: { urls: string[] }; error?: string }> {
  const q = (query || '').trim();
  if (!q) return { success: false, error: 'Thiếu từ khoá.' };
  const cacheKey = q.toLowerCase();

  // 1) Serve from cache (persists across sessions; avoids re-hitting the rate-limited API).
  try {
    const r = await chrome.storage.local.get({ [IMAGE_CACHE_KEY]: {} });
    const cache = (r[IMAGE_CACHE_KEY] || {}) as Record<string, { urls: string[]; ts: number }>;
    const hit = cache[cacheKey];
    if (hit && Date.now() - hit.ts < IMAGE_CACHE_TTL_MS) {
      return hit.urls.length
        ? { success: true, data: { urls: hit.urls } }
        : { success: false, error: 'Không tìm thấy ảnh phù hợp.' };
    }
  } catch { /* fall through to network */ }

  // 2) Fetch from Openverse.
  try {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=8&mature=false`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { success: false, error: `Openverse ${res.status}` };
    const data = await res.json();
    const results = (data.results || []) as { thumbnail?: string; url?: string }[];
    const urls = results.map((r) => r.thumbnail || r.url || '').filter(Boolean).slice(0, 6);
    void cacheImageResult(cacheKey, urls); // cache even empty results to skip repeat lookups
    return urls.length ? { success: true, data: { urls } } : { success: false, error: 'Không tìm thấy ảnh phù hợp.' };
  } catch {
    return { success: false, error: 'Không tải được ảnh.' };
  }
}

/** Store an image-search result, evicting oldest entries when over capacity. */
async function cacheImageResult(key: string, urls: string[]): Promise<void> {
  try {
    const r = await chrome.storage.local.get({ [IMAGE_CACHE_KEY]: {} });
    const cache = (r[IMAGE_CACHE_KEY] || {}) as Record<string, { urls: string[]; ts: number }>;
    cache[key] = { urls, ts: Date.now() };
    const entries = Object.entries(cache);
    const next =
      entries.length > IMAGE_CACHE_MAX
        ? Object.fromEntries(entries.sort((a, b) => b[1].ts - a[1].ts).slice(0, IMAGE_CACHE_MAX))
        : cache;
    await chrome.storage.local.set({ [IMAGE_CACHE_KEY]: next });
  } catch { /* ignore */ }
}

// ============================================
// Context menus
// ============================================

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'translate-selection',
      title: '🌐 Dịch với AI Translator',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'translate-selection-bilingual',
      title: '📑 Dịch song ngữ tại chỗ',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'translate-selection-replace',
      title: '✍️ Dịch & ghi đè tại chỗ',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'translate-page',
      title: '🌐 Dịch / khôi phục toàn trang',
      contexts: ['page'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const tabId = tab.id;
  // sendMessage rejects on pages with no content script (chrome://, Web Store, PDF viewer,
  // pages loaded before install). Swallow so it doesn't surface as an unhandled rejection.
  const send = (msg: unknown) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});

  if (info.menuItemId === 'translate-selection' && info.selectionText) {
    send({ type: 'TRANSLATE_SELECTION', payload: { text: info.selectionText } });
  } else if (info.menuItemId === 'translate-selection-bilingual') {
    send({ type: 'TRANSLATE_SELECTION_INLINE', payload: { mode: 'bilingual' } });
  } else if (info.menuItemId === 'translate-selection-replace') {
    send({ type: 'TRANSLATE_SELECTION_INLINE', payload: { mode: 'replace' } });
  } else if (info.menuItemId === 'translate-page') {
    const settings = await getSettings();
    send({
      type: 'TRANSLATE_PAGE',
      payload: {
        mode: settings.pageTranslateMode || 'replace',
        targetLang: (settings.pageTargetLang || 'vi') as Language,
      },
    });
  }
});
