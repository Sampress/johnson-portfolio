(function () {
  var $ = function (id) { return document.getElementById(id); };
  var loginView = $('login-view'), dashView = $('dash-view');
  var works = [], messages = [];

  function api(method, url, body) {
    var opts = { method: method, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401 && url !== '/api/login' && url !== '/api/me') { showLogin(); }
        if (!r.ok) throw new Error(data.error || 'Something went wrong.');
        return data;
      });
    });
  }
  function showLogin() { dashView.hidden = true; loginView.hidden = false; }
  function showDash() { loginView.hidden = true; dashView.hidden = false; loadWorks(); loadMessages(); }

  /* ---- login / logout ---- */
  api('GET', '/api/me').then(showDash, showLogin);

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target; $('login-error').textContent = '';
    api('POST', '/api/login', { username: f.username.value, password: f.password.value })
      .then(function () { f.reset(); showDash(); })
      .catch(function (err) { $('login-error').textContent = err.message; });
  });
  $('logout-btn').addEventListener('click', function () {
    api('POST', '/api/logout', {}).then(showLogin, showLogin);
  });

  /* ---- tabs ---- */
  function showTab(name) {
    var isWorks = name === 'works';
    $('works-view').hidden = !isWorks; $('messages-view').hidden = isWorks;
    $('tab-works').classList.toggle('active', isWorks); $('tab-messages').classList.toggle('active', !isWorks);
    if (!isWorks) loadMessages();
  }
  $('tab-works').addEventListener('click', function () { showTab('works'); });
  $('tab-messages').addEventListener('click', function () { showTab('messages'); });

  function btn(label, cls, fn, disabled) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn small ' + (cls || ''); b.textContent = label;
    b.disabled = !!disabled; b.addEventListener('click', fn); return b;
  }

  /* ---- works list ---- */
  function loadWorks() {
    api('GET', '/api/works').then(function (data) { works = data; renderList(); });
  }
  function renderList() {
    var ul = $('list'); ul.textContent = '';
    $('empty').hidden = works.length > 0;
    works.forEach(function (w, i) {
      var li = document.createElement('li');
      var img = document.createElement('img'); img.src = '/' + encodeURI(w.image); img.alt = '';
      var meta = document.createElement('div'); meta.className = 'meta';
      var t = document.createElement('strong'); t.textContent = w.title;
      var c = document.createElement('span'); c.className = 'muted'; c.textContent = w.category || '—';
      meta.appendChild(t); meta.appendChild(c);
      var actions = document.createElement('div'); actions.className = 'actions';
      actions.appendChild(btn('↑', '', function () { move(i, -1); }, i === 0));
      actions.appendChild(btn('↓', '', function () { move(i, 1); }, i === works.length - 1));
      actions.appendChild(btn('Edit', '', function () { startEdit(w); }));
      actions.appendChild(btn('Delete', 'danger', function () { remove(w); }));
      li.appendChild(img); li.appendChild(meta); li.appendChild(actions); ul.appendChild(li);
    });
  }
  function move(i, d) {
    var j = i + d; if (j < 0 || j >= works.length) return;
    var copy = works.slice(); var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    api('PUT', '/api/works/order', { ids: copy.map(function (w) { return w.id; }) })
      .then(function () { works = copy; renderList(); })
      .catch(function (e) { alert(e.message); });
  }
  function remove(w) {
    if (!confirm('Delete "' + w.title + '"? This cannot be undone.')) return;
    api('DELETE', '/api/works/' + w.id).then(function () {
      if (form.elements.id.value === w.id) resetForm();
      loadWorks();
    }).catch(function (e) { alert(e.message); });
  }

  /* ---- work form ---- */
  var form = $('work-form'), fileInput = $('image-file'), preview = $('preview');
  var F = function (n) { return form.elements[n]; };
  function setPreview(path) {
    if (path) { preview.src = '/' + encodeURI(path); preview.hidden = false; } else { preview.hidden = true; preview.removeAttribute('src'); }
  }
  function resetForm() {
    form.reset(); F('id').value = ''; F('image').value = ''; setPreview('');
    $('image-note').textContent = '';
    $('form-title').textContent = 'Add a work'; $('cancel-btn').hidden = true; $('form-error').textContent = '';
  }
  function startEdit(w) {
    F('id').value = w.id; F('title').value = w.title; F('category').value = w.category || '';
    F('link').value = w.link || ''; F('github').value = w.github || ''; F('role').value = w.role || '';
    F('tools').value = (w.tools || []).join(', '); F('result').value = w.result || '';
    F('description').value = w.description || '';
    F('image').value = w.image; fileInput.value = ''; setPreview(w.image); $('image-note').textContent = '';
    $('form-title').textContent = 'Edit work'; $('cancel-btn').hidden = false; $('form-error').textContent = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('cancel-btn').addEventListener('click', resetForm);

  /* ---- image upload (shrinks big images in the browser first) ---- */
  function fmt(bytes) { return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB'; }
  function optimise(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.onload = function () {
        var original = reader.result;
        if (file.type === 'image/gif') return resolve({ data: original, bytes: file.size, note: '' });
        var img = new Image();
        img.onerror = function () { reject(new Error('That does not look like a valid image.')); };
        img.onload = function () {
          var MAX = 1600, w = img.naturalWidth, h = img.naturalHeight;
          if (w <= MAX && file.size <= 400 * 1024) return resolve({ data: original, bytes: file.size, note: '' });
          var scale = Math.min(1, MAX / w);
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          var out = c.toDataURL('image/jpeg', 0.82);
          var outBytes = Math.round((out.length - out.indexOf(',') - 1) * 3 / 4);
          if (outBytes >= file.size) return resolve({ data: original, bytes: file.size, note: '' });
          resolve({ data: out, bytes: outBytes, note: 'Image optimised: ' + fmt(file.size) + ' → ' + fmt(outBytes) });
        };
        img.src = original;
      };
      reader.readAsDataURL(file);
    });
  }
  fileInput.addEventListener('change', function () {
    var file = fileInput.files[0]; if (!file) return;
    $('form-error').textContent = ''; $('image-note').textContent = '';
    if (file.size > 25 * 1024 * 1024) { $('form-error').textContent = 'Image is too large (max 25 MB).'; fileInput.value = ''; return; }
    $('save-btn').disabled = true; $('image-note').textContent = 'Processing image…';
    optimise(file)
      .then(function (r) {
        if (r.bytes > 5 * 1024 * 1024) throw new Error('Image must be under 5 MB after optimising.');
        return api('POST', '/api/upload', { data: r.data }).then(function (u) {
          F('image').value = u.path; setPreview(u.path); $('image-note').textContent = r.note;
        });
      })
      .catch(function (e) { $('form-error').textContent = e.message; $('image-note').textContent = ''; fileInput.value = ''; })
      .then(function () { $('save-btn').disabled = false; });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault(); $('form-error').textContent = '';
    var payload = {
      title: F('title').value, category: F('category').value, image: F('image').value,
      link: F('link').value, github: F('github').value, role: F('role').value,
      tools: F('tools').value, result: F('result').value, description: F('description').value
    };
    var id = F('id').value;
    $('save-btn').disabled = true;
    api(id ? 'PUT' : 'POST', id ? '/api/works/' + id : '/api/works', payload)
      .then(function () { resetForm(); loadWorks(); })
      .catch(function (err) { $('form-error').textContent = err.message; })
      .then(function () { $('save-btn').disabled = false; });
  });

  /* ---- messages ---- */
  function loadMessages() {
    api('GET', '/api/messages').then(function (data) { messages = data; renderMessages(); }, function () {});
  }
  function renderMessages() {
    var unread = messages.filter(function (m) { return !m.read; }).length;
    var badge = $('badge'); badge.hidden = unread === 0; badge.textContent = unread;
    var ul = $('msg-list'); ul.textContent = '';
    $('msg-empty').hidden = messages.length > 0;
    messages.forEach(function (m) {
      var li = document.createElement('li'); if (!m.read) li.className = 'unread';
      var head = document.createElement('div'); head.className = 'head';
      var who = document.createElement('span');
      var name = document.createElement('strong'); name.className = 'who'; name.textContent = m.name;
      var mail = document.createElement('a'); mail.href = 'mailto:' + m.email; mail.textContent = ' <' + m.email + '>';
      who.appendChild(name); who.appendChild(mail);
      var date = document.createElement('span'); date.className = 'muted'; date.textContent = new Date(m.date).toLocaleString();
      head.appendChild(who); head.appendChild(date); li.appendChild(head);
      if (m.subject) { var s = document.createElement('div'); s.className = 'subject'; s.textContent = m.subject; li.appendChild(s); }
      var body = document.createElement('div'); body.className = 'body'; body.textContent = m.message; li.appendChild(body);
      var actions = document.createElement('div'); actions.className = 'row';
      var reply = document.createElement('a'); reply.className = 'btn small';
      reply.href = 'mailto:' + m.email + '?subject=' + encodeURIComponent('Re: ' + (m.subject || 'Your message'));
      reply.textContent = 'Reply';
      actions.appendChild(reply);
      actions.appendChild(btn(m.read ? 'Mark as unread' : 'Mark as read', '', function () {
        api('PUT', '/api/messages/' + m.id, { read: !m.read }).then(loadMessages).catch(function (e) { alert(e.message); });
      }));
      actions.appendChild(btn('Delete', 'danger', function () {
        if (!confirm('Delete this message?')) return;
        api('DELETE', '/api/messages/' + m.id).then(loadMessages).catch(function (e) { alert(e.message); });
      }));
      li.appendChild(actions); ul.appendChild(li);
    });
  }
})();
