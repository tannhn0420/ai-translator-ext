# AI Translator - Requirements Specification

## 1. Product Overview

### 1.1 Vision
Chrome Extension sử dụng Google Gemini API để dịch trang web với chất lượng AI vượt trội so với Google Translate truyền thống. AI hiểu ngữ cảnh, thành ngữ, và văn phong nên cho ra bản dịch tự nhiên hơn.

### 1.2 Target Users
- Người Việt đọc trang web tiếng Anh
- Developers đọc documentation tiếng Anh
- Người học tiếng Anh muốn so sánh bản gốc và bản dịch
- Content creators cần dịch nội dung chất lượng cao

## 2. Functional Requirements

### 2.1 Core Translation Features

#### F1: Highlight & Translate (Content Script)
- **F1.1**: Khi user highlight (select) text trên bất kỳ trang web nào, hiện tooltip/bubble với bản dịch
- **F1.2**: Auto-detect ngôn ngữ nguồn (EN/VI) và dịch sang ngôn ngữ đích tương ứng
- **F1.3**: Hiển thị bản dịch trong floating panel ngay cạnh vùng highlight
- **F1.4**: Cho phép copy bản dịch nhanh bằng 1 click
- **F1.5**: Hỗ trợ dịch từ đơn lẻ, câu, đoạn văn
- **F1.6**: Hiển thị loading state khi đang dịch

#### F2: Full Page Translation
- **F2.1**: Nút "Dịch toàn trang" trong popup extension
- **F2.2**: Thay thế text gốc bằng bản dịch (toggle được)
- **F2.3**: Giữ nguyên format, layout, images của trang gốc
- **F2.4**: Cho phép toggle giữa bản gốc và bản dịch
- **F2.5**: Progress indicator khi đang dịch toàn trang

#### F3: Popup Translation Panel
- **F3.1**: Input textarea để user paste/type text cần dịch
- **F3.2**: Output textarea hiển thị kết quả dịch
- **F3.3**: Nút swap ngôn ngữ (EN ↔ VI)
- **F3.4**: Translation history (recent 20 translations)
- **F3.5**: Copy result button

### 2.2 AI Customization Features

#### F4: Custom System Prompt
- **F4.1**: Input cho user define system prompt (AI persona/behavior)
- **F4.2**: Preset prompts có sẵn:
  - "Dịch chính xác, giữ nguyên thuật ngữ kỹ thuật"
  - "Dịch tự nhiên, dễ hiểu cho người mới"
  - "Dịch văn học, giữ văn phong"
  - "Dịch technical documentation"
- **F4.3**: Cho phép save/load multiple custom prompts
- **F4.4**: Preview prompt effect trước khi apply

#### F5: Translation Prompt Template
- **F5.1**: Input cho phần dịch thuật cụ thể (translation instruction)
- **F5.2**: Variables hỗ trợ: `{text}`, `{source_lang}`, `{target_lang}`
- **F5.3**: Default template có sẵn, user có thể customize

### 2.3 Settings & Configuration

#### F6: API Configuration
- **F6.1**: Input Gemini API key
- **F6.2**: Validate API key khi save
- **F6.3**: Model selection (gemini-2.0-flash default, gemini-2.0-pro optional)
- **F6.4**: API usage tracking (requests count)

#### F7: Language Settings
- **F7.1**: Default source language (Auto-detect / EN / VI)
- **F7.2**: Default target language (VI / EN)
- **F7.3**: Quick swap button

#### F8: Behavior Settings
- **F8.1**: Auto-translate on highlight (on/off)
- **F8.2**: Show translation bubble (on/off)
- **F8.3**: Keyboard shortcut configuration
- **F8.4**: Translation bubble position (above/below selection)

## 3. Non-Functional Requirements

### 3.1 Performance
- Translation response: < 2 seconds for sentences
- Extension load time: < 500ms
- Memory usage: < 50MB
- No impact on page rendering performance

### 3.2 Security
- API key stored securely in chrome.storage.sync
- No data sent to third-party servers (only Gemini API)
- Content Security Policy compliant

### 3.3 Compatibility
- Chrome 88+ (Manifest V3 support)
- All websites (including SPAs, dynamic content)
- Responsive popup (works on different screen sizes)

### 3.4 Usability
- Intuitive UI, minimal learning curve
- Bilingual interface (EN/VI)
- Keyboard accessible
- Clear error messages

## 4. User Stories

### US1: Quick Translation
> Là một developer, tôi muốn highlight đoạn code comment tiếng Anh và thấy bản dịch tiếng Việt ngay lập tức, để tôi hiểu nhanh mà không cần rời trang.

### US2: Custom AI Behavior
> Là một translator chuyên nghiệp, tôi muốn define prompt riêng cho AI, ví dụ "dịch theo phong cách báo chí", để AI dịch đúng tone tôi cần.

### US3: Full Page Reading
> Là một sinh viên, tôi muốn dịch toàn bộ bài báo tiếng Anh sang tiếng Việt để đọc hiểu nhanh hơn, với khả năng toggle xem bản gốc.

### US4: API Setup
> Là một user mới, tôi muốn setup API key dễ dàng với hướng dẫn rõ ràng, và biết ngay API key có hợp lệ hay không.

## 5. MVP Scope (Phase 1-3)

### Must Have (MVP)
- [x] Chrome Extension setup với Manifest V3
- [ ] Popup với translation input/output
- [ ] Highlight text → show translation bubble
- [ ] Gemini API integration
- [ ] API key configuration
- [ ] Custom system prompt
- [ ] EN ↔ VI language swap

### Should Have (Post-MVP)
- [ ] Full page translation
- [ ] Translation history
- [ ] Multiple saved prompts
- [ ] Keyboard shortcuts

### Nice to Have (Future)
- [ ] More language pairs
- [ ] Offline cache for common translations
- [ ] Export translation history
- [ ] Side-by-side comparison view
