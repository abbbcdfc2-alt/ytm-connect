const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const SERVER_BUILD_ID = 'v1.4.0-' + Date.now();

// --- Baza Kont i Tokenów (Zapisywana do pliku accounts.json) ---
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
let accountsData = { users: {}, tokens: {} };

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const content = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
      accountsData = JSON.parse(content);
      if (!accountsData.users) accountsData.users = {};
      if (!accountsData.tokens) accountsData.tokens = {};
    }
  } catch (e) {
    console.warn('[Auth] Błąd odczytu accounts.json:', e);
  }
}

function saveAccounts() {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accountsData, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Auth] Błąd zapisu accounts.json:', e);
  }
}

loadAccounts();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function authenticateOrRegister(username, password) {
  if (!username || typeof username !== 'string' || !username.trim()) {
    return { error: 'Podaj nazwę użytkownika' };
  }
  if (!password || typeof password !== 'string' || password.length < 3) {
    return { error: 'Hasło musi mieć co najmniej 3 znaki' };
  }

  const cleanUser = username.trim();
  const lowerUser = cleanUser.toLowerCase();

  let user = accountsData.users[lowerUser];
  let isNew = false;

  if (!user) {
    // Rejestracja nowego konta
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    user = {
      username: lowerUser,
      displayName: cleanUser,
      salt: salt,
      hash: hash,
      createdAt: new Date().toISOString()
    };
    accountsData.users[lowerUser] = user;
    isNew = true;
    console.log(`[Auth] Utworzono nowe konto: ${cleanUser}`);
  } else {
    // Logowanie do istniejącego konta
    const testHash = hashPassword(password, user.salt);
    if (testHash !== user.hash) {
      return { error: 'Nieprawidłowe hasło dla tego konta' };
    }
    console.log(`[Auth] Zalogowano pomyślnie: ${user.displayName}`);
  }

  // Wygeneruj bezpieczny token sesji (ważny na stałe do momentu wylogowania)
  const token = crypto.randomBytes(24).toString('hex');
  accountsData.tokens[token] = {
    username: lowerUser,
    createdAt: new Date().toISOString()
  };
  saveAccounts();

  return {
    success: true,
    token: token,
    username: user.displayName,
    isNew: isNew
  };
}

function getUserByToken(token) {
  if (!token || !accountsData.tokens[token]) return null;
  const tokenInfo = accountsData.tokens[token];
  const user = accountsData.users[tokenInfo.username];
  return user || null;
}

function readJsonBody(req, callback) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 5e5) req.socket.destroy();
  });
  req.on('end', () => {
    try {
      const data = body ? JSON.parse(body) : {};
      callback(null, data);
    } catch (e) {
      callback(e, null);
    }
  });
}

const server = http.createServer((req, res) => {
  let reqUrl = req.url.split('?')[0];

  // Nagłówki CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API Autoryzacji Kont ---
  if (reqUrl === '/api/auth/login' && req.method === 'POST') {
    readJsonBody(req, (err, data) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Nieprawidłowy format JSON' }));
        return;
      }
      const result = authenticateOrRegister(data.username, data.password);
      if (result.error) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: result.error }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      }
    });
    return;
  }

  if (reqUrl === '/api/auth/me') {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const token = parsedUrl.searchParams.get('token') || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : '');
    const user = getUserByToken(token);
    if (user) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ authenticated: true, username: user.displayName }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ authenticated: false }));
    }
    return;
  }

  if (reqUrl === '/api/auth/logout' && req.method === 'POST') {
    readJsonBody(req, (err, data) => {
      if (data && data.token && accountsData.tokens[data.token]) {
        delete accountsData.tokens[data.token];
        saveAccounts();
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // API statusu podłączonych urządzeń
  if (reqUrl === '/api/status') {
    const statusData = {
      status: 'online',
      rooms: Array.from(rooms.keys()).map(r => ({
        room: r,
        clients: Array.from(rooms.get(r)).map(c => ({ role: c.role, name: c.deviceName }))
      }))
    };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(statusData));
    return;
  }

  // API podpowiedzi wyszukiwania YouTube Music (dokładne sugestie z YTM + piosenki)
  if (reqUrl === '/api/suggest') {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const query = parsedUrl.searchParams.get('q') || '';
    if (!query.trim()) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ queries: [], songs: [] }));
      return;
    }

    getYTMSuggestions(query.trim(), (result) => {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (reqUrl === '/') reqUrl = '/index.html';

  const filePath = path.join(__dirname, 'public', reqUrl);
  const ext = path.extname(filePath);

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.apk': 'application/vnd.android.package-archive'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Server Error');
      }
    } else {
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(content);
    }
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();
const roomStates = new Map();

