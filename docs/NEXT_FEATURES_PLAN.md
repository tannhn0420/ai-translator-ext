# Roadmap v2 — Học tập + Bề mặt mới + Tốc độ

4 tính năng đã chốt: **Streaming**, **Sổ từ vựng + Flashcard (SRS)**, **OCR dịch ảnh (Gemini vision)**,
**Phụ đề song ngữ YouTube**. Tất cả build trên kiến trúc hiện có (background router + `buildProviderList`/
`callProvider` + services gemini/openai + storage sync/local + content bubble/sidebar).

## Thứ tự đề xuất (value/effort + rủi ro)
1. **⚡ Streaming** — nhỏ, nền tảng, rủi ro thấp, nâng trải nghiệm toàn app. (~1 ngày)
2. **📇 Sổ từ vựng + Flashcard** — flagship học tập, self-contained, không phụ thuộc DOM site. (~2–3 ngày)
3. **🖼️ OCR dịch ảnh** — độc đáo, tận dụng Gemini multimodal, rủi ro vừa (quyền host/CORS). (~1–2 ngày)
4. **🎬 Phụ đề YouTube** — wow nhất nhưng công sức & rủi ro cao nhất (DOM YouTube). Làm cuối. (~2–3 ngày)

Cả 4 gần như độc lập → có thể đổi thứ tự tùy ý.

---

## 1. ⚡ Streaming (chữ dịch hiện dần)

**Vì sao:** bubble/popup/IELTS hiện đang chờ trọn phản hồi mới hiện. Streaming → cảm giác nhanh hơn hẳn.
Chỉ áp dụng cho **dịch 1 đoạn** (bubble, popup, dictionary, IELTS); **page-translate giữ nguyên batch**
(vì output là JSON, không stream được sạch).

**Kỹ thuật:** sendMessage là request/response một lần → không stream được. Dùng **long-lived Port**
(`chrome.runtime.connect`).

**Data contract:**
```
Content: const port = chrome.runtime.connect({ name: 'translate-stream' })
         port.postMessage({ text, targetLang, systemPrompt, template, context, dictionaryMode })
Background (chrome.runtime.onConnect): stream provider → port.postMessage
         { type:'delta', text }   // nhiều lần
         { type:'done',  full }   // kết thúc → lưu history, cache
         { type:'error', error }  // lỗi → content hiện lỗi / fallback
```

**Provider streaming:**
- Gemini: `POST {API}/{model}:streamGenerateContent?alt=sse&key=…` → SSE `data: {json}`, gộp
  `candidates[0].content.parts[].text`.
- OpenAI-compat (openai/groq/openrouter): `chat/completions` với `stream:true` → SSE
  `data: {choices:[{delta:{content}}]}`, kết `data: [DONE]`.
- Parse SSE bằng `fetch` + `response.body.getReader()` + `TextDecoder`.

**Render:** đang stream hiển thị **plain text** cộng dồn; khi `done` mới format markdown/section như hiện tại.
Fallback: nếu port/stream lỗi → gọi lại đường `TRANSLATE_TEXT` cũ (không stream).

**Files:** `services/gemini.ts` + `openai.ts` (thêm bản `*Stream(onDelta)`), `background/index.ts`
(`onConnect` handler, tái dùng `buildProviderList`), `content/index.tsx` (`translateText` + IELTS dùng port),
`App.tsx` (popup dùng port). Fallback giữ nguyên hàm cũ.

**Rủi ro:** khác biệt SSE giữa provider; fallback provider giữa chừng khó → chốt provider ngay đầu stream,
lỗi giữa chừng thì hiện phần đã có + nút thử lại.

---

## 2. 📇 Sổ từ vựng + Flashcard (SRS)

**Vì sao:** biến tool đọc → tool **học**. Tận dụng dictionary + history sẵn có. Không phụ thuộc site → bền.

**Data model** (`chrome.storage.local`, key `vocabDeck`):
```ts
interface VocabCard {
  id: string; term: string; lang: 'en'|'vi';
  meaning: string; ipa?: string; example?: string;
  context?: string; sourceUrl?: string; createdAt: number;
  // SRS (SM-2 lite)
  due: number; interval: number; ease: number; reps: number; lapses: number;
}
```

**SRS SM-2 lite** — 4 nút Again/Hard/Good/Easy:
- Again: interval→0 (10 phút), lapses++, ease−0.2
- Hard: interval→max(1, interval×1.2), ease−0.15
- Good: reps 0→1d, 1→6d, ≥2→round(interval×ease); reps++
- Easy: interval→round(interval×ease×1.3), ease+0.15, reps++
- ease clamp [1.3, 2.8]; due = now + interval ngày.

**Điểm lưu từ (capture):**
- Bubble dictionary: thêm nút **➕ Lưu từ** trong `renderTranslationResult` → parse term/ipa/meaning/example
  từ markdown dictionary → `SAVE_VOCAB`.
- Bubble dịch thường + selection: nút **➕ Lưu**.
- Context menu selection: "➕ Lưu vào sổ từ vựng".
- Nếu lưu từ selection chưa qua dictionary → 1 API call sinh thẻ gọn (term→meaning+ipa+example).

