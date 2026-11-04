// Zalo Gateway Frontend Application
let ws = null;
let currentThreadId = null;
let currentThreadIsGroup = false;
let currentThreadName = "";
let threads = [];
let messagesByThread = {};

const threadListEl = document.getElementById("thread-list");
const messageFeedEl = document.getElementById("message-feed");
const messageFormEl = document.getElementById("message-form");
const messageInputEl = document.getElementById("message-input");
const chatHeaderEl = document.getElementById("chat-header");
const chatActionsEl = document.getElementById("chat-actions");
const chatInputAreaEl = document.getElementById("chat-input-area");
const activeThreadNameEl = document.getElementById("active-thread-name");
const activeThreadSubEl = document.getElementById("active-thread-sub");
const activeAvatarEl = document.getElementById("active-avatar");
const badgeThreadIdEl = document.getElementById("badge-thread-id");
const badgeThreadTypeEl = document.getElementById("badge-thread-type");
const statusBadgeEl = document.getElementById("status-badge");
const statPortEl = document.getElementById("stat-port");
const statWebhooksEl = document.getElementById("stat-webhooks");
const statSocketsEl = document.getElementById("stat-sockets");
const loginBannerEl = document.getElementById("login-banner");
const btnOpenLoginEl = document.getElementById("btn-open-login");
const btnBannerLoginEl = document.getElementById("btn-banner-login");
const modalLoginEl = document.getElementById("modal-login");
const qrImgEl = document.getElementById("qr-img");
const qrLoadingEl = document.getElementById("qr-loading");
const qrLoadingTextEl = document.getElementById("qr-loading-text");
const qrStatusPillEl = document.getElementById("qr-status-pill");
const qrStatusTextEl = document.getElementById("qr-status-text");
const btnRefreshQREl = document.getElementById("btn-refresh-qr");
const btnForceQREl = document.getElementById("btn-force-qr");

let qrPollTimer = null;

// Init WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[WS] Connected to Zalo Gateway");
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      handleWSEvent(payload);
    } catch (err) {
      console.error("[WS] Parse error:", err);
    }
  };

  ws.onclose = () => {
    console.warn("[WS] Disconnected, reconnecting in 2s...");
    statusBadgeEl.className = "status-badge offline";
    statusBadgeEl.querySelector(".status-text").textContent = "Mất kết nối Gateway";
    setTimeout(connectWebSocket, 2000);
  };
}

function handleWSEvent(evt) {
  switch (evt.type) {
    case "init":
      if (evt.data.status) updateStatus(evt.data.status);
      if (evt.data.threads) {
        threads = evt.data.threads;
        renderThreads();
      }
      break;

    case "status_updated":
      updateStatus(evt.data);
      break;

    case "qr_updated":
      renderQRState(evt.data);
      break;

    case "message_received":
    case "message_sent":
      handleNewMessage(evt.data);
      break;
  }
}

function updateStatus(status) {
  if (status.connected) {
    statusBadgeEl.className = "status-badge online";
    statusBadgeEl.querySelector(".status-text").textContent = "Zalo Đã kết nối";
    if (loginBannerEl) loginBannerEl.style.display = "none";
    if (btnOpenLoginEl) {
      btnOpenLoginEl.textContent = "✓ Đã đăng nhập";
      btnOpenLoginEl.className = "btn-login-header connected";
    }
  } else {
    statusBadgeEl.className = "status-badge offline";
    statusBadgeEl.querySelector(".status-text").textContent = "Zalo Chưa đăng nhập";
    if (loginBannerEl) loginBannerEl.style.display = "flex";
    if (btnOpenLoginEl) {
      btnOpenLoginEl.textContent = "🔑 Đăng nhập";
      btnOpenLoginEl.className = "btn-login-header";
    }
  }

  statPortEl.textContent = status.port || "54321";
  statWebhooksEl.textContent = status.active_webhooks || 0;
  statSocketsEl.textContent = status.active_websockets || 1;
}