wss.on('connection', (ws) => {
  ws.room = null;
  ws.role = 'unknown';
  ws.deviceName = 'Nieznane urządzenie';

  // Wyślij wersję serwera do klienta (pozwala na auto-reload po wdrożeniu nowej wersji)
  ws.send(JSON.stringify({ type: 'server_hello', version: SERVER_BUILD_ID }));

  ws.on('message', (rawData) => {
    try {
      const data = JSON.parse(rawData);

      switch (data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'register':
          handleRegister(ws, data);
          break;

        case 'state_update':
          handleStateUpdate(ws, data);
          break;

        case 'command':
          handleCommand(ws, data);
          break;

        default:
          console.log('[WS] Nieznany typ wiadomości:', data.type);
      }
    } catch (err) {
      console.error('[WS] Błąd parsowania wiadomości:', err);
    }
  });

  ws.on('close', () => {
    if (ws.room && rooms.has(ws.room)) {
      const roomSet = rooms.get(ws.room);
      roomSet.delete(ws);
      if (roomSet.size === 0) {
        rooms.delete(ws.room);
      } else {
        broadcastRoomInfo(ws.room);
      }
    }
    console.log(`[WS] Rozłączono: ${ws.deviceName} (${ws.role})`);
  });
});

function handleRegister(ws, data) {
  let roomName = null;
  let accountUser = null;

  if (data.token) {
    accountUser = getUserByToken(data.token);
    if (accountUser) {
      roomName = 'acc_' + accountUser.username;
      ws.account = accountUser.username;
      ws.displayName = accountUser.displayName;
    }
  }

  // Jeśli brak ważnego tokenu, użyj zadanego pokoju (kompatybilność)
  if (!roomName) {
    roomName = data.room || 'ytm-room-1';
  }

  ws.room = roomName;
  ws.role = data.role || 'mobile';
  ws.deviceName = data.name || (ws.role === 'desktop' ? 'Komputer (Firefox)' : 'Telefon (Android)');

  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set());
  }
  rooms.get(roomName).add(ws);

  console.log(`[WS] Zalogowano ${ws.deviceName} [${ws.role}] (Konto: ${ws.displayName || 'brak'}) w pokoju: ${roomName}`);

  // Potwierdź stan autoryzacji
  ws.send(JSON.stringify({
    type: 'auth_status',
    authenticated: !!accountUser,
    username: accountUser ? accountUser.displayName : null,
    room: roomName
  }));

  broadcastRoomInfo(roomName);

  if (ws.role === 'mobile' && roomStates.has(roomName)) {
    ws.send(JSON.stringify({
      type: 'desktop_state',
      state: roomStates.get(roomName)
    }));
  }
}

