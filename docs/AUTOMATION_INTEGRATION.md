# Automation & Integration Guide - Zalo Gateway

This document provides concrete, copy-pasteable examples for integrating Zalo Gateway into popular automation tools, programming languages, and AI agents.

---

## 1. n8n Integration

### Step-by-Step
1. In your n8n workflow canvas, create a **Webhook** node.
   - HTTP Method: `POST`
   - Path: `zalo-inbound`
2. Copy the Webhook URL from n8n (e.g. `http://localhost:5678/webhook/zalo-inbound`).
3. Register the webhook in Zalo Gateway:
```bash
curl -X POST http://localhost:54321/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:5678/webhook/zalo-inbound",
    "secret": "my-n8n-secret",
    "events": ["message.received"]
  }'
```
4. In n8n, add an **HTTP Request** node to reply back when desired:
   - Method: `POST`
   - URL: `http://localhost:54321/api/v1/send`
   - Body Parameters:
     - `thread_id`: `{{ $json.body.data.threadId }}`
     - `message`: `Cảm ơn bạn! Đơn hàng của bạn đang được xử lý.`
     - `is_group`: `{{ $json.body.data.isGroup }}`

---

## 2. Python Script Integration

```python
import requests
import json

GATEWAY_URL = "http://localhost:54321"

def check_status():
    resp = requests.get(f"{GATEWAY_URL}/api/v1/status")
    return resp.json()

def send_message(thread_id: str, message: str, is_group: bool = False):
    payload = {
        "thread_id": thread_id,
        "message": message,
        "is_group": is_group
    }
    resp = requests.post(f"{GATEWAY_URL}/api/v1/send", json=payload)
    return resp.json()

if __name__ == "__main__":
    print("Gateway Status:", check_status())
    res = send_message("1842365959181420185", "Hello from Python automation!")
    print("Send result:", res)
```

---

## 3. Node.js / TypeScript Integration

```typescript
const GATEWAY_URL = "http://localhost:54321";

async function sendZalo(threadId: string, message: string, isGroup = false) {
  const res = await fetch(`${GATEWAY_URL}/api/v1/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      thread_id: threadId,
      message,
      is_group: isGroup
    })
  });
  return await res.json();
}

sendZalo("1842365959181420185", "Hello from Node.js!").then(console.log);
```

---

## 4. cURL & Bash Scripting

Send an automated alert (e.g. from a cronjob or backup script):
```bash
#!/usr/bin/env bash
THREAD_ID="1842365959181420185"
MESSAGE="⚠️ [Alert] Backup hoàn tất lúc $(date)!"

curl -s -X POST http://localhost:54321/api/v1/send \
  -H "Content-Type: application/json" \
  -d "{\"thread_id\": \"$THREAD_ID\", \"message\": \"$MESSAGE\", \"is_group\": false}"
```
