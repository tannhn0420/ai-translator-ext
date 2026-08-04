# Kế hoạch: Dịch & replace toàn trang (giữ format)

> Tính năng "full-page in-place translation" kiểu Immersive Translate — dịch text
> tiếng Anh trên trang và thay thế tại chỗ, **giữ nguyên format** (block + inline).

## Quyết định đã chốt
- **Mode:** hỗ trợ cả **Replace** (mặc định) và **Song ngữ (bilingual)**; toggle trong popup.
- **v1 giữ inline format ngay** (bold/italic/link bám đúng từ sau khi dịch), không hạ cấp plain-text.
- **Trigger:** nút "Dịch toàn trang" trong popup + mục context menu chuột phải.
  (Auto-theo-domain: Phase 3.)

## Tại sao không dịch từng text-node
Trật tự từ EN↔VI khác nhau nên không map 1:1 fragment. Phải dịch **theo block (nguyên câu)**
để AI đủ ngữ cảnh, đồng thời bảo toàn thẻ inline bằng placeholder.

## Data contracts

### Serialize inline (block → chuỗi có token)
```
Gốc   : The <b>quick</b> fox <a href=x>jumps</a><br>now.
Encode: The <0>quick</0> fox <1>jumps</1><2/>now.
```
- `<n>...</n>`  = inline element có nội dung (map[n] = clone element gốc, giữ attributes)
- `<n/>`        = inline rỗng/void (br, img)

### Batch qua background
```
message: { type:'TRANSLATE_BATCH', payload:{ items:[{i,text}], targetLang, mode:'page' } }
Model trả JSON thuần: { "0":"...", "1":"..." }  (cùng key, không kèm giải thích)
Parse: strip ```json fence → JSON.parse → map theo key.
Fail  → fallback dịch per-item; item vẫn fail → giữ nguyên bản gốc.
```

### Reconstruct
Tokenize chuỗi dịch theo `</?(\d+)/?>`:
- text → textNode
- `<n>` → push clone map[n] (shallow), fill inner (đệ quy)
- `</n>` → pop
- `<n/>` → clone void
- Tag lệch/thiếu/thừa → **fallback**: replace block bằng 1 text node phẳng (không vỡ trang).

## Module mới
- `src/content/pageTranslate/segmenter.ts` — duyệt DOM, gom **leaf block**, luật skip, lọc VN.
- `src/content/pageTranslate/serialize.ts` — encode/reconstruct + flat fallback.
- `src/content/pageTranslate/controller.ts` — orchestrate batch, replace, WeakMap restore, toggle, progress, bilingual.

## File sửa
- `src/types/index.ts` — message + batch types + settings (`pageTranslateMode`, `pageTargetLang`).
- `src/utils/constants.ts` — `PAGE_BATCH_TEMPLATE`, `PAGE_BATCH_MAX_ITEMS`, `PAGE_BATCH_MAX_CHARS`, concurrency/rate.
- `src/services/gemini.ts` / `openai.ts` — optional `maxOutputTokens` cho batch.
- `src/background/index.ts` — `TRANSLATE_BATCH` handler (per-item cache, JSON parse, rate limit) + context menu item.
- `src/content/index.tsx` — nhận `TRANSLATE_PAGE` / `TOGGLE_PAGE_TRANSLATION`, gọi controller.
- `src/App.tsx` (popup) — nút + toggle Replace/Song ngữ.
- `src/content/styles.css` — progress indicator + style song ngữ.
- `manifest.json` — (không đổi permission; context menu đã có `contextMenus`).

## Luật segmenter (skip)
`script, style, noscript, code, pre, textarea, input, select, [contenteditable],
[translate="no"], #ai-translator-* (UI của chính extension)`, node chỉ số/URL/emoji,
và block đã là tiếng Việt (regex dấu) khi đích = vi.

## Phase
- **Phase 1 ✅ — Core replace + inline format:** segmenter + serialize/reconstruct +
  fallback + `TRANSLATE_BATCH` + cache + Replace + Song ngữ + toggle restore + trigger
  (popup + context menu).
  - Fix độ phủ: bỏ stall 60s → retry-on-429 + recover item bị model bỏ sót (chia đôi);
    batch 18 item/3000 ký tự.
  - Fix "dịch 1 phần" trên trang song ngữ Anh-Việt: lọc ngôn ngữ theo **tỉ lệ từ có dấu**
    (ngưỡng 30%) thay vì "có 1 dấu = tiếng Việt" → đoạn tiếng Anh nhắc "Việt Nam/Hà Nội"
    không còn bị skip.
- **Phase 2 ✅ — Viewport-first + tốc độ cảm nhận:** `IntersectionObserver` dịch phần đang
  nhìn thấy trước, cuộn tới đâu dịch tới đó (tiết kiệm token); status pill busy/idle;
  pause/resume toggle 0-token (giữ snapshot gốc + dịch).
- **Phase 3 (tiếp theo) — Động & per-site:** `MutationObserver` cho SPA/infinite-scroll,
  auto-dịch nhớ theo domain, nút "Dừng".

## Rủi ro & xử lý
- AI hỏng token/JSON → fallback per-block/per-item. Không bao giờ vỡ trang.
- SPA React ghi đè bản dịch → re-apply + nút Dừng (Phase 3).
- Shadow DOM / iframe → v1 skip (giới hạn đã biết); cân nhắc `all_frames` sau.
- Trang lớn → chunk theo `requestIdleCallback`, cap số node.
- Quota API → batch + cache + skip block đã tiếng Việt.