function handleNewMessage(msg) {
  const tid = msg.threadId;
  if (!messagesByThread[tid]) {
    messagesByThread[tid] = [];
  }

  // Deduplicate: same ID
  if (messagesByThread[tid].some(x => x.id === msg.id)) {
    return;
  }

  // Deduplicate: same content sent within 4 seconds
  if (msg.isSelf && messagesByThread[tid].some(x => x.isSelf && x.content === msg.content && Math.abs(x.timestamp - msg.timestamp) < 4000)) {
    return;
  }

  messagesByThread[tid].push(msg);

  // Update or insert thread
  let t = threads.find(x => x.id === tid);
  if (!t) {
    t = {
      id: tid,
      name: msg.senderName || `Người dùng (${tid})`,
      isGroup: msg.isGroup,
      lastMessage: msg.content,
      lastSender: msg.senderName,
      lastIsoTime: msg.isoTime,
      lastTimestamp: msg.timestamp,
      unreadCount: 0
    };
    threads.unshift(t);
  } else {
    t.lastMessage = msg.content;
    t.lastSender = msg.senderName;
    t.lastIsoTime = msg.isoTime;
    t.lastTimestamp = msg.timestamp;
    if (tid !== currentThreadId && !msg.isSelf) {
      t.unreadCount = (t.unreadCount || 0) + 1;
    }
    // Move to top
    threads = [t, ...threads.filter(x => x.id !== tid)];
  }

  renderThreads();

  // If currently viewing this thread, append message
  if (tid === currentThreadId) {
    appendMessageBubble(msg);
    scrollToBottom();
  }
}

function renderThreads(filter = "") {
  threadListEl.innerHTML = "";

  const filtered = threads.filter(t => 
    t.name.toLowerCase().includes(filter.toLowerCase()) || 
    t.id.includes(filter) ||
    (t.lastMessage && t.lastMessage.toLowerCase().includes(filter.toLowerCase()))
  );

  if (filtered.length === 0) {
    threadListEl.innerHTML = `<div class="empty-state">Không có hội thoại nào</div>`;
    return;
  }

  filtered.forEach(t => {
    const item = document.createElement("div");
    item.className = `thread-item ${t.id === currentThreadId ? "active" : ""}`;
    item.onclick = () => selectThread(t);

    const initial = (t.name || "Z").charAt(0).toUpperCase();
    const isGroupClass = t.isGroup ? "group" : "";

    item.innerHTML = `
      <div class="avatar ${isGroupClass}">${initial}</div>
      <div class="thread-details">
        <div class="thread-row-top">
          <span class="thread-name">${escapeHtml(t.name)}</span>
          <span class="thread-time">${t.lastIsoTime ? t.lastIsoTime.split(" ")[0] : ""}</span>
        </div>
        <div class="thread-preview">${escapeHtml(t.lastMessage || "(Chưa có tin nhắn)")}</div>
      </div>
    `;
    threadListEl.appendChild(item);
  });
}

async function selectThread(t) {
  currentThreadId = t.id;
  currentThreadIsGroup = t.isGroup;
  currentThreadName = t.name;

  activeThreadNameEl.textContent = t.name;
  activeThreadSubEl.textContent = t.isGroup ? "Nhóm chat" : "Hội thoại cá nhân";
  activeAvatarEl.textContent = (t.name || "Z").charAt(0).toUpperCase();
  badgeThreadIdEl.textContent = `ID: ${t.id}`;
  badgeThreadTypeEl.textContent = t.isGroup ? "Nhóm" : "Cá nhân";

  chatActionsEl.style.display = "flex";
  chatInputAreaEl.style.display = "block";

  renderThreads();
  loadMessagesForThread(t.id);
}

async function loadMessagesForThread(threadId) {
  messageFeedEl.innerHTML = `<div class="empty-state">Đang tải tin nhắn...</div>`;

  try {
    const res = await fetch(`/api/v1/messages?thread_id=${threadId}&limit=50`);
    const msgs = await res.json();
    messagesByThread[threadId] = msgs;

    messageFeedEl.innerHTML = "";
    if (msgs.length === 0) {
      messageFeedEl.innerHTML = `<div class="empty-state">Chưa có tin nhắn nào trong hội thoại này.</div>`;
      return;
    }

    msgs.forEach(m => appendMessageBubble(m));
    scrollToBottom();
  } catch (err) {
    messageFeedEl.innerHTML = `<div class="empty-state">Lỗi tải tin nhắn: ${err.message}</div>`;
  }
}

function appendMessageBubble(m) {
  const row = document.createElement("div");
  row.className = `msg-row ${m.isSelf ? "self" : "incoming"}`;

  let senderHtml = "";
  if (!m.isSelf && currentThreadIsGroup) {
    senderHtml = `<div class="msg-sender">${escapeHtml(m.senderName || m.senderId)}</div>`;
  }

  row.innerHTML = `
    ${senderHtml}
    <div class="msg-bubble">${escapeHtml(m.content)}</div>
    <div class="msg-time">${m.isoTime || ""}</div>
  `;

  messageFeedEl.appendChild(row);
}

function scrollToBottom() {
  messageFeedEl.scrollTop = messageFeedEl.scrollHeight;
}

// Message submission with anti-duplicate guard
const btnSendEl = document.getElementById("btn-send");
let isSending = false;

