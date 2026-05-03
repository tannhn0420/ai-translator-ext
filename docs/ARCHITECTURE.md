# AI Translator - Technical Architecture

## 1. Extension Architecture (Manifest V3)

### Components
- **Popup UI** (React): Translation input/output, quick settings
- **Options Page** (React): Full settings, prompt editor, API config
- **Content Script** (Injected): Highlight detection, translation bubble
- **Service Worker** (Background): API calls, message routing, storage

### Data Flow
```
User Action → Content/Popup → Message → Service Worker → Gemini API → Response → UI Update
```

## 2. Component Tree

### Popup
```
PopupApp → Header, TranslationPanel, QuickActions, PromptQuickSelect
```

### Options
```
OptionsApp → Sidebar, APISettings, PromptSettings, LanguageSettings, BehaviorSettings
```

### Content Script
```
ContentScript → SelectionListener, TranslationBubble (Shadow DOM), PageTranslator
```

## 3. Message Protocol

```typescript
type MessageType = 'TRANSLATE_TEXT' | 'TRANSLATE_PAGE' | 'GET_SETTINGS' | 'SAVE_SETTINGS' | 'VALIDATE_API_KEY';

interface TranslateRequest {
  type: 'TRANSLATE_TEXT';
  payload: { text: string; sourceLang: string; targetLang: string; customPrompt?: string; };
}
```

## 4. Storage Schema (chrome.storage.sync)

- `apiKey`, `model` (gemini-2.0-flash default)
- `defaultSourceLang`, `defaultTargetLang`
- `systemPrompt`, `translationTemplate`, `savedPrompts[]`
- `autoTranslateOnHighlight`, `showTranslationBubble`, `bubblePosition`
- `translationHistory[]`, `totalTranslations`, `apiCallsToday`

## 5. Gemini API

- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Temperature: 0.3 (low for translation consistency)
- Max tokens: 8192

### Default System Prompt
```
You are a professional translator specializing in English-Vietnamese translation.
Translations should be natural, accurate, and preserve original meaning and tone.
For technical terms, keep English in parentheses after Vietnamese when appropriate.
```

## 6. Build: Vite + CRXJS
- `@crxjs/vite-plugin` for Chrome Extension dev
- Multi-entry: popup, options, content, background
- Shadow DOM for content script UI isolation
- CSS prefixed with `ai-translator-` to avoid conflicts
