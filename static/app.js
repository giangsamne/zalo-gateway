// ==========================================================================
// Zalo Gateway - Minimalist Frontend Application
// ==========================================================================

const API_BASE = '/api/v1';
const FALLBACK_AVATAR = '/static/zalo-assets/assets/logo-new.146dfa01c78183631d33b77999a18288.svg';

let currentThreadId = null;
let currentThreadName = null;
let allThreads = [];
let isConnected = false;
let isSending = false;
let qrPollTimer = null;
let threadPollTimer = null;
let ws = null;
let wsReconnectTimer = null;
let lastThreadsSig = '';
let lastMessagesSig = '';

// DOM Elements
const convList = document.getElementById('conv-list');
const searchInput = document.getElementById('contact-search-input');
const btnClearSearch = document.getElementById('btn-clear-search');
const chatHeader = document.getElementById('chat-header');
const activeChatName = document.getElementById('active-chat-name');
const activeChatAvatar = document.getElementById('active-chat-avatar');
const activeChatStatus = document.getElementById('active-chat-status');
const activeThreadIdText = document.getElementById('active-thread-id-text');
const btnCopyThreadId = document.getElementById('btn-copy-thread-id');
const btnRefreshChat = document.getElementById('btn-refresh-chat');
const chatMessages = document.getElementById('chat-messages');
const chatFooter = document.getElementById('chat-footer');
const richInput = document.getElementById('richInput');
const btnSendMsg = document.getElementById('btn-send-msg');
const welcomeCard = document.getElementById('welcome-card');

const btnLoginModal = document.getElementById('btn-login-modal');
const onlineDot = document.getElementById('online-dot');
const statusLabel = document.getElementById('status-label');

const modalQR = document.getElementById('modal-qr');
const qrImage = document.getElementById('qr-image');
const qrLoading = document.getElementById('qr-loading');
const qrStatusText = document.getElementById('qr-status-text');
const btnRefreshQR = document.getElementById('btn-refresh-qr');

const modalWebhooks = document.getElementById('modal-webhooks');
const btnOpenWebhooks = document.getElementById('btn-open-webhooks');
const btnSaveWebhook = document.getElementById('btn-save-webhook');
const webhookList = document.getElementById('webhook-list');
const whUrlInput = document.getElementById('wh-url');
const whSecretInput = document.getElementById('wh-secret');

// Init
window.addEventListener('DOMContentLoaded', () => {
  initApp();
  initEventListeners();
});

async function initApp() {
  await checkStatus();
  await loadThreads();
  connectWebSocket();

  // Fallback polling every 2s
  threadPollTimer = setInterval(() => {
    checkStatus();
    loadThreads();
    if (currentThreadId && !isSending) {
      loadMessages(currentThreadId, true);
    }
  }, 2000);
}

function applyThreadFilterAndRender() {
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const filtered = query
    ? allThreads.filter(t => (t.name || '').toLowerCase().includes(query) || (t.lastMessage && t.lastMessage.toLowerCase().includes(query)))
    : allThreads;
  renderThreads(filtered);
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    ws = new WebSocket(`${proto}//${location.host}/ws`);
  } catch (err) {
    console.error('WebSocket init error:', err);
    return;
  }

  ws.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data);
      const { type, data } = frame || {};
      if (type === 'init' || type === 'threads_updated') {
        const threads = type === 'init' ? (data && data.threads) : data;
        if (Array.isArray(threads)) {
          allThreads = threads;
          applyThreadFilterAndRender();
        }
      } else if (type === 'message_received' || type === 'message_sent') {
        const msgTid = data && (data.threadId || data.thread_id);
        if (msgTid && msgTid === currentThreadId && !isSending) {
          loadMessages(currentThreadId, true);
        }
        loadThreads();
      } else if (type === 'status_updated') {
        checkStatus();
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  };

  ws.onclose = () => {
    ws = null;
    if (!wsReconnectTimer) {
      wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectWebSocket();
      }, 3000);
    }
  };

  ws.onerror = () => {
    try { ws.close(); } catch (e) {}
  };
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('open');
  if (modalId === 'modal-qr' && qrPollTimer) {
    clearInterval(qrPollTimer);
    qrPollTimer = null;
  }
}

