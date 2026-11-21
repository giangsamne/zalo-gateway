// ==========================================================================
// Zalo Web & Gateway Frontend Application
// ==========================================================================

const API_BASE = '/api/v1';

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
const chatHeader = document.getElementById('chat-header');
const activeChatName = document.getElementById('active-chat-name');
const activeChatAvatar = document.getElementById('active-chat-avatar');
const activeChatStatus = document.getElementById('active-chat-status');
const chatMessages = document.getElementById('chat-messages');
const chatFooter = document.getElementById('chat-footer');
const richInput = document.getElementById('richInput');
const btnSendMsg = document.getElementById('btn-send-msg');
const welcomeCard = document.getElementById('welcome-card');

const modalQR = document.getElementById('modal-qr');
const qrImage = document.getElementById('qr-image');
const qrLoading = document.getElementById('qr-loading');
const qrStatusText = document.getElementById('qr-status-text');
const btnLoginModal = document.getElementById('btn-login-modal');

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

  // Start fallback polling every 2s
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
    ? allThreads.filter(t => t.name.toLowerCase().includes(query) || (t.lastMessage && t.lastMessage.toLowerCase().includes(query)))
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

function initEventListeners() {
  // Search input filter
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    renderThreads(allThreads.filter(t => t.name.toLowerCase().includes(query) || (t.lastMessage && t.lastMessage.toLowerCase().includes(query))));
  });

  // Send message button click
  btnSendMsg.addEventListener('click', () => {
    sendMessage();
  });

  // Enter to send, Shift+Enter for newline
  richInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Open QR modal
  btnLoginModal.addEventListener('click', () => {
    openQRModal();
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

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-close');
      document.getElementById(targetId).classList.remove('open');
      if (targetId === 'modal-qr' && qrPollTimer) {
        clearInterval(qrPollTimer);
        qrPollTimer = null;
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
      if (isConnected) {
        dot.classList.add('connected');
        qrStatusText.textContent = 'Đã kết nối Zalo PC Desktop';
      } else {
        dot.classList.remove('connected');
        qrStatusText.textContent = 'Chưa kết nối - Quét mã QR';
      }
    }

    const onlineDot = document.getElementById('online-dot');
    if (onlineDot) {
      onlineDot.style.backgroundColor = isConnected ? '#22b14c' : '#e53935';
    }
    if (!isConnected && activeChatStatus) {
      activeChatStatus.textContent = 'Mất kết nối Zalo PC Desktop Engine';
    } else if (isConnected && activeChatStatus && currentThreadId) {
      activeChatStatus.textContent = 'Trực tuyến • Zalo PC Desktop Engine';
    }
  } catch (err) {
    console.error('Status error:', err);
  }
}

async function openQRModal() {
  modalQR.classList.add('open');
  await refreshQRCode();

  if (!qrPollTimer) {
    qrPollTimer = setInterval(async () => {
      await refreshQRCode();
      await checkStatus();
      if (isConnected) {
        clearInterval(qrPollTimer);
        qrPollTimer = null;
        setTimeout(() => modalQR.classList.remove('open'), 1000);
      }
    }, 4000);
  }
}

async function refreshQRCode() {
  qrLoading.style.display = 'flex';
  try {
    const res = await fetch(`${API_BASE}/login/qr`);
    const data = await res.json();

    if (data.status === 'qr_ready' && data.qr_image_base64) {
      qrImage.src = data.qr_image_base64;
      qrLoading.style.display = 'none';
      qrStatusText.textContent = 'Mã QR mới sẵn sàng. Hãy quét bằng điện thoại!';
    } else if (data.connected) {
      qrLoading.innerHTML = '<span style="color:#22b14c; font-weight:600;">✓ Đã đăng nhập Zalo PC thành công!</span>';
      qrLoading.style.display = 'flex';
    }
  } catch (err) {
    console.error('QR fetch error:', err);
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
    convList.innerHTML = '<div class="conv-loading"><span>Chưa có cuộc trò chuyện nào</span></div>';
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

    const avatarSrc = t.avatar || '/static/zalo-assets/assets/logo-new.146dfa01c78183631d33b77999a18288.svg';

    item.innerHTML = `
      <div class="conv-item-avatar-wrap">
        <img src="${avatarSrc}" class="conv-item-avatar" alt="${t.name}">
      </div>
      <div class="conv-item-body">
        <div class="conv-item-header">
          <span class="conv-item-name">${t.name}</span>
          <span class="conv-item-time">${t.lastIsoTime || ''}</span>
        </div>
        <div class="conv-item-footer">
          <span class="conv-item-snippet">${t.lastMessage || 'Bắt đầu cuộc trò chuyện'}</span>
          ${t.unreadCount > 0 ? `<span class="conv-item-badge">${t.unreadCount}</span>` : ''}
        </div>
      </div>
    `;

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

  // Update header
  activeChatName.textContent = t.name;
  if (t.avatar) {
    activeChatAvatar.src = t.avatar;
  }
  activeChatStatus.textContent = isConnected ? 'Trực tuyến • Zalo PC Desktop Engine' : 'Mất kết nối Zalo PC Desktop Engine';

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
      <div style="text-align:center; color:#72808e; font-size:13px; margin-top:20px;">
        Chưa có tin nhắn trong hội thoại này. Hãy nhập tin nhắn bên dưới để bắt đầu!
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
    const timeText = m.isoTime || m.iso_time || '';

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

  // Optimistic UI update
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
      // Reload thread snippet & synced messages
      setTimeout(() => {
        lastMessagesSig = '';
        loadThreads();
        if (currentThreadId && !isSending) {
          loadMessages(currentThreadId, true);
        }
      }, 600);
    } else {
      tempBubble.querySelector('.bubble-meta').innerHTML = `<span style="color:#e53935">Lỗi gửi: ${escapeHtml(result.error || 'Không rõ nguyên nhân')}</span>`;
    }
  } catch (err) {
    console.error('Send error:', err);
    tempBubble.querySelector('.bubble-meta').innerHTML = `<span style="color:red">Lỗi gửi!</span>`;
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
      item.style.padding = '10px';
      item.style.borderBottom = '1px solid #e1e4ea';
      item.innerHTML = `
        <div style="font-weight:600; font-size:13.5px; color:#081c36;">${wh.url}</div>
        <div style="font-size:12px; color:#72808e; margin-top:2px;">Events: ${wh.events.join(', ')} • Secret: ${wh.secret ? '••••••••' : 'None'}</div>
      `;
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
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}
