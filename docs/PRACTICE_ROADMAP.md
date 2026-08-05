# Roadmap — Luyện tập nâng cao (đã approve toàn bộ)

Tất cả tận dụng Gemini + Web Speech (TTS + SpeechRecognition) sẵn có; build tuần tự theo
thứ tự ưu tiên. Không cần quyền/nguồn ngoài mới (trừ optional video ở #3 Phase-2 cũ).

## Thứ tự build
1. 🤖 AI bạn hội thoại (free-talk) — 2. 📝 AI nhận xét — 3. 📇 Luyện từ sổ — 4. 🔤 Drill âm khó — 5. 📅 Thử thách hằng ngày — 6. 📈 Dashboard.

---

## 1. 🤖 AI bạn hội thoại (free-talk) — ưu tiên cao nhất
**Mục tiêu:** nói chuyện qua lại với AI theo tình huống → luyện phản xạ speaking thật.

**UX:** tab/nút "🤖 Trò chuyện" trên trang Practice. Chọn tình huống (dùng lại chip topic) →
vòng lặp: **bạn nói (SR) → transcript + lịch sử hội thoại gửi Gemini → AI trả lời trong vai,
đúng level, 1–2 câu → TTS đọc → lặp**. Hiện khung chat (bong bóng). Nút kết thúc + xem tóm tắt.

**Contract:** message `CHAT_TURN { messages: [{role:'user'|'assistant', text}], topic, level }`
→ `{ reply: string, correction?: string }`. System prompt: "Bạn là người bản xứ đang trò chuyện
với người học trình độ X về chủ đề Y. Trả lời tự nhiên, ngắn, giữ mạch hội thoại; nếu câu người
học sai rõ, thêm 1 dòng sửa ngắn." Non-JSON hoặc JSON nhỏ; reuse provider chain.

**File:** `background` (`handleChatTurn`), `constants` (CHAT prompt), `practice/ChatMode.tsx` (mới)
+ nút mở, reuse `speech.ts` + `speak()`.

## 2. 📝 AI nhận xét phát âm/ngữ pháp
**Mục tiêu:** sau khi nói, được sửa nhẹ nhàng như gia sư.

**UX:** nút **"📝 Nhận xét"** xuất hiện sau khi chấm điểm ở `PracticeLine` và role-play. Gửi
`{ target, said }` cho Gemini → trả về: điểm mạnh, lỗi phát âm/ngữ pháp, cách nói hay hơn (ngắn,
tiếng Việt). Hiện inline dưới câu.

**Contract:** `ANALYZE_SPEAKING { target, said } → { feedback: string }`.
**File:** `background` handler + prompt; `PracticeApp` thêm nút + chỗ hiển thị.

## 3. 📇 Luyện nói từ sổ của tôi
**Mục tiêu:** ôn từ đã lưu bằng cách nói (flashcards → speaking).

**UX:** trên Practice, nút "📇 Từ sổ của tôi" → chọn chủ đề-trong-sổ hoặc "từ đến hạn" → sinh
mẫu câu/hội thoại **dùng chính các từ đó**.

**Contract:** biến thể `GENERATE_PRACTICE { topic, level, words?: string[] }` — khi có `words`,
prompt yêu cầu dùng các từ này. Lấy từ deck qua `GET_VOCAB`.
**File:** `constants` (nhánh prompt), `background` (thêm `words` vào text), `PracticeApp` (chọn nguồn).

## 4. 🔤 Drill âm người Việt hay sai
**Mục tiêu:** luyện `th`, `-ed/-s`, phụ âm cuối, `r/l`…

**UX:** chọn âm → Gemini sinh **minimal pairs + câu chứa âm** → SR chấm từng từ (đã có scoring).
**Contract:** `GENERATE_DRILL { sound } → { pairs:[{a,b}], sentences:[...] }`.
**File:** `background` handler + prompt; `practice/Drill.tsx` (hoặc section trong Practice).

## 5. 📅 Thử thách hằng ngày (+ nhắc học)
**Mục tiêu:** thói quen hằng ngày, tăng streak.

**UX:** nút "📅 Thử thách hôm nay" → chủ đề theo ngày (deterministic theo date) → sinh bài. Tích hợp
**toast nhắc học sẵn có**: thêm biến thể toast "Luyện nói hôm nay?" mở trang Practice. Lưu ngày đã
hoàn thành (streak dùng `practiceStats` sẵn có).
**File:** `PracticeApp` (topic-of-day), `content` (toast biến thể mở practice), settings nhỏ.

## 6. 📈 Dashboard tiến độ
**Mục tiêu:** thấy tiến bộ → có động lực.

**UX:** mở rộng `practiceStats` thành **theo ngày** `{ byDay: { 'YYYY-MM-DD': {attempts,sumScore} } }`
→ biểu đồ cột 14 ngày + tổng câu luyện + điểm TB + từ hay sai (thu thập từ token miss). Đặt ở
đầu trang Practice hoặc tab riêng.
**File:** `PracticeApp` (record theo ngày + chart SVG nhỏ, không cần lib).

---

## Ghi chú kỹ thuật chung
- Các handler mới đều **reuse** `buildProviderList` + `callProvider` + `extractJson` + cache.
- Speaking dựa `SpeechRecognition` — có fallback nếu bị chặn; Listening/Chat-text vẫn chạy.
- Mỗi mục build xong → build + commit riêng (1 commit/mục) để dễ theo dõi.