function initEventListeners() {
  // Search input filter & clear button
  searchInput.addEventListener('input', (e) => {
    btnClearSearch.style.display = e.target.value ? 'flex' : 'none';
    lastThreadsSig = '';
    applyThreadFilterAndRender();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    btnClearSearch.style.display = 'none';
    lastThreadsSig = '';
    applyThreadFilterAndRender();
    searchInput.focus();
  });

  // Auto-resize textarea & Enter to send
  richInput.addEventListener('input', () => {
    richInput.style.height = 'auto';
    richInput.style.height = Math.min(richInput.scrollHeight, 120) + 'px';
  });

  richInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  btnSendMsg.addEventListener('click', () => {
    sendMessage();
  });

  // Copy Thread ID
  btnCopyThreadId.addEventListener('click', async () => {
    if (!currentThreadId) return;
    try {
      await navigator.clipboard.writeText(currentThreadId);
    } catch {
      const tmp = document.createElement('input');
      tmp.value = currentThreadId;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
    }
    activeThreadIdText.textContent = '✓ Đã chép ID';
    setTimeout(() => {
      if (currentThreadId) {
        activeThreadIdText.textContent = `ID: ${currentThreadId}`;
      }
    }, 1500);
  });

  // Manual Refresh chat
  btnRefreshChat.addEventListener('click', () => {
    lastThreadsSig = '';
    lastMessagesSig = '';
    loadThreads();
    if (currentThreadId && !isSending) {
      loadMessages(currentThreadId, false);
    }
  });

  // Fallback avatar if external URL fails
  activeChatAvatar.addEventListener('error', () => {
    if (!activeChatAvatar.src.endsWith(FALLBACK_AVATAR)) {
      activeChatAvatar.src = FALLBACK_AVATAR;
    }
  });

  // Open QR modal
  btnLoginModal.addEventListener('click', () => {
    openQRModal();
  });

  // Force refresh QR code
  btnRefreshQR.addEventListener('click', () => {
    refreshQRCode(true);
  });

  // Open Webhooks modal
  btnOpenWebhooks.addEventListener('click', () => {
    modalWebhooks.classList.add('open');
    loadWebhooks();
  });

  // Save webhook
  btnSaveWebhook.addEventListener('click', () => {
    saveWebhook();
  });

  // Modal close buttons & backdrop click
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal(btn.getAttribute('data-close'));
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });
}

// --------------------------------------------------------------------------
// Status & QR Logic
// --------------------------------------------------------------------------
async function checkStatus() {
  try {
    const res = await fetch(`${API_BASE}/status`);
    const data = await res.json();
    isConnected = !!data.connected;

    const dot = document.querySelector('.dot-status');
    if (dot) {
      dot.classList.toggle('connected', isConnected);
      qrStatusText.textContent = isConnected ? 'Đã kết nối Zalo PC Desktop' : 'Chưa kết nối - Quét mã QR';
    }

    if (onlineDot) {
      onlineDot.classList.toggle('online', isConnected);
      onlineDot.classList.toggle('offline', !isConnected);
    }
    if (btnLoginModal) {
      btnLoginModal.classList.toggle('online', isConnected);
      btnLoginModal.classList.toggle('offline', !isConnected);
    }
    if (statusLabel) {
      statusLabel.textContent = isConnected ? 'Trực tuyến' : 'Mất kết nối';
    }

    if (!isConnected && activeChatStatus) {
      activeChatStatus.textContent = 'Mất kết nối Zalo PC Desktop Engine';
    } else if (isConnected && activeChatStatus && currentThreadId) {
      activeChatStatus.textContent = 'Trực tuyến';
    }
  } catch (err) {
    console.error('Status error:', err);
  }
}

async function openQRModal() {
  modalQR.classList.add('open');
  await refreshQRCode(false);

  if (!qrPollTimer) {
    qrPollTimer = setInterval(async () => {
      await refreshQRCode(false);
      await checkStatus();
      if (isConnected) {
        clearInterval(qrPollTimer);
        qrPollTimer = null;
        setTimeout(() => closeModal('modal-qr'), 1000);
      }
    }, 4000);
  }
}

async function refreshQRCode(force = false) {
  qrLoading.innerHTML = '<div class="spinner"></div><span>Đang lấy mã QR từ Zalo PC...</span>';
  qrLoading.style.display = 'flex';
  qrImage.style.display = 'none';
  try {
    const res = await fetch(`${API_BASE}/login/qr${force ? '?force=true' : ''}`, {
      method: force ? 'POST' : 'GET'
    });
    const data = await res.json();

    if (data.status === 'qr_ready' && data.qr_image_base64) {
      qrImage.src = data.qr_image_base64;
      qrImage.style.display = 'block';
      qrLoading.style.display = 'none';
      qrStatusText.textContent = 'Quét mã QR bằng Zalo trên điện thoại';
    } else if (data.connected || data.status === 'connected') {
      qrLoading.innerHTML = '<span style="color:#10b981; font-weight:600;">✓ Đã đăng nhập Zalo PC</span>';
      qrLoading.style.display = 'flex';
    } else {
      qrLoading.innerHTML = '<span style="color:#64748b;">Chưa có mã QR. Nhấn "Lấy mã QR mới" nếu cần đăng nhập lại.</span>';
      qrLoading.style.display = 'flex';
    }
  } catch (err) {
    console.error('QR fetch error:', err);
    qrLoading.innerHTML = '<span style="color:#ef4444;">Không kết nối được tới Zalo Gateway</span>';
  }
}

