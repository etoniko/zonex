/**
 * Paper.io 2–style canvas client.
 * Server is authority; binary WS + AOI state.
 */

import {
  decodePacket,
  encodeInput,
  encodeJoin,
  encodeName,
  encodeChat,
  encodeColor,
} from './binary.js';
import { PLAYER_COLORS, colorIndex, RANDOM_COLOR_IDX } from './palette.js';
import { detectPlatform, isTV, isMobileLayout } from './platform.js';
import { MobileControls } from './MobileControls.js';
import { TvControls } from './TvControls.js';
import { resolveWsUrl, resolveRatingsUrl } from './servers.js';

detectPlatform();
window.addEventListener('resize', () => {
  detectPlatform();
  syncDeviceControls();
  layoutKillsUnderChat();
  syncMenuRatingVisibility();
});

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');
const overlay = document.getElementById('overlay');
const playBtn = document.getElementById('play');
const deadEl = document.getElementById('dead');
const deadMap = document.getElementById('dead-map');
const deadMapCtx = deadMap.getContext('2d');
const retryBtn = document.getElementById('retry');
const pctEl = document.getElementById('pct');
const killsEl = document.getElementById('kills');
const killsN = document.getElementById('kills-n');
const boardEl = document.getElementById('board');
const boardClose = document.getElementById('board-close');
const boardShow = document.getElementById('board-show');
const chatClose = document.getElementById('chat-close');
const chatShow = document.getElementById('chat-show');
const chatWrite = document.getElementById('chat-write');
const boardRows = document.getElementById('board-rows');
const menuRating = document.getElementById('menu-rating');
const ratingList = document.getElementById('rating-list');
const ratingToggle = document.getElementById('rating-toggle');
const nickInput = document.getElementById('nick');
const chatPanel = document.getElementById('hud-chat');
const chatContent = document.getElementById('chat-content');
const chatCompose = document.getElementById('chat-compose');
const optChat = document.getElementById('opt-chat');
const optNames = document.getElementById('opt-names');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const menuColors = document.getElementById('menu-colors');

/** Last alive self snapshot for end-screen if death packet has no poly. */
let lastAliveMe = null;
/** @type {{ name: string, color: string, text: string }[]} */
const chatMessages = [];
const CHAT_ALLOWED = /[^a-zA-Zа-яА-ЯёЁ0-9 =_<>!.\-]/g;

const settings = {
  chat: true,
  names: true,
};

/** Session UI: panels collapsed by × */
let boardCollapsed = false;
let chatFeedCollapsed = false;

let selectedColorIdx = RANDOM_COLOR_IDX;
try {
  nickInput.value = localStorage.getItem('zonex_nick') || '';
  const savedColor = localStorage.getItem('zonex_color');
  if (savedColor == null || savedColor === '' || savedColor === 'random') {
    selectedColorIdx = RANDOM_COLOR_IDX;
  } else {
    const idx = colorIndex(savedColor);
    if (idx >= 0) selectedColorIdx = idx;
  }
  const raw = localStorage.getItem('zonex_settings');
  if (raw) {
    const s = JSON.parse(raw);
    if (typeof s.chat === 'boolean') settings.chat = s.chat;
    if (typeof s.names === 'boolean') settings.names = s.names;
  }
} catch {
  /* ignore */
}

if (optChat) optChat.checked = settings.chat;
if (optNames) optNames.checked = settings.names;

function saveSettings() {
  try {
    localStorage.setItem('zonex_settings', JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  applySettingsUi();
  if (state?.board) updateLeaderboard(state.board);
}

function applySettingsUi() {
  if (!settings.chat) {
    closeChatCompose();
    if (chatPanel) chatPanel.hidden = true;
  } else {
    renderChat();
  }
  syncPanelToggles();
}

optChat?.addEventListener('change', () => {
  settings.chat = !!optChat.checked;
  saveSettings();
});
optNames?.addEventListener('change', () => {
  settings.names = !!optNames.checked;
  saveSettings();
});

function settingsOpen() {
  return !!settingsPanel?.classList.contains('open');
}

function openSettings() {
  settingsPanel?.classList.add('open');
}

function closeSettings() {
  settingsPanel?.classList.remove('open');
}

function toggleSettings() {
  if (settingsOpen()) closeSettings();
  else openSettings();
}

settingsBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsBtn.blur();
  toggleSettings();
});
document.addEventListener('click', (e) => {
  if (!settingsOpen()) return;
  if (settingsPanel.contains(e.target) || settingsBtn.contains(e.target)) return;
  closeSettings();
});

function playerName() {
  let n = (nickInput.value || '').trim().slice(0, 16);
  if (!n) n = 'Игрок';
  try {
    localStorage.setItem('zonex_nick', n);
  } catch {
    /* ignore */
  }
  return n;
}

function saveSelectedColor() {
  try {
    localStorage.setItem(
      'zonex_color',
      selectedColorIdx === RANDOM_COLOR_IDX ? 'random' : PLAYER_COLORS[selectedColorIdx]
    );
  } catch {
    /* ignore */
  }
}

function syncColorUi() {
  if (!menuColors) return;
  menuColors.querySelectorAll('.color-cell').forEach((btn) => {
    btn.classList.toggle('selected', Number(btn.dataset.idx) === selectedColorIdx);
  });
}

