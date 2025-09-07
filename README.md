# TruCy Checker (lite)

Một bản minimal để anh **deploy nhanh** lên Vercel: dán tên token/contract ⇒ phân tích nhanh (chọn cặp có thanh khoản nhất trên Dexscreener) + gợi ý LONG/SHORT kèm Entry/SL/TP dựa trên EMA20/EMA50 & ATR14 (khung 15m).

## Chạy local
```bash
npm i
npm run dev
# mở http://localhost:5173
```

## Deploy lên Vercel (đơn giản nhất)
1. Tạo repo GitHub mới, upload toàn bộ mã nguồn này.
2. Vào https://vercel.com → New Project → Import repo → chọn **Framework: Vite** (tự detect), lệnh build: `npm run build`, output: `dist`.
3. Deploy là xong.

> Bản này dùng Tailwind CDN trong `index.html` để triển khai nhanh, nên không cần cài tailwind trong build.
