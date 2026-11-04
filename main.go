package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

//go:embed static/*
var staticFS embed.FS

//go:embed docs/*
var docsFS embed.FS

func main() {
	// Parse CLI options with environment fallbacks
	defaultPort := 54321
	if envPort := os.Getenv("PORT"); envPort != "" {
		if p, err := strconv.Atoi(envPort); err == nil {
			defaultPort = p
		}
	}

	defaultDaemon := "http://127.0.0.1:39123"
	if envDaemon := os.Getenv("DAEMON_URL"); envDaemon != "" {
		defaultDaemon = envDaemon
	}

	port := flag.Int("port", defaultPort, "Port to listen on (5-digit port default: 54321)")
	daemonURL := flag.String("daemon", defaultDaemon, "Zalo underlying daemon endpoint")
	configPath := flag.String("config", "webhooks.json", "Path to webhooks persistent config")
	flag.Parse()

	log.Printf("==========================================================")
	log.Printf("  ⚡ Zalo Gateway - Multi-Session Web & Automation Hub   ")
	log.Printf("  🌐 Port: %d | Daemon: %s", *port, *daemonURL)
	log.Printf("==========================================================")

	// Initialize components
	webhookMgr := NewWebhookManager(*configPath)
	bridge := NewZaloBridge(*daemonURL, webhookMgr)
	hub := NewHub(bridge)
	bridge.SetHub(hub)

	// Run Hub loop and bridge polling
	go hub.Run()
	bridge.Start()

	// Setup HTTP multiplexer
	mux := http.NewServeMux()

	// Embedded Static File Server
	subFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("Failed to initialize embedded static fs: %v", err)
	}
	fileServer := http.FileServer(http.FS(subFS))
	mux.Handle("/static/", http.StripPrefix("/static/", fileServer))

	// Web UI Root
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		data, err := staticFS.ReadFile("static/index.html")
		if err != nil {
			http.Error(w, "Error loading UI", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(data)
	})

	// WebSocket handler
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r)
	})

	// OpenAPI and LLM Spec handlers
	mux.HandleFunc("/api/v1/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		data, err := docsFS.ReadFile("docs/openapi.json")
		if err != nil {
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}
		_, _ = w.Write(data)
	})

	mux.HandleFunc("/llms.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		data, err := docsFS.ReadFile("docs/llms.txt")
		if err != nil {
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}
		_, _ = w.Write(data)
	})

	mux.HandleFunc("/agent-guide.md", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		data, err := docsFS.ReadFile("docs/agent-guide.md")
		if err != nil {
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}
		_, _ = w.Write(data)
	})

	// REST API Endpoints
	mux.HandleFunc("/api/v1/status", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == "OPTIONS" {
			return
		}
		st := bridge.GetStatus()
		st.Port = *port
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(st)
	})

	// Login & QR Code endpoints
	mux.HandleFunc("/api/v1/login/qr", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == "OPTIONS" {
			return
		}

		if r.Method == "GET" {
			qr, err := bridge.GetQRStatus()
			if err != nil {
				w.WriteHeader(http.StatusBadGateway)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(qr)
			return
		}

		if r.Method == "POST" {
			force := r.URL.Query().Get("force") == "true"
			qr, err := bridge.StartQRLogin(force)
			if err != nil {
				w.WriteHeader(http.StatusBadGateway)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(qr)
			return
		}

		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/v1/threads", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == "OPTIONS" {
			return
		}
		threads := bridge.GetThreads()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(threads)
	})

	mux.HandleFunc("/api/v1/messages", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == "OPTIONS" {
			return
		}
		threadID := r.URL.Query().Get("thread_id")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit <= 0 {
			limit = 50
		}
		msgs := bridge.GetMessages(threadID, limit)
		if msgs == nil {
			msgs = []Message{}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(msgs)
	})

	mux.HandleFunc("/api/v1/send", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == "OPTIONS" {
			return
		}
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Invalid body", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		var req SendMessageRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "Invalid JSON body", http.StatusBadRequest)
			return
		}

		targetID := req.ThreadID
		if targetID == "" {
			targetID = req.RecipientID
		}

		if targetID == "" || req.Message == "" {
			http.Error(w, "Missing thread_id/recipient_id or message", http.StatusBadRequest)
			return
		}

		res, _ := bridge.SendMessage(targetID, req.Message, req.IsGroup)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	})

	// Webhooks API
	mux.HandleFunc("/api/v1/webhooks", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == "OPTIONS" {
			return
		}

		if r.Method == "GET" {
			list := webhookMgr.List()
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(list)
			return
		}

		if r.Method == "POST" {
			var payload struct {
				URL    string   `json:"url"`
				Secret string   `json:"secret"`
				Events []string `json:"events"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.URL == "" {
				http.Error(w, "Invalid webhook payload", http.StatusBadRequest)
				return
			}
			wh := webhookMgr.Register(payload.URL, payload.Secret, payload.Events)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(wh)
			return
		}

		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/v1/webhooks/", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == "OPTIONS" {
			return
		}

		if r.Method == "DELETE" {
			parts := strings.Split(r.URL.Path, "/")
			id := parts[len(parts)-1]
			if webhookMgr.Delete(id) {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"success":true}`))
			} else {
				http.NotFound(w, r)
			}
			return
		}
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	})

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", *port),
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	log.Printf("🚀 Zalo Gateway live at: http://localhost:%d", *port)
	log.Printf("📖 AI Agent Guide: http://localhost:%d/agent-guide.md", *port)
	log.Printf("📋 OpenAPI 3.0: http://localhost:%d/api/v1/openapi.json", *port)

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server stopped: %v", err)
	}
}

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Zalo-Signature")
}