function selectColor(idx, send = true) {
  const i = Number(idx);
  if (i === RANDOM_COLOR_IDX) {
    selectedColorIdx = RANDOM_COLOR_IDX;
  } else if (!Number.isInteger(i) || i < 0 || i >= PLAYER_COLORS.length) {
    return;
  } else {
    selectedColorIdx = i;
  }
  saveSelectedColor();
  syncColorUi();
  if (send) sendColor();
}

function sendColor() {
  if (ws?.readyState !== 1 || !myId) return;
  const me = state?.zones?.find((z) => z.id === myId);
  if (!me?.alive) return;
  ws.send(encodeColor(selectedColorIdx));
}

function mountColorPickers() {
  if (!menuColors) return;
  menuColors.innerHTML = '';

  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.className = 'color-cell random';
  randomBtn.dataset.idx = String(RANDOM_COLOR_IDX);
  randomBtn.title = 'Случайный';
  randomBtn.setAttribute('aria-label', 'Случайный цвет');
  randomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectColor(RANDOM_COLOR_IDX, true);
  });
  menuColors.appendChild(randomBtn);

  PLAYER_COLORS.forEach((hex, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-cell';
    btn.dataset.idx = String(i);
    btn.style.background = hex;
    btn.title = 'Цвет';
    btn.setAttribute('aria-label', `Цвет ${i + 1}`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectColor(i, true);
    });
    menuColors.appendChild(btn);
  });
  syncColorUi();
}
mountColorPickers();

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const GRID = 40;
/** Client-only zoom: visible world span on short axis (wheel). */
const VIEW_MIN = 120;
const VIEW_MAX = 2800;
const VIEW_DEFAULT = 520;
let viewSpan = VIEW_DEFAULT;

let myId = null;
let state = null;
let playing = false;
/** Screen-space mouse (client pixels) + last sent delta. */
let mouse = { x: 0, y: 0 };
let oldDx = 0;
let oldDy = 0;

function inGameplayControls() {
  return !!(
    playing &&
    myId &&
    !menuOpen() &&
    !deadEl.classList.contains('show') &&
    !isChatComposeOpen()
  );
}

const mobileControls = new MobileControls({
  mouse,
  getViewSpan: () => viewSpan,
  setViewSpan: (v) => {
    viewSpan = v;
  },
  viewMin: VIEW_MIN,
  viewMax: VIEW_MAX,
  shouldShow: () => inGameplayControls(),
});

const tvControls = new TvControls({
  mouse,
  shouldShow: () => inGameplayControls(),
  isTyping: () =>
    !!(
      isChatComposeOpen() ||
      document.activeElement === nickInput ||
      document.activeElement === chatCompose
    ),
});

function syncDeviceControls() {
  mobileControls.syncVisibility();
}
let cam = { x: 0, y: 0, scale: 1 };
let smoothCam = { x: 0, y: 0 };
/**
 * Render poses: server sets targets; frame loop eases + predicts between 50ms ticks.
 */
const visuals = new Map();
const SMOOTH_RATE = 14; // frame ease toward server pose
let lastFrameAt = performance.now();
let lastStateAt = 0;

/** Like slither: ignore aim if cursor is too close to screen center. */
const AIM_DEADZONE2 = 64; // 8px

function resize() {
  canvas.width = Math.floor(window.innerWidth * devicePixelRatio);
  canvas.height = Math.floor(window.innerHeight * devicePixelRatio);
}
window.addEventListener('resize', resize);
resize();

/** Client-only zoom — does not touch server / AOI. */
window.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.08 : 1 / 1.08;
    viewSpan = Math.min(VIEW_MAX, Math.max(VIEW_MIN, viewSpan * factor));
  },
  { passive: false }
);

let ws = null;

function connect() {
  const wsUrl = resolveWsUrl();
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  ws.addEventListener('open', () => {
    if (playing) ws.send(encodeJoin(playerName(), selectedColorIdx));
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = decodePacket(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'welcome') {
      myId = msg.id;
      deadEl.classList.remove('show');
      syncDeviceControls();
      syncPanelToggles();
    } else if (msg.type === 'chat_msg') {
      if (settings.chat) pushChatMessage(msg);
    } else if (msg.type === 'state') {
      state = msg;
      absorbState(msg);
      const me = msg.zones.find((z) => z.id === myId);
      const boardMe = msg.board?.find((b) => b.id === myId);
      if (me?.alive) {
        lastAliveMe = {
          territory: me.territory,
          color: me.color,
          pct: boardMe?.pct,
          size: msg.size,
        };
      }
      if (playing && myId && (!me || !me.alive)) {
        overlay.classList.add('hidden');
        showDeathScreen(me, boardMe, msg.size);
        myId = null;
        syncDeviceControls();
        syncPanelToggles();
      }
      updatePct(me);
      updateLeaderboard(msg.board || []);
    }
  });
  ws.addEventListener('close', () => {
    setTimeout(connect, 800);
  });
}
connect();

