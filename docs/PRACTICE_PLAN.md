# Plan — 🎯 Luyện tập theo chủ đề (Speaking & Listening)

Tận dụng **Gemini (sẵn có)** + **Web Speech** (TTS + SpeechRecognition, built-in Chrome) →
phủ 4 kỹ năng, **không cần key/nguồn ngoài mới**. Tài nguyên free (Tatoeba/Datamuse/YouGlish)
là bổ sung ở Phase 2.

## Trang mới: `src/practice/` (full-screen, mở từ popup)

### Luồng
1. **Nhập/chọn topic** (+ mức độ) → `GENERATE_PRACTICE` tới background → Gemini sinh JSON:
   ```json
   {
     "vocab":   [{ "term", "ipa", "meaning", "example" }],
     "phrases": [{ "en", "vi" }],
     "dialogue":[{ "speaker", "en", "vi" }]
   }
   ```
   Tái dùng `buildProviderList` + `callProvider` + `extractJson`; cache theo topic+level+model.
2. Hiện **pack** 3 mục: Từ vựng · Mẫu câu · Hội thoại.
3. **Lưu từ vựng vào sổ** theo topic (dùng `SAVE_VOCAB`/deck sẵn có).

### Kỹ năng luyện
- **🎧 Listening (dictation)**: TTS đọc (giọng/tốc độ từ settings) → gõ lại → chấm (so từ, tô sai).
- **🎤 Speaking**: `webkitSpeechRecognition` (en-US) → chuyển giọng thành chữ → **so với câu mẫu,
  chấm điểm % + tô từ đúng/sai**. Cần cho phép mic (prompt 1 lần); fallback nếu trình duyệt không hỗ trợ.
- **🔊** mỗi mục: nghe mẫu (TTS).

### Chấm điểm (MVP)
Chuẩn hoá (lowercase, bỏ dấu câu) → so **multiset từ**: `score = từ khớp / tổng từ mẫu`; tô từng từ mẫu đúng/sai.

## Data / file
- `types`: message `GENERATE_PRACTICE`; interface `PracticePack` (vocab/phrases/dialogue).
- `utils/constants.ts`: `PRACTICE_SYSTEM_PROMPT` + `PRACTICE_TEMPLATE` (ép JSON, kèm IPA + VI).
- `background/index.ts`: `handleGeneratePractice` (provider chain + JSON extract + cache).
- `src/practice/`: `practice.html`, `main.tsx`, `PracticeApp.tsx`, `practice.css`, `speech.ts`
  (SpeechRecognition + scoring). Voices lấy từ settings (như flashcards).
- `vite.config.ts`: thêm entry `practice`.
- `src/App.tsx` (popup): nút **🎯 Luyện tập** (mở trang).

## Phase
- **MVP (đợt này)**: generate pack theo topic + lưu từ + Listening (dictation) + Speaking (SpeechRecognition)
  cho mẫu câu & hội thoại + nghe TTS.
- **Phase 2**: nhúng **YouGlish** (phát âm từ trong video thật), **Tatoeba** (câu thật EN–VI),
  **YouTube search theo topic** (user tự thêm key), lưu lịch sử điểm luyện tập.

## Rủi ro
- SpeechRecognition cần mic + mạng (Chrome dùng server Google); có fallback báo rõ nếu bị chặn/không hỗ trợ.
- JSON từ model có thể lệch → `extractJson` + validate, thiếu mục nào ẩn mục đó.
