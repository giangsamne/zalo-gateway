# AI Agent Integration Guide - Zalo Gateway

This guide is designed for Autonomous AI Agents (e.g. Google Antigravity, Claude, AutoGen, CrewAI, LangChain, or custom LLM bots) to integrate and automate actions on Zalo without triggering session kicks or account bans.

---

## 1. Architecture Overview
Standard Zalo Web (`chat.zalo.me`) permits only **one active web browser session** per account. When an automated bot logs into Zalo Web, human users get logged out.

**Zalo Gateway** solves this by:
- Acting as a single persistent daemon session.
- Exposing a local Go-native HTTP & WebSocket server on a 5-digit port (`54321`).
- Allowing both humans (via the embedded Web UI) and AI agents (via REST / Webhook / WebSocket) to interact concurrently.

---

## 2. API Reference for Agents

### Check Status
```http
GET /api/v1/status
```
**Response (200 OK):**
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

---

### Send a Message
```http
POST /api/v1/send
Content-Type: application/json

{
  "thread_id": "1842365959181420185",
  "message": "Hello from AI Agent! Your task has finished.",
  "is_group": false
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "message_id": "self_1793718900"
}
```

---

### Query Messages
```http
GET /api/v1/messages?thread_id=1842365959181420185&limit=10
```

---

### Register a Webhook for Autonomous Triggering
```http
POST /api/v1/webhooks
Content-Type: application/json

{
  "url": "http://localhost:5678/webhook/zalo-agent",
  "secret": "agent_token_here",
  "events": ["message.received"]
}
```
Whenever an incoming message arrives, the gateway sends a POST request with:
```json
{
  "event": "message.received",
  "timestamp": 1793718950000,
  "data": {
    "id": "8448...",
    "threadId": "1842365959181420185",
    "isGroup": false,
    "isSelf": false,
    "senderId": "1842365959181420185",
    "senderName": "Nguyễn Văn A",
    "content": "Giá gói cước bao nhiêu bạn ơi?",
    "timestamp": 1793718950000,
    "isoTime": "21:40:06 03/11/2026"
  }
}
```

If `secret` is set, the request includes the header:
`X-Zalo-Signature: sha256=<hex_hmac_sha256>`