// --------------------------------------------------------------------------
// Threads & Conversations
// --------------------------------------------------------------------------
async function loadThreads() {
  try {
    const res = await fetch(`${API_BASE}/threads`);
    const threads = await res.json();
    if (Array.isArray(threads)) {
      allThreads = threads;
      applyThreadFilterAndRender();
    }
  } catch (err) {
    console.error('Load threads error:', err);
  }
}

function renderThreads(threads) {
  if (!threads || threads.length === 0) {
    lastThreadsSig = '';
    convList.innerHTML = '<div class="conv-loading"><span>Không có cuộc trò chuyện nào</span></div>';
    return;
  }

  const sig = currentThreadId + '||' + threads.map(t => [t.id, t.name, t.lastMessage, t.lastIsoTime, t.unreadCount].join('\x1f')).join('\x1e');
  if (sig === lastThreadsSig) {
    return;
  }
  lastThreadsSig = sig;

  convList.innerHTML = '';
  threads.forEach(t => {
    const item = document.createElement('div');
    item.className = `conv-item ${t.id === currentThreadId ? 'active' : ''} ${t.unreadCount > 0 ? 'unread' : ''}`;
    item.dataset.threadId = t.id;

    const avatarSrc = t.avatar || FALLBACK_AVATAR;
    const safeName = escapeHtml(t.name || 'Không rõ');
    const safeTime = escapeHtml(t.lastIsoTime || '');
    const safeSnippet = escapeHtml(t.lastMessage || 'Chưa có tin nhắn');

    item.innerHTML = `
      <div class="conv-item-avatar-wrap">
        <img src="${escapeHtml(avatarSrc)}" class="conv-item-avatar" alt="${safeName}">
      </div>
      <div class="conv-item-body">
        <div class="conv-item-header">
          <span class="conv-item-name">${safeName}</span>
          <span class="conv-item-time">${safeTime}</span>
        </div>
        <div class="conv-item-footer">
          <span class="conv-item-snippet">${safeSnippet}</span>
          ${t.unreadCount > 0 ? `<span class="conv-item-badge">${t.unreadCount}</span>` : ''}
        </div>
      </div>
    `;

    const img = item.querySelector('.conv-item-avatar');
    if (img) {
      img.addEventListener('error', () => {
        if (!img.src.endsWith(FALLBACK_AVATAR)) {
          img.src = FALLBACK_AVATAR;
        }
      });
    }

    item.addEventListener('click', () => {
      selectThread(t);
    });

    convList.appendChild(item);
  });
}

async function selectThread(t) {
  currentThreadId = t.id;
  currentThreadName = t.name;
  lastThreadsSig = '';
  lastMessagesSig = '';

  // Highlight in sidebar
  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.threadId === t.id);
  });

  if (welcomeCard) {
    welcomeCard.style.display = 'none';
  }

  // Show & update header
  chatHeader.style.display = 'flex';
  activeChatName.textContent = t.name;
  activeChatAvatar.src = t.avatar || FALLBACK_AVATAR;
  activeChatStatus.textContent = isConnected ? 'Trực tuyến' : 'Mất kết nối Zalo PC Desktop Engine';
  activeThreadIdText.textContent = `ID: ${t.id}`;

  // Show footer
  chatFooter.style.display = 'flex';
  richInput.placeholder = `Nhập tin nhắn tới ${t.name}...`;
  richInput.focus();

  // Load message history
  await loadMessages(t.id, false);
}

// --------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------
async function loadMessages(threadId, silent = false) {
  if (!threadId) return;
  try {
    const res = await fetch(`${API_BASE}/messages?thread_id=${encodeURIComponent(threadId)}`);
    const messages = await res.json();
    if (threadId !== currentThreadId) return;
    renderMessages(messages, silent);
  } catch (err) {
    console.error('Load messages error:', err);
  }
}

