# AI Translator - Chrome Extension

## Project Overview
Chrome Extension sử dụng Gemini API để dịch trang web với chất lượng AI, chủ yếu EN ↔ VI.
Built with React + TypeScript + Vite + Chrome Extension Manifest V3.

## Tech Stack
- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite with CRXJS plugin (for Chrome Extension HMR)
- **Styling**: Vanilla CSS with CSS Variables (design tokens)
- **State Management**: React Context + useReducer (lightweight, no external deps)
- **API**: Google Gemini API (gemini-2.0-flash model)
- **Extension**: Chrome Manifest V3

## Project Structure
```
ai-translator/
├── CLAUDE.md                    # This file
├── docs/                        # Documentation & phase tracking
│   ├── REQUIREMENTS.md          # Full requirements specification
│   ├── ARCHITECTURE.md          # Technical architecture
│   ├── PHASES.md                # Phase tracking & progress
│   └── DESIGN.md                # UI/UX design specification
├── public/
│   ├── manifest.json            # Chrome Extension manifest
│   └── icons/                   # Extension icons
├── src/
│   ├── background/              # Service worker (background script)
│   │   └── index.ts
│   ├── content/                 # Content script (injected into pages)
│   │   ├── index.tsx
│   │   ├── highlighter.ts       # Text selection & highlight logic
│   │   └── styles.css
│   ├── popup/                   # Extension popup UI
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.html
│   ├── options/                 # Options/Settings page
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.html
│   ├── components/              # Shared React components
│   │   ├── TranslationPanel.tsx
│   │   ├── PromptEditor.tsx
│   │   ├── LanguageSelector.tsx
│   │   └── TranslationBubble.tsx
│   ├── hooks/                   # Custom React hooks
│   │   ├── useTranslation.ts
│   │   ├── useGemini.ts
│   │   └── useSettings.ts
│   ├── services/                # API & business logic
│   │   ├── gemini.ts            # Gemini API client
│   │   ├── translator.ts        # Translation logic
│   │   └── storage.ts           # Chrome storage wrapper
│   ├── utils/                   # Utility functions
│   │   ├── dom.ts               # DOM manipulation helpers
│   │   ├── language.ts          # Language detection
│   │   └── constants.ts
│   └── types/                   # TypeScript type definitions
│       └── index.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .env.example                 # API key template
```

## Key Commands
```bash
# Development (with HMR)
npm run dev

# Build for production
npm run build

# Load extension in Chrome:
# 1. chrome://extensions
# 2. Enable Developer Mode
# 3. Load Unpacked → select `dist/` folder
```

## Code Conventions
- Use TypeScript strict mode
- Components: PascalCase, one component per file
- Hooks: camelCase with `use` prefix
- Services: camelCase
- CSS: BEM-like naming with `.ai-translator-` prefix to avoid conflicts
- All user-facing text supports both EN and VI
- Error handling: Always provide user-friendly error messages
- Chrome APIs: Use `chrome.runtime`, `chrome.storage.sync`, `chrome.tabs`
- Content scripts: Minimal footprint, avoid polluting page namespace

## API Configuration
- Model: `gemini-2.0-flash` (fast, cost-effective for translation)
- API Key stored in `chrome.storage.sync` (encrypted)
- Rate limiting: Max 10 requests/minute to avoid API quota issues

## Design Principles
- **Non-intrusive**: Extension should not interfere with normal browsing
- **Fast**: Translation should feel instant (streaming when possible)
- **Accurate**: Leverage AI context understanding for better translations
- **Customizable**: Users can define AI behavior via custom prompts
- **Accessible**: Support keyboard shortcuts, proper contrast ratios

## Phase Tracking
See `docs/PHASES.md` for detailed phase progress.
Current Phase: Phase 1 - Project Setup & Foundation