async function submitMessage() {
  if (isSending) return;
  const text = messageInputEl.value.trim();
  if (!text || !currentThreadId) return;

  isSending = true;
  messageInputEl.value = "";
  if (btnSendEl) btnSendEl.disabled = true;

  try {
    const res = await fetch("/api/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: currentThreadId,
        message: text,
        is_group: currentThreadIsGroup
      })
    });
    const data = await res.json();
    if (!data.success) {
      alert("Lỗi gửi tin nhắn: " + (data.error || "Không rõ nguyên nhân"));
    }
  } catch (err) {
    alert("Không thể kết nối đến Gateway: " + err.message);
  } finally {
    isSending = false;
    if (btnSendEl) btnSendEl.disabled = false;
    messageInputEl.focus();
  }
}

if (btnSendEl) {
  btnSendEl.onclick = (e) => {
    e.preventDefault();
    submitMessage();
  };
}

if (messageFormEl) {
  messageFormEl.onsubmit = (e) => {
    e.preventDefault();
    submitMessage();
    return false;
  };
}

// Enter to submit (ignores Vietnamese IME composition)
messageInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    if (e.isComposing || e.keyCode === 229) {
      return; // Vietnamese IME đang gõ dấu (Telex/VNI)
    }
    e.preventDefault();
    submitMessage();
  }
});

// Search filter
document.getElementById("search-threads").addEventListener("input", (e) => {
  renderThreads(e.target.value);
});

// Modals Handling
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.onclick = () => {
    document.getElementById(btn.dataset.close).classList.remove("open");
  };
});

document.getElementById("btn-webhooks").onclick = () => {
  loadWebhooks();
  document.getElementById("modal-webhooks").classList.add("open");
};

document.getElementById("btn-docs").onclick = () => {
  document.getElementById("modal-docs").classList.add("open");
};

// Docs Tabs
document.querySelectorAll(".docs-tabs button").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".docs-tabs button").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(tc => tc.style.display = "none");
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).style.display = "block";
  };
});