**UI ôn tập & quản lý:** thêm tab **"Sổ từ vựng"** trong Options (`OptionsApp.tsx`) gồm:
- Danh sách (search, sửa, xoá), thống kê (tổng/đến hạn/đã thuộc).
- Chế độ **Review**: lật thẻ, 4 nút chấm điểm, chạy hết thẻ `due`.
- **Export Anki**: xuất TSV (front⭾back) tải về bằng Blob + `<a download>` (Anki import chuẩn). (.apkg để sau.)

**Messages:** `SAVE_VOCAB`, `GET_VOCAB`, `UPDATE_VOCAB` (sau review), `DELETE_VOCAB`, `EXPORT_VOCAB`.

**Files:** `types` (VocabCard + messages), `storage.ts` (CRUD + `getDueCards` + SRS update),
`background/index.ts` (handlers + context menu), `content/index.tsx` (nút Lưu ở bubble),
`OptionsApp.tsx` (tab mới + review), `constants.ts` (prompt sinh thẻ gọn).

**Rủi ro:** thấp. Chủ yếu là công UI review.

---

## 3. 🖼️ OCR dịch chữ trong ảnh (Gemini vision)

**Vì sao:** ảnh chụp, infographic, meme có chữ — dịch được là độc đáo. Gemini flash **đa phương thức** sẵn.

**Luồng:**
- Context menu `contexts:['image']` → `info.srcUrl`.
- **Background fetch** ảnh (service worker không bị CORS của trang, nhưng cần host permission) → base64.
- Gọi Gemini vision:
```
contents:[{ parts:[
  { inline_data: { mime_type, data: <base64> } },
  { text: OCR_PROMPT (target lang) }
]}]
```
- Kết quả hiện ở **bubble tại vị trí ảnh** (content tìm `img[src=srcUrl]` để định vị) hoặc sidebar.

**Provider:** MVP **Gemini-only** (vision). Provider khác → báo "chưa hỗ trợ ảnh" (openai gpt-4o có thể thêm sau
với payload `image_url`).

**Quyền:** cần `host_permissions` rộng để fetch ảnh bất kỳ. Dùng **`optional_host_permissions: ["*://*/*"]`**
và xin khi bật tính năng (đỡ đáng ngại hơn là xin sẵn `<all_urls>`).

**Messages:** `OCR_TRANSLATE { srcUrl, targetLang }` → `{ text }`.

**Files:** `gemini.ts` (`callGeminiVision`), `background/index.ts` (handler + fetch→base64 + context menu 'image'
+ xin optional permission), `content/index.tsx` (định vị + hiện bubble), `constants.ts` (OCR_PROMPT),
`manifest.json` (optional_host_permissions).

**Rủi ro:** quyền host & CORS khi fetch ảnh; ảnh data:URI/blob:; định vị bubble. Có fallback hiện ở giữa màn hình.

---

## 4. 🎬 Phụ đề song ngữ YouTube

**Vì sao:** "must-have" của người học ngoại ngữ. Wow-factor cao nhất.

**MVP (approach A — đọc phụ đề đang render):**
- Content chạy trên youtube.com (đã `all_urls`). Yêu cầu user **bật CC**.
- `MutationObserver` trên `.ytp-caption-window-container`; mỗi khi có cue mới (`.ytp-caption-segment`),
  gom thành 1 dòng → dịch (cache mạnh vì cue lặp) → chèn dòng dịch **ngay dưới** dòng gốc, style riêng.
- Toggle bật/tắt "Phụ đề song ngữ" (nút nhỏ trên player hoặc trong popup); nhớ theo session.

**Nâng cấp (approach B — sau):** lấy nguyên transcript (timedtext) → **pre-translate theo batch** →
đồng bộ theo `video.currentTime`. Mượt hơn, đỡ giật, rẻ hơn (batch), nhưng phải lần URL track (dễ vỡ).

**Chi phí:** mỗi dòng phụ đề 1 lần dịch → **cache theo text** để cue lặp không tốn lại; model nhanh (flash/groq).

**Files:** `src/content/youtube/subtitles.ts` (mới), wire trong `content/index.tsx` khi `location.host`
là youtube, `TRANSLATE_LINE` (hoặc tái dùng `TRANSLATE_TEXT`) + cache, settings `youtubeDualSubs`+lang,
CSS overlay phụ đề (theater/fullscreen).

**Rủi ro (cao):** YouTube đổi DOM/class → vỡ; phụ đề phải bật sẵn; độ trễ/độ tốn khi dịch realtime;
style qua các chế độ xem. Cần bảo trì.

---

## Quyết định đã chốt
- **Streaming**: stream **cả dictionary** (cùng đường bubble). IELTS để nâng cấp sau (cùng cơ chế Port).
- **Vocab**: UI review là **trang riêng full-screen** (`flashcards.html`, entry Vite mới).
- **OCR**: dùng **`optional_host_permissions`**, xin khi bật tính năng.
- **YouTube**: **MVP approach A** (đọc phụ đề đang render + cache mạnh) — bền trước thay đổi DOM, ship nhanh;
  approach B (pre-translate transcript) là nâng cấp sau.
