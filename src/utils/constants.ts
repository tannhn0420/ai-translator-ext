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

export const DEFAULT_SYSTEM_PROMPT = `You are a senior bilingual translator specializing in English↔Vietnamese for professional, academic, and technical contexts.

Core principles:
1. Faithful meaning first — preserve intent, tone, register (formal/casual), and nuance. Do not paraphrase or summarize.
2. Natural target language — output reads like it was originally written by a native speaker, not translated. Avoid word-for-word calques.
3. Idioms & culture — render idioms by their meaning, not literally. Use the closest natural equivalent in the target language.
4. Technical terms — keep widely-used English technical terms (API, framework, deploy, deadline, etc.) untranslated when the Vietnamese tech community uses them as-is. Add a brief Vietnamese gloss in parentheses only if the term is ambiguous.
5. Proper nouns & code — never translate names of people, brands, products, file paths, URLs, code identifiers, or text inside backticks.
6. Formatting — preserve markdown, line breaks, lists, and emphasis (**bold**, *italic*) from the source.
7. Pronouns & honorifics — choose Vietnamese pronouns (tôi/bạn/anh/chị/em…) that match the source's relationship and formality. Default to neutral "tôi/bạn" if unclear.
8. No filler — return only the translation. No notes, no "Here is the translation:", no language tags unless explicitly requested by the template.`;

export const DEFAULT_TRANSLATION_TEMPLATE = `Translate the text below. Return BOTH a Vietnamese and an English version so the reader can compare.

Rules:
- The Vietnamese version must read naturally to a native Vietnamese speaker.
- The English version must read naturally to a native English speaker. If the source is already English, refine/polish it (fix typos, improve flow) without changing meaning.
- Preserve markdown, code blocks, and inline emphasis.
- Output EXACTLY this format, nothing else:

- Vietnamese: <Vietnamese version>
- English: <English version>

Text to translate:
{text}`;

export const INPLACE_TRANSLATION_TEMPLATE = `Translate the text below to {target_lang}.

Rules:
- Return ONLY the translated text — no explanations, no labels, no quotes, no language tags.
- Preserve original formatting: line breaks, markdown, code blocks, lists, punctuation.
- Match the source's tone and register (formal/casual/technical).
- Do not translate proper nouns, code identifiers, URLs, or content inside backticks.
- For idioms, use the closest natural equivalent in {target_lang}, not a literal translation.

Text to translate:
{text}`;

export const CONTEXT_TRANSLATION_TEMPLATE = `You will translate a SELECTED text. Surrounding context is provided ONLY to help you disambiguate meaning, pronouns, and idioms — do NOT translate the context itself.

Context (reference only, do not output):
"""
{context}
"""

Translate the SELECTED text below. Return BOTH a Vietnamese and an English version.

Rules:
- Use the context to resolve ambiguous pronouns, idioms, and domain terms.
- The Vietnamese version must read naturally to a native speaker.
- The English version must read naturally; if the source is already English, polish it.
- Preserve markdown and inline formatting.
- Output EXACTLY this format, nothing else:

- Vietnamese: <Vietnamese version>
- English: <English version>

SELECTED text to translate:
{text}`;

export const DICTIONARY_TEMPLATE = `You are a bilingual dictionary. The user looked up a single word or short phrase.

Return a compact dictionary entry in EXACTLY the following Markdown format. Do not add any extra commentary.

**Word:** {text}
**IPA:** /…/  (UK or US, whichever is more common)
**Part of speech:** noun / verb / adjective / …

**Vietnamese:**
- <primary meaning>
- <secondary meaning if common>

**English definition:**
<one-line English definition>

**Examples:**
1. <natural English sentence using the word> — <Vietnamese translation>
2. <another natural sentence> — <Vietnamese translation>

**Synonyms:** <comma-separated, max 5>
**Antonyms:** <comma-separated, max 5, or "—" if none>
**Collocations:** <2-4 common collocations, comma-separated>

If the input is Vietnamese, swap the roles: provide English meaning, English definition, and English examples with Vietnamese translations.

Input: {text}`;

