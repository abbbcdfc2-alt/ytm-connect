const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const SERVER_BUILD_ID = 'v1.4.0-' + Date.now();

// --- Prywatna Baza Kont i Tokenów (Zapisywana w ukrytym katalogu .data, niedostępnym przez HTTP) ---
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '.data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

// Migracja starego pliku accounts.json jeśli istniał w katalogu głównym
const oldAccountsFile = path.join(__dirname, 'accounts.json');
if (fs.existsSync(oldAccountsFile)) {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
      fs.copyFileSync(oldAccountsFile, ACCOUNTS_FILE);
    }
    fs.unlinkSync(oldAccountsFile);
  } catch (e) {}
}

let accountsData = { users: {}, tokens: {}, resetCodes: {} };

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const content = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
      accountsData = JSON.parse(content);
      if (!accountsData.users) accountsData.users = {};
      if (!accountsData.tokens) accountsData.tokens = {};
      if (!accountsData.resetCodes) accountsData.resetCodes = {};
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

// --- Zabezpieczenia: Porównywanie odporne na ataki czasowe (Timing Attacks) ---
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// --- Zabezpieczenia: Rate Limiter w pamięci (Ochrona przed atakami brute-force) ---
const rateLimits = new Map();

function checkRateLimit(key, maxRequests = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  let record = rateLimits.get(key);

  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    rateLimits.set(key, record);
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
}

// Czyszczenie wygasłych limitów co 10 minut
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimits.entries()) {
    if (now > val.resetTime) rateLimits.delete(key);
  }
}, 10 * 60 * 1000);

// --- Obsługa Wysyłki E-mail (Nodemailer z obsługą SMTP i fallbacku) ---
let mailTransporter = null;

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (user && pass) {
    try {
      mailTransporter = nodemailer.createTransport({
        host: host,
        port: port,
        secure: secure,
        auth: { user, pass },
        tls: { rejectUnauthorized: false }
      });
      console.log(`[Email] Skonfigurowano transporter SMTP: ${host}:${port} (${user})`);
    } catch (e) {
      console.warn('[Email] Błąd konfiguracji SMTP:', e);
    }
  }
  return mailTransporter;
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '***@***';
  const [user, domain] = email.split('@');
  const maskedUser = user.length <= 2 ? user[0] + '***' : user[0] + '***' + user[user.length - 1];
  const domainParts = domain.split('.');
  const dName = domainParts[0];
  const maskedDomain = (dName.length <= 2 ? dName[0] + '***' : dName[0] + '***' + dName[dName.length - 1]) + '.' + domainParts.slice(1).join('.');
  return `${maskedUser}@${maskedDomain}`;
}

