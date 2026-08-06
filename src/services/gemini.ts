// ============================================
// Gemini API Service
// ============================================

import type { GeminiRequest, GeminiResponse, SourceLanguage, Language } from '../types';
import { GEMINI_API_URL, LANGUAGE_LABELS } from '../utils/constants';
import { readSSE } from './sse';

/**
 * Call Gemini API for translation
 */
export async function callGeminiAPI(
  text: string,
  sourceLang: SourceLanguage,
  targetLang: Language,
  systemPrompt: string,
  translationTemplate: string,
  apiKey: string,
  model: string = 'gemini-flash-latest',
  maxOutputTokens: number = 8192
): Promise<string> {
  if (!apiKey) {
    throw new Error('API key chưa được cấu hình. Vui lòng vào Settings để nhập API key.');
  }

  if (!text.trim()) {
    throw new Error('Vui lòng nhập text cần dịch.');
  }

  // Build the translation prompt from template
  const sourceLangName = sourceLang === 'auto' ? 'the detected language' : LANGUAGE_LABELS[sourceLang];
  const targetLangName = LANGUAGE_LABELS[targetLang];

  const userPrompt = translationTemplate
    .replace('{text}', () => text) // function replacer: user text may contain $& / $1 / $$
    .replace('{source_lang}', () => sourceLangName)
    .replace('{target_lang}', () => targetLangName);

  const requestBody: GeminiRequest = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens,
    },
  };

  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    if (response.status === 400) {
      throw new Error('API key không hợp lệ hoặc request bị lỗi.');
    } else if (response.status === 429) {
      throw new Error('Đã vượt quá giới hạn API. Vui lòng thử lại sau.');
    } else if (response.status === 403) {
      throw new Error('API key không có quyền truy cập. Kiểm tra lại key.');
    }
    throw new Error(
      `Lỗi API: ${response.status} - ${errorData?.error?.message || response.statusText}`
    );
  }

  const data: GeminiResponse = await response.json();

  if (data.error) {
    throw new Error(`Gemini error: ${data.error.message}`);
  }

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Không nhận được kết quả dịch từ AI.');
  }

  // A candidate blocked by SAFETY/RECITATION has no content/parts — guard before mapping.
  const parts = data.candidates[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error('AI không trả nội dung (có thể bị bộ lọc an toàn chặn). Thử đoạn khác.');
  }

  const translatedText = parts.map((part) => part.text).join('');
  return translatedText.trim();
}

/**
 * Streaming variant of callGeminiAPI. Calls `onDelta` with the accumulated text as
 * chunks arrive and resolves with the final full text.
 */
export async function callGeminiAPIStream(
  text: string,
  sourceLang: SourceLanguage,
  targetLang: Language,
  systemPrompt: string,
  translationTemplate: string,
  apiKey: string,
  model: string,
  onDelta: (full: string) => void,
  maxOutputTokens: number = 8192
): Promise<string> {
  if (!apiKey) {
    throw new Error('API key chưa được cấu hình. Vui lòng vào Settings để nhập API key.');
  }
  if (!text.trim()) {
    throw new Error('Vui lòng nhập text cần dịch.');
  }

  const sourceLangName = sourceLang === 'auto' ? 'the detected language' : LANGUAGE_LABELS[sourceLang];
  const targetLangName = LANGUAGE_LABELS[targetLang];
  const userPrompt = translationTemplate
    .replace('{text}', () => text) // function replacer: user text may contain $& / $1 / $$
    .replace('{source_lang}', () => sourceLangName)
    .replace('{target_lang}', () => targetLangName);

  const requestBody: GeminiRequest = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens },
  };

  const url = `${GEMINI_API_URL}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    if (response.status === 400) throw new Error('API key không hợp lệ hoặc request bị lỗi.');
    if (response.status === 429) throw new Error('Đã vượt quá giới hạn API. Vui lòng thử lại sau.');
    if (response.status === 403) throw new Error('API key không có quyền truy cập. Kiểm tra lại key.');
    const errorData = await response.json().catch(() => null);
    throw new Error(`Lỗi API: ${response.status} - ${errorData?.error?.message || response.statusText}`);
  }

  let full = '';
  await readSSE(response, (data) => {
    try {
      const json = JSON.parse(data) as GeminiResponse;
      const parts = json.candidates?.[0]?.content?.parts;
      if (parts) {
        const piece = parts.map((p) => p.text || '').join('');
        if (piece) {
          full += piece;
          onDelta(full);
        }
      }
    } catch {
      // ignore malformed chunk
    }
  });

  return full.trim();
}

/**
 * Validate API key by making a simple test request
 */
export async function validateApiKey(apiKey: string, model: string = 'gemini-flash-latest'): Promise<boolean> {
  try {
    const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Hello' }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
