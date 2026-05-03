# 🌐 AI Translator - Chrome Extension

Dịch trang web EN ↔ VI với chất lượng AI sử dụng Google Gemini API.

## ✨ Tính năng

- **🔤 Dịch trong Popup**: Nhập text → dịch ngay với AI
- **✏️ Highlight & Dịch**: Bôi đen text trên bất kỳ trang web → hiện bubble dịch
- **🤖 Custom Prompt**: Tùy chỉnh cách AI dịch (4 preset + tự viết)
- **🔄 EN ↔ VI**: Chuyển đổi nhanh giữa Anh → Việt và ngược lại
- **📋 Copy nhanh**: Copy bản dịch 1 click
- **⚡ Gemini 2.0 Flash**: Dịch nhanh, chính xác

## 🚀 Cài đặt

### 1. Lấy API Key
Truy cập [Google AI Studio](https://aistudio.google.com/apikey) → Tạo API key miễn phí

### 2. Build Extension
```bash
npm install
npm run build
```

### 3. Load vào Chrome
1. Mở Chrome → `chrome://extensions`
2. Bật **Developer mode** (góc trên phải)
3. Click **Load unpacked**
4. Chọn thư mục `dist/`

### 4. Cấu hình
1. Click icon extension → ⚙️ Settings
2. Nhập API Key → Click "Kiểm tra & Lưu"
3. Tùy chỉnh prompt nếu cần

## 🛠️ Development

```bash
# Chạy dev server (HMR)
npm run dev

# Build production
npm run build

# Lint
npm run lint
```

## 📁 Cấu trúc

```
src/
├── App.tsx              # Popup chính
├── background/          # Service worker
├── content/             # Content script (highlight & bubble)
├── options/             # Trang cài đặt
├── services/            # Gemini API, Chrome storage
├── types/               # TypeScript types
└── utils/               # Constants, presets
```

## ⚙️ Tech Stack

- React 19 + TypeScript
- Vite 8 + @crxjs/vite-plugin
- Chrome Manifest V3
- Google Gemini 2.0 Flash API
- Vanilla CSS (dark theme, glassmorphism)

## 📝 License

MIT