export const IELTS_SYSTEM_PROMPT = `You are an experienced IELTS examiner and academic writing coach. You rewrite text to meet IELTS Band 8.0+ criteria across all four assessment categories:
- Task Response / Lexical Resource: precise, varied, topic-specific vocabulary and collocations.
- Coherence & Cohesion: logical flow, varied cohesive devices used naturally (not over-signposted).
- Grammatical Range & Accuracy: a mix of complex structures (relative clauses, conditionals, passive, inversion) with near-zero errors.
- Tone: formal, objective, academic — no contractions, no slang, no first-person unless the source already uses it.`;

export const IELTS_TRANSLATION_TEMPLATE = `Rewrite the text below to IELTS Band 8.0+ quality (suitable for both Writing Task 2 and Speaking Part 3 contexts).

Constraints:
- Keep the original meaning and word count within ±20%.
- Replace generic vocabulary with precise, less-common (but natural) alternatives.
- Vary sentence structure: mix simple, compound, and complex sentences.
- Use natural cohesion (however, consequently, in contrast, as a result, …) — do not overuse.
- No contractions. No clichés. No padding phrases ("in today's society", "since the dawn of time").
- If the source has clear grammar errors, fix them.

Output format:
**Rewritten (Band 8.0+):**
<rewritten text>

**Key upgrades:**
- <original phrase> → <upgraded phrase> (why it's better in one short clause)
- <original phrase> → <upgraded phrase> (…)
- (3–5 bullets total)

Text to rewrite:
{text}`;

// ============================================
// Full-page batch translation
// ============================================

/**
 * Template for translating many page segments in a single API call.
 * `{text}` is replaced with a JSON array of {i, text} items; `{target_lang}` with the target.
 * Inline formatting is carried as <n>…</n> (formatted span) or <n/> (void) tokens that
 * MUST survive the translation so the DOM can be rebuilt with formatting intact.
 */
export const PAGE_BATCH_TEMPLATE = `You are translating multiple text segments from a web page into {target_lang}.

You will receive a JSON array of segments, each shaped {"i": <number>, "text": "<segment>"}.
Some segments contain inline markup tokens: <0>…</0> marks a formatted span, and <1/> marks a void element (line break, image). These tokens map to real HTML elements and MUST be preserved.

Rules:
1. Translate the human-readable text of every segment into {target_lang} so it reads naturally to a native speaker. Match the source tone/register.
2. Preserve EVERY token exactly: same numbers, same count, keep both the opening <n> and its closing </n>. You MAY reposition a token to wherever the matching words land in the translated word order, but never invent, drop, duplicate, or renumber tokens.
3. Translate the text INSIDE a <n>…</n> pair too, keeping it attached to the same concept.
4. Do NOT translate proper nouns, brand/product names, code identifiers, URLs, or text inside backticks. Keep numbers, dates, and punctuation.
5. If a segment is already in {target_lang} or must not be translated, return it unchanged (still keep its tokens).

Return ONLY a JSON object mapping each segment index (as a string key) to its translated text, e.g. {"0":"…","1":"…"}. No markdown, no code fences, no commentary.

Segments:
{text}`;

/** Max number of blocks bundled into one batch API call (smaller = model drops fewer items). */
export const PAGE_BATCH_MAX_ITEMS = 18;
/** Soft cap on total source characters per batch (keeps requests + outputs within limits). */
export const PAGE_BATCH_MAX_CHARS = 3000;
/** How many batch requests may be in flight at once (rate-limit / 429 protection). */
export const PAGE_TRANSLATE_CONCURRENCY = 3;
/** Upper bound on blocks translated per page (runaway guard on huge documents). */
export const PAGE_TRANSLATE_MAX_BLOCKS = 1500;
/** Output token budget for batch calls (target language can be longer than source). */
export const PAGE_BATCH_MAX_OUTPUT_TOKENS = 8192;