// Webhook CRUD
async function loadWebhooks() {
  const listEl = document.getElementById("webhook-list");
  listEl.innerHTML = "Đang tải...";

  try {
    const res = await fetch("/api/v1/webhooks");
    const data = await res.json();
    if (data.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Chưa đăng ký webhook nào.</div>`;
      return;
    }

    listEl.innerHTML = "";
    data.forEach(wh => {
      const item = document.createElement("div");
      item.className = "webhook-item";
      item.innerHTML = `
        <div class="wh-info">
          <div class="wh-url">${escapeHtml(wh.url)}</div>
          <div class="wh-meta">
            <span>Sự kiện: <strong>${wh.events.join(", ")}</strong></span>
            <span>Thành công: <strong style="color:var(--success)">${wh.success_count}</strong></span>
            <span>Lỗi: <strong style="color:var(--danger)">${wh.failure_count}</strong></span>
          </div>
        </div>
        <button class="btn-danger" onclick="deleteWebhook('${wh.id}')">Xóa</button>
      `;
      listEl.appendChild(item);
    });
  } catch (err) {
    listEl.innerHTML = "Lỗi tải webhooks: " + err.message;
  }
}

document.getElementById("webhook-form").onsubmit = async (e) => {
  e.preventDefault();
  const url = document.getElementById("wh-url").value;
  const secret = document.getElementById("wh-secret").value;
  const events = [document.getElementById("wh-events").value];

  try {
    const res = await fetch("/api/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, secret, events })
    });
    if (res.ok) {
      document.getElementById("wh-url").value = "";
      document.getElementById("wh-secret").value = "";
      loadWebhooks();
    }
  } catch (err) {
    alert("Lỗi thêm webhook: " + err.message);
  }
};

window.deleteWebhook = async (id) => {
  if (!confirm("Bạn có chắc chắn muốn xóa webhook này?")) return;
  try {
    await fetch(`/api/v1/webhooks/${id}`, { method: "DELETE" });
    loadWebhooks();
  } catch (err) {
    alert("Lỗi xóa: " + err.message);
  }
};

// ========================
// QR Login Flow Management
// ========================
function openLoginModal() {
  modalLoginEl.classList.add("open");
  loadQRCode(false);
  startQRPoll();
}

function closeLoginModal() {
  modalLoginEl.classList.remove("open");
  stopQRPoll();
}

function startQRPoll() {
  stopQRPoll();
  qrPollTimer = setInterval(async () => {
    if (!modalLoginEl.classList.contains("open")) {
      stopQRPoll();
      return;
    }
    try {
      const res = await fetch("/api/v1/login/qr");
      if (res.ok) {
        const qr = await res.json();
        renderQRState(qr);
      }
    } catch (_) {}
  }, 1500);
}

function stopQRPoll() {
  if (qrPollTimer) {
    clearInterval(qrPollTimer);
    qrPollTimer = null;
  }
}

async function loadQRCode(force = false) {
  qrLoadingEl.style.display = "flex";
  const spinner = qrLoadingEl.querySelector(".spinner");
  if (spinner) spinner.style.display = "block";
  qrImgEl.style.display = "none";
  qrLoadingTextEl.textContent = force ? "Đang tạo phiên mới..." : "Đang tải mã QR mới nhất...";
  qrStatusPillEl.className = "qr-status-pill waiting";
  qrStatusTextEl.textContent = "Đang kết nối...";

  try {
    const endpoint = force ? "/api/v1/login/qr?force=true" : "/api/v1/login/qr";
    const res = await fetch(endpoint, { method: "POST" });
    const qr = await res.json();
    renderQRState(qr);
  } catch (err) {
    qrLoadingTextEl.textContent = "Lỗi kết nối máy chủ: " + err.message;
  }
}

function renderQRState(qr) {
  if (!qr) return;

  if (qr.qr_image_base64) {
    qrImgEl.src = qr.qr_image_base64;
    qrImgEl.style.display = "block";
    qrLoadingEl.style.display = "none";
  }

  switch (qr.status) {
    case "connected":
      qrLoadingEl.style.display = "flex";
      const sp = qrLoadingEl.querySelector(".spinner");
      if (sp) sp.style.display = "none";
      qrImgEl.style.display = "none";
      qrLoadingTextEl.innerHTML = `🟢 <strong>Tài khoản hiện đang kết nối Zalo sẵn!</strong><br><small style="color:var(--text-muted); margin-top:8px; display:block;">UID: ${qr.ownId || ""}. Bạn có thể bắt đầu nhắn tin ngay. Nếu bạn muốn đổi số Zalo khác, bấm "Đăng nhập tài khoản khác" bên dưới.</small>`;
      qrStatusPillEl.className = "qr-status-pill success";
      qrStatusTextEl.textContent = "🟢 Zalo Đã kết nối";
      break;

    case "qr_ready":
      qrStatusPillEl.className = "qr-status-pill waiting";
      qrStatusTextEl.textContent = "📲 Vui lòng quét mã QR bằng app Zalo";
      break;

    case "scanned":
      qrStatusPillEl.className = "qr-status-pill scanned";
      const userName = qr.scanned_user ? (qr.scanned_user.display_name || "Zalo") : "bạn";
      qrStatusTextEl.textContent = `👀 Đã quét bởi ${userName}! Bấm [Đăng nhập] trên đt...`;
      break;

    case "expired":
      qrStatusPillEl.className = "qr-status-pill expired";
      qrStatusTextEl.textContent = "⚠️ Mã QR đã hết hạn - Bấm [Làm mới mã QR]";
      break;

    case "declined":
      qrStatusPillEl.className = "qr-status-pill expired";
      qrStatusTextEl.textContent = "❌ Yêu cầu đăng nhập đã bị từ chối trên điện thoại";
      break;

    case "success":
      qrStatusPillEl.className = "qr-status-pill success";
      qrStatusTextEl.textContent = "✅ Đăng nhập thành công! Đang vào Zalo...";
      setTimeout(() => {
        closeLoginModal();
        fetch("/api/v1/status").then(r => r.json()).then(updateStatus);
        fetch("/api/v1/threads").then(r => r.json()).then(t => { threads = t; renderThreads(); });
      }, 1500);
      break;

    case "generating":
      qrLoadingEl.style.display = "flex";
      const spin = qrLoadingEl.querySelector(".spinner");
      if (spin) spin.style.display = "block";
      qrImgEl.style.display = "none";
      qrLoadingTextEl.textContent = "Đang tạo mã QR mới từ Zalo...";
      qrStatusPillEl.className = "qr-status-pill waiting";
      qrStatusTextEl.textContent = "Đang khởi tạo...";
      break;
  }
}

if (btnOpenLoginEl) btnOpenLoginEl.onclick = openLoginModal;
if (btnBannerLoginEl) btnBannerLoginEl.onclick = openLoginModal;
if (btnRefreshQREl) btnRefreshQREl.onclick = () => loadQRCode(false);
if (btnForceQREl) btnForceQREl.onclick = () => {
  if (confirm("Thao tác này sẽ xóa phiên đăng nhập cũ và tạo mã QR hoàn toàn mới. Tiếp tục?")) {
    loadQRCode(true);
  }
};

// Modal close handler for login modal
document.querySelectorAll('[data-close="modal-login"]').forEach(btn => {
  btn.onclick = closeLoginModal;
});

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Start
connectWebSocket();
