# AI Translator - UI/UX Design Specification

## 1. Design System

### 1.1 Color Palette
```css
/* Primary */
--primary-500: #6366F1;      /* Indigo - main brand */
--primary-600: #4F46E5;      /* Darker for hover */
--primary-400: #818CF8;      /* Lighter accent */

/* Dark Theme (default) */
--bg-primary: #0F0F23;       /* Deep dark blue */
--bg-secondary: #1A1A2E;     /* Card backgrounds */
--bg-tertiary: #16213E;      /* Input backgrounds */
--bg-glass: rgba(255,255,255,0.05); /* Glassmorphism */

--text-primary: #E2E8F0;     /* Main text */
--text-secondary: #94A3B8;   /* Muted text */
--text-accent: #A78BFA;      /* Highlighted text */

/* Semantic */
--success: #10B981;
--error: #EF4444;
--warning: #F59E0B;

/* Gradients */
--gradient-primary: linear-gradient(135deg, #6366F1, #8B5CF6);
--gradient-bg: linear-gradient(180deg, #0F0F23, #1A1A2E);
--gradient-glass: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.02));
```

### 1.2 Typography
```css
--font-primary: 'Inter', -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', monospace;

--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
```

### 1.3 Spacing & Borders
```css
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-full: 9999px;

--shadow-sm: 0 2px 8px rgba(0,0,0,0.2);
--shadow-md: 0 4px 16px rgba(0,0,0,0.3);
--shadow-lg: 0 8px 32px rgba(0,0,0,0.4);
--shadow-glow: 0 0 20px rgba(99,102,241,0.3);
```

## 2. Popup Design (400 x 600)

### Layout
```
┌──────────────────────────────┐
│  🌐 AI Translator    [⚙️]   │  ← Header (48px)
├──────────────────────────────┤
│  [EN ▼]  [⇄]  [VI ▼]       │  ← Language bar (40px)
├──────────────────────────────┤
│                              │
│  Type or paste text...       │  ← Input (flex-grow)
│                              │
│                              │
├──────────────────────────────┤
│     [ ✨ Translate ]         │  ← Action button (48px)
├──────────────────────────────┤
│                              │
│  Translation result...  [📋]│  ← Output (flex-grow)
│                              │
│                              │
├──────────────────────────────┤
│  [📄 Translate Page] [Prompt]│  ← Quick actions (40px)
└──────────────────────────────┘
```

### Visual Effects
- Glassmorphism cards with subtle borders
- Gradient translate button with glow on hover
- Smooth height transitions for textareas
- Pulse animation on translate button during loading
- Swap button rotation animation (180deg)

## 3. Translation Bubble (Content Script)

### Design
```
         ┌─────────────────────────┐
         │ Translated text here... │
         │                    [📋] │
         └─────────┬───────────────┘
                   ▼
         [highlighted text on page]
```

- Max width: 400px
- Glassmorphism background with backdrop-blur
- Soft shadow
- Fade-in animation (200ms)
- Auto-dismiss after 10s or click outside

## 4. Options Page

### Layout
- Sidebar navigation (left, 240px)
- Content area (right, flex)
- Dark theme consistent with popup
- Form sections with clear labels
- Code editor style for prompt textarea

## 5. Key Interactions
- **Swap languages**: 180° rotation animation
- **Translate button**: Gradient pulse while loading
- **Copy button**: Checkmark animation on success
- **Translation bubble**: Fade-in from below
- **Tab switches**: Slide transition
- **Settings save**: Toast notification
