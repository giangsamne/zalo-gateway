package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"
)

type ZaloBridge struct {
	mu             sync.RWMutex
	daemonURL      string
	connected      bool
	ownID          string
	masterUID      string
	messages       []Message
	seenMessageIDs map[string]bool
	threads        map[string]*Thread
	hub            *Hub
	webhookMgr     *WebhookManager
	httpClient     *http.Client
	startTime      time.Time
	lastQRStatus   string
}

func NewZaloBridge(daemonURL string, webhookMgr *WebhookManager) *ZaloBridge {
	return &ZaloBridge{
		daemonURL:      daemonURL,
		seenMessageIDs: make(map[string]bool),
		threads:        make(map[string]*Thread),
		webhookMgr:     webhookMgr,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		startTime: time.Now(),
	}
}

func (b *ZaloBridge) SetHub(hub *Hub) {
	b.hub = hub
}

func (b *ZaloBridge) Start() {
	go b.pollLoop()
}

func (b *ZaloBridge) pollLoop() {
	ticker := time.NewTicker(1500 * time.Millisecond)
	defer ticker.Stop()

	// Initial fetch
	b.syncStatus()
	b.syncMessages()

	for range ticker.C {
		b.syncStatus()
		b.syncMessages()
	}
}

func (b *ZaloBridge) syncStatus() {
	resp, err := b.httpClient.Get(fmt.Sprintf("%s/status", b.daemonURL))
	if err != nil {
		b.mu.Lock()
		b.connected = false
		b.mu.Unlock()
		return
	}
	defer resp.Body.Close()

	var data struct {
		Connected bool   `json:"connected"`
		OwnID     string `json:"ownId"`
		MasterUID string `json:"masterUid"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err == nil {
		b.mu.Lock()
		prevConn := b.connected
		b.connected = data.Connected
		b.ownID = data.OwnID
		b.masterUID = data.MasterUID
		changed := prevConn != b.connected
		b.mu.Unlock()

		if changed && b.hub != nil {
			b.hub.Broadcast("status_updated", b.GetStatus())
			b.webhookMgr.Dispatch("status.changed", b.GetStatus())
		}
	}

	// If not connected, check QR updates
	if !b.connected {
		if qr, err := b.GetQRStatus(); err == nil {
			b.mu.Lock()
			qrChanged := b.lastQRStatus != qr.Status
			b.lastQRStatus = qr.Status
			b.mu.Unlock()

			if qrChanged && b.hub != nil {
				b.hub.Broadcast("qr_updated", qr)
			}
		}
	}
}

func (b *ZaloBridge) syncMessages() {
	resp, err := b.httpClient.Get(fmt.Sprintf("%s/messages?limit=50", b.daemonURL))
	if err != nil {
		return
	}
	defer resp.Body.Close()

	var fetched []Message
	if err := json.NewDecoder(resp.Body).Decode(&fetched); err != nil {
		return
	}

	b.mu.Lock()
	newIncoming := make([]Message, 0)
	for _, m := range fetched {
		if !b.seenMessageIDs[m.ID] {
			b.seenMessageIDs[m.ID] = true
			b.messages = append(b.messages, m)
			b.updateThreadLocked(m)
			newIncoming = append(newIncoming, m)
		}
	}
	b.mu.Unlock()

	// Notify for each new message
	for _, msg := range newIncoming {
		if b.hub != nil {
			b.hub.Broadcast("message_received", msg)
		}
		b.webhookMgr.Dispatch("message.received", msg)
	}
}

func (b *ZaloBridge) updateThreadLocked(m Message) {
	thread, exists := b.threads[m.ThreadID]
	if !exists {
		name := m.SenderName
		if name == "" {
			name = fmt.Sprintf("Người dùng (%s)", m.ThreadID)
		}
		thread = &Thread{
			ID:      m.ThreadID,
			Name:    name,
			IsGroup: m.IsGroup,
		}
		b.threads[m.ThreadID] = thread
	}

	if !m.IsSelf && m.SenderName != "" {
		thread.Name = m.SenderName
	}
	thread.LastMessage = m.Content
	thread.LastSender = m.SenderName
	thread.LastTimestamp = m.Timestamp
	thread.LastISOTime = m.ISOTime
	if !m.Read && !m.IsSelf {
		thread.UnreadCount++
	}
}

func (b *ZaloBridge) GetMessages(threadID string, limit int) []Message {
	b.mu.RLock()
	defer b.mu.RUnlock()

	var result []Message
	for _, m := range b.messages {
		if threadID == "" || m.ThreadID == threadID {
			result = append(result, m)
		}
	}

	if limit > 0 && len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result
}

func (b *ZaloBridge) GetThreads() []*Thread {
	b.mu.RLock()
	defer b.mu.RUnlock()

	list := make([]*Thread, 0, len(b.threads))
	for _, t := range b.threads {
		list = append(list, t)
	}

	sort.Slice(list, func(i, j int) bool {
		return list[i].LastTimestamp > list[j].LastTimestamp
	})
	return list
}

func (b *ZaloBridge) SendMessage(threadID, message string, isGroup bool) (*SendMessageResponse, error) {
	payload := map[string]interface{}{
		"threadId": threadID,
		"message":  message,
		"isGroup":  isGroup,
	}

	bodyBytes, _ := json.Marshal(payload)
	resp, err := b.httpClient.Post(fmt.Sprintf("%s/send", b.daemonURL), "application/json", bytes.NewBuffer(bodyBytes))
	if err != nil {
		log.Printf("[Bridge] Send error: %v", err)
		return &SendMessageResponse{Success: false, Error: err.Error()}, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var res struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}
	_ = json.Unmarshal(body, &res)

	if res.Success {
		// Create local self message for instant feedback
		selfMsg := Message{
			ID:         fmt.Sprintf("self_%d", time.Now().UnixNano()%1000000),
			ThreadID:   threadID,
			IsGroup:    isGroup,
			IsSelf:     true,
			SenderID:   b.ownID,
			SenderName: "Tôi",
			Content:    message,
			Timestamp:  time.Now().UnixMilli(),
			ISOTime:    time.Now().Format("15:04:05 02/01/2006"),
			Read:       true,
		}

		b.mu.Lock()
		b.seenMessageIDs[selfMsg.ID] = true
		b.messages = append(b.messages, selfMsg)
		b.updateThreadLocked(selfMsg)
		b.mu.Unlock()

		if b.hub != nil {
			b.hub.Broadcast("message_sent", selfMsg)
		}
		b.webhookMgr.Dispatch("message.sent", selfMsg)
		return &SendMessageResponse{Success: true, MessageID: selfMsg.ID}, nil
	}

	errMsg := res.Error
	if errMsg == "" {
		errMsg = "Không thể gửi tin nhắn qua Zalo"
	}
	return &SendMessageResponse{Success: false, Error: errMsg}, fmt.Errorf(errMsg)
}

func (b *ZaloBridge) GetStatus() GatewayStatus {
	b.mu.RLock()
	defer b.mu.RUnlock()

	activeSockets := 0
	if b.hub != nil {
		activeSockets = b.hub.ActiveCount()
	}

	return GatewayStatus{
		Status:         "running",
		Port:           54321,
		Connected:      b.connected,
		OwnID:          b.ownID,
		MasterUID:      b.masterUID,
		UptimeSeconds:  int64(time.Since(b.startTime).Seconds()),
		TotalMessages:  len(b.messages),
		ActiveWebhooks: b.webhookMgr.Count(),
		ActiveSockets:  activeSockets,
		DaemonEndpoint: b.daemonURL,
		Version:        "1.0.0",
	}
}

type daemonQRResponse struct {
	Status        string      `json:"status"`
	QRCode        string      `json:"qrCode"`
	QRImageBase64 string      `json:"qrImageBase64"`
	ScannedUser   interface{} `json:"scannedUser"`
	UpdatedAt     int64       `json:"updatedAt"`
	Error         string      `json:"error"`
}

func (b *ZaloBridge) GetQRStatus() (*QRLoginStatus, error) {
	resp, err := b.httpClient.Get(fmt.Sprintf("%s/qr", b.daemonURL))
	if err != nil {
		return &QRLoginStatus{Status: "error", Error: err.Error()}, err
	}
	defer resp.Body.Close()

	var d daemonQRResponse
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return &QRLoginStatus{Status: "error", Error: err.Error()}, err
	}
	return &QRLoginStatus{
		Status:        d.Status,
		QRCode:        d.QRCode,
		QRImageBase64: d.QRImageBase64,
		ScannedUser:   d.ScannedUser,
		UpdatedAt:     d.UpdatedAt,
		Error:         d.Error,
	}, nil
}

func (b *ZaloBridge) StartQRLogin(force bool) (*QRLoginStatus, error) {
	url := fmt.Sprintf("%s/login/start", b.daemonURL)
	if force {
		url += "?force=true"
	}
	resp, err := b.httpClient.Post(url, "application/json", nil)
	if err != nil {
		return &QRLoginStatus{Status: "error", Error: err.Error()}, err
	}
	defer resp.Body.Close()

	var d daemonQRResponse
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return &QRLoginStatus{Status: "error", Error: err.Error()}, err
	}
	qr := &QRLoginStatus{
		Status:        d.Status,
		QRCode:        d.QRCode,
		QRImageBase64: d.QRImageBase64,
		ScannedUser:   d.ScannedUser,
		UpdatedAt:     d.UpdatedAt,
		Error:         d.Error,
	}
	if b.hub != nil {
		b.hub.Broadcast("qr_updated", qr)
	}
	return qr, nil
}