function startGame() {
  deadEl.classList.remove('show');
  overlay.classList.add('hidden');
  hideMenuSettings();
  document.body.classList.add('playing');
  mouse.x = window.innerWidth / 2;
  mouse.y = window.innerHeight / 2;
  oldDx = 0;
  oldDy = 0;
  syncMenuRatingVisibility();

  // Already in a live match — apply nick/color, close menu
  const me = myId && state?.zones?.find((z) => z.id === myId);
  if (playing && me?.alive) {
    sendNick();
    sendColor();
    syncDeviceControls();
    return;
  }

  playing = true;
  lastAliveMe = null;
  visuals.clear();
  if (ws?.readyState === 1) {
    ws.send(encodeJoin(playerName(), selectedColorIdx));
  }
  syncDeviceControls();
  syncPanelToggles();
}

function sendNick() {
  if (ws?.readyState !== 1 || !myId) return;
  ws.send(encodeName(playerName()));
}

function menuOpen() {
  return !overlay.classList.contains('hidden');
}

function isChatComposeOpen() {
  return !!(chatCompose && !chatCompose.hidden);
}

function sanitizeChatInput(raw) {
  return String(raw || '')
    .replace(CHAT_ALLOWED, '')
    .slice(0, 80);
}

function sanitizeChat(raw) {
  return sanitizeChatInput(raw).replace(/ {2,}/g, ' ').trim();
}

function pushChatMessage(msg) {
  chatMessages.push({
    name: msg.name || 'Игрок',
    color: msg.color || '#2f6bff',
    text: msg.text || '',
  });
  if (chatMessages.length > 50) chatMessages.splice(0, chatMessages.length - 50);
  renderChat();
}

function layoutKillsUnderChat() {
  if (!killsEl) return;
  const left = 14;
  let top = 14;
  if (chatPanel && !chatPanel.hidden) {
    const r = chatPanel.getBoundingClientRect();
    top = Math.round(r.bottom + 8);
  } else if (chatShow && !chatShow.hidden) {
    const r = chatShow.getBoundingClientRect();
    top = Math.round(r.bottom + 8);
  }
  killsEl.style.left = `${left}px`;
  killsEl.style.top = `${top}px`;
}

function syncPanelToggles() {
  if (boardEl) boardEl.classList.toggle('is-collapsed', boardCollapsed);
  if (boardShow) {
    boardShow.hidden = !(playing && boardCollapsed);
  }
  if (chatShow) {
    chatShow.hidden = !(playing && settings.chat && chatFeedCollapsed);
  }
  if (chatWrite) {
    const showWrite =
      playing &&
      settings.chat &&
      !chatFeedCollapsed &&
      chatMessages.length > 0 &&
      !!myId &&
      !menuOpen() &&
      !deadEl.classList.contains('show') &&
      !isTV();
    chatWrite.hidden = !showWrite;
  }
  layoutKillsUnderChat();
}

function renderChat() {
  if (!chatContent || !chatPanel) return;
  if (!settings.chat || chatFeedCollapsed) {
    chatPanel.hidden = true;
    syncPanelToggles();
    return;
  }
  chatContent.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const m of chatMessages) {
    const tile = document.createElement('div');
    tile.className = 'hud-message-tile';
    const item = document.createElement('span');
    item.className = 'hud-message-item';
    item.style.color = m.color;
    item.textContent = `${m.name}: `;
    const body = document.createElement('span');
    body.className = 'hud-message';
    body.textContent = m.text;
    item.appendChild(body);
    tile.appendChild(item);
    frag.appendChild(tile);
  }
  chatContent.appendChild(frag);
  chatContent.scrollTop = chatContent.scrollHeight;
  // Панель только если кто-то уже писал
  chatPanel.hidden = chatMessages.length === 0;
  syncPanelToggles();
}

function openChatCompose() {
  if (!chatCompose) return;
  if (!settings.chat) return;
  if (!playing || !myId) return;
  if (menuOpen()) return;
  if (deadEl.classList.contains('show')) return;
  chatCompose.hidden = false;
  chatCompose.value = '';
  requestAnimationFrame(() => chatCompose.focus());
}

function closeChatCompose() {
  if (!chatCompose) return;
  chatCompose.blur();
  chatCompose.value = '';
  chatCompose.hidden = true;
}

boardClose?.addEventListener('click', (e) => {
  e.stopPropagation();
  boardCollapsed = true;
  syncPanelToggles();
});
boardShow?.addEventListener('click', (e) => {
  e.stopPropagation();
  boardCollapsed = false;
  syncPanelToggles();
});
chatClose?.addEventListener('click', (e) => {
  e.stopPropagation();
  chatFeedCollapsed = true;
  if (chatPanel) chatPanel.hidden = true;
  syncPanelToggles();
});
chatShow?.addEventListener('click', (e) => {
  e.stopPropagation();
  chatFeedCollapsed = false;
  renderChat();
  syncPanelToggles();
});
chatWrite?.addEventListener('click', (e) => {
  e.stopPropagation();
  openChatCompose();
});

function submitChatCompose() {
  if (!chatCompose) return;
  const value = sanitizeChat(chatCompose.value);
  if (value && ws?.readyState === 1) ws.send(encodeChat(value));
  closeChatCompose();
}

function hideMenuSettings() {
  closeSettings();
  settingsBtn?.classList.remove('show');
}

function showMenuSettings() {
  settingsBtn?.classList.add('show');
}