async function sendResetEmail(toEmail, code, username) {
  const transporter = getMailTransporter();
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@ytm-connect.local';

  const htmlContent = `
    <div style="font-family: Arial, -apple-system, BlinkMacSystemFont, sans-serif; background-color: #121212; color: #ffffff; padding: 30px; border-radius: 14px; max-width: 480px; margin: 0 auto; border: 1px solid #2a2a2a;">
      <h2 style="color: #1db954; margin-top: 0; font-size: 22px;">🎵 YTM Connect</h2>
      <p style="font-size: 15px; color: #e0e0e0;">Witaj <b>${username}</b>,</p>
      <p style="font-size: 14px; color: #b0b0b0; line-height: 1.5;">Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta w YTM Connect. Twój 6-cyfrowy kod weryfikacyjny to:</p>
      <div style="background: rgba(29, 185, 84, 0.15); border: 2px solid #1db954; color: #1db954; font-size: 34px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 18px; border-radius: 10px; margin: 24px 0;">
        ${code}
      </div>
      <p style="font-size: 13px; color: #888888; line-height: 1.4;">Kod jest ważny przez <b>15 minut</b>. Po wpisaniu kodu będziesz mógł ustalić nowe hasło do swojego konta.</p>
      <p style="font-size: 12px; color: #555555; margin-top: 24px; border-top: 1px solid #222; padding-top: 12px;">Jeśli nie prosiłeś o zmianę hasła, zignoruj tę wiadomość.</p>
    </div>
  `;

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: `"YTM Connect" <${fromAddress}>`,
        to: toEmail,
        subject: `Twój kod resetu hasła YTM Connect: ${code}`,
        text: `Twój kod weryfikacyjny do resetu hasła YTM Connect to: ${code} (kod jest ważny przez 15 minut).`,
        html: htmlContent
      });
      console.log(`[Email] ✅ Wysłano e-mail z kodem do ${toEmail} (ID: ${info.messageId})`);
      return { success: true };
    } catch (err) {
      console.error(`[Email] ❌ Błąd wysyłania e-maila:`, err);
      return { success: false, error: 'Błąd wysyłania e-maila przez SMTP: ' + err.message };
    }
  } else {
    // Tryb symulacji / development gdy zmienne SMTP_USER i SMTP_PASS nie zostały jeszcze ustawione w Render
    console.log(`\n======================================================`);
    console.log(`[RESET HASŁA - BRAK ZMIENNYCH SMTP_USER I SMTP_PASS W ENV]`);
    console.log(`Konto: ${username} (${toEmail})`);
    console.log(`KOD WERYFIKACYJNY: ${code}`);
    console.log(`Aby maile wysyłały się na prawdziwą skrzynkę, dodaj SMTP_USER i SMTP_PASS w panelu Render.`);
    console.log(`======================================================\n`);
    return {
      success: true,
      simulated: true,
      debugCode: code,
      message: 'Kod wygenerowany! (Skonfiguruj SMTP_USER i SMTP_PASS w Render dla wysyłki na e-mail).'
    };
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function loginUser(username, password) {
  if (!username || typeof username !== 'string' || !username.trim()) {
    return { error: 'Podaj nazwę użytkownika / login' };
  }
  if (!password || typeof password !== 'string' || password.length < 3) {
    return { error: 'Hasło musi mieć co najmniej 3 znaki' };
  }

  const cleanUser = username.trim();
  const lowerUser = cleanUser.toLowerCase();
  const user = accountsData.users[lowerUser];

  if (!user) {
    return { error: 'Konto o podanym loginie nie istnieje. Przejdź do rejestracji i utwórz konto.' };
  }

  const testHash = hashPassword(password, user.salt);
  if (!timingSafeEqualStr(testHash, user.hash)) {
    return { error: 'Nieprawidłowe hasło dla tego konta' };
  }

  if (!user.reauthKey) {
    user.reauthKey = crypto.randomBytes(32).toString('hex');
  }

  const token = crypto.randomBytes(24).toString('hex');
  accountsData.tokens[token] = {
    username: lowerUser,
    createdAt: new Date().toISOString()
  };
  saveAccounts();

  console.log(`[Auth] Zalogowano pomyślnie: ${user.displayName}`);

  return {
    success: true,
    token: token,
    username: user.displayName,
    email: user.email || '',
    reauthKey: user.reauthKey
  };
}

function registerUser(username, password, confirmPassword, email) {
  if (!username || typeof username !== 'string' || !username.trim()) {
    return { error: 'Podaj nazwę użytkownika / login' };
  }
  const cleanUser = username.trim();
  if (cleanUser.length < 3) {
    return { error: 'Login musi mieć co najmniej 3 znaki' };
  }
  if (!password || typeof password !== 'string' || password.length < 3) {
    return { error: 'Hasło musi mieć co najmniej 3 znaki' };
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return { error: 'Wpisane hasła nie są identyczne!' };
  }
  if (!email || typeof email !== 'string' || !email.includes('@') || email.trim().length < 5) {
    return { error: 'Podaj poprawny adres e-mail (potrzebny do odzyskiwania hasła)' };
  }

  const lowerUser = cleanUser.toLowerCase();
  if (accountsData.users[lowerUser]) {
    return { error: 'Konto o takim loginie już istnieje. Wybierz inny login lub zaloguj się.' };
  }

  const cleanEmail = email.trim().toLowerCase();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const reauthKey = crypto.randomBytes(32).toString('hex');

  const user = {
    username: lowerUser,
    displayName: cleanUser,
    email: cleanEmail,
    salt: salt,
    hash: hash,
    reauthKey: reauthKey,
    createdAt: new Date().toISOString()
  };

  accountsData.users[lowerUser] = user;

  const token = crypto.randomBytes(24).toString('hex');
  accountsData.tokens[token] = {
    username: lowerUser,
    createdAt: new Date().toISOString()
  };
  saveAccounts();

  console.log(`[Auth] Zarejestrowano nowe konto: ${cleanUser} (${cleanEmail})`);

  return {
    success: true,
    token: token,
    username: user.displayName,
    email: user.email,
    reauthKey: user.reauthKey,
    isNew: true
  };
}

function authenticateOrRegister(username, password, email) {
  const lower = (username || '').trim().toLowerCase();
  if (accountsData.users[lower]) {
    return loginUser(username, password);
  }
  return registerUser(username, password, password, email || '');
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

  // --- Zabezpieczenia: Nagłówki Ochronne (Security Headers) ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API Logowania do Konta ---
  if (reqUrl === '/api/auth/login' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit('login_' + ip, 15, 15 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Zbyt wiele prób logowania. Odczekaj 15 minut.' }));
      return;
    }

    readJsonBody(req, (err, data) => {
      if (err || !data.username || !data.password) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Wpisz login i hasło' }));
        return;
      }
      const result = loginUser(data.username, data.password);
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

  // --- API Tworzenia / Rejestracji Nowego Konta ---
  if (reqUrl === '/api/auth/register' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit('reg_' + ip, 10, 15 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Zbyt wiele prób rejestracji. Odczekaj 15 minut.' }));
      return;
    }

    readJsonBody(req, (err, data) => {
      if (err || !data.username || !data.password) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Wypełnij wszystkie wymagane pola' }));
        return;
      }
      const result = registerUser(data.username, data.password, data.confirmPassword, data.email);
      if (result.error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: result.error }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      }
    });
    return;
  }

  // --- API Resetowania Hasła (Krok 1: Wysłanie 6-cyfrowego kodu na e-mail) ---
  if (reqUrl === '/api/auth/forgot-password' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit('forgot_' + ip, 6, 15 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Zbyt wiele prób resetowania hasła. Odczekaj 15 minut.' }));
      return;
    }

    readJsonBody(req, async (err, data) => {
      if (err || !data.identifier) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Podaj login lub adres e-mail konta' }));
        return;
      }

      const id = data.identifier.trim().toLowerCase();
      let foundUser = null;

      // Szukaj po loginie lub adresie e-mail
      if (accountsData.users[id]) {
        foundUser = accountsData.users[id];
      } else {
        for (const u of Object.values(accountsData.users)) {
          if (u.email && u.email.toLowerCase() === id) {
            foundUser = u;
            break;
          }
        }
      }

      if (!foundUser) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Nie znaleziono konta o podanym loginie lub e-mailu' }));
        return;
      }

      let targetEmail = foundUser.email;
      // Jeśli konto nie miało przypisanego e-maila, a użytkownik podał go teraz w formularzu
      if (!targetEmail && data.email && data.email.includes('@')) {
        targetEmail = data.email.trim().toLowerCase();
        foundUser.email = targetEmail;
        saveAccounts();
      }

      if (!targetEmail) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          error: 'Do tego konta nie przypisano jeszcze adresu e-mail. Podaj swój e-mail, aby otrzymać kod.',
          requiresEmail: true,
          username: foundUser.displayName
        }));
        return;
      }

      // Wygeneruj 6-cyfrowy kod weryfikacyjny (ważny 15 minut)
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      accountsData.resetCodes[foundUser.username] = {
        code: code,
        expiresAt: Date.now() + 15 * 60 * 1000,
        attempts: 0
      };
      saveAccounts();

      const mailResult = await sendResetEmail(targetEmail, code, foundUser.displayName);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        username: foundUser.displayName,
        maskedEmail: maskEmail(targetEmail),
        message: `Kod weryfikacyjny został wysłany na Twój adres e-mail (${maskEmail(targetEmail)}). Sprawdź skrzynkę pocztową.`
      }));
    });
    return;
  }

  // --- API Resetowania Hasła (Krok 2: Weryfikacja kodu i zapisanie NOWEGO HASŁA) ---
  if (reqUrl === '/api/auth/reset-password' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit('reset_' + ip, 6, 15 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Zbyt wiele prób. Odczekaj 15 minut.' }));
      return;
    }

    readJsonBody(req, (err, data) => {
      if (err || !data.username || !data.code || !data.newPassword) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Podaj nazwę użytkownika, kod z e-maila oraz nowe hasło' }));
        return;
      }

      const lowerUser = data.username.trim().toLowerCase();
      const code = data.code.trim();
      const newPassword = data.newPassword.trim();

      if (newPassword.length < 3) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Nowe hasło musi mieć co najmniej 3 znaki' }));
        return;
      }

      const resetInfo = accountsData.resetCodes[lowerUser];
      if (!resetInfo) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Brak aktywnego wniosku o reset hasła lub kod wygasł. Wygeneruj nowy kod.' }));
        return;
      }

      if (Date.now() > resetInfo.expiresAt) {
        delete accountsData.resetCodes[lowerUser];
        saveAccounts();
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Kod weryfikacyjny wygasł (ważny 15 minut). Wygeneruj nowy kod.' }));
        return;
      }

      if (!timingSafeEqualStr(resetInfo.code, code)) {
        resetInfo.attempts = (resetInfo.attempts || 0) + 1;
        if (resetInfo.attempts >= 5) {
          delete accountsData.resetCodes[lowerUser];
          saveAccounts();
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Zbyt wiele błędnych prób. Wniosek anulowany – wygeneruj nowy kod.' }));
          return;
        }
        saveAccounts();
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: `Nieprawidłowy kod weryfikacyjny. Pozostało prób: ${5 - resetInfo.attempts}` }));
        return;
      }

      // Kod poprawny - zapisujemy NOWE HASŁO
      const user = accountsData.users[lowerUser];
      if (!user) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Nie znaleziono konta' }));
        return;
      }

      const newSalt = crypto.randomBytes(16).toString('hex');
      const newHash = hashPassword(newPassword, newSalt);

      user.salt = newSalt;
      user.hash = newHash;
      user.reauthKey = crypto.randomBytes(32).toString('hex');
      user.updatedAt = new Date().toISOString();

      delete accountsData.resetCodes[lowerUser];

      // Unieważnij wszystkie stare tokeny dla bezpieczeństwa
      for (const [t, info] of Object.entries(accountsData.tokens)) {
        if (info.username === lowerUser) {
          delete accountsData.tokens[t];
        }
      }

      // Wygeneruj nowy token sesji
      const newToken = crypto.randomBytes(24).toString('hex');
      accountsData.tokens[newToken] = {
        username: lowerUser,
        createdAt: new Date().toISOString()
      };
      saveAccounts();

      console.log(`[Auth] ✅ Zresetowano i zapisano nowe hasło dla konta: ${user.displayName}`);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        token: newToken,
        username: user.displayName,
        email: user.email || '',
        reauthKey: user.reauthKey,
        message: 'Hasło zostało pomyślnie zmienione! Zalogowano na nowe dane.'
      }));
    });
    return;
  }

  // --- API Autoryzacji Stałej Sesji (Zapamiętaj mnie - Sesja nie wygasa) ---
  if (reqUrl === '/api/auth/reauth' && req.method === 'POST') {
    readJsonBody(req, (err, data) => {
      const clientKey = data.reauthKey || data.userHash; // kompatybilność wsteczna
      if (err || !data.username || !clientKey) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ authenticated: false }));
        return;
      }
      const lower = data.username.trim().toLowerCase();
      let user = accountsData.users[lower];

      const keyToMatch = user ? (user.reauthKey || user.hash) : null;
      if (user && keyToMatch && timingSafeEqualStr(keyToMatch, clientKey)) {
        // Zaktualizuj do reauthKey jeśli konto korzystało jeszcze ze starego hasha
        if (!user.reauthKey) {
          user.reauthKey = crypto.randomBytes(32).toString('hex');
        }
        const newToken = crypto.randomBytes(24).toString('hex');
        accountsData.tokens[newToken] = {
          username: lower,
          createdAt: new Date().toISOString(),
          permanent: true
        };
        saveAccounts();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          authenticated: true,
          token: newToken,
          username: user.displayName,
          email: user.email || '',
          reauthKey: user.reauthKey
        }));
        return;
      }

      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ authenticated: false }));
    });
    return;
  }

  // --- API Aktualizacji Adresu E-mail konta ---
  if (reqUrl === '/api/auth/update-email' && req.method === 'POST') {
    readJsonBody(req, (err, data) => {
      if (err || !data.token || !data.email) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Podaj poprawny adres e-mail' }));
        return;
      }
      const user = getUserByToken(data.token);
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Brak autoryzacji' }));
        return;
      }

      const cleanEmail = data.email.trim().toLowerCase();
      if (!cleanEmail.includes('@') || cleanEmail.length < 5) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Nieprawidłowy format adresu e-mail' }));
        return;
      }

      user.email = cleanEmail;
      saveAccounts();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, email: cleanEmail }));
    });
    return;
  }

  if (reqUrl === '/api/auth/me') {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const token = parsedUrl.searchParams.get('token') || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : '');
    const user = getUserByToken(token);
    if (user) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ authenticated: true, username: user.displayName, email: user.email || '' }));
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

  // API statusu podłączonych urządzeń (Bezpieczny - ukrywa loginy i nazwy pokoi)
  if (reqUrl === '/api/status') {
    let totalClients = 0;
    for (const clientSet of rooms.values()) {
      totalClients += clientSet.size;
    }
    const statusData = {
      status: 'online',
      version: '1.4.0',
      activeRooms: rooms.size,
      activeConnections: totalClients
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

  const publicDir = path.resolve(__dirname, 'public');
  const safePath = path.resolve(publicDir, '.' + reqUrl);
  const ext = path.extname(safePath).toLowerCase();

  const allowedExtensions = new Set([
    '.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.apk', '.ico', '.webp'
  ]);

  // Bezwzględna ochrona danych wrażliwych:
  // 1. Ścieżka musi ściśle należeć do katalogu public/
  // 2. Blokada plików ukrytych (.env, .data, .git)
  // 3. Blokada baz kont, logów, kodów źródłowych i konfiguracji
  // 4. Dozwolone wyłącznie bezpieczne pliki z białej listy rozszerzeń
  const lowerUrl = reqUrl.toLowerCase();
  const isForbidden = (
    !safePath.startsWith(publicDir) ||
    !allowedExtensions.has(ext) ||
    lowerUrl.includes('.env') ||
    lowerUrl.includes('.git') ||
    lowerUrl.includes('.data') ||
    lowerUrl.includes('accounts') ||
    lowerUrl.includes('package') ||
    lowerUrl.includes('server') ||
    lowerUrl.endsWith('.json') ||
    lowerUrl.endsWith('.log') ||
    lowerUrl.endsWith('.md')
  );

  if (isForbidden) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden - Dostęp zabroniony');
    return;
  }

  const filePath = safePath;

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
