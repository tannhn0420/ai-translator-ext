# AI Translator - Phase Tracking

## Phase Overview

| Phase | Name | Status | Description |
|-------|------|--------|-------------|
| 1 | Project Setup & Foundation | ✅ Complete | Vite + React + CRXJS + Manifest V3 |
| 2 | Popup Translation UI | ✅ Complete | Core translation panel in popup |
| 3 | Gemini API Integration | ✅ Complete | API client, service worker |
| 4 | Content Script - Highlight | ✅ Complete | Text selection & bubble translation |
| 5 | Options Page & Prompts | ✅ Complete | Settings, custom prompts |
| 6 | Full Page Translation | ⬜ Not Started | Translate entire page |
| 7 | Polish & UX | ⬜ Not Started | Animations, dark mode, shortcuts |
| 8 | Testing & Release | 🔄 In Progress | Testing, packaging |

---

## Phase 1: Project Setup & Foundation
**Goal**: Scaffolded project that loads as Chrome Extension

### Tasks
- [x] Create CLAUDE.md
- [x] Create REQUIREMENTS.md
- [x] Create ARCHITECTURE.md
- [x] Create PHASES.md (this file)
- [ ] Create DESIGN.md
- [ ] Initialize Vite + React + TypeScript project
- [ ] Install & configure @crxjs/vite-plugin
- [ ] Create manifest.json (Manifest V3)
- [ ] Setup popup entry point (popup/index.html + main.tsx)
- [ ] Setup options entry point (options/index.html + main.tsx)
- [ ] Setup content script entry point
- [ ] Setup background service worker entry
- [ ] Create base CSS design system (variables, reset)
- [ ] Generate extension icons
- [ ] Verify extension loads in Chrome

### Deliverables
- Extension loads in Chrome with basic popup
- All entry points functional
- Build & dev commands working

---

## Phase 2: Popup Translation UI
**Goal**: Beautiful popup with translation input/output

### Tasks
- [ ] Design & implement PopupApp layout
- [ ] LanguageSelector component (EN/VI/Auto)
- [ ] SwapButton (EN ↔ VI animation)
- [ ] Input textarea with char count
- [ ] Output textarea with copy button
- [ ] TranslateButton with loading state
- [ ] Quick action buttons (translate page toggle)
- [ ] Prompt preset dropdown
- [ ] CSS styling (glassmorphism, gradients, animations)
- [ ] Responsive layout for 400x600 popup

### Deliverables
- Fully styled popup UI
- All interactive elements functional (except API)
- Mock translation for testing

---

## Phase 3: Gemini API Integration
**Goal**: Real translation via Gemini API

### Tasks
- [ ] Gemini API client service (services/gemini.ts)
- [ ] Background service worker message handler
- [ ] Chrome storage service (services/storage.ts)
- [ ] API key input & validation in popup
- [ ] Connect popup translate button to API
- [ ] Error handling (invalid key, rate limit, network)
- [ ] Loading states during API calls
- [ ] Translation history storage

### Deliverables
- Working EN ↔ VI translation via Gemini
- API key management
- Error handling

---

## Phase 4: Content Script - Highlight Translation
**Goal**: Highlight text on any page → translation bubble

### Tasks
- [ ] Content script selection listener
- [ ] Shadow DOM container for bubble UI
- [ ] TranslationBubble React component
- [ ] Position calculation (near selection)
- [ ] Connect to service worker for translation
- [ ] Auto-dismiss on click outside
- [ ] Copy translation button
- [ ] CSS isolation (Shadow DOM)
- [ ] Handle edge cases (iframes, dynamic content)

### Deliverables
- Select text → see translation bubble
- Works on any website
- Non-intrusive, isolated styling

---

## Phase 5: Options Page & Custom Prompts
**Goal**: Full settings page with prompt customization

### Tasks
- [ ] Options page layout (sidebar + content)
- [ ] API Settings section (key, model, usage)
- [ ] System Prompt editor with presets
- [ ] Translation Template editor with variables
- [ ] Save/Load multiple custom prompts
- [ ] Language default settings
- [ ] Behavior toggles (auto-translate, bubble, etc.)
- [ ] Import/Export settings

### Deliverables
- Complete options page
- Custom prompt system working
- Settings persist across sessions

---

## Phase 6: Full Page Translation
**Goal**: Translate entire page content

### Tasks
- [ ] DOM walker to extract text nodes
- [ ] Batch translation (chunk text nodes)
- [ ] Replace text nodes with translations
- [ ] Toggle original ↔ translated view
- [ ] Progress indicator
- [ ] Handle dynamic content (MutationObserver)
- [ ] Performance optimization

### Deliverables
- One-click full page translation
- Toggle between original and translated
- Works on most websites

---

## Phase 7: Polish & UX
**Goal**: Premium feel, smooth experience

### Tasks
- [ ] Dark/Light mode toggle
- [ ] Micro-animations throughout
- [ ] Keyboard shortcuts (Ctrl+Shift+T)
- [ ] Onboarding flow for new users
- [ ] Error recovery & retry logic
- [ ] Performance audit & optimization
- [ ] Accessibility audit (ARIA, contrast)

### Deliverables
- Premium, polished UI
- Keyboard accessible
- Smooth animations

---

## Phase 8: Testing & Release
**Goal**: Production-ready extension

### Tasks
- [ ] Manual testing on 10+ popular websites
- [ ] Edge case testing (long text, special chars)
- [ ] API error scenario testing
- [ ] Cross-browser compatibility check
- [ ] Bundle size optimization
- [ ] Create README with screenshots
- [ ] Package for Chrome Web Store
- [ ] Create demo video/screenshots

### Deliverables
- Production-ready .crx / .zip
- Documentation complete
- Ready for Chrome Web Store submission

---

## Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-04-30 | Use Vite + CRXJS | Best DX for Chrome Extension with React |
| 2026-04-30 | Manifest V3 | Required for new Chrome extensions |
| 2026-04-30 | gemini-2.0-flash default | Fast, cost-effective for translation |
| 2026-04-30 | Shadow DOM for content script | CSS isolation from host page |
| 2026-04-30 | Vanilla CSS | Avoid TailwindCSS build complexity in extension |