/** ESC — client menu only; stay on server. */
function openMenu() {
  closeChatCompose();
  deadEl.classList.remove('show');
  overlay.classList.remove('hidden');
  showMenuSettings();
  syncDeviceControls();
  syncPanelToggles();
  syncMenuRatingVisibility();
  loadMenuRating();
}

function closeMenu() {
  if (!playing) return;
  const me = myId && state?.zones?.find((z) => z.id === myId);
  if (me?.alive) {
    sendNick();
    overlay.classList.add('hidden');
    hideMenuSettings();
    syncDeviceControls();
    syncPanelToggles();
    syncMenuRatingVisibility();
  }
}

// Gear only on the start/menu screen
if (!overlay.classList.contains('hidden')) showMenuSettings();
else hideMenuSettings();

playBtn.addEventListener('click', (e) => {
  playBtn.blur();
  startGame();
});
nickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
});
retryBtn.addEventListener('click', (e) => {
  retryBtn.blur();
  startGame();
});
chatCompose?.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    e.stopPropagation();
    submitChatCompose();
  } else if (e.code === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeChatCompose();
  }
});
chatCompose?.addEventListener('input', () => {
  const live = sanitizeChatInput(chatCompose.value);
  if (live !== chatCompose.value) chatCompose.value = live;
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (isChatComposeOpen()) {
      closeChatCompose();
      return;
    }
    if (settingsOpen()) {
      closeSettings();
      return;
    }
    if (menuOpen()) {
      closeMenu();
      return;
    }
    openMenu();
    return;
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (menuOpen() || isChatComposeOpen() || settingsOpen()) return;
    if (document.activeElement === nickInput) return;
    if (!playing || !myId || deadEl.classList.contains('show')) return;
    // TV: Enter = OK на пульте, чат не открываем
    if (isTV()) return;
    e.preventDefault();
    openChatCompose();
  }
});

function pctFromTerritory(territory, worldSize) {
  const area = territoryArea(territory);
  const r = (worldSize || 4000) / 2;
  const world = Math.PI * r * r;
  if (!(world > 0)) return 0;
  return Math.min(100, (area / world) * 100);
}

function showDeathScreen(me, boardMe, worldSize) {
  const src =
    me?.territory?.length
      ? me
      : lastAliveMe?.territory?.length
        ? lastAliveMe
        : me || lastAliveMe;
  const size = worldSize || lastAliveMe?.size || state?.size || 4000;
  let pct = boardMe?.pct;
  if (pct == null && lastAliveMe?.pct != null) pct = lastAliveMe.pct;
  if (pct == null) pct = pctFromTerritory(src?.territory, size);
  drawDeathMap(src?.territory, src?.color || '#2f6bff', Number(pct || 0));
  hideMenuSettings();
  deadEl.classList.add('show');
}

/** Fit final territory — shape only; pct centered in dark edge color. */
function drawDeathMap(territory, color, pct) {
  const w = deadMap.width;
  const h = deadMap.height;
  const dctx = deadMapCtx;
  dctx.clearRect(0, 0, w, h);

  const edge = shade(color || '#2f6bff', 0.7);
  const cx = w / 2;
  const cy = h / 2;

  if (territory?.length) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const poly of territory) {
      for (const p of poly[0] || []) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
      }
    }
    const bw = Math.max(40, maxX - minX);
    const bh = Math.max(40, maxY - minY);
    const pad = 16;
    const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
    const ox = cx - ((minX + maxX) / 2) * s;
    const oy = cy - ((minY + maxY) / 2) * s;

    dctx.fillStyle = hexAlpha(color || '#2f6bff', 0.9);
    dctx.strokeStyle = edge;
    dctx.lineWidth = 2;
    for (const poly of territory) {
      const outer = poly[0];
      if (!outer?.length) continue;
      dctx.beginPath();
      dctx.moveTo(ox + outer[0][0] * s, oy + outer[0][1] * s);
      for (let i = 1; i < outer.length; i++) {
        dctx.lineTo(ox + outer[i][0] * s, oy + outer[i][1] * s);
      }
      dctx.closePath();
      dctx.fill();
      dctx.stroke();
    }
  }

  const label = `${Number(pct || 0).toFixed(1)}%`;
  dctx.font = '900 28px Nunito, sans-serif';
  dctx.textAlign = 'center';
  dctx.textBaseline = 'middle';
  dctx.fillStyle = edge;
  dctx.fillText(label, cx, cy);
}

/**
 * Slither-style: delta from canvas/screen center in CSS pixels.
 */
function getMouseDelta() {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return {
    dx: mouse.x - cx,
    dy: mouse.y - cy,
  };
}

function onPointer(e) {
  // Touch / TV aim comes from MobileControls / TvControls
  if (mobileControls.active || isTV()) return;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
}

canvas.addEventListener('pointerdown', onPointer);
canvas.addEventListener('pointermove', onPointer);
window.addEventListener('pointermove', (e) => {
  if (!playing || menuOpen() || isChatComposeOpen() || settingsOpen()) return;
  onPointer(e);
});

setInterval(() => {
  if (!playing || menuOpen() || isChatComposeOpen() || settingsOpen() || !ws || ws.readyState !== 1 || !myId) return;
  const { dx, dy } = getMouseDelta();
  const len2 = dx * dx + dy * dy;
  if (len2 < AIM_DEADZONE2) return;
  if (Math.abs(oldDx - dx) < 0.5 && Math.abs(oldDy - dy) < 0.5) return;
  oldDx = dx;
  oldDy = dy;
  ws.send(encodeInput(dx, dy));
}, 33);

