# Zalo Gateway - Technical Specification

## 1. System Objective
Zalo Web (`chat.zalo.me`) enforces a single active browser session per personal account. Concurrent logins from multiple physical workstations or automated applications result in immediate session eviction.

**Zalo Gateway** solves this limitation by acting as a native Go proxy & relay server:
- Bridges to the core authentication & session engine.
- Exposes an embedded, responsive Web Chat interface.
- Exposes a bidirectional WebSocket endpoint (`/ws`).
- Exposes RESTful CRUD endpoints (`/api/v1/*`).
- Manages an asynchronous Webhook dispatcher with HMAC-SHA256 signature verification.

---

## 2. Component Design

```
+-----------------------------------------------------------+
|                       Zalo Gateway                        |
|                                                           |
|  +--------------------+     +--------------------------+  |
|  |   HTTP API & WS    |     |    Embedded Web UI       |  |
|  |   Port :54321      |     |    (HTML5/CSS/JS)        |  |
|  +---------+----------+     +------------+-------------+  |
|            |                             |                |
|  +---------v-----------------------------v-------------+  |
|  |                WebSocket Hub                        |  |
|  +-------------------------+---------------------------+  |
|                            |                              |
|  +-------------------------v---------------------------+  |
|  |                 Zalo Bridge                         |  |
|  |      In-Memory Cache & Message Aggregator           |  |
|  +-------------------------+---------------------------+  |
|                            |                              |
|  +-------------------------v---------------------------+  |
|  |             Webhook Dispatch Engine                 |  |
|  |         (Non-blocking Worker Pool)                  |  |
|  +-----------------------------------------------------+  |
+-----------------------------------------------------------+
```

### 2.1 Concurrency Model
- **Go Goroutines**: Each incoming WebSocket connection runs dedicated read and write pumps, decoupled by buffered Go channels (`chan []byte, 256`).
- **Mutex Guards**: Thread and message caches are protected by `sync.RWMutex` to ensure thread-safe concurrent reads by REST endpoints and WebSockets while writer goroutines sync from the daemon.
- **Asynchronous Webhooks**: Outbound HTTP requests to external webhook subscribers are dispatched in dedicated goroutines with an explicit 8-second HTTP client timeout.

### 2.2 Webhook Security: HMAC-SHA256
When a webhook is registered with a `secret`, each outbound payload contains the header:
```http
X-Zalo-Signature: sha256=<hex_digest>
```
The signature is calculated as:
```go
mac := hmac.New(sha256.New, []byte(secret))
mac.Write(rawBodyBytes)
expectedSignature := hex.EncodeToString(mac.Sum(nil))
```

---

## 3. Storage and Persistence
- **Config & Webhooks**: Stored in JSON format at `webhooks.json` (configurable via `-config`).
- **Messages**: Kept in an in-memory ring buffer (up to 500 recent messages) and continuously synced with the daemon.
