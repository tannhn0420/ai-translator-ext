// ============================================
// OpenAI API Service
// ============================================

import type { SourceLanguage, Language } from '../types';
import { LANGUAGE_LABELS } from '../utils/constants';

/**
 * Call OpenAI API for translation
 */
export async function callOpenAIAPI(
  text: string,
  sourceLang: SourceLanguage,
  targetLang: Language,
  systemPrompt: string,
  translationTemplate: string,
  apiKey: string,
  model: string = 'gpt-4o-mini',
  baseUrl: string = 'https://api.openai.com/v1',
  maxTokens?: number
): Promise<string> {
  if (!apiKey) {
    throw new Error('OpenAI API key chưa được cấu hình. Vui lòng vào Settings để nhập API key.');
  }

  if (!text.trim()) {
    throw new Error('Vui lòng nhập text cần dịch.');
  }

  const sourceLangName = sourceLang === 'auto' ? 'the detected language' : LANGUAGE_LABELS[sourceLang];
  const targetLangName = LANGUAGE_LABELS[targetLang];

  const userPrompt = translationTemplate
    .replace('{text}', text)
    .replace('{source_lang}', sourceLangName)
    .replace('{target_lang}', targetLangName);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const message = errorData?.error?.message || response.statusText;
    throw new Error(`OpenAI API Error: ${response.status} - ${message}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

/**
 * Validate OpenAI API key
 */
export async function validateOpenAIApiKey(
  apiKey: string, 
  model: string = 'gpt-4o-mini',
  baseUrl: string = 'https://api.openai.com/v1'
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Say hello' }],
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