function updatePct(me) {
  if (!state) {
    pctEl.textContent = '0.0';
    if (killsN) killsN.textContent = '0';
    return;
  }
  const fromBoard = state.board?.find((b) => b.id === myId);
  if (fromBoard) {
    pctEl.textContent = fromBoard.pct.toFixed(1);
  } else if (!me?.territory) {
    pctEl.textContent = '0.0';
  } else {
    const area = territoryArea(me.territory);
    const r = state.size / 2;
    const world = Math.PI * r * r;
    const p = Math.min(100, (area / world) * 100);
    pctEl.textContent = p.toFixed(1);
  }
  if (killsN) {
    const k = me?.kills ?? 0;
    killsN.textContent = String(Math.max(0, k | 0));
  }
  layoutKillsUnderChat();
}

function boardRowHtml(b, rank, extraClass = '') {
  const me = String(b.id) === String(myId) ? ' me' : '';
  const label = settings.names ? escapeHtml(b.name || 'Игрок') : '•••';
  const pct = Math.max(0, Math.min(100, b.pct || 0));
  return `<div class="row${me}${extraClass}"><div class="bar" style="width:${pct}%;background:${b.color}"></div><span class="rank">${rank}</span><span class="dot" style="background:${b.color}"></span><span class="name">${label}</span><span class="score">${pct.toFixed(1)}%</span></div>`;
}

function updateLeaderboard(board) {
  const list = board || [];
  const topN = isMobileLayout() ? 3 : 5;
  const top = list.slice(0, topN);
  let html = top.map((b, i) => boardRowHtml(b, i + 1)).join('');

  // Свою строку снизу — только если не попал в топ
  if (myId) {
    const myRank = list.findIndex((b) => String(b.id) === String(myId));
    if (myRank >= topN) {
      html += boardRowHtml(list[myRank], myRank + 1, ' self-slot');
    }
  }

  boardRows.innerHTML = html;
}

/** Rating score is hundredths of a percent → "12.3%" */
function formatRatingScore(score) {
  const pct = (score | 0) / 100;
  return `${pct.toFixed(1)}%`;
}

function ratingRowHtml(row, rank) {
  const top1 = rank === 1 ? ' top1' : '';
  return `<div class="row${top1}" data-ri="${rank - 1}"><span class="rank">${rank}</span><canvas class="shape" width="56" height="56" aria-hidden="true"></canvas><span class="name">${escapeHtml(row.name || 'Игрок')}</span><span class="score">${formatRatingScore(row.rating)}</span></div>`;
}

