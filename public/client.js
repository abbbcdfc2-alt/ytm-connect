// YTM Connect - Web Client (Pilot na telefon)
(function () {
  let ws = null;
  let targetDevice = 'desktop'; // 'desktop' (PC) lub 'phone' (Ten telefon)

  let config = {
    room: localStorage.getItem('ytm_room') || 'ytm-room-1',
    name: localStorage.getItem('ytm_device_name') || 'Redmi Note 12 Pro (YTM Connect)',
    serverUrl: localStorage.getItem('ytm_server_url') || ''
  };

  let currentState = {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 100
  };

  let isSeeking = false;
  let progressInterval = null;
  let searchDebounceTimer = null;
  let heartbeatTimer = null;

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // Elementy DOM
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const albumArt = document.getElementById('albumArt');
  const bgBlur = document.getElementById('bgBlur');
  const trackTitle = document.getElementById('trackTitle');
  const trackArtist = document.getElementById('trackArtist');
  const progressBarFill = document.getElementById('progressBarFill');
  const seekSlider = document.getElementById('seekSlider');
  const currentTimeLabel = document.getElementById('currentTime');
  const totalDurationLabel = document.getElementById('totalDuration');
  const playBtn = document.getElementById('playBtn');
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const volumeSlider = document.getElementById('volumeSlider');

  // Wyszukiwarka i podpowiedzi
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const searchDropdown = document.getElementById('searchDropdown');

  // Przełącznik urządzeń
  const btnTargetPc = document.getElementById('btnTargetPc');
  const btnTargetPhone = document.getElementById('btnTargetPhone');

  // Modal ustawień
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const roomInput = document.getElementById('roomInput');
  const nameInput = document.getElementById('nameInput');
  const serverInput = document.getElementById('serverInput');
  const saveModalBtn = document.getElementById('saveModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');

  const DEFAULT_REMOTE_URL = 'https://elegant-authentic-packs-much.trycloudflare.com';

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function connect() {
    let targetOrigin = '';
    if (config.serverUrl && config.serverUrl.startsWith('http')) {
      targetOrigin = config.serverUrl;
    } else if (location.origin && location.origin.startsWith('http')) {
      targetOrigin = location.origin;
    } else {
      targetOrigin = DEFAULT_REMOTE_URL;
    }

    let wsHost = 'elegant-authentic-packs-much.trycloudflare.com';
    let wsProtocol = 'wss:';

    try {
      const u = new URL(targetOrigin);
      wsHost = u.host;
      wsProtocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    } catch (e) {}

    const wsUrl = `${wsProtocol}//${wsHost}/ws`;
    console.log('[Pilot] Łączenie z WebSocket:', wsUrl);
    updateStatus('connecting', 'Łączenie...');

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      updateStatus('disconnected', 'Błąd połączenia');
      setTimeout(connect, 3000);
      return;
    }

    ws.onopen = () => {
      console.log('[Pilot] Połączono z serwerem YTM Connect');
      startHeartbeat();
      ws.send(JSON.stringify({
        type: 'register',
        role: 'mobile',
        name: config.name,
        room: config.room
      }));
      updateStatus('connected', 'Połączono');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('Błąd parsowania wiadomości:', e);
      }
    };

    ws.onclose = () => {
      stopHeartbeat();
      updateStatus('disconnected', 'Rozłączono. Ponawianie...');
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      try { ws.close(); } catch(e) {}
    };
  }

  function updateStatus(state, text) {
    statusBadge.className = 'device-badge ' + state;
    statusText.textContent = text;
  }

  function handleMessage(msg) {
    if (msg.type === 'desktop_state') {
      applyDesktopState(msg.state);
      updateStatus('connected', 'PC (Firefox) - Gotowy');
    } else if (msg.type === 'room_info') {
      const desktop = msg.clients && msg.clients.find(c => c.role === 'desktop');
      if (desktop) {
        updateStatus('connected', desktop.name || 'PC (Firefox)');
      } else {
        updateStatus('connecting', 'Oczekiwanie na PC...');
      }
    }
  }

  function applyDesktopState(state) {
    if (!state) return;
    currentState = state;

    trackTitle.textContent = state.title || 'Brak utworu';
    trackArtist.textContent = (state.artist || '') + (state.album ? ' • ' + state.album : '');

    if (state.artwork) {
      albumArt.src = state.artwork;
      bgBlur.style.backgroundImage = `url("${state.artwork}")`;
    }

    if (state.isPlaying) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
      startLocalProgress();
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
      stopLocalProgress();
    }

    if (!isSeeking) {
      updateProgressUI(state.currentTime, state.duration);
    }

    if (typeof state.volume === 'number') {
      volumeSlider.value = state.volume;
    }
  }

  function updateProgressUI(current, duration) {
    currentTimeLabel.textContent = formatTime(current);
    totalDurationLabel.textContent = formatTime(duration);

    const percent = duration > 0 ? (current / duration) * 100 : 0;
    progressBarFill.style.width = `${percent}%`;
    seekSlider.value = percent;
  }

  function startLocalProgress() {
    stopLocalProgress();
    progressInterval = setInterval(() => {
      if (!isSeeking && currentState.isPlaying && currentState.duration > 0) {
        currentState.currentTime = Math.min(currentState.duration, currentState.currentTime + 1);
        updateProgressUI(currentState.currentTime, currentState.duration);
      }
    }, 1000);
  }

  function stopLocalProgress() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  function sendCommand(action, value) {
    if (targetDevice === 'phone') {
      executePhoneAction(action, value);
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'command',
      target: 'desktop',
      action: action,
      value: value,
      room: config.room
    }));
  }

  function executePhoneAction(action, value) {
    if (action === 'search_and_play' || action === 'play_video') {
      const url = action === 'play_video'
        ? `https://music.youtube.com/watch?v=${encodeURIComponent(value)}`
        : `https://music.youtube.com/search?q=${encodeURIComponent(value)}`;

      if (window.AndroidBridge && window.AndroidBridge.openTrackOnPhone) {
        window.AndroidBridge.openTrackOnPhone(action === 'play_video' ? value : '', action === 'search_and_play' ? value : '');
      } else {
        window.open(url, '_blank');
      }
    }
  }

  // --- Przełącznik urządzeń (Gdzie odtwarzać) ---
  btnTargetPc.addEventListener('click', () => {
    targetDevice = 'desktop';
    btnTargetPc.classList.add('active');
    btnTargetPhone.classList.remove('active');
  });

  btnTargetPhone.addEventListener('click', () => {
    targetDevice = 'phone';
    btnTargetPhone.classList.add('active');
    btnTargetPc.classList.remove('active');
  });

  // --- Kontrolki odtwarzacza ---
  playBtn.addEventListener('click', () => sendCommand('toggle'));
  prevBtn.addEventListener('click', () => sendCommand('prev'));
  nextBtn.addEventListener('click', () => sendCommand('next'));

  // Przewijanie utworu
  seekSlider.addEventListener('input', () => {
    isSeeking = true;
    const targetPercent = parseFloat(seekSlider.value);
    const targetTime = (targetPercent / 100) * (currentState.duration || 0);
    progressBarFill.style.width = `${targetPercent}%`;
    currentTimeLabel.textContent = formatTime(targetTime);
  });

  seekSlider.addEventListener('change', () => {
    const targetPercent = parseFloat(seekSlider.value);
    const targetTime = (targetPercent / 100) * (currentState.duration || 0);
    sendCommand('seek', Math.floor(targetTime));
    currentState.currentTime = targetTime;
    isSeeking = false;
  });

  // Głośność
  volumeSlider.addEventListener('input', () => {
    const val = parseInt(volumeSlider.value, 10);
    sendCommand('volume', val);
  });

  // --- Wyszukiwarka i podpowiedzi (Autocomplete) ---
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();

    if (query.length > 0) {
      searchClearBtn.classList.remove('hidden');
    } else {
      searchClearBtn.classList.add('hidden');
      searchDropdown.classList.add('hidden');
      searchDropdown.innerHTML = '';
      return;
    }

    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      fetchSuggestions(query);
    }, 180);
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchClearBtn.classList.add('hidden');
    searchDropdown.classList.add('hidden');
    searchDropdown.innerHTML = '';
    searchInput.focus();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = searchInput.value.trim();
      if (q) {
        playByQuery(q);
        searchDropdown.classList.add('hidden');
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-section')) {
      searchDropdown.classList.add('hidden');
    }
  });

  function fetchSuggestions(query) {
    let apiBase = '';
    if (config.serverUrl && config.serverUrl.startsWith('http')) {
      apiBase = config.serverUrl.replace(/\/+$/, '');
    } else if (location.origin && location.origin.startsWith('http')) {
      apiBase = location.origin.replace(/\/+$/, '');
    } else {
      apiBase = DEFAULT_REMOTE_URL;
    }

    fetch(`${apiBase}/api/suggest?q=${encodeURIComponent(query)}`)
      .then(res => res.json())
      .then(data => {
        renderSuggestions(query, data);
      })
      .catch(err => {
        console.error('Błąd pobierania sugestii:', err);
      });
  }

  function renderSuggestions(query, data) {
    searchDropdown.innerHTML = '';

    const queries = data.queries || [];
    const songs = data.songs || [];

    if (queries.length === 0 && songs.length === 0) {
      searchDropdown.classList.add('hidden');
      return;
    }

    const lowerQuery = query.toLowerCase();

    // 1. Tekstowe podpowiedzi wyszukiwania (Dokładnie jak na screenie YTM)
    queries.forEach(qText => {
      const item = document.createElement('div');
      item.className = 'search-item query-item';

      // Wyszukaj i pogrub pasujący fragment
      let displayHtml = escapeHtml(qText);
      const idx = qText.toLowerCase().indexOf(lowerQuery);
      if (idx !== -1) {
        const before = qText.substring(0, idx);
        const match = qText.substring(idx, idx + query.length);
        const after = qText.substring(idx + query.length);
        displayHtml = `${escapeHtml(before)}<strong>${escapeHtml(match)}</strong>${escapeHtml(after)}`;
      }

      item.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
        <span class="query-text">${displayHtml}</span>
      `;

      item.addEventListener('click', () => {
        searchInput.value = qText;
        searchDropdown.classList.add('hidden');
        playByQuery(qText);
      });

      searchDropdown.appendChild(item);
    });

    // 2. Podpowiedzi konkretnych utworów z miniaturkami okładek
    songs.forEach(song => {
      const item = document.createElement('div');
      item.className = 'search-item song-item';

      const thumbUrl = song.thumb || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46' fill='%23333'%3E%3Crect width='46' height='46'/%3E%3C/svg%3E";

      item.innerHTML = `
        <img class="song-thumb" src="${escapeHtml(thumbUrl)}" alt="" />
        <div class="song-info">
          <span class="song-title">${escapeHtml(song.title)}</span>
          <span class="song-subtitle">${escapeHtml(song.subtitle || '')}</span>
        </div>
      `;

      item.addEventListener('click', () => {
        searchInput.value = song.title;
        searchDropdown.classList.add('hidden');
        playBySong(song);
      });

      searchDropdown.appendChild(item);
    });

    searchDropdown.classList.remove('hidden');
  }

  function playByQuery(query) {
    if (targetDevice === 'desktop') {
      sendCommand('search_and_play', query);
    } else {
      executePhoneAction('search_and_play', query);
    }
  }

  function playBySong(song) {
    if (targetDevice === 'desktop') {
      if (song.videoId) {
        sendCommand('play_video', song.videoId);
      } else {
        sendCommand('search_and_play', song.title);
      }
    } else {
      if (song.videoId) {
        executePhoneAction('play_video', song.videoId);
      } else {
        executePhoneAction('search_and_play', song.title);
      }
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }

  // --- Modal Ustawień ---
  settingsBtn.addEventListener('click', () => {
    roomInput.value = config.room;
    nameInput.value = config.name;
    serverInput.value = config.serverUrl || window.location.origin;
    settingsModal.classList.remove('hidden');
  });

  cancelModalBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  saveModalBtn.addEventListener('click', () => {
    config.room = roomInput.value.trim() || 'ytm-room-1';
    config.name = nameInput.value.trim() || 'Redmi Note 12 Pro (YTM Connect)';
    config.serverUrl = serverInput.value.trim();

    localStorage.setItem('ytm_room', config.room);
    localStorage.setItem('ytm_device_name', config.name);
    localStorage.setItem('ytm_server_url', config.serverUrl);

    settingsModal.classList.add('hidden');

    if (window.AndroidBridge && window.AndroidBridge.setServerUrl && config.serverUrl) {
      window.AndroidBridge.setServerUrl(config.serverUrl);
    } else {
      if (ws) ws.close();
    }
  });

  // Start aplikacji
  connect();
})();