function renderMessages(messages, preserveScroll = false) {
  if (!messages || messages.length === 0) {
    lastMessagesSig = '';
    chatMessages.innerHTML = `
      <div class="day-divider">Hôm nay</div>
      <div style="text-align:center; color:#94a3b8; font-size:13px; margin-top:20px;">
        Chưa có tin nhắn trong hội thoại này.
      </div>
    `;
    return;
  }

  const sorted = [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const sig = currentThreadId + '||' + sorted.map(m => (m.id || '') + ':' + (m.content || '')).join('\x1e');
  if (preserveScroll && sig === lastMessagesSig) {
    return;
  }
  lastMessagesSig = sig;

  const wasNearBottom = !preserveScroll || (chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight) < 80;
  const prevScrollTop = chatMessages.scrollTop;

  chatMessages.innerHTML = `<div class="day-divider">Hôm nay</div>`;

  sorted.forEach(m => {
    const isSelf = !!(m.isSelf ?? m.is_self);
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSelf ? 'self' : 'peer'}`;

    const textContent = escapeHtml(m.content || '').replace(/\n/g, '<br>');
    const timeText = escapeHtml(m.isoTime || m.iso_time || '');

    bubble.innerHTML = `
      <div class="bubble-inner">
        <div class="bubble-content">${textContent}</div>
        <div class="bubble-meta">
          <span>${timeText}</span>
          ${isSelf ? '<span>✓✓</span>' : ''}
        </div>
      </div>
    `;

    chatMessages.appendChild(bubble);
  });

  if (wasNearBottom) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else {
    chatMessages.scrollTop = prevScrollTop;
  }
}

// --------------------------------------------------------------------------
// Send Message
// --------------------------------------------------------------------------
async function sendMessage() {
  if (isSending || !currentThreadId) return;

  const text = richInput.value.trim();
  if (!text) return;

  isSending = true;
  richInput.value = '';
  richInput.style.height = 'auto';

  const tempBubble = document.createElement('div');
  tempBubble.className = 'chat-bubble self';
  tempBubble.innerHTML = `
    <div class="bubble-inner">
      <div class="bubble-content">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
      <div class="bubble-meta">
        <span>Vừa xong</span>
        <span>🕒</span>
      </div>
    </div>
  `;
  chatMessages.appendChild(tempBubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const res = await fetch(`${API_BASE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient_id: currentThreadId,
        thread_id: currentThreadId,
        message: text
      })
    });
    const result = await res.json();
    if (result.success) {
      tempBubble.querySelector('.bubble-meta').innerHTML = `<span>Vừa xong</span><span>✓✓</span>`;
      setTimeout(() => {
        lastMessagesSig = '';
        loadThreads();
        if (currentThreadId && !isSending) {
          loadMessages(currentThreadId, true);
        }
      }, 600);
    } else {
      tempBubble.querySelector('.bubble-meta').innerHTML = `<span style="color:#ef4444">Lỗi gửi: ${escapeHtml(result.error || 'Không rõ nguyên nhân')}</span>`;
    }
  } catch (err) {
    console.error('Send error:', err);
    tempBubble.querySelector('.bubble-meta').innerHTML = `<span style="color:#ef4444">Lỗi gửi!</span>`;
  } finally {
    isSending = false;
  }
}

// --------------------------------------------------------------------------
// Webhooks Logic
// --------------------------------------------------------------------------
async function loadWebhooks() {
  try {
    const res = await fetch(`${API_BASE}/webhooks`);
    const list = await res.json();
    if (!list || list.length === 0) {
      webhookList.innerHTML = '<div class="empty-wh">Chưa có webhook nào được đăng ký.</div>';
      return;
    }

    webhookList.innerHTML = '';
    list.forEach(wh => {
      const item = document.createElement('div');
      item.className = 'wh-item';
      const eventsText = Array.isArray(wh.events) ? wh.events.join(', ') : '';
      item.innerHTML = `
        <div class="wh-info">
          <div class="wh-url">${escapeHtml(wh.url || '')}</div>
          <div class="wh-meta">Events: ${escapeHtml(eventsText)} • Secret: ${wh.secret ? '••••••••' : 'None'}</div>
        </div>
        <button type="button" class="btn-delete-wh" data-id="${escapeHtml(wh.id || '')}">Xoá</button>
      `;

      const delBtn = item.querySelector('.btn-delete-wh');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          const id = delBtn.getAttribute('data-id');
          if (!id) return;
          try {
            const delRes = await fetch(`${API_BASE}/webhooks/${encodeURIComponent(id)}`, {
              method: 'DELETE'
            });
            if (delRes.ok) {
              await loadWebhooks();
            }
          } catch (err) {
            console.error('Delete webhook error:', err);
          }
        });
      }

      webhookList.appendChild(item);
    });
  } catch (err) {
    console.error('Webhooks error:', err);
  }
}

async function saveWebhook() {
  const url = whUrlInput.value.trim();
  const secret = whSecretInput.value.trim();
  if (!url) return;

  try {
    const res = await fetch(`${API_BASE}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret,
        events: ['message.received', 'message.sent']
      })
    });
    if (res.ok) {
      whUrlInput.value = '';
      whSecretInput.value = '';
      await loadWebhooks();
    }
  } catch (err) {
    console.error('Save webhook error:', err);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g,
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}
