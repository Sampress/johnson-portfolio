/**
 * Portfolio server — serves the site and a small admin API.
 * No dependencies: run with  `node server.js`  (Node 16+).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(ROOT, 'data');
const WORKS_FILE = path.join(DATA_DIR, 'works.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const UPLOAD_DIR = path.join(ROOT, 'images', 'uploads');

const SESSION_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_BODY = 8 * 1024 * 1024; // 8 MB (base64 image uploads)
const MAX_IMAGE = 5 * 1024 * 1024; // 5 MB decoded

// Only these paths are ever served publicly. Everything else (server.js,
// data/, sass/, PDFs you don't link to, etc.) returns 404.
const PUBLIC_DIRS = ['css', 'js', 'fonts', 'images', 'admin'];
const PUBLIC_FILES = ['index.html', 'work.html', 'KOLAWOLE SAMUEL CV.pdf'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.map': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- helpers ---------- */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSONAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isPrivateAddr(a) {
  a = String(a || '').replace(/^::ffff:/, '');
  return a === '::1' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a) || /^f[cd][0-9a-f]{2}:/i.test(a);
}
// Behind a host's proxy every visitor shares the proxy's address, so we read X-Forwarded-For,
// but only when the connection itself comes from a private address (so it can't be spoofed from outside).
function clientIp(req) {
  const direct = req.socket.remoteAddress || 'unknown';
  if (isPrivateAddr(direct) && req.headers['x-forwarded-for']) {
    const chain = String(req.headers['x-forwarded-for']).split(',').map((x) => x.trim()).filter(Boolean);
    for (let i = chain.length - 1; i >= 0; i--) if (!isPrivateAddr(chain[i])) return chain[i];
  }
  return direct;
}
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production'; }

/* ---------- sessions & login throttling ---------- */
const sessions = new Map(); // token -> expiry
const attempts = new Map(); // ip -> { count, until }
const contactHits = new Map(); // ip -> [timestamps]

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  return token;
}
function isAuthed(req) {
  const token = parseCookies(req).sid;
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  sessions.set(token, Date.now() + SESSION_MS); // sliding expiry
  return true;
}
function cookie(req, value, maxAgeSec) {
  return `sid=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}` + (isHttps(req) ? '; Secure' : '');
}
setInterval(() => {
  const now = Date.now();
  for (const [t, e] of sessions) if (e < now) sessions.delete(t);
  for (const [ip, a] of attempts) if (a.until && a.until < now) attempts.delete(ip);
  for (const [ip, h] of contactHits) if (!h.some((t) => now - t < 3600000)) contactHits.delete(ip);
}, 10 * 60 * 1000).unref();

function checkPassword(username, password) {
  const admin = readJSON(ADMIN_FILE, null);
  if (!admin) return false;
  const salt = Buffer.from(admin.salt, 'hex');
  const expected = Buffer.from(admin.hash, 'hex');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  const userOk = String(username).length === admin.username.length &&
    crypto.timingSafeEqual(Buffer.from(String(username)), Buffer.from(admin.username));
  const passOk = crypto.timingSafeEqual(actual, expected);
  return userOk && passOk;
}