function handleStateUpdate(ws, data) {
  const roomName = ws.room;
  if (!roomName || !rooms.has(roomName)) return;

  if (ws.role === 'desktop') {
    roomStates.set(roomName, data.state);
  }

  const messageStr = JSON.stringify({
    type: ws.role === 'desktop' ? 'desktop_state' : 'phone_state',
    state: data.state,
    fromDevice: ws.deviceName
  });

  for (const client of rooms.get(roomName)) {
    if (client !== ws && client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }
}

function handleCommand(ws, data) {
  const roomName = ws.room;
  if (!roomName || !rooms.has(roomName)) return;

  const targetRole = data.target || (ws.role === 'mobile' ? 'desktop' : 'mobile');

  const messageStr = JSON.stringify({
    type: 'command',
    action: data.action,
    value: data.value,
    fromDevice: ws.deviceName,
    target: targetRole
  });

  for (const client of rooms.get(roomName)) {
    if (client !== ws && client.readyState === WebSocket.OPEN) {
      if (client.role === targetRole || !targetRole) {
        client.send(messageStr);
      }
    }
  }
}

function broadcastRoomInfo(roomName) {
  if (!rooms.has(roomName)) return;

  const clients = Array.from(rooms.get(roomName)).map(c => ({
    role: c.role,
    name: c.deviceName
  }));

  const msg = JSON.stringify({
    type: 'room_info',
    room: roomName,
    clients: clients
  });

  for (const client of rooms.get(roomName)) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function getYTMSuggestions(query, callback) {
  const postDataSuggest = JSON.stringify({
    context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20231204.01.00', hl: 'pl', gl: 'PL' } },
    input: query
  });

  // Filtr "Utwory" w wyszukiwarce YouTube Music
  const postDataSongs = JSON.stringify({
    context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20231204.01.00', hl: 'pl', gl: 'PL' } },
    query: query,
    params: 'EgWKAQIIAWoKEAkQChAFEAMQBA%3D%3D'
  });

  let queries = [];
  let songs = [];
  let pending = 2;

  const done = () => {
    pending--;
    if (pending === 0) {
      const seen = new Set();
      const uniqueSongs = songs.filter(s => {
        if (!s.videoId || seen.has(s.videoId)) return false;
        seen.add(s.videoId);
        return true;
      });
      callback({ queries, songs: uniqueSongs });
    }
  };

  // 1. Podpowiedzi tekstowe z YouTube Music
  const req1 = https.request('https://music.youtube.com/youtubei/v1/music/get_search_suggestions?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    timeout: 3500
  }, (res) => {
    res.setEncoding('utf8');
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(d);
        for (const c of json.contents || []) {
          for (const item of (c.searchSuggestionsSectionRenderer?.contents || [])) {
            if (item.searchSuggestionRenderer) {
              const text = item.searchSuggestionRenderer.suggestion?.runs?.map(r => r.text).join('') || '';
              if (text) queries.push(text);
            }
          }
        }
      } catch(e) {}
      done();
    });
  });
  req1.on('error', done);
  req1.on('timeout', () => { req1.destroy(); done(); });
  req1.write(postDataSuggest);
  req1.end();

  // 2. Wyszukiwanie utworów (kategoria Utwory / Songs)
  const req2 = https.request('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    timeout: 3500
  }, (res) => {
    res.setEncoding('utf8');
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(d);
        function parseItems(obj) {
          if (!obj || typeof obj !== 'object') return;
          if (obj.musicResponsiveListItemRenderer) {
            const r = obj.musicResponsiveListItemRenderer;
            const title = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map(x => x.text).join('') || '';
            const subtitle = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map(x => x.text).join('') || '';
            
            const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
            let thumb = '';
            if (thumbs.length > 0) {
              thumb = thumbs[thumbs.length - 1].url;
            }

            const videoId = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                            r.playlistItemData?.videoId ||
                            r.navigationEndpoint?.watchEndpoint?.videoId || '';

            // Odrzucamy podcasty i odcinki, zatrzymujemy utwory
            if (title && videoId && !subtitle.toLowerCase().includes('odcinek') && !subtitle.toLowerCase().includes('podcast')) {
              songs.push({ title, subtitle, thumb, videoId });
            }
          }
          for (const k of Object.keys(obj)) {
            parseItems(obj[k]);
          }
        }
        parseItems(json);
      } catch(e) {}
      done();
    });
  });
  req2.on('error', done);
  req2.on('timeout', () => { req2.destroy(); done(); });
  req2.write(postDataSongs);
  req2.end();
}

server.listen(PORT, () => {
  console.log(`🚀 YTM Connect Server działa na porcie ${PORT}`);
});