function drawRatingShape(canvas, shape, color) {
  if (!canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, w, h);
  const fill = color || '#2f6bff';
  if (!shape?.length) {
    c.fillStyle = hexAlpha(fill, 0.35);
    c.beginPath();
    c.arc(w / 2, h / 2, Math.min(w, h) * 0.28, 0, Math.PI * 2);
    c.fill();
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of shape) {
    for (const p of ring || []) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  const bw = Math.max(8, maxX - minX);
  const bh = Math.max(8, maxY - minY);
  const pad = 6;
  const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const ox = w / 2 - ((minX + maxX) / 2) * s;
  const oy = h / 2 - ((minY + maxY) / 2) * s;

  c.fillStyle = hexAlpha(fill, 0.92);
  c.strokeStyle = shade(fill, 0.7);
  c.lineWidth = 2;
  for (const ring of shape) {
    if (!ring?.length) continue;
    c.beginPath();
    c.moveTo(ox + ring[0][0] * s, oy + ring[0][1] * s);
    for (let i = 1; i < ring.length; i++) {
      c.lineTo(ox + ring[i][0] * s, oy + ring[i][1] * s);
    }
    c.closePath();
    c.fill();
    c.stroke();
  }
}

function paintRatingShapes(items) {
  if (!ratingList) return;
  const canvases = ratingList.querySelectorAll('canvas.shape');
  canvases.forEach((cv, i) => {
    const row = items[i];
    if (!row) return;
    drawRatingShape(cv, row.shape, row.color);
  });
}

function renderRatingList(items) {
  if (!ratingList) return;
  if (!items.length) {
    ratingList.innerHTML = '<div class="lb-empty">Пока никого нет</div>';
    return;
  }
  ratingList.innerHTML = items.map((row, i) => ratingRowHtml(row, i + 1)).join('');
  paintRatingShapes(items);
}

let ratingExpanded = false;
let ratingHasMore = false;
let ratingLoading = false;
let ratingItems = [];

function syncMenuRatingVisibility() {
  if (!menuRating) return;
  const menuVisible = !overlay.classList.contains('hidden');
  const hide = !menuVisible || isMobileLayout() || isTV();
  menuRating.hidden = hide;
}

async function fetchRatings(offset, limit) {
  const base = resolveRatingsUrl();
  const join = base.includes('?') ? '&' : '?';
  const url = `${base}${join}offset=${offset | 0}&limit=${limit | 0}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function loadMenuRating() {
  if (!ratingList || isMobileLayout() || isTV()) return;
  ratingExpanded = false;
  ratingHasMore = false;
  ratingItems = [];
  if (menuRating) menuRating.dataset.expanded = '0';
  if (ratingToggle) {
    ratingToggle.disabled = true;
    ratingToggle.setAttribute('aria-expanded', 'false');
  }
  ratingList.innerHTML = '<div class="lb-empty">Загрузка…</div>';
  try {
    const data = await fetchRatings(0, 5);
    ratingItems = data.items || [];
    ratingHasMore = !!data.hasMore || (data.total | 0) > ratingItems.length;
    renderRatingList(ratingItems);
  } catch {
    ratingList.innerHTML = '<div class="lb-empty">Не удалось загрузить</div>';
  }
  if (ratingToggle) ratingToggle.disabled = !ratingHasMore && ratingItems.length <= 5;
}

async function expandMenuRating() {
  if (ratingLoading || !ratingList) return;
  ratingLoading = true;
  try {
    if (ratingItems.length <= 5 && ratingHasMore) {
      const data = await fetchRatings(0, 50);
      ratingItems = data.items || [];
      ratingHasMore = !!data.hasMore;
      renderRatingList(ratingItems);
    }
    ratingExpanded = true;
    if (menuRating) menuRating.dataset.expanded = '1';
    if (ratingToggle) ratingToggle.setAttribute('aria-expanded', 'true');
  } catch {
    /* keep top-5 */
  }
  ratingLoading = false;
}

function collapseMenuRating() {
  ratingExpanded = false;
  if (menuRating) menuRating.dataset.expanded = '0';
  if (ratingToggle) ratingToggle.setAttribute('aria-expanded', 'false');
  if (ratingList) ratingList.scrollTop = 0;
  renderRatingList(ratingItems.slice(0, 5));
}

ratingToggle?.addEventListener('click', (e) => {
  e.preventDefault();
  if (ratingExpanded) collapseMenuRating();
  else expandMenuRating();
});

syncMenuRatingVisibility();
loadMenuRating();

let lastMinimapAt = 0;
const MINIMAP_MS = 500;

/** Mobile: tap minimap to expand / collapse. */
mini?.addEventListener(
  'pointerdown',
  (e) => {
    if (!isMobileLayout()) return;
    e.preventDefault();
    e.stopPropagation();
    mini.classList.toggle('expanded');
    drawMinimap(true);
  },
  { passive: false }
);

function drawMinimap(force = false) {
  const now = performance.now();
  if (!force && now - lastMinimapAt < MINIMAP_MS) return;
  lastMinimapAt = now;

  const w = mini.width;
  const h = mini.height;
  const size = state?.size || 4000;
  const cx = w / 2;
  const cy = h / 2;
  const mapR = Math.min(w, h) / 2 - 1;
  const s = (mapR * 2) / size;
  const ox = cx - (size / 2) * s;
  const oy = cy - (size / 2) * s;

  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, w, h);

  mctx.beginPath();
  mctx.arc(cx, cy, mapR, 0, Math.PI * 2);
  mctx.fillStyle = '#94a3b8';
  mctx.fill();

  mctx.save();
  mctx.beginPath();
  mctx.arc(cx, cy, mapR, 0, Math.PI * 2);
  mctx.clip();

  mctx.beginPath();
  mctx.arc(cx, cy, mapR - 1, 0, Math.PI * 2);
  mctx.fillStyle = '#eef2f6';
  mctx.fill();

  for (const z of state?.zones || []) {
    if (!z.alive || !z.territory?.length) continue;
    mctx.fillStyle = hexAlpha(z.color, 0.55);
    for (const poly of z.territory) {
      const outer = poly[0];
      if (!outer?.length) continue;
      mctx.beginPath();
      mctx.moveTo(ox + outer[0][0] * s, oy + outer[0][1] * s);
      for (let i = 1; i < outer.length; i++) {
        mctx.lineTo(ox + outer[i][0] * s, oy + outer[i][1] * s);
      }
      mctx.closePath();
      mctx.fill();
    }
  }

  for (const b of state?.board || []) {
    const x = ox + b.cell[0] * s;
    const y = oy + b.cell[1] * s;
    const me = b.id === myId;
    mctx.fillStyle = b.color;
    if (me) {
      const hs = 2.5;
      mctx.fillRect(x - hs, y - hs, hs * 2, hs * 2);
      mctx.strokeStyle = '#1e293b';
      mctx.lineWidth = 1;
      mctx.strokeRect(x - hs, y - hs, hs * 2, hs * 2);
    } else {
      mctx.beginPath();
      mctx.arc(x, y, 2.5, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  mctx.restore();

  mctx.beginPath();
  mctx.arc(cx, cy, mapR - 0.5, 0, Math.PI * 2);
  mctx.strokeStyle = '#64748b';
  mctx.lineWidth = 1;
  mctx.stroke();
}

function territoryArea(multi) {
  let a = 0;
  for (const poly of multi || []) {
    const ring = poly[0];
    if (!ring?.length) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
  }
  return Math.abs(a) / 2;
}

function hexAlpha(hex, a) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function shade(hex, factor) {
  const n = hex.replace('#', '');
  const r = Math.min(255, Math.max(0, Math.round(parseInt(n.slice(0, 2), 16) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(parseInt(n.slice(2, 4), 16) * factor)));
  const b = Math.min(255, Math.max(0, Math.round(parseInt(n.slice(4, 6), 16) * factor)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function drawPaperBg(size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const rim = 6;

  // Gray void
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(cx - r - 400, cy - r - 400, size + 800, size + 800);

  // Dark rim
  ctx.beginPath();
  ctx.arc(cx, cy, r + rim, 0, Math.PI * 2);
  ctx.fillStyle = '#64748b';
  ctx.fill();

  // Light playable disc
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#eef2f6';
  ctx.fill();

  // Dot grid clipped to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(120, 140, 160, 0.22)';
  for (let x = GRID; x < size; x += GRID) {
    for (let y = GRID; y < size; y += GRID) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
  }
  ctx.restore();
}

/** Flat paper cutout — solid fill, thin crisp edge (no jelly glow). */
function drawTerritory(multi, color) {
  if (!multi?.length) return;
  for (const poly of multi) {
    const outer = poly[0];
    if (!outer?.length) continue;
    ctx.beginPath();
    ctx.moveTo(outer[0][0], outer[0][1]);
    for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i][0], outer[i][1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill('nonzero');
    ctx.strokeStyle = shade(color, 0.78);
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/**
 * Clip so strokes only paint outside `territory` (evenodd: world − fill).
 * Guarantees own zone stays above own trail — no stub through the fill.
 */
function clipOutsideTerritory(territory, worldSize) {
  if (!territory?.length) return;
  ctx.beginPath();
  const pad = 800;
  ctx.rect(-pad, -pad, worldSize + pad * 2, worldSize + pad * 2);
  for (const poly of territory) {
    for (const ring of poly) {
      if (!ring?.length) continue;
      ctx.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
      ctx.closePath();
    }
  }
  ctx.clip('evenodd');
}

/** Parse #rrggbb → rgba string. */
function rgbaFromHex(hex, a) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Solid ribbon; optional tip fade; startButt hides stub into own zone. */
function drawTrail(trail, color, radius, trailWidth, fadeTip = 0, startButt = false) {
  if (!trail || trail.length < 2) return;
  const w = trailWidth || Math.max(8, radius * 1.55);
  const edge = shade(color, 0.72);
  const gap = 48;

  const strokeSolid = (pts, cap = 'round') => {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = edge;
    ctx.lineWidth = w;
    ctx.lineJoin = 'round';
    ctx.lineCap = cap;
    ctx.stroke();
  };

  /** Last stretch → transparent (hides round cap under / past the square). */
  const strokeFadedTip = (pts, fadeLen, firstCap) => {
    if (pts.length < 2 || !(fadeLen > 0)) {
      strokeSolid(pts, firstCap);
      return;
    }
    let remain = fadeLen;
    let cutX = pts[pts.length - 1][0];
    let cutY = pts[pts.length - 1][1];
    let cutAt = pts.length - 1;
    for (let i = pts.length - 1; i > 0; i--) {
      const x0 = pts[i - 1][0];
      const y0 = pts[i - 1][1];
      const x1 = pts[i][0];
      const y1 = pts[i][1];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (seg < 1e-6) continue;
      if (remain <= seg) {
        const t = 1 - remain / seg;
        cutX = x0 + (x1 - x0) * t;
        cutY = y0 + (y1 - y0) * t;
        cutAt = i;
        remain = 0;
        break;
      }
      remain -= seg;
      cutAt = i - 1;
      cutX = x0;
      cutY = y0;
    }

    const body = pts.slice(0, cutAt);
    body.push([cutX, cutY]);
    if (body.length >= 2) strokeSolid(body, firstCap);

    const tip = [[cutX, cutY], ...pts.slice(cutAt)];
    if (tip.length < 2) return;
    const a = tip[0];
    const b = tip[tip.length - 1];
    const grad = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
    grad.addColorStop(0, edge);
    grad.addColorStop(0.25, edge);
    grad.addColorStop(1, rgbaFromHex(edge, 0));
    ctx.beginPath();
    ctx.moveTo(tip[0][0], tip[0][1]);
    for (let i = 1; i < tip.length; i++) ctx.lineTo(tip[i][0], tip[i][1]);
    ctx.strokeStyle = grad;
    ctx.lineWidth = w;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.stroke();
  };

  let start = 0;
  const runs = [];
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    if (
      !Number.isFinite(a[0]) ||
      !Number.isFinite(b[0]) ||
      Math.hypot(b[0] - a[0], b[1] - a[1]) > gap
    ) {
      runs.push(trail.slice(start, i));
      start = i;
    }
  }
  runs.push(trail.slice(start));

  for (let r = 0; r < runs.length; r++) {
    const pts = runs[r];
    const last = r === runs.length - 1;
    const firstCap = startButt && r === 0 ? 'butt' : 'round';
    if (last && fadeTip > 0) strokeFadedTip(pts, fadeTip, firstCap);
    else strokeSolid(pts, firstCap);
  }
}

function drawCell(z, vis) {
  if (!(z.radius > 0)) return;
  const x = vis?.x ?? z.cell[0];
  const y = vis?.y ?? z.cell[1];
  const half = (z.radius || 11) + 2; // visual only — slightly larger head
  const dir = vis?.dir ?? z.dir ?? 0;
  const size = half * 2;
  // Trail round-cap nose sits ~trailW/2 ahead of cell — shift square forward
  // so the tip is centered inside the head and does not poke out the front.
  const trailW = z.trailWidth || Math.max(8, (z.radius || 11) * 1.55);
  const fwd = trailW * 0.5;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir);

  ctx.fillStyle = 'rgba(30, 41, 59, 0.14)';
  ctx.fillRect(-half + fwd + 1.5, -half + 2.5, size, size);

  ctx.fillStyle = z.color;
  ctx.fillRect(-half + fwd, -half, size, size);
  ctx.strokeStyle = shade(z.color, 0.72);
  ctx.lineWidth = 1.8;
  ctx.strokeRect(-half + fwd, -half, size, size);

  ctx.restore();

  if (!settings.names || !z.name) return;
  const ink = shade(z.color, 0.55);
  // Name sits above the shifted square (approx. forward offset in world Y when facing up)
  const nameX = x + Math.cos(dir) * fwd;
  const nameY = y + Math.sin(dir) * fwd;
  ctx.save();
  ctx.font = '800 14px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = ink;
  ctx.fillText(z.name, nameX, nameY - half - 5);
  ctx.restore();
}

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Pull server poses into visual targets + velocity for prediction. */
function absorbState(msg) {
  const now = performance.now();
  const dt = lastStateAt ? Math.min(0.12, Math.max(0.02, (now - lastStateAt) / 1000)) : 0.05;
  lastStateAt = now;
  const alive = new Set();
  for (const z of msg.zones || []) {
    if (!z.alive || !(z.radius > 0)) continue;
    alive.add(z.id);
    const tx = z.cell[0];
    const ty = z.cell[1];
    const td = z.dir || 0;
    let v = visuals.get(z.id);
    if (!v) {
      visuals.set(z.id, {
        x: tx,
        y: ty,
        dir: td,
        tx,
        ty,
        tdir: td,
        vx: 0,
        vy: 0,
      });
      continue;
    }
    v.vx = (tx - v.tx) / dt;
    v.vy = (ty - v.ty) / dt;
    // Clamp teleport / AOI pops
    const sp = Math.hypot(v.vx, v.vy);
    if (sp > 400) {
      v.vx = 0;
      v.vy = 0;
      v.x = tx;
      v.y = ty;
    }
    v.tx = tx;
    v.ty = ty;
    v.tdir = td;
  }
  for (const id of [...visuals.keys()]) {
    if (!alive.has(id)) visuals.delete(id);
  }
}

/** Ease visuals toward server pose (no prediction — avoids zoom jitter). */
function stepVisuals(dt) {
  const k = 1 - Math.exp(-SMOOTH_RATE * dt);
  for (const v of visuals.values()) {
    v.x += (v.tx - v.x) * k;
    v.y += (v.ty - v.y) * k;
    v.dir = angleLerp(v.dir, v.tdir, k);
  }
}

function updateCamera(meVis, size) {
  const short = Math.min(canvas.width, canvas.height);
  cam.scale = short / viewSpan;
  // Fixed cam: locked to head, no second lag layer
  if (meVis) {
    smoothCam.x = meVis.x;
    smoothCam.y = meVis.y;
  } else {
    smoothCam.x = size / 2;
    smoothCam.y = size / 2;
  }
}

function buildDrawTrail(z) {
  const vis = visuals.get(z.id);
  let trail = z.trail;
  if (z.radius > 0 && vis && trail?.length) {
    // Solid tip under the square (no fade) — fade caused a white flicker seam
    trail = trail.slice(0, -1);
    trail.push([vis.x, vis.y]);
  }
  if (!trail || trail.length < 2) return null;
  const radius = z.radius > 0 ? z.radius : 11;
  const width = z.trailWidth || Math.max(8, radius * 1.55);
  return { trail, fadeTip: 0, radius, width };
}

function frame(now) {
  const t = now || performance.now();
  let dt = (t - lastFrameAt) / 1000;
  lastFrameAt = t;
  if (dt > 0.05) dt = 0.05;
  if (dt < 0.001) dt = 0.001;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (!state) {
    requestAnimationFrame(frame);
    return;
  }

  stepVisuals(dt);

  const me = state.zones.find((z) => z.id === myId) || state.zones[0];
  const meVis = me ? visuals.get(me.id) : null;
  updateCamera(meVis, state.size);

  ctx.setTransform(
    cam.scale,
    0,
    0,
    cam.scale,
    canvas.width / 2 - smoothCam.x * cam.scale,
    canvas.height / 2 - smoothCam.y * cam.scale
  );

  drawPaperBg(state.size);

  // Fills, then trails clipped outside own fill → own zone is always above own trail.
  // Trail still paints over empty / foreign land.
  for (const z of state.zones) {
    if (!z.alive) continue;
    drawTerritory(z.territory, z.color);
  }
  for (const z of state.zones) {
    if (!z.alive) continue;
    const built = buildDrawTrail(z);
    if (!built) continue;
    ctx.save();
    clipOutsideTerritory(z.territory, state.size);
    drawTrail(built.trail, z.color, built.radius, built.width, built.fadeTip, true);
    ctx.restore();
  }
  for (const z of state.zones) {
    if (!z.alive) continue;
    if (!(z.radius > 0)) continue;
    drawCell(z, visuals.get(z.id));
  }

  drawMinimap();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