/* ---------- validation ---------- */
function cleanText(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function validImagePath(p) {
  return typeof p === 'string' && /^images\/[\w\-. %\/]+$/.test(p) && !p.includes('..') && !p.includes('//');
}
function validLink(l) {
  if (!l) return true;
  if (/^https?:\/\//i.test(l)) { try { new URL(l); return true; } catch { return false; } }
  return /^[\w\-./#?=&%]+$/.test(l) && !l.includes('..');
}
function cleanMultiline(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
function parseTools(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  return list.map((t) => cleanText(t, 30)).filter(Boolean).slice(0, 12);
}
function validEmail(e) { return e.length <= 200 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(e); }
function parseWork(body) {
  const title = cleanText(body.title, 120);
  const category = cleanText(body.category, 60);
  const image = cleanText(body.image, 200);
  const link = cleanText(body.link, 500);
  const github = cleanText(body.github, 500);
  const role = cleanText(body.role, 80);
  const result = cleanText(body.result, 400);
  const description = cleanMultiline(body.description, 2000);
  const tools = parseTools(body.tools);
  if (!title) return { error: 'Title is required.' };
  if (!validImagePath(image)) return { error: 'Please choose or upload an image.' };
  if (!validLink(link)) return { error: 'Link must start with http:// or https://' };
  if (github && !(/^https?:\/\//i.test(github) && validLink(github))) return { error: 'GitHub link must start with http:// or https://' };
  return { work: { title, category, image, link, github, role, tools, result, description } };
}

/* ---------- image upload ---------- */
function sniffImage(buf) {
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 6 && buf.slice(0, 3).toString() === 'GIF') return 'gif';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
function saveUpload(dataUrl) {
  const m = /^data:[\w/+.-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) return { error: 'Invalid image data.' };
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length || buf.length > MAX_IMAGE) return { error: 'Image must be under 5 MB.' };
  const ext = sniffImage(buf);
  if (!ext) return { error: 'Only PNG, JPG, GIF or WEBP images are allowed.' };
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return { path: 'images/uploads/' + name };
}
function removeUploadIfUnused(imagePath, works) {
  if (!imagePath || !imagePath.startsWith('images/uploads/')) return;
  if (works.some((w) => w.image === imagePath)) return;
  const file = path.join(ROOT, imagePath);
  if (file.startsWith(UPLOAD_DIR + path.sep)) fs.unlink(file, () => {});
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const method = req.method;
  const route = url.pathname;

  // Public: list works
  if (method === 'GET' && route === '/api/works') {
    return send(res, 200, readJSON(WORKS_FILE, []), { 'Cache-Control': 'no-cache' });
  }

  const single = /^\/api\/works\/([a-f0-9]{12})$/.exec(route);
  if (method === 'GET' && single) {
    const w = readJSON(WORKS_FILE, []).find((x) => x.id === single[1]);
    return w ? send(res, 200, w, { 'Cache-Control': 'no-cache' }) : send(res, 404, { error: 'Not found.' });
  }

  // Everything that changes state needs a custom header (CSRF defence, with SameSite=Strict cookie)
  if (method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') {
    return send(res, 403, { error: 'Forbidden' });
  }

  if (method === 'POST' && route === '/api/login') {
    const ip = clientIp(req);
    const a = attempts.get(ip) || { count: 0, until: 0 };
    if (a.until > Date.now()) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    if (!fs.existsSync(ADMIN_FILE)) return send(res, 503, { error: 'Admin not set up yet. Run: node setup-admin.js' });
    const body = await readBody(req);
    if (checkPassword(body.username || '', body.password || '')) {
      attempts.delete(ip);
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, createSession(), SESSION_MS / 1000) });
    }
    a.count += 1;
    if (a.count >= 5) { a.until = Date.now() + 15 * 60 * 1000; a.count = 0; }
    attempts.set(ip, a);
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return send(res, 401, { error: 'Incorrect username or password.' });
  }

  if (method === 'POST' && route === '/api/contact') {
    const ip = clientIp(req);
    const now = Date.now();
    const hits = (contactHits.get(ip) || []).filter((t) => now - t < 3600000);
    if (hits.length >= 5) return send(res, 429, { error: 'You have sent several messages already. Please try again later.' });
    const body = await readBody(req);
    if (body.website) return send(res, 201, { ok: true }); // honeypot: bots fill this hidden field
    const name = cleanText(body.name, 100);
    const email = cleanText(body.email, 200);
    const subject = cleanText(body.subject, 150);
    const message = cleanMultiline(body.message, 3000);
    if (!name) return send(res, 400, { error: 'Please enter your name.' });
    if (!validEmail(email)) return send(res, 400, { error: 'Please enter a valid email address.' });
    if (message.length < 10) return send(res, 400, { error: 'Please write a slightly longer message.' });
    hits.push(now); contactHits.set(ip, hits);
    const msgs = readJSON(MESSAGES_FILE, []);
    msgs.unshift({ id: crypto.randomBytes(6).toString('hex'), name, email, subject, message, date: new Date().toISOString(), read: false });
    writeJSONAtomic(MESSAGES_FILE, msgs.slice(0, 1000));
    return send(res, 201, { ok: true });
  }

  if (method === 'POST' && route === '/api/logout') {
    const t = parseCookies(req).sid; if (t) sessions.delete(t);
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
  }

  if (method === 'GET' && route === '/api/me') return send(res, isAuthed(req) ? 200 : 401, { authed: isAuthed(req) });

  // ---- everything below needs login ----
  if (!isAuthed(req)) return send(res, 401, { error: 'Please log in.' });

  if (method === 'GET' && route === '/api/messages') return send(res, 200, readJSON(MESSAGES_FILE, []));
  const mm = /^\/api\/messages\/([a-f0-9]{12})$/.exec(route);
  if (mm && (method === 'PUT' || method === 'DELETE')) {
    const msgs = readJSON(MESSAGES_FILE, []);
    const i = msgs.findIndex((m) => m.id === mm[1]);
    if (i === -1) return send(res, 404, { error: 'Not found.' });
    if (method === 'DELETE') msgs.splice(i, 1);
    else msgs[i].read = !!(await readBody(req)).read;
    writeJSONAtomic(MESSAGES_FILE, msgs);
    return send(res, 200, { ok: true });
  }

  if (method === 'POST' && route === '/api/upload') {
    const body = await readBody(req);
    const r = saveUpload(body.data);
    return r.error ? send(res, 400, { error: r.error }) : send(res, 201, r);
  }

  if (method === 'POST' && route === '/api/works') {
    const { work, error } = parseWork(await readBody(req));
    if (error) return send(res, 400, { error });
    const works = readJSON(WORKS_FILE, []);
    work.id = crypto.randomBytes(6).toString('hex');
    works.push(work);
    writeJSONAtomic(WORKS_FILE, works);
    return send(res, 201, work);
  }

  if (method === 'PUT' && route === '/api/works/order') {
    const body = await readBody(req);
    const works = readJSON(WORKS_FILE, []);
    const byId = new Map(works.map((w) => [w.id, w]));
    if (!Array.isArray(body.ids) || body.ids.length !== works.length || !body.ids.every((id) => byId.has(id))) {
      return send(res, 400, { error: 'Invalid order.' });
    }
    writeJSONAtomic(WORKS_FILE, body.ids.map((id) => byId.get(id)));
    return send(res, 200, { ok: true });
  }

  const m = /^\/api\/works\/([a-f0-9]{12})$/.exec(route);
  if (m && (method === 'PUT' || method === 'DELETE')) {
    const works = readJSON(WORKS_FILE, []);
    const i = works.findIndex((w) => w.id === m[1]);
    if (i === -1) return send(res, 404, { error: 'Not found.' });
    if (method === 'DELETE') {
      const [removed] = works.splice(i, 1);
      writeJSONAtomic(WORKS_FILE, works);
      removeUploadIfUnused(removed.image, works);
      return send(res, 200, { ok: true });
    }
    const { work, error } = parseWork(await readBody(req));
    if (error) return send(res, 400, { error });
    const old = works[i];
    works[i] = { id: old.id, ...work };
    writeJSONAtomic(WORKS_FILE, works);
    if (old.image !== work.image) removeUploadIfUnused(old.image, works);
    return send(res, 200, works[i]);
  }

  return send(res, 404, { error: 'Not found.' });
}

/* ---------- pages with server-filled meta tags ---------- */
function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function origin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const host = /^[\w.\-:\[\]]+$/.test(req.headers.host || '') ? req.headers.host : 'localhost';
  return (isHttps(req) ? 'https' : 'http') + '://' + host;
}
function servePage(req, res, url, file, rel) {
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) return send(res, 404, 'Not found');
    const base = origin(req);
    const vals = {
      ORIGIN: base,
      URL: base + '/' + rel,
      TITLE: 'Project | Kolawole Samuel Bejide',
      DESC: 'A project by Kolawole Samuel Bejide, Full Stack Web Developer & Data Analyst.',
      IMAGE: base + '/images/Profile%20pic.jpg',
    };
    if (rel === 'work.html') {
      const id = url.searchParams.get('id') || '';
      const w = /^[a-f0-9]{12}$/.test(id) ? readJSON(WORKS_FILE, []).find((x) => x.id === id) : null;
      if (w) {
        vals.URL = base + '/work.html?id=' + w.id;
        vals.TITLE = w.title + ' | Kolawole Samuel Bejide';
        vals.DESC = (w.description || (w.category ? w.category + ' project' : 'Project') + ' by Kolawole Samuel Bejide').replace(/\s+/g, ' ').slice(0, 200);
        vals.IMAGE = base + '/' + encodeURI(w.image);
      }
    }
    html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vals ? esc(vals[k]) : m));
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

/* ---------- static files ---------- */
function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request'); }
  if (rel === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
  if (rel === '/') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  rel = rel.replace(/^\/+/, '');

  const parts = rel.split('/');
  const allowed = parts.length === 1 ? PUBLIC_FILES.includes(rel) : PUBLIC_DIRS.includes(parts[0]);
  if (!allowed || parts.some((p) => p.startsWith('.') || p === '..')) return send(res, 404, 'Not found');

  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'Not found');

  if (rel === 'index.html' || rel === 'work.html') return servePage(req, res, url, file, rel);

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': parts[0] === 'admin' ? 'no-store' : 'public, max-age=3600',
    };
    if (parts[0] === 'admin') {
      headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'";
      headers['X-Frame-Options'] = 'DENY';
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error.' : e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Site:  http://localhost:${PORT}/`);
  console.log(`Admin: http://localhost:${PORT}/admin/`);
  if (!fs.existsSync(ADMIN_FILE)) console.log('\nNo admin account yet — run:  node setup-admin.js');
});
