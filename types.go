package main

import "time"

// Message represents a single Zalo chat message.
type Message struct {
	ID         string `json:"id"`
	ThreadID   string `json:"threadId"`
	IsGroup    bool   `json:"isGroup"`
	IsSelf     bool   `json:"isSelf"`
	SenderID   string `json:"senderId"`
	SenderName string `json:"senderName"`
	Content    string `json:"content"`
	Timestamp  int64  `json:"timestamp"`
	ISOTime    string `json:"isoTime"`
	Read       bool   `json:"read"`
}

// Thread represents a conversation thread (single person or group).
type Thread struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	IsGroup       bool   `json:"isGroup"`
	LastMessage   string `json:"lastMessage"`
	LastSender    string `json:"lastSender"`
	LastTimestamp int64  `json:"lastTimestamp"`
	LastISOTime   string `json:"lastIsoTime"`
	UnreadCount   int    `json:"unreadCount"`
}

// SendMessageRequest is the payload to send a message via REST or WebSocket.
type SendMessageRequest struct {
	ThreadID string `json:"thread_id"`
	Message  string `json:"message"`
	IsGroup  bool   `json:"is_group"`
}

// SendMessageResponse is the result of sending a message.
type SendMessageResponse struct {
	Success   bool   `json:"success"`
	MessageID string `json:"message_id,omitempty"`
	Error     string `json:"error,omitempty"`
}

// Webhook defines an automated subscriber endpoint.
type Webhook struct {
	ID              string     `json:"id"`
	URL             string     `json:"url"`
	Secret          string     `json:"secret,omitempty"`
	Events          []string   `json:"events"` // e.g. ["message.received", "message.sent"]
	CreatedAt       time.Time  `json:"created_at"`
	LastTriggeredAt *time.Time `json:"last_triggered_at,omitempty"`
	SuccessCount    int        `json:"success_count"`
	FailureCount    int        `json:"failure_count"`
}

// WebhookPayload represents the event body delivered to webhook URLs.
type WebhookPayload struct {
	Event     string      `json:"event"`
	Timestamp int64       `json:"timestamp"`
	Data      interface{} `json:"data"`
}

// GatewayStatus represents system health and metrics.
type GatewayStatus struct {
	Status          string `json:"status"`
	Port            int    `json:"port"`
	Connected       bool   `json:"connected"`
	OwnID           string `json:"own_id,omitempty"`
	MasterUID       string `json:"master_uid,omitempty"`
	UptimeSeconds   int64  `json:"uptime_seconds"`
	TotalMessages   int    `json:"total_messages"`
	ActiveWebhooks  int    `json:"active_webhooks"`
	ActiveSockets   int    `json:"active_websockets"`
	DaemonEndpoint  string `json:"daemon_endpoint"`
	Version         string `json:"version"`
}

// QRLoginStatus represents real-time Zalo QR login state.
type QRLoginStatus struct {
	Status        string      `json:"status"` // "idle", "generating", "qr_ready", "scanned", "expired", "declined", "success"
	QRCode        string      `json:"qr_code,omitempty"`
	QRImageBase64 string      `json:"qr_image_base64,omitempty"`
	ScannedUser   interface{} `json:"scanned_user,omitempty"`
	UpdatedAt     int64       `json:"updated_at"`
	Error         string      `json:"error,omitempty"`
}

// WSMessage is the transport envelope for WebSocket frames.
type WSMessage struct {
	Type string      `json:"type"` // "message_received", "message_sent", "status_updated", "init"
	Data interface{} `json:"data"`
}
