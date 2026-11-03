# ⚡ Zalo Gateway

<div align="center">

![Go Version](https://img.shields.io/badge/Go-1.22%2B-00ADD8?style=flat&logo=go)
![Port](https://img.shields.io/badge/Port-54321-orange?style=flat)
![Protocol](https://img.shields.io/badge/Protocol-HTTP%20%7C%20WebSocket%20%7C%20Webhook-blue?style=flat)
![AI Ready](https://img.shields.io/badge/AI%20Agent-Antigravity%20%7C%20Claude%20%7C%20n8n-green?style=flat)
![License](https://img.shields.io/badge/License-MIT-purple?style=flat)

**High-performance Native Go Gateway & Web Client for Zalo Personal Accounts**  
*Solve the 1-session Zalo Web limit • Real-time Web Client • REST API • Outbound Webhooks • Multi-Agent Automation*

[English](docs/TECHNICAL_SPEC.md) • [Hướng Dẫn Tiếng Việt](#-tổng-quan) • [Agent Guide](docs/agent-guide.md) • [OpenAPI 3.0](docs/openapi.json)

</div>

---

## 💡 Bài toán & Giải pháp (The Problem & Solution)

### Vấn đề của Zalo Web
Mặc định, Zalo chỉ cho phép **1 phiên đăng nhập trên trình duyệt (`chat.zalo.me`)**. Nếu bạn mở Zalo Web ở máy thứ 2 (hoặc một tool automation đăng nhập vào Zalo Web), máy thứ 1 sẽ lập tức bị **đăng xuất (đá phiên)**. Điều này gây khó khăn khi:
- Bạn muốn dùng Zalo trên nhiều máy tính/laptop cùng lúc.
- Bạn muốn tích hợp AI Agent, chatbot hoặc workflow tự động hóa (n8n, Make, CRM) mà không làm gián đoạn việc nhắn tin của bản thân.

### Giải pháp: Zalo Gateway
**Zalo Gateway** là một máy chủ trung gian hiệu năng cao viết bằng **Go native**, chạy độc lập trên cổng 5 chữ số **`54321`**:
1. **Duy trì 1 phiên Zalo duy nhất ngầm định**: Kết nối với daemon Zalo để duy trì session.
2. **Giao diện Web Client riêng biệt**: Tích hợp sẵn Web UI hiện đại (Single Page App) nhúng thẳng trong file thực thi Go. Bạn có thể mở link này trên **bao nhiêu máy tính, điện thoại cũng được mà KHÔNG BAO GIỜ bị Zalo đá phiên**.
3. **Cổng tự động hóa toàn diện (Automation Hub)**: Cung cấp đầy đủ **REST API**, **WebSocket hai chiều**, và **Webhooks** (có xác thực HMAC-SHA256) cho n8n, Make, Python, AI Agent.

---

## 🏛️ Kiến trúc Hệ thống (Architecture)

```
                    ┌──────────────────────────────────────────────┐
                    │             Zalo Servers (VNG)               │
                    └──────────────────────▲───────────────────────┘
                                           │ Duy trì 1 phiên duy nhất (session)
                    ┌──────────────────────▼───────────────────────┐
                    │      Zalo Gateway (Go Native - Port 54321)   │
                    │   - Embedded Web UI (SPA)                    │
                    │   - WebSocket Hub (Bi-directional)           │
                    │   - REST API (/api/v1)                       │
                    │   - Webhook Dispatcher (HMAC-SHA256)         │
                    └──────▲───────────────▲───────────────▲───────┘
                           │               │               │
        ┌──────────────────▼────┐   ┌──────▼──────┐   ┌────▼─────────────────┐
        │    Web UI Client      │   │  Webhooks   │   │  Autonomous Agents   │
        │ (Mở trên mọi thiết bị │   │  n8n / Make │   │  Antigravity, Claude │
        │    không bị văng)     │   │  Automation │   │  OpenAPI 3.0 Specs   │
        └───────────────────────┘   └─────────────┘   └──────────────────────┘
```

---

## 🚀 Tính năng Nổi bật (Key Features)

* **⚡ Go Native Siêu Nhẹ & Nhanh**: Khởi động tức thì (< 20ms), tiêu thụ chỉ ~15MB RAM.
* **🌐 Web Client nhúng sẵn**: Sử dụng Go `embed.FS`, không cần cài thêm Node.js hay Nginx để chạy giao diện web.
* **🔄 WebSocket Thời Gian Thực**: Tin nhắn gửi và nhận được cập nhật tức thì tới mọi trình duyệt đang mở.
* **🪝 Outbound Webhooks**: Tự động bắn POST request (kèm chữ ký bảo mật `X-Zalo-Signature: sha256=...`) tới các webhook của n8n, Make, Flowise khi có tin nhắn mới.
* **🤖 Thân thiện với AI Agent & LLMs**:
  * Chuẩn **OpenAPI 3.0** tại `/api/v1/openapi.json`.
  * Tài liệu chuẩn LLM tại `/llms.txt`.
  * Tài liệu hướng dẫn riêng cho Agent tại `/agent-guide.md`.
* **🔒 An toàn & Bảo mật**: Cho phép đặt secret key ký HMAC, hỗ trợ CORS, chạy mạng nội bộ hoặc qua Cloudflare Tunnel / Tailscale.

---

## 🛠️ Cài đặt & Khởi chạy (Quick Start)

### 1. Yêu cầu
- Đã cài đặt Go 1.22+ (đối với build từ nguồn).
- Daemon nền Zalo đang chạy (ví dụ `zalo-personal-ai-agent` trên port `39123`).

### 2. Cài đặt nhanh qua 1 dòng lệnh
```bash
git clone https://github.com/giangsamne/zalo-gateway.git
cd zalo-gateway
go build -o zalo-gateway .
./zalo-gateway
```

### 3. Tùy chọn tham số
```bash
./zalo-gateway -port 54321 -daemon http://127.0.0.1:39123 -config webhooks.json
```
Hoặc dùng biến môi trường:
```bash
PORT=54321 DAEMON_URL=http://127.0.0.1:39123 ./zalo-gateway
```

Sau khi chạy, mở trình duyệt:
* 🌐 **Web Chat Client**: `http://localhost:54321/`
* 📊 **API Status**: `http://localhost:54321/api/v1/status`
* 📖 **Agent Guide**: `http://localhost:54321/agent-guide.md`
* 📋 **OpenAPI Specification**: `http://localhost:54321/api/v1/openapi.json`

---

## 📡 REST API Reference

### 1. Kiểm tra trạng thái
```http
GET /api/v1/status
```
```json
{
  "status": "running",
  "port": 54321,
  "connected": true,
  "own_id": "1842365959181420185",
  "uptime_seconds": 3600,
  "total_messages": 42,
  "active_webhooks": 1
}
```

### 2. Lấy danh sách hội thoại
```http
GET /api/v1/threads
```

### 3. Lấy tin nhắn
```http
GET /api/v1/messages?thread_id=1842365959181420185&limit=20
```

### 4. Gửi tin nhắn
```http
POST /api/v1/send
Content-Type: application/json

{
  "thread_id": "1842365959181420185",
  "message": "Xin chào từ hệ thống tự động!",
  "is_group": false
}
```

### 5. Đăng ký Webhook
```http
POST /api/v1/webhooks
Content-Type: application/json

{
  "url": "https://your-n8n-instance.com/webhook/zalo",
  "secret": "my-shared-secret",
  "events": ["message.received"]
}
```

---

## 🤖 Tích hợp AI Agent & Tự Động Hóa (Automation)

### Tích hợp n8n Workflow
1. Thêm node **Webhook** trong n8n (POST method).
2. Dán webhook URL của n8n vào Zalo Gateway qua giao diện Web hoặc gọi API `POST /api/v1/webhooks`.
3. Khi khách nhắn tin tới Zalo, n8n nhận payload:
```json
{
  "event": "message.received",
  "timestamp": 1793718950000,
  "data": {
    "id": "8448...",
    "threadId": "1842365959181420185",
    "isGroup": false,
    "senderName": "Nguyễn Văn A",
    "content": "Giá khóa học bao nhiêu vậy shop?"
  }
}
```
4. Dùng node **AI Agent** trong n8n xử lý câu trả lời rồi gọi lại `POST http://localhost:54321/api/v1/send` để trả lời khách hàng ngay lập tức!

---

## ⚙️ Chạy tự động cùng hệ thống (systemd)

Tạo file dịch vụ `/etc/systemd/system/zalo-gateway.service`:
```ini
[Unit]
Description=Zalo Gateway - Multi-Session Web & Automation Hub
After=network.target

[Service]
Type=simple
User=giang3dlab
WorkingDirectory=/home/giang3dlab/apps/zalo-gateway
ExecStart=/home/giang3dlab/apps/zalo-gateway/zalo-gateway -port 54321
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Kích hoạt:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now zalo-gateway.service
```

---

## 📄 Bản quyền (License)
Dự án được phân phối dưới giấy phép **MIT License**.
Phát triển bởi **Giang3DLab** ([@giangsamne](https://github.com/giangsamne)).