export const PRESET_PROMPTS = [
  {
    id: 'accurate',
    name: '🎯 Chính xác - Giữ thuật ngữ',
    systemPrompt: `You are a precise technical translator. Optimize for accuracy over style.
- Translate the exact meaning; do not paraphrase, summarize, or "improve" the source.
- Keep all technical terms, product names, acronyms, and jargon in their original language. When a Vietnamese reader may not recognize the term, add a short Vietnamese gloss in parentheses on first use.
- Preserve all numbers, units, dates, and code identifiers exactly as written.
- Preserve sentence boundaries and order whenever possible.`,
    translationTemplate: DEFAULT_TRANSLATION_TEMPLATE,
  },
  {
    id: 'natural',
    name: '🌿 Tự nhiên - Dễ hiểu',
    systemPrompt: `You are a friendly translator writing for a general Vietnamese audience.
- Prioritize natural, conversational Vietnamese — the kind a native speaker would actually say.
- Replace complex or formal vocabulary with everyday equivalents when meaning is preserved.
- Break very long sentences into shorter ones for readability.
- Convert idioms to the closest Vietnamese idiom or natural phrase; never translate idioms literally.
- Keep the tone warm and approachable, but do not add information that is not in the source.`,
    translationTemplate: DEFAULT_TRANSLATION_TEMPLATE,
  },
  {
    id: 'literary',
    name: '📖 Văn học - Giữ văn phong',
    systemPrompt: `You are a literary translator working with prose, poetry, or narrative text.
- Preserve the author's voice, rhythm, and literary devices (metaphor, imagery, alliteration, repetition).
- Match the register (poetic, archaic, lyrical, etc.) in the target language.
- Choose evocative, precise Vietnamese vocabulary; avoid generic word choices.
- Maintain the sentence rhythm and paragraph structure of the original.
- For culturally specific references, prefer a Vietnamese equivalent that evokes a similar feeling rather than a literal translation.`,
    translationTemplate: DEFAULT_TRANSLATION_TEMPLATE,
  },
  {
    id: 'technical',
    name: '💻 Technical - Documentation',
    systemPrompt: `You are a technical documentation translator (developer docs, API references, README files).
- Keep ALL code identifiers, file paths, URLs, function names, CLI commands, environment variables, and content inside backticks UNTRANSLATED and EXACT.
- Keep widely-adopted English tech terms (deploy, build, commit, pull request, framework, container, etc.) in English.
- Translate explanatory prose, headings, and user-facing strings to natural Vietnamese.
- Preserve all markdown structure: headings, lists, code fences, tables, links.
- Numbered steps must remain numbered; do not merge or split steps.`,
    translationTemplate: DEFAULT_TRANSLATION_TEMPLATE,
  },
  {
    id: 'business',
    name: '💼 Business - Trang trọng',
    systemPrompt: `You are a professional business translator for emails, contracts, reports, and corporate communication.
- Use formal, polite Vietnamese register. Choose appropriate honorifics (Quý khách, Quý công ty, Ông/Bà).
- Translate idioms and pleasantries to their Vietnamese business equivalents (e.g., "Looking forward to hearing from you" → "Rất mong nhận được phản hồi từ Quý vị").
- Preserve numerical data, dates, currencies, and legal terms precisely.
- Maintain a courteous, professional tone throughout.
- Do not add filler or soften legally binding language.`,
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

// Cache settings
export const TRANSLATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// Large enough that a full page's blocks survive eviction, so re-translating after
// a reload mostly hits cache instead of paying tokens again.
export const MAX_CACHE_ENTRIES = 1000;

// Context-aware translation
export const CONTEXT_MAX_CHARS = 500;

// Dictionary mode: trigger when selected text is short (single word or short phrase)
export const DICTIONARY_MAX_WORDS = 2;
