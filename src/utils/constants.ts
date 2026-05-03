// ============================================
// Constants
// ============================================

export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const OPENAI_API_URL = 'https://api.openai.com/v1';
export const GROQ_API_URL = 'https://api.groq.com/openai/v1';
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

export const DEFAULT_MODEL = 'gemini-flash-latest';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_GROQ_MODEL = 'llama-3.1-8b-instant';
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';

export const DEFAULT_SYSTEM_PROMPT = `You are a professional translator specializing in English-Vietnamese translation.
Your translations should be natural, accurate, and preserve the original meaning and tone.
For technical terms, keep the English term in parentheses after the Vietnamese translation when appropriate.
.`;

export const DEFAULT_TRANSLATION_TEMPLATE = `Translate the following text. 
Please provide two versions of the translation:
- Vietnamese: [Your Vietnamese translation here]
- English: [Your English translation here]

Only return the requested labels and translations. No additional commentary.

Text to translate:
{text}`;

export const INPLACE_TRANSLATION_TEMPLATE = `Translate the following text to {target_lang}.
ONLY return the translated text. Do not include any explanations, labels, or additional formatting.

Text to translate:
{text}`;

export const IELTS_SYSTEM_PROMPT = `You are an expert IELTS examiner. Your goal is to rewrite the provided text to meet an IELTS 8.0+ standard.`;

export const IELTS_TRANSLATION_TEMPLATE = `Please provide a highly advanced, natural rewrite of the following text suitable for IELTS Band 8.0+ (both Writing and Speaking contexts).
Only return the rewritten text. No explanations or additional commentary.

Text to rewrite:
{text}`;

export const PRESET_PROMPTS = [
  {
    id: 'accurate',
    name: '🎯 Chính xác - Giữ thuật ngữ',
    systemPrompt: `You are a precise translator. Translate accurately while keeping technical terms in their original language with Vietnamese explanation in parentheses. Maintain the exact meaning without paraphrasing.`,
    translationTemplate: DEFAULT_TRANSLATION_TEMPLATE,
  },
  {
    id: 'natural',
    name: '🌿 Tự nhiên - Dễ hiểu',
    systemPrompt: `You are a friendly translator. Make translations sound natural and easy to understand for Vietnamese speakers. Use simple, everyday language. Avoid overly formal or technical language.`,
    translationTemplate: DEFAULT_TRANSLATION_TEMPLATE,
  },
  {
    id: 'literary',
    name: '📖 Văn học - Giữ văn phong',
    systemPrompt: `You are a literary translator. Preserve the writing style, tone, and literary devices of the original text. Use beautiful, expressive Vietnamese that captures the spirit of the original.`,
    translationTemplate: DEFAULT_TRANSLATION_TEMPLATE,
  },
  {
    id: 'technical',
    name: '💻 Technical - Documentation',
    systemPrompt: `You are a technical documentation translator. Translate technical content accurately. Keep code snippets, API names, variable names, and technical terms in English. Translate explanations and descriptions to Vietnamese.`,
    translationTemplate: DEFAULT_TRANSLATION_TEMPLATE,
  },
];

export const LANGUAGE_LABELS: Record<string, string> = {
  auto: '🔍 Auto Detect',
  en: '🇬🇧 English',
  vi: '🇻🇳 Tiếng Việt',
};

export const MAX_HISTORY_ITEMS = 50;
export const RATE_LIMIT_PER_MINUTE = 15;
export const MAX_TEXT_LENGTH = 5000;
