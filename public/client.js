// YTM Connect - Web Client (Pilot na telefon z pełną obsługą PC i Telefonu)
(function () {
  let ws = null;
  let targetDevice = 'desktop'; // 'desktop' (Komputer PC) lub 'phone' (Ten telefon)

  let config = {
    room: localStorage.getItem('ytm_room') || 'ytm-room-1',
    name: localStorage.getItem('ytm_device_name') || 'Redmi Note 12 Pro (YTM Connect)',
    serverUrl: localStorage.getItem('ytm_server_url') || '',
    token: localStorage.getItem('ytm_token') || '',
    username: localStorage.getItem('ytm_username') || ''
  };

  let currentState = {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 100,
    title: '',
    artist: '',
    artwork: '',
    videoId: '',
    likeStatus: 'INDIFFERENT'
  };

  let selectedSong = null;
  let isSeeking = false;
  let progressInterval = null;
  let searchDebounceTimer = null;
  let heartbeatTimer = null;

  // --- YouTube IFrame API dla trybu "Ten telefon" ---
  let phonePlayer = null;
  let phonePlayerReady = false;
  let phoneCurrentVideoId = '';
  let phonePlayerInterval = null;

  window.onYouTubeIframeAPIReady = function () {
    try {
      phonePlayer = new YT.Player('phonePlayerContainer', {
        height: '1',
        width: '1',
        playerVars: {
          autoplay: 1,
          controls: 0,
          playsinline: 1,
          rel: 0,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            phonePlayerReady = true;
            console.log('[Phone Player] Gotowy do odtwarzania.');
          },
          onStateChange: (event) => {
            handlePhonePlayerStateChange(event.data);
          }
        }
      });
    } catch (e) {
      console.warn('[Phone Player] Błąd inicjalizacji YT Player:', e);
    }
  };

  function handlePhonePlayerStateChange(stateCode) {
    if (targetDevice !== 'phone') return;

    // YT.PlayerState: 1 = PLAYING, 2 = PAUSED, 3 = BUFFERING, 0 = ENDED
    if (stateCode === 1) {
      currentState.isPlaying = true;
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
      startPhoneProgressSync();
    } else if (stateCode === 2 || stateCode === 0) {
      currentState.isPlaying = false;
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
      stopPhoneProgressSync();
    }
  }

  function startPhoneProgressSync() {
    stopPhoneProgressSync();
    phonePlayerInterval = setInterval(() => {
      if (phonePlayer && phonePlayerReady && targetDevice === 'phone') {
        try {
          const cur = Math.floor(phonePlayer.getCurrentTime() || 0);
          const dur = Math.floor(phonePlayer.getDuration() || 0);
          currentState.currentTime = cur;
          currentState.duration = dur;
          if (!isSeeking) {
            updateProgressUI(cur, dur);
          }
        } catch (e) {}
      }
    }, 1000);
  }

  function stopPhoneProgressSync() {
    if (phonePlayerInterval) {
      clearInterval(phonePlayerInterval);
      phonePlayerInterval = null;
    }
  }

  function loadPhoneVideo(videoId, startSeconds = 0) {
    if (!videoId) return;
    phoneCurrentVideoId = videoId;
    console.log('[Phone Player] Ładowanie wideo na telefonie:', videoId);

    if (phonePlayer && phonePlayerReady && typeof phonePlayer.loadVideoById === 'function') {
      try {
        phonePlayer.loadVideoById({
          videoId: videoId,
          startSeconds: startSeconds
        });
        phonePlayer.playVideo();
      } catch (e) {
        console.warn('[Phone Player] Błąd loadVideoById:', e);
      }
    } else {
      // Jeśli API iframe jeszcze się ładuje, zaktualizuj kontener
      const container = document.getElementById('phonePlayerContainer');
      if (container) {
        container.innerHTML = `<iframe width="1" height="1" src="https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&playsinline=1" allow="autoplay" style="opacity:0.01;"></iframe>`;
      }
    }

    currentState.isPlaying = true;
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
  }

  function phonePlay() {
    if (phonePlayer && phonePlayerReady && typeof phonePlayer.playVideo === 'function') {
      phonePlayer.playVideo();
    }
    currentState.isPlaying = true;
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
  }

  function phonePause() {
    if (phonePlayer && phonePlayerReady && typeof phonePlayer.pauseVideo === 'function') {
      phonePlayer.pauseVideo();
    }
    currentState.isPlaying = false;
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
  }

  function phoneToggle() {
    if (currentState.isPlaying) {
      phonePause();
    } else {
      if (phoneCurrentVideoId) {
        phonePlay();
      } else if (selectedSong && selectedSong.videoId) {
        loadPhoneVideo(selectedSong.videoId);
      } else if (currentState.videoId) {
        loadPhoneVideo(currentState.videoId);
      }
    }
  }

  function phoneSeek(seconds) {
    if (phonePlayer && phonePlayerReady && typeof phonePlayer.seekTo === 'function') {
      phonePlayer.seekTo(seconds, true);
    }
  }

  function phoneVolume(val) {
    if (phonePlayer && phonePlayerReady && typeof phonePlayer.setVolume === 'function') {
      phonePlayer.setVolume(val);
    }
  }

  // --- Heartbeat Ping/Pong ---
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
  const likeBtn = document.getElementById('likeBtn');
  const dislikeBtn = document.getElementById('dislikeBtn');
  const volumeSlider = document.getElementById('volumeSlider');
  const btnOpenInYtmApp = document.getElementById('btnOpenInYtmApp');

  // Wyszukiwarka i podpowiedzi
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const searchDropdown = document.getElementById('searchDropdown');

  // Przełącznik urządzeń
  const btnTargetPc = document.getElementById('btnTargetPc');
  const btnTargetPhone = document.getElementById('btnTargetPhone');

  // Górny pasek i przyciski
  const refreshBtn = document.getElementById('refreshBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const roomInput = document.getElementById('roomInput');
  const nameInput = document.getElementById('nameInput');
  const serverInput = document.getElementById('serverInput');
  const saveModalBtn = document.getElementById('saveModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');

  // Elementy Konta, Logowania i Resetu Hasła
  const authOverlay = document.getElementById('authOverlay');
  const authLoginCard = document.getElementById('authLoginCard');
  const authForgotStep1Card = document.getElementById('authForgotStep1Card');
  const authForgotStep2Card = document.getElementById('authForgotStep2Card');

  const tabBtnLogin = document.getElementById('tabBtnLogin');
  const tabBtnRegister = document.getElementById('tabBtnRegister');
  const loginFormSection = document.getElementById('loginFormSection');
  const registerFormSection = document.getElementById('registerFormSection');
  const authError = document.getElementById('authError');

  // Logowanie
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const rememberMeLogin = document.getElementById('rememberMeLogin');
  const loginSubmitBtn = document.getElementById('loginSubmitBtn');
  const switchToRegisterBtn = document.getElementById('switchToRegisterBtn');
  const openForgotBtn = document.getElementById('openForgotBtn');

  // Tworzenie konta
  const regUsername = document.getElementById('regUsername');
  const regPassword = document.getElementById('regPassword');
  const regPasswordConfirm = document.getElementById('regPasswordConfirm');
  const regEmail = document.getElementById('regEmail');
  const rememberMeReg = document.getElementById('rememberMeReg');
  const registerSubmitBtn = document.getElementById('registerSubmitBtn');
  const switchToLoginBtn = document.getElementById('switchToLoginBtn');

  const forgotIdentifierInput = document.getElementById('forgotIdentifierInput');
  const forgotExtraEmailGroup = document.getElementById('forgotExtraEmailGroup');
  const forgotExtraEmailInput = document.getElementById('forgotExtraEmailInput');
  const sendResetCodeBtn = document.getElementById('sendResetCodeBtn');
  const forgotStep1Error = document.getElementById('forgotStep1Error');
  const cancelForgotBtn1 = document.getElementById('cancelForgotBtn1');

  const forgotSuccessInfo = document.getElementById('forgotSuccessInfo');
  const forgotStep2Error = document.getElementById('forgotStep2Error');
  const resetCodeInput = document.getElementById('resetCodeInput');
  const resetNewPasswordInput = document.getElementById('resetNewPasswordInput');
  const resetConfirmPasswordInput = document.getElementById('resetConfirmPasswordInput');
  const submitNewPasswordBtn = document.getElementById('submitNewPasswordBtn');
  const cancelForgotBtn2 = document.getElementById('cancelForgotBtn2');

  const accountUsername = document.getElementById('accountUsername');
  const settingsEmailInput = document.getElementById('settingsEmailInput');
  const saveEmailBtn = document.getElementById('saveEmailBtn');
  const emailStatusText = document.getElementById('emailStatusText');
  const logoutBtn = document.getElementById('logoutBtn');

  function forceAppReload() {
    if (window.AndroidBridge && window.AndroidBridge.forceReload) {
      window.AndroidBridge.forceReload();
    } else {
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('t', Date.now());
        window.location.href = u.toString();
      } catch (e) {
        window.location.reload();
      }
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.style.transform = 'rotate(360deg)';
      refreshBtn.style.transition = 'transform 0.4s ease';
      setTimeout(forceAppReload, 200);
    });
  }

  // Rozsuwana kolejka odtwarzania (Bottom Sheet Drawer)
  const queueDrawerTrigger = document.getElementById('queueDrawerTrigger');
  const queueTriggerCount = document.getElementById('queueTriggerCount');
  const queueBackdrop = document.getElementById('queueBackdrop');
  const queueBottomSheet = document.getElementById('queueBottomSheet');
  const queueDragHandle = document.getElementById('queueDragHandle');
  const queueSheetCount = document.getElementById('queueSheetCount');
  const queueCloseBtn = document.getElementById('queueCloseBtn');
  const queueScrollContainer = document.getElementById('queueScrollContainer');
  const queueList = document.getElementById('queueList');
  const queueEmptyState = document.getElementById('queueEmptyState');

  let currentQueue = [];
  let isQueueSheetOpen = false;

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function connect() {
    let wsHost = window.location.host || 'ytm-connect.onrender.com';
    let wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    if (config.serverUrl && config.serverUrl.startsWith('http')) {
      try {
        const u = new URL(config.serverUrl);
        wsHost = u.host;
        wsProtocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      } catch (e) {}
    }

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
        room: config.room,
        token: config.token || ''
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
      updateStatus('disconnected', 'Rozłączono. Ponawianie za 3s...');
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
    if (msg.type === 'server_hello') {
      const lastVer = localStorage.getItem('ytm_server_version');
      if (lastVer && lastVer !== msg.version) {
        console.log('[Pilot] Nowa wersja wdrożona na serwerze! Automatyczne odświeżanie...');
        localStorage.setItem('ytm_server_version', msg.version);
        setTimeout(forceAppReload, 600);
      } else {
        localStorage.setItem('ytm_server_version', msg.version);
      }
    } else if (msg.type === 'auth_status') {
      if (msg.authenticated && msg.username) {
        config.username = msg.username;
        localStorage.setItem('ytm_username', msg.username);
        if (accountUsername) accountUsername.textContent = msg.username;
        if (authOverlay) authOverlay.classList.add('hidden');
      } else if (!msg.authenticated && config.token) {
        config.token = '';
        localStorage.removeItem('ytm_token');
        if (authOverlay) authOverlay.classList.remove('hidden');
      }
      if (msg.room) {
        config.room = msg.room;
        localStorage.setItem('ytm_room', msg.room);
      }
    } else if (msg.type === 'desktop_state') {
      applyDesktopState(msg.state);
    } else if (msg.type === 'room_info') {
      const desktop = msg.clients && msg.clients.find(c => c.role === 'desktop');
      if (desktop) {
        if (targetDevice === 'desktop') {
          updateStatus('connected', desktop.name || 'Komputer (Firefox)');
        }
      } else {
        if (targetDevice === 'desktop') {
          updateStatus('connecting', 'Oczekiwanie na PC...');
        }
      }
    }
  }

  function applyDesktopState(state) {
    if (!state) return;

    if (pendingQueueClick) {
      const vidMatch = pendingQueueClick.videoId && state.videoId && (state.videoId === pendingQueueClick.videoId);
      const titleMatch = pendingQueueClick.title && state.title && (state.title.toLowerCase().trim() === pendingQueueClick.title);
      // Zwolnij blokadę tylko jeśli komputer naprawdę zmienił utwór na kliknięty
      if (vidMatch || (titleMatch && (Date.now() - (pendingQueueClick.time || 0) > 1500))) {
        pendingQueueClick = null;
      }
    }

    // Jeśli użytkownik jest w trybie PC, zaktualizuj stan
    if (targetDevice === 'desktop') {
      currentState = Object.assign({}, currentState, state);

      trackTitle.textContent = state.title || 'Brak utworu';
      trackArtist.textContent = (state.artist || '') + (state.album ? ' • ' + state.album : '');

      if (state.artwork) {
        albumArt.src = state.artwork;
        bgBlur.style.backgroundImage = `url("${state.artwork}")`;
      }

      if (state.videoId || selectedSong) {
        btnOpenInYtmApp.classList.remove('hidden');
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

      if (typeof state.likeStatus === 'string') {
        currentState.likeStatus = state.likeStatus;
        updateLikeButtonsUI(state.likeStatus);
      } else if (!state.title || state.title.includes('Brak')) {
        updateLikeButtonsUI('INDIFFERENT');
      }
    } else {
      // W trybie telefonu tylko zachowaj w pamięci w razie chęci przełączenia
      currentState.videoId = state.videoId || currentState.videoId;
    }

    // Aktualizacja kolejki odtwarzania
    if (Array.isArray(state.queue)) {
      updateQueue(state.queue);
    }
  }

  function updateProgressUI(current, duration) {
    currentTimeLabel.textContent = formatTime(current);
    totalDurationLabel.textContent = formatTime(duration);

    const percent = duration > 0 ? (current / duration) * 100 : 0;
    progressBarFill.style.width = `${percent}%`;
    seekSlider.value = percent;
  }

  function updateLikeButtonsUI(status) {
    if (!likeBtn || !dislikeBtn) return;
    const isLike = (status === 'LIKE');
    const isDislike = (status === 'DISLIKE');

    likeBtn.classList.toggle('active-like', isLike);
    const likeOutline = likeBtn.querySelector('.icon-outline');
    const likeFilled = likeBtn.querySelector('.icon-filled');
    if (likeOutline && likeFilled) {
      likeOutline.classList.toggle('hidden', isLike);
      likeFilled.classList.toggle('hidden', !isLike);
    }

    dislikeBtn.classList.toggle('active-dislike', isDislike);
    const dislikeOutline = dislikeBtn.querySelector('.icon-outline');
    const dislikeFilled = dislikeBtn.querySelector('.icon-filled');
    if (dislikeOutline && dislikeFilled) {
      dislikeOutline.classList.toggle('hidden', isDislike);
      dislikeFilled.classList.toggle('hidden', !isDislike);
    }
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
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[Pilot] WebSocket nie jest otwarty, pomijanie komendy:', action);
      return;
    }
    ws.send(JSON.stringify({
      type: 'command',
      target: 'desktop',
      action: action,
      value: value,
      room: config.room
    }));
  }

  // --- Przełącznik urządzeń (Gdzie odtwarzać) ---
  btnTargetPc.addEventListener('click', () => {
    if (targetDevice === 'desktop') return;
    targetDevice = 'desktop';
    btnTargetPc.classList.add('active');
    btnTargetPhone.classList.remove('active');
    updateStatus('connected', 'Komputer (PC)');

    // Wstrzymaj odtwarzacz telefonu
    phonePause();

    // Przekaż odtwarzanie na PC, jeśli na telefonie coś leciało
    if (phoneCurrentVideoId) {
      sendCommand('play_video', phoneCurrentVideoId);
    } else if (selectedSong && selectedSong.videoId) {
      sendCommand('play_video', selectedSong.videoId);
    }
  });

  btnTargetPhone.addEventListener('click', () => {
    if (targetDevice === 'phone') return;
    targetDevice = 'phone';
    btnTargetPhone.classList.add('active');
    btnTargetPc.classList.remove('active');
    updateStatus('connected', 'Ten telefon');

    // Wstrzymaj PC
    if (currentState.isPlaying) {
      sendCommand('pause');
    }

    // Przenieś aktualny utwór na telefon
    const vidToPlay = (selectedSong && selectedSong.videoId) || currentState.videoId;
    if (vidToPlay) {
      loadPhoneVideo(vidToPlay, currentState.currentTime || 0);
    }
  });

  // --- Kontrolki odtwarzacza ---
  playBtn.addEventListener('click', () => {
    if (targetDevice === 'desktop') {
      if (currentState.isPlaying) {
        sendCommand('pause');
        currentState.isPlaying = false;
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
      } else {
        // Jeśli na PC nic nie gra, a użytkownik wybrał piosenkę z listy
        if ((!currentState.title || currentState.title.includes('Brak')) && selectedSong) {
          playBySong(selectedSong);
        } else {
          sendCommand('play');
        }
        currentState.isPlaying = true;
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
      }
    } else {
      // Ten telefon
      phoneToggle();
    }
  });

  if (likeBtn) {
    likeBtn.addEventListener('click', () => {
      const nextStatus = (currentState.likeStatus === 'LIKE') ? 'INDIFFERENT' : 'LIKE';
      currentState.likeStatus = nextStatus;
      updateLikeButtonsUI(nextStatus);
      if (targetDevice === 'desktop') {
        sendCommand('like');
      }
    });
  }

  prevBtn.addEventListener('click', () => {
    if (targetDevice === 'desktop') {
      sendCommand('prev');
    } else {
      phoneSeek(0);
    }
  });

  nextBtn.addEventListener('click', () => {
    if (targetDevice === 'desktop') {
      sendCommand('next');
    } else {
      phoneSeek(currentState.duration || 0);
    }
  });

  if (dislikeBtn) {
    dislikeBtn.addEventListener('click', () => {
      const nextStatus = (currentState.likeStatus === 'DISLIKE') ? 'INDIFFERENT' : 'DISLIKE';
      currentState.likeStatus = nextStatus;
      updateLikeButtonsUI(nextStatus);
      if (targetDevice === 'desktop') {
        sendCommand('dislike');
      }
    });
  }

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
    currentState.currentTime = targetTime;
    isSeeking = false;

    if (targetDevice === 'desktop') {
      sendCommand('seek', Math.floor(targetTime));
    } else {
      phoneSeek(Math.floor(targetTime));
    }
  });

  // Głośność
  volumeSlider.addEventListener('input', () => {
    const val = parseInt(volumeSlider.value, 10);
    if (targetDevice === 'desktop') {
      sendCommand('volume', val);
    } else {
      phoneVolume(val);
    }
  });

  // Otwórz w aplikacji YTM
  btnOpenInYtmApp.addEventListener('click', () => {
    const vid = (selectedSong && selectedSong.videoId) || currentState.videoId || '';
    const title = (selectedSong && selectedSong.title) || currentState.title || '';

    if (window.AndroidBridge && window.AndroidBridge.openTrackOnPhone) {
      window.AndroidBridge.openTrackOnPhone(vid, title);
    } else {
      const url = vid
        ? `https://music.youtube.com/watch?v=${encodeURIComponent(vid)}`
        : `https://music.youtube.com/search?q=${encodeURIComponent(title)}`;
      window.location.href = url;
    }
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
    let apiBase = window.location.origin;
    if (config.serverUrl && config.serverUrl.startsWith('http')) {
      apiBase = config.serverUrl.replace(/\/+$/, '');
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

    // 1. Podpowiedzi konkretnych utworów z miniaturkami okładek (Na samej górze)
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

    // 2. Tekstowe podpowiedzi wyszukiwania
    queries.forEach(qText => {
      const item = document.createElement('div');
      item.className = 'search-item query-item';

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

    searchDropdown.classList.remove('hidden');
  }

  function playByQuery(query) {
    if (targetDevice === 'desktop') {
      sendCommand('search_and_play', query);
    } else {
      loadPhoneVideo('', 0);
      if (window.AndroidBridge && window.AndroidBridge.openTrackOnPhone) {
        window.AndroidBridge.openTrackOnPhone('', query);
      }
    }
  }

  function playBySong(song) {
    if (!song) return;
    selectedSong = song;

    // 1. Natychmiastowa aktualizacja interfejsu pilota (Tytuł, artysta, okładka, play/pause)
    trackTitle.textContent = song.title;
    trackArtist.textContent = song.subtitle || 'YouTube Music';
    if (song.thumb) {
      albumArt.src = song.thumb;
      bgBlur.style.backgroundImage = `url("${song.thumb}")`;
    }
    btnOpenInYtmApp.classList.remove('hidden');
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
    currentState.isPlaying = true;
    currentState.videoId = song.videoId || '';

    // 2. Odtwarzanie w zależności od wybranego urządzenia docelowego
    if (targetDevice === 'desktop') {
      updateStatus('connected', 'Odtwarzanie na PC...');
      if (song.videoId) {
        sendCommand('play_video', song.videoId);
      } else {
        sendCommand('search_and_play', song.title);
      }
    } else {
      updateStatus('connected', 'Odtwarzanie na telefonie');
      if (song.videoId) {
        loadPhoneVideo(song.videoId, 0);
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
    if (accountUsername) accountUsername.textContent = config.username || 'Niezalogowany';
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

  // ========================================================
  // Obsługa rozsuwanej kolejki (Bottom Sheet Queue Manager)
  // ========================================================
  function getPolishSongWord(n) {
    if (n === 1) return 'utwór';
    const rem10 = n % 10;
    const rem100 = n % 100;
    if (rem10 >= 2 && rem10 <= 4 && (rem100 < 10 || rem100 >= 20)) return 'utwory';
    return 'utworów';
  }

  function deduplicateQueue(queue) {
    if (!Array.isArray(queue) || queue.length === 0) return [];

    // 1. Jeśli cała tablica to zdwojony zestaw (z dwóch kontenerów DOM YouTube Music)
    if (queue.length > 2 && queue.length % 2 === 0) {
      const half = queue.length / 2;
      let isExactHalfDuplicate = true;
      for (let i = 0; i < half; i++) {
        const a = queue[i];
        const b = queue[i + half];
        if (!a || !b || a.title !== b.title || a.artist !== b.artist) {
          isExactHalfDuplicate = false;
          break;
        }
      }
      if (isExactHalfDuplicate) {
        queue = queue.slice(0, half);
      }
    }

    // 2. Usuń pary duplikatów występujące bezpośrednio obok siebie (np. wersja wideo + wersja audio)
    const clean = [];
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (!item || !item.title) continue;

      const norm = (item.title || '').toLowerCase().replace(/\s+/g, ' ').trim()
        .replace(/\s*\(video\s*version\)/gi, '')
        .replace(/\s*\(official\s*video\)/gi, '')
        .replace(/\s*\(audio\)/gi, '');

      const prev = clean.length > 0 ? clean[clean.length - 1] : null;

      if (prev) {
        const prevNorm = (prev.title || '').toLowerCase().replace(/\s+/g, ' ').trim()
          .replace(/\s*\(video\s*version\)/gi, '')
          .replace(/\s*\(official\s*video\)/gi, '')
          .replace(/\s*\(audio\)/gi, '');

        if (norm === prevNorm) {
          // Jeśli obecny utwór gra lub ma okładkę, podmień poprzedni
          if ((item.selected && !prev.selected) || (!prev.thumb && item.thumb)) {
            clean[clean.length - 1] = { ...prev, ...item, selected: item.selected || prev.selected };
          }
          continue;
        }
      }

      // Jeśli brakuje okładki, uzupełnij z YouTube CDN
      let finalThumb = item.thumb;
      if ((!finalThumb || finalThumb.includes('data:image')) && item.videoId) {
        finalThumb = `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`;
      }

      clean.push({
        ...item,
        thumb: finalThumb
      });
    }

    // 3. Bezwzględnie dopilnuj, aby DOKŁADNIE JEDEN utwór na całej liście miał zaznaczenie 'selected'
    let selectedIndex = -1;

    // A. Jeśli użytkownik przed chwilą kliknął utwór, utrzymaj podświetlenie klikniętego
    if (pendingQueueClick) {
      selectedIndex = clean.findIndex(q => {
        if (pendingQueueClick.videoId && q.videoId && q.videoId === pendingQueueClick.videoId) return true;
        if (pendingQueueClick.title && q.title && q.title.toLowerCase().trim() === pendingQueueClick.title) return true;
        return q.index === pendingQueueClick.index;
      });
    }

    // B. Jeśli brak blokady kliknięcia, dopasuj do aktualnie grającego utworu
    if (selectedIndex === -1) {
      if (currentState.videoId) {
        selectedIndex = clean.findIndex(q => q.videoId && q.videoId === currentState.videoId);
      }
      if (selectedIndex === -1) {
        selectedIndex = clean.findIndex(q => q.selected);
      }
      if (selectedIndex === -1 && currentState.title && !currentState.title.includes('Brak')) {
        const curNorm = currentState.title.toLowerCase().trim();
        selectedIndex = clean.findIndex(q => q.title && q.title.toLowerCase().trim() === curNorm);
      }
    }

    // C. Wymuś absolutną unikalność - tylko selectedIndex dostaje true, żaden inny!
    clean.forEach((item, idx) => {
      item.index = idx;
      item.selected = (idx === selectedIndex);
    });

    return clean;
  }

  function updateQueue(queue) {
    currentQueue = deduplicateQueue(Array.isArray(queue) ? queue : []);
    const count = currentQueue.length;

    if (queueTriggerCount) {
      queueTriggerCount.textContent = count;
    }
    if (queueSheetCount) {
      queueSheetCount.textContent = `${count} ${getPolishSongWord(count)} w kolejce`;
    }

    renderQueueList();
  }

  function renderQueueList() {
    if (!queueList) return;

    if (!currentQueue || currentQueue.length === 0) {
      queueList.innerHTML = '';
      if (queueEmptyState) queueEmptyState.classList.remove('hidden');
      return;
    }

    if (queueEmptyState) queueEmptyState.classList.add('hidden');

    const prevScrollTop = queueScrollContainer ? queueScrollContainer.scrollTop : 0;
    queueList.innerHTML = '';

    currentQueue.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = `queue-item ${item.selected ? 'playing' : ''}`;
      el.dataset.index = index;

      const thumbUrl = item.thumb || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44' fill='%23222'%3E%3Crect width='44' height='44'/%3E%3C/svg%3E";

      el.innerHTML = `
        <span class="queue-item-index">${index + 1}</span>
        <img class="queue-item-thumb" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" />
        <div class="queue-item-details">
          <span class="queue-item-title">${escapeHtml(item.title || 'Nieznany utwór')}</span>
          <div class="queue-item-meta">
            ${item.selected ? `
              <div class="queue-equalizer">
                <span></span><span></span><span></span>
              </div>
            ` : ''}
            <span class="queue-item-artist">${escapeHtml(item.artist || 'YouTube Music')}</span>
            ${item.duration ? `<span class="queue-item-dur">• ${escapeHtml(item.duration)}</span>` : ''}
          </div>
        </div>
        <div class="queue-item-actions">
          <button class="queue-action-btn btn-move-up" data-action="up" data-index="${index}" title="Przesuń w górę" ${index === 0 ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
            </svg>
          </button>
          <button class="queue-action-btn btn-move-down" data-action="down" data-index="${index}" title="Przesuń w dół" ${index === currentQueue.length - 1 ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
            </svg>
          </button>
          <button class="queue-action-btn btn-remove" data-action="remove" data-index="${index}" title="Usuń z kolejki">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      `;

      // Kliknięcie w wiersz odtwarza dany utwór
      el.addEventListener('click', (e) => {
        if (e.target.closest('.queue-action-btn')) return;
        playQueueItem(index);
      });

      queueList.appendChild(el);
    });

    if (queueScrollContainer && prevScrollTop > 0) {
      queueScrollContainer.scrollTop = prevScrollTop;
    }
  }

  // Delegacja kliknięć przycisków w kolejce (W górę, W dół, Usuń)
  if (queueList) {
    queueList.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('.queue-action-btn');
      if (!actionBtn) return;
      e.stopPropagation();

      const action = actionBtn.dataset.action;
      const index = parseInt(actionBtn.dataset.index, 10);
      if (isNaN(index)) return;

      if (action === 'up' && index > 0) {
        moveQueueItem(index, index - 1);
      } else if (action === 'down' && index < currentQueue.length - 1) {
        moveQueueItem(index, index + 1);
      } else if (action === 'remove') {
        removeQueueItem(index);
      }
    });
  }

  let pendingQueueClick = null;
  let pendingQueueTimer = null;

  function playQueueItem(index) {
    const item = currentQueue[index];
    if (!item) return;

    // 1. Zablokuj cofanie zielonej ramki aż komputer potwierdzi start nowego utworu (lub miną 4 sekundy)
    pendingQueueClick = {
      index: index,
      title: (item.title || '').toLowerCase().trim(),
      videoId: item.videoId || '',
      time: Date.now()
    };
    if (pendingQueueTimer) clearTimeout(pendingQueueTimer);
    pendingQueueTimer = setTimeout(() => {
      pendingQueueClick = null;
    }, 4000);

    // 2. Bezwzględnie TYLKO kliknięty element ma zaznaczenie w telefonie
    currentQueue.forEach((q, idx) => {
      q.selected = (idx === index);
    });
    renderQueueList();

    // 3. Wyślij pełną informację do PC
    if (targetDevice === 'desktop') {
      const origIdx = (typeof item.originalIndex === 'number') ? item.originalIndex : index;
      sendCommand('play_queue_item', {
        index: index,
        originalIndex: origIdx,
        videoId: item.videoId || '',
        title: item.title || ''
      });
    } else {
      if (item.videoId) {
        loadPhoneVideo(item.videoId, 0);
      }
    }
  }

  function moveQueueItem(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= currentQueue.length || toIndex < 0 || toIndex >= currentQueue.length) return;

    const fromItem = currentQueue[fromIndex];
    const toItem = currentQueue[toIndex];
    const fromOriginal = fromItem && typeof fromItem.originalIndex === 'number' ? fromItem.originalIndex : fromIndex;
    const toOriginal = toItem && typeof toItem.originalIndex === 'number' ? toItem.originalIndex : toIndex;

    // Optymistyczna zamiana kolejności w interfejsie
    const moved = currentQueue.splice(fromIndex, 1)[0];
    currentQueue.splice(toIndex, 0, moved);
    renderQueueList();

    if (targetDevice === 'desktop') {
      sendCommand('move_queue_item', {
        from: fromIndex,
        to: toIndex,
        fromOriginal: fromOriginal,
        toOriginal: toOriginal
      });
    }
  }

  function removeQueueItem(index) {
    if (index < 0 || index >= currentQueue.length) return;

    const item = currentQueue[index];
    const origIdx = item && typeof item.originalIndex === 'number' ? item.originalIndex : index;

    // Optymistyczne usunięcie z listy
    currentQueue.splice(index, 1);
    const count = currentQueue.length;
    if (queueTriggerCount) queueTriggerCount.textContent = count;
    if (queueSheetCount) queueSheetCount.textContent = `${count} ${getPolishSongWord(count)} w kolejce`;
    renderQueueList();

    if (targetDevice === 'desktop') {
      sendCommand('remove_queue_item', {
        index: index,
        originalIndex: origIdx
      });
    }
  }

  function openQueueSheet() {
    if (!queueBottomSheet || !queueBackdrop) return;
    queueBottomSheet.classList.add('open');
    queueBackdrop.classList.add('visible');
    isQueueSheetOpen = true;

    // Przewiń płynnie do aktualnie odtwarzanego utworu
    setTimeout(() => {
      const playingEl = queueList.querySelector('.queue-item.playing');
      if (playingEl && queueScrollContainer) {
        playingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  }

  function closeQueueSheet() {
    if (!queueBottomSheet || !queueBackdrop) return;
    queueBottomSheet.classList.remove('open');
    queueBackdrop.classList.remove('visible');
    queueBottomSheet.style.transform = '';
    isQueueSheetOpen = false;
  }

  if (queueDrawerTrigger) {
    queueDrawerTrigger.addEventListener('click', openQueueSheet);
  }

  if (queueCloseBtn) {
    queueCloseBtn.addEventListener('click', closeQueueSheet);
  }

  if (queueBackdrop) {
    queueBackdrop.addEventListener('click', closeQueueSheet);
  }

  // Obsługa gestu przeciągnięcia w dół palcem (Swipe to dismiss)
  let touchStartY = 0;
  let touchCurrentY = 0;
  let isDraggingSheet = false;

  function onSheetTouchStart(e) {
    if (queueScrollContainer && queueScrollContainer.scrollTop > 5 && e.target.closest('#queueScrollContainer')) {
      return;
    }
    touchStartY = e.touches[0].clientY;
    touchCurrentY = touchStartY;
    isDraggingSheet = true;
    queueBottomSheet.style.transition = 'none';
  }

  function onSheetTouchMove(e) {
    if (!isDraggingSheet) return;
    touchCurrentY = e.touches[0].clientY;
    const deltaY = touchCurrentY - touchStartY;
    if (deltaY > 0) {
      if (e.cancelable) e.preventDefault();
      queueBottomSheet.style.transform = `translateY(${deltaY}px)`;
    }
  }

  function onSheetTouchEnd() {
    if (!isDraggingSheet) return;
    isDraggingSheet = false;
    queueBottomSheet.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    const deltaY = touchCurrentY - touchStartY;
    if (deltaY > 75) {
      closeQueueSheet();
    } else {
      queueBottomSheet.style.transform = 'translateY(0)';
    }
  }

  if (queueDragHandle) {
    queueDragHandle.addEventListener('touchstart', onSheetTouchStart, { passive: true });
    queueDragHandle.addEventListener('touchmove', onSheetTouchMove, { passive: false });
    queueDragHandle.addEventListener('touchend', onSheetTouchEnd);
  }

  const sheetHeader = document.querySelector('.queue-sheet-header');
  if (sheetHeader) {
    sheetHeader.addEventListener('touchstart', onSheetTouchStart, { passive: true });
    sheetHeader.addEventListener('touchmove', onSheetTouchMove, { passive: false });
    sheetHeader.addEventListener('touchend', onSheetTouchEnd);
  }

  // --- Obsługa Konta, Logowania i Resetowania Hasła ---
  let currentResetUsername = '';

  function switchAuthView(viewName) {
    if (authLoginCard) authLoginCard.classList.toggle('hidden', viewName !== 'login');
    if (authForgotStep1Card) authForgotStep1Card.classList.toggle('hidden', viewName !== 'step1');
    if (authForgotStep2Card) authForgotStep2Card.classList.toggle('hidden', viewName !== 'step2');
    showAuthError('');
    if (forgotStep1Error) {
      forgotStep1Error.textContent = '';
      forgotStep1Error.classList.add('hidden');
    }
    if (forgotStep2Error) {
      forgotStep2Error.textContent = '';
      forgotStep2Error.classList.add('hidden');
    }
  }

  function showAuthError(msg) {
    if (!authError) return;
    if (!msg) {
      authError.classList.add('hidden');
      authError.textContent = '';
      return;
    }
    authError.textContent = msg;
    authError.classList.remove('hidden');
  }

  function checkAuthOnStart() {
    if (accountUsername && config.username) {
      accountUsername.textContent = config.username;
    }

    if (!config.token) {
      const rem = localStorage.getItem('ytm_remember_me') === 'true';
      const remUser = localStorage.getItem('ytm_username');
      const remKey = localStorage.getItem('ytm_reauth_key') || localStorage.getItem('ytm_user_hash');
      if (rem && remUser && remKey) {
        // Cicha stała reautoryzacja (sesja nie wygasa)
        fetch('/api/auth/reauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: remUser, reauthKey: remKey, userHash: remKey })
        })
        .then(r => r.json())
        .then(data => {
          if (data && data.authenticated && data.token) {
            config.token = data.token;
            config.username = data.username;
            localStorage.setItem('ytm_token', data.token);
            if (data.reauthKey) {
              localStorage.setItem('ytm_reauth_key', data.reauthKey);
              localStorage.removeItem('ytm_user_hash');
            }
            if (data.email) {
              localStorage.setItem('ytm_email', data.email);
              if (settingsEmailInput) settingsEmailInput.value = data.email;
            }
            if (accountUsername) accountUsername.textContent = data.username;
            if (authOverlay) authOverlay.classList.add('hidden');
            connect();
          } else {
            switchAuthView('login');
            if (authOverlay) authOverlay.classList.remove('hidden');
          }
        }).catch(() => {
          switchAuthView('login');
          if (authOverlay) authOverlay.classList.remove('hidden');
        });
        return;
      }

      switchAuthView('login');
      if (authOverlay) authOverlay.classList.remove('hidden');
    } else {
      if (authOverlay) authOverlay.classList.add('hidden');
      // Pobierz dane konta (np. powiązany email)
      fetch('/api/auth/me?token=' + encodeURIComponent(config.token))
        .then(r => r.json())
        .then(data => {
          if (data && data.authenticated) {
            if (data.username && accountUsername) accountUsername.textContent = data.username;
            if (data.email && settingsEmailInput) settingsEmailInput.value = data.email;
          }
        }).catch(() => {});
    }
  }

  // Przełączanie na ekran resetu hasła
  if (openForgotBtn) {
    openForgotBtn.addEventListener('click', () => {
      switchAuthView('step1');
      const val = (loginUsername && loginUsername.value.trim()) || (regUsername && regUsername.value.trim()) || '';
      if (val && forgotIdentifierInput) {
        forgotIdentifierInput.value = val;
      }
    });
  }

  if (cancelForgotBtn1) {
    cancelForgotBtn1.addEventListener('click', () => switchAuthView('login'));
  }

  if (cancelForgotBtn2) {
    cancelForgotBtn2.addEventListener('click', () => switchAuthView('login'));
  }

  // Krok 1: Wysłanie kodu weryfikacyjnego
  if (sendResetCodeBtn) {
    sendResetCodeBtn.addEventListener('click', async () => {
      const identifier = forgotIdentifierInput ? forgotIdentifierInput.value.trim() : '';
      const extraEmail = forgotExtraEmailInput ? forgotExtraEmailInput.value.trim() : '';

      if (!identifier) {
        if (forgotStep1Error) {
          forgotStep1Error.textContent = 'Wpisz swój login lub adres e-mail';
          forgotStep1Error.classList.remove('hidden');
        }
        return;
      }

      sendResetCodeBtn.disabled = true;
      sendResetCodeBtn.textContent = 'Wysyłanie kodu...';
      if (forgotStep1Error) forgotStep1Error.classList.add('hidden');

      try {
        const resp = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, email: extraEmail })
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
          if (data.requiresEmail) {
            if (forgotExtraEmailGroup) forgotExtraEmailGroup.classList.remove('hidden');
          }
          if (forgotStep1Error) {
            forgotStep1Error.textContent = data.error || 'Błąd wysyłania kodu';
            forgotStep1Error.classList.remove('hidden');
          }
          return;
        }

        // Sukces - przejdź do kroku 2
        currentResetUsername = data.username || identifier;
        switchAuthView('step2');

        if (forgotSuccessInfo) {
          forgotSuccessInfo.textContent = data.message || `Kod weryfikacyjny wysłany! Sprawdź swoją skrzynkę e-mail.`;
          forgotSuccessInfo.classList.remove('hidden');
        }

        if (resetCodeInput) resetCodeInput.focus();
      } catch (err) {
        if (forgotStep1Error) {
          forgotStep1Error.textContent = 'Błąd połączenia z serwerem: ' + err.message;
          forgotStep1Error.classList.remove('hidden');
        }
      } finally {
        sendResetCodeBtn.disabled = false;
        sendResetCodeBtn.textContent = 'Wyślij kod weryfikacyjny';
      }
    });
  }

  // Krok 2: Weryfikacja kodu i zapis NOWEGO HASŁA
  if (submitNewPasswordBtn) {
    submitNewPasswordBtn.addEventListener('click', async () => {
      const code = resetCodeInput ? resetCodeInput.value.trim() : '';
      const p1 = resetNewPasswordInput ? resetNewPasswordInput.value.trim() : '';
      const p2 = resetConfirmPasswordInput ? resetConfirmPasswordInput.value.trim() : '';

      if (!code || code.length < 4) {
        if (forgotStep2Error) {
          forgotStep2Error.textContent = 'Wpisz 6-cyfrowy kod weryfikacyjny z e-maila';
          forgotStep2Error.classList.remove('hidden');
        }
        return;
      }
      if (!p1 || p1.length < 3) {
        if (forgotStep2Error) {
          forgotStep2Error.textContent = 'Nowe hasło musi mieć co najmniej 3 znaki';
          forgotStep2Error.classList.remove('hidden');
        }
        return;
      }
      if (p1 !== p2) {
        if (forgotStep2Error) {
          forgotStep2Error.textContent = 'Wpisane hasła nie są identyczne!';
          forgotStep2Error.classList.remove('hidden');
        }
        return;
      }

      submitNewPasswordBtn.disabled = true;
      submitNewPasswordBtn.textContent = 'Zapisywanie nowego hasła...';
      if (forgotStep2Error) forgotStep2Error.classList.add('hidden');

      try {
        const resp = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: currentResetUsername,
            code: code,
            newPassword: p1
          })
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
          if (forgotStep2Error) {
            forgotStep2Error.textContent = data.error || 'Błąd resetowania hasła';
            forgotStep2Error.classList.remove('hidden');
          }
          return;
        }

        // Sukces - nowe hasło zapisane i zalogowano!
        config.token = data.token;
        config.username = data.username;
        localStorage.setItem('ytm_token', data.token);
        localStorage.setItem('ytm_username', data.username);
        localStorage.setItem('ytm_remember_me', 'true');
        if (data.reauthKey) {
          localStorage.setItem('ytm_reauth_key', data.reauthKey);
          localStorage.removeItem('ytm_user_hash');
        }

        if (accountUsername) accountUsername.textContent = data.username;
        if (authOverlay) authOverlay.classList.add('hidden');

        if (resetCodeInput) resetCodeInput.value = '';
        if (resetNewPasswordInput) resetNewPasswordInput.value = '';
        if (resetConfirmPasswordInput) resetConfirmPasswordInput.value = '';

        switchAuthView('login');

        // Zrestartuj połączenie z nowym tokenem
        if (ws) ws.close();
        else connect();
      } catch (err) {
        if (forgotStep2Error) {
          forgotStep2Error.textContent = 'Błąd połączenia: ' + err.message;
          forgotStep2Error.classList.remove('hidden');
        }
      } finally {
        submitNewPasswordBtn.disabled = false;
        submitNewPasswordBtn.textContent = 'Zapisz nowe hasło i zaloguj';
      }
    });
  }

  // Zapisywanie e-maila w oknie ustawień
  if (saveEmailBtn) {
    saveEmailBtn.addEventListener('click', async () => {
      const emailVal = settingsEmailInput ? settingsEmailInput.value.trim() : '';
      if (!emailVal || !emailVal.includes('@')) {
        if (emailStatusText) {
          emailStatusText.className = 'email-status-text error';
          emailStatusText.textContent = 'Podaj poprawny adres e-mail';
        }
        return;
      }

      saveEmailBtn.disabled = true;
      saveEmailBtn.textContent = 'Zapis...';

      try {
        const resp = await fetch('/api/auth/update-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: config.token, email: emailVal })
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
          if (emailStatusText) {
            emailStatusText.className = 'email-status-text error';
            emailStatusText.textContent = data.error || 'Błąd zapisu';
          }
        } else {
          if (emailStatusText) {
            emailStatusText.className = 'email-status-text success';
            emailStatusText.textContent = 'E-mail zapisany pomyślnie!';
            setTimeout(() => { emailStatusText.textContent = ''; }, 3000);
          }
        }
      } catch (e) {
        if (emailStatusText) {
          emailStatusText.className = 'email-status-text error';
          emailStatusText.textContent = 'Błąd połączenia';
        }
      } finally {
        saveEmailBtn.disabled = false;
        saveEmailBtn.textContent = 'Zapisz';
      }
    });
  }

  // Przełączanie zakładek Logowanie <-> Tworzenie konta
  function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    if (tabBtnLogin) tabBtnLogin.classList.toggle('active', isLogin);
    if (tabBtnRegister) tabBtnRegister.classList.toggle('active', !isLogin);
    if (loginFormSection) loginFormSection.classList.toggle('hidden', !isLogin);
    if (registerFormSection) registerFormSection.classList.toggle('hidden', isLogin);
    showAuthError('');
    if (isLogin && loginUsername) setTimeout(() => loginUsername.focus(), 50);
    if (!isLogin && regUsername) setTimeout(() => regUsername.focus(), 50);
  }

  if (tabBtnLogin) tabBtnLogin.addEventListener('click', () => switchAuthTab('login'));
  if (tabBtnRegister) tabBtnRegister.addEventListener('click', () => switchAuthTab('register'));
  if (switchToRegisterBtn) switchToRegisterBtn.addEventListener('click', () => switchAuthTab('register'));
  if (switchToLoginBtn) switchToLoginBtn.addEventListener('click', () => switchAuthTab('login'));

  // Obsługa Enter w polach logowania
  [loginUsername, loginPassword].forEach(input => {
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (loginSubmitBtn) loginSubmitBtn.click();
      }
    });
  });

  // Obsługa Enter w polach tworzenia konta
  [regUsername, regPassword, regPasswordConfirm, regEmail].forEach(input => {
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (registerSubmitBtn) registerSubmitBtn.click();
      }
    });
  });

  // Standardowe Logowanie
  if (loginSubmitBtn) {
    loginSubmitBtn.addEventListener('click', async () => {
      const u = loginUsername ? loginUsername.value.trim() : '';
      const p = loginPassword ? loginPassword.value.trim() : '';
      const rem = rememberMeLogin ? rememberMeLogin.checked : true;

      if (!u) {
        showAuthError('Wpisz nazwę użytkownika / login');
        return;
      }
      if (!p || p.length < 3) {
        showAuthError('Hasło musi mieć co najmniej 3 znaki');
        return;
      }

      loginSubmitBtn.disabled = true;
      loginSubmitBtn.textContent = 'Logowanie...';
      showAuthError('');

      try {
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
          showAuthError(data.error || 'Błąd logowania');
          loginSubmitBtn.disabled = false;
          loginSubmitBtn.textContent = 'Zaloguj się';
          return;
        }

        config.token = data.token;
        config.username = data.username;
        localStorage.setItem('ytm_token', data.token);
        localStorage.setItem('ytm_username', data.username);

        if (rem) {
          localStorage.setItem('ytm_remember_me', 'true');
          if (data.reauthKey) {
            localStorage.setItem('ytm_reauth_key', data.reauthKey);
            localStorage.removeItem('ytm_user_hash');
          }
        } else {
          localStorage.removeItem('ytm_remember_me');
          localStorage.removeItem('ytm_reauth_key');
          localStorage.removeItem('ytm_user_hash');
        }

        if (accountUsername) accountUsername.textContent = data.username;
        if (data.email && settingsEmailInput) settingsEmailInput.value = data.email;
        if (authOverlay) authOverlay.classList.add('hidden');
        if (loginPassword) loginPassword.value = '';

        // Zrestartuj połączenie z nowym tokenem konta
        if (ws) ws.close();
        else connect();
      } catch (err) {
        showAuthError('Błąd połączenia z serwerem: ' + err.message);
      } finally {
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = 'Zaloguj się';
      }
    });
  }

  // Tworzenie konta / Rejestracja
  if (registerSubmitBtn) {
    registerSubmitBtn.addEventListener('click', async () => {
      const u = regUsername ? regUsername.value.trim() : '';
      const p = regPassword ? regPassword.value.trim() : '';
      const cp = regPasswordConfirm ? regPasswordConfirm.value.trim() : '';
      const em = regEmail ? regEmail.value.trim() : '';
      const rem = rememberMeReg ? rememberMeReg.checked : true;

      if (!u) {
        showAuthError('Wpisz nazwę użytkownika / login');
        return;
      }
      if (u.length < 3) {
        showAuthError('Login musi mieć co najmniej 3 znaki');
        return;
      }
      if (!p || p.length < 3) {
        showAuthError('Hasło musi mieć co najmniej 3 znaki');
        return;
      }
      if (p !== cp) {
        showAuthError('Wpisane hasła nie są identyczne!');
        return;
      }
      if (!em || !em.includes('@') || em.length < 5) {
        showAuthError('Podaj poprawny adres e-mail (do odzyskiwania hasła)');
        return;
      }

      registerSubmitBtn.disabled = true;
      registerSubmitBtn.textContent = 'Tworzenie konta...';
      showAuthError('');

      try {
        const resp = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: u,
            password: p,
            confirmPassword: cp,
            email: em
          })
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
          showAuthError(data.error || 'Błąd rejestracji konta');
          registerSubmitBtn.disabled = false;
          registerSubmitBtn.textContent = 'Utwórz konto';
          return;
        }

        config.token = data.token;
        config.username = data.username;
        localStorage.setItem('ytm_token', data.token);
        localStorage.setItem('ytm_username', data.username);
        if (data.email) {
          localStorage.setItem('ytm_email', data.email);
        }

        if (rem) {
          localStorage.setItem('ytm_remember_me', 'true');
          if (data.reauthKey) {
            localStorage.setItem('ytm_reauth_key', data.reauthKey);
            localStorage.removeItem('ytm_user_hash');
          }
        } else {
          localStorage.removeItem('ytm_remember_me');
          localStorage.removeItem('ytm_reauth_key');
          localStorage.removeItem('ytm_user_hash');
        }

        if (accountUsername) accountUsername.textContent = data.username;
        if (data.email && settingsEmailInput) settingsEmailInput.value = data.email;
        if (authOverlay) authOverlay.classList.add('hidden');
        if (regPassword) regPassword.value = '';
        if (regPasswordConfirm) regPasswordConfirm.value = '';

        // Zrestartuj połączenie z nowym tokenem konta
        if (ws) ws.close();
        else connect();
      } catch (err) {
        showAuthError('Błąd połączenia z serwerem: ' + err.message);
      } finally {
        registerSubmitBtn.disabled = false;
        registerSubmitBtn.textContent = 'Utwórz konto';
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (config.token) {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: config.token })
          });
        } catch(e) {}
      }

      config.token = '';
      config.username = '';
      localStorage.removeItem('ytm_token');
      localStorage.removeItem('ytm_username');
      localStorage.removeItem('ytm_remember_me');
      localStorage.removeItem('ytm_reauth_key');
      localStorage.removeItem('ytm_user_hash');

      if (settingsModal) settingsModal.classList.add('hidden');
      if (authOverlay) authOverlay.classList.remove('hidden');
      if (accountUsername) accountUsername.textContent = '--';

      if (ws) ws.close();
    });
  }

  // Sprawdź stan autoryzacji przy starcie
  checkAuthOnStart();

  // Start aplikacji
  connect();
})();
