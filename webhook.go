package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

type WebhookManager struct {
	mu         sync.RWMutex
	webhooks   map[string]*Webhook
	configPath string
	httpClient *http.Client
}

func NewWebhookManager(configPath string) *WebhookManager {
	wm := &WebhookManager{
		webhooks:   make(map[string]*Webhook),
		configPath: configPath,
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
		},
	}
	wm.load()
	return wm
}

func (wm *WebhookManager) load() {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	data, err := os.ReadFile(wm.configPath)
	if err != nil {
		return
	}

	var saved []*Webhook
	if err := json.Unmarshal(data, &saved); err == nil {
		for _, wh := range saved {
			wm.webhooks[wh.ID] = wh
		}
	}
}

func (wm *WebhookManager) save() {
	list := make([]*Webhook, 0, len(wm.webhooks))
	for _, wh := range wm.webhooks {
		list = append(list, wh)
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err == nil {
		_ = os.WriteFile(wm.configPath, data, 0644)
	}
}

func (wm *WebhookManager) Register(url string, secret string, events []string) *Webhook {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	if len(events) == 0 {
		events = []string{"message.received"}
	}

	id := fmt.Sprintf("wh_%d", time.Now().UnixNano()%1000000)
	wh := &Webhook{
		ID:        id,
		URL:       url,
		Secret:    secret,
		Events:    events,
		CreatedAt: time.Now(),
	}
	wm.webhooks[id] = wh
	wm.save()
	return wh
}

func (wm *WebhookManager) Delete(id string) bool {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	if _, exists := wm.webhooks[id]; exists {
		delete(wm.webhooks, id)
		wm.save()
		return true
	}
	return false
}

func (wm *WebhookManager) List() []*Webhook {
	wm.mu.RLock()
	defer wm.mu.RUnlock()

	list := make([]*Webhook, 0, len(wm.webhooks))
	for _, wh := range wm.webhooks {
		list = append(list, wh)
	}
	return list
}

func (wm *WebhookManager) Count() int {
	wm.mu.RLock()
	defer wm.mu.RUnlock()
	return len(wm.webhooks)
}

func (wm *WebhookManager) Dispatch(event string, data interface{}) {
	wm.mu.RLock()
	defer wm.mu.RUnlock()

	if len(wm.webhooks) == 0 {
		return
	}

	payload := WebhookPayload{
		Event:     event,
		Timestamp: time.Now().UnixMilli(),
		Data:      data,
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return
	}

	for _, wh := range wm.webhooks {
		// Check event subscription
		matched := false
		for _, e := range wh.Events {
			if e == "*" || e == event {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}

		go wm.sendWebhook(wh, bodyBytes)
	}
}

func (wm *WebhookManager) sendWebhook(wh *Webhook, body []byte) {
	req, err := http.NewRequest("POST", wh.URL, bytes.NewBuffer(body))
	if err != nil {
		wm.recordResult(wh.ID, false)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "ZaloGateway/1.0 (+https://github.com/giangsamne/zalo-gateway)")

	if wh.Secret != "" {
		mac := hmac.New(sha256.New, []byte(wh.Secret))
		mac.Write(body)
		signature := hex.EncodeToString(mac.Sum(nil))
		req.Header.Set("X-Zalo-Signature", "sha256="+signature)
	}

	resp, err := wm.httpClient.Do(req)
	if err != nil {
		log.Printf("[Webhook] Error sending to %s: %v", wh.URL, err)
		wm.recordResult(wh.ID, false)
		return
	}
	defer resp.Body.Close()

	success := resp.StatusCode >= 200 && resp.StatusCode < 300
	wm.recordResult(wh.ID, success)
}

func (wm *WebhookManager) recordResult(id string, success bool) {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	wh, ok := wm.webhooks[id]
	if !ok {
		return
	}

	now := time.Now()
	wh.LastTriggeredAt = &now
	if success {
		wh.SuccessCount++
	} else {
		wh.FailureCount++
	}
	wm.save()
}
