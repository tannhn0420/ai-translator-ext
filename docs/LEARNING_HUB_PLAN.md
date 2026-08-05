# Plan — Nâng cấp "Learning Hub" (sổ từ vựng)

Mở rộng phần Flashcards hiện có thành một hub học tập. Tất cả build trên nền sẵn có
(`VocabCard` + `utils/srs.ts` + `storage.local` deck + trang `src/flashcards`).

## Chia 2 đợt
- **Đợt 1 — Trong trang Flashcards** (tự chứa, không cần quyền mới): import/export, chủ đề,
  ảnh minh hoạ, chế độ ôn (gồm ôn lại đã học), nghe nhiều voice, tạo thẻ thủ công.
- **Đợt 2 — Nhắc nhở & củng cố** (cần quyền `alarms` + `notifications`): thông báo nhắc học,
  và toast "từ chưa thuộc" hiện 5–10s trên web.

---

## Đợt 1

### 1. Data model (types/index.ts)
`VocabCard` thêm:
- `topic?: string` — chủ đề (mặc định "Chung").
- `image?: string` — data URL ảnh **đã thu nhỏ** (~240px, JPEG q≈0.7 → vài KB).

`VocabCardInput` thêm `topic`, `image`. `AppSettings` thêm `ttsVoiceEn`, `ttsVoiceVi`,
`ttsRate` (số). Thêm message `IMPORT_VOCAB`.

> Ảnh chỉ lưu **cục bộ trong máy**, không gửi cho AI → **không tốn token**; thu nhỏ để
> nhẹ `storage.local`.

### 2. Export — nhiều định dạng (trang Flashcards)
- **CSV** (mở Excel/Google Sheets): header `term,meaning,ipa,example,topic,lang`, có quote.
- **JSON**: nguyên `VocabCard[]` kể cả SRS → **backup/khôi phục** chuẩn.
- **TSV** (Anki): giữ như hiện tại (`term ⭾ meaning · ipa · example`).
- Tải file bằng Blob + `<a download>`.

### 3. Import file (trang Flashcards + background)
- `<input type=file>` nhận `.csv/.tsv/.json`, tự nhận định dạng theo phần mở rộng/nội dung.
- Parser CSV nhỏ (chịu được dấu phẩy trong ngoặc kép). Map cột linh hoạt; tối thiểu cần
  `term` + `meaning`.
- Gửi `IMPORT_VOCAB {cards}`; background: item có `id`+`due` → giữ nguyên (restore JSON),
  còn lại → `createCard`. `storage.importVocabCards` đọc-ghi 1 lần, **dedupe** theo `term+lang`,
  trả `{added, skipped}`.

### 4. Phân loại theo chủ đề (topic)
- Khi lưu từ (bubble) → gán topic mặc định "Chung" (có thể đổi sau).
- Trang Flashcards: **dropdown lọc theo chủ đề** ở cả Danh sách và Ôn tập; sửa topic từng thẻ
  (inline select); danh sách chủ đề suy ra từ deck.

### 5. Ảnh minh hoạ
- Form thêm/sửa thẻ: upload ảnh → canvas thu nhỏ ≤240px → `toDataURL('image/jpeg', 0.7)` → lưu.
- Hiện thumbnail ở mặt sau thẻ (review) và trong danh sách. Nút xoá ảnh.

### 6. Chế độ ôn tập (gồm "ôn lại đã học")
- Bộ chọn chế độ: **Đến hạn (SRS)** / **Tất cả** / **Đã thuộc** (`reps ≥ 2`) / kết hợp lọc chủ đề.
- Phiên ôn xây theo `(mode, topic)`, duyệt theo index; chấm điểm vẫn cập nhật SRS + lưu.

### 7. Nghe nhiều voice (TTS)
- `speechSynthesis.getVoices()` (lắng nghe `onvoiceschanged`) → chọn giọng cho EN và VI +
  thanh chỉnh **tốc độ**. Lưu vào settings.
- Nút 🔊 ở mỗi thẻ (review + list) đọc theo giọng đã chọn. `content` `speak()` cũng dùng
  giọng/tốc độ này cho bubble (đồng bộ toàn app).

### 8. Tạo thẻ thủ công
- Tab/nút **➕ Tạo thẻ**: form term/meaning/ipa/example/topic/ảnh → `SAVE_VOCAB`.

### File đợt 1
`types`, `utils/srs.ts` (createCard nhận topic/image), `services/storage.ts`
(tts defaults + `importVocabCards`), `background/index.ts` (SAVE_VOCAB topic/image +
`IMPORT_VOCAB`), `src/flashcards/FlashcardsApp.tsx` + `flashcards.css` (rewrite lớn:
topic filter, review modes, add/edit form, ảnh, import/export, voice picker),
`content/index.tsx` (`speak()` dùng voice/rate).

---

## Đợt 2 — Nhắc nhở & củng cố (in-tab, KHÔNG cần quyền mới)

**Đã chốt:** nhắc nhở hiển thị **ngay trong tab đang dùng, mỗi 10 phút** — không phải system
notification → **không cần quyền `alarms`/`notifications`** (chỉ dùng `setInterval` +
kiểm tra tab đang hiển thị). Gộp cả "nhắc học" và "toast từ chưa thuộc" làm một.

### Toast nhắc học / từ chưa thuộc (content)
- Content script mỗi tab tự chạy interval **10 phút**; **chỉ hiện khi tab đang hiển thị**
  (`document.visibilityState === 'visible'` + có focus) → đúng "tab đang dùng".
- Mỗi lần hiện **toast 5–10s** ở góc, gồm: term + nghĩa + 🔊 nghe + nút **"Đã thuộc"**
  (chấm Good qua `UPDATE_VOCAB`) / **"Ẩn"**.
- Chọn thẻ: **thẻ đến hạn trước**, hết mới lấy **thẻ chưa thuộc (`reps < 2`) ngẫu nhiên**
  (đã chốt). Lấy qua message `GET_REMINDER_CARD` tới background.
- Không làm phiền: **không hiện khi đang focus ô nhập** (input/textarea/contenteditable);
  có **toggle bật/tắt** + ô chỉnh tần suất (mặc định 10 phút) trong settings.

### File đợt 2
`types` (message `GET_REMINDER_CARD` + settings `reminderEnabled`, `reminderIntervalMin`),
`storage.ts` (defaults), `background/index.ts` (chọn thẻ nhắc), `content/index.tsx`
(interval + toast tương tác, dùng `speak()` voice ở đợt 1).

---

## Thứ tự đề xuất
Đợt 1 trước (giá trị cao, không cần quyền), có thể chia nhỏ: (data model + import/export) →
(topics + ảnh + tạo thẻ) → (review modes + voices). Sau đó Đợt 2 (toast nhắc học in-tab).
