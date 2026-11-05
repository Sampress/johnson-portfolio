/* Fills work.html from /api/works/<id> */
(function () {
  var root = document.getElementById('detail');
  document.getElementById('year').textContent = new Date().getFullYear();

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function isWeb(u) { return /^https?:\/\//i.test(u || ''); }
  function button(label, href, iconClass, primary) {
    var a = el('a', 'wd-btn' + (primary ? ' wd-btn-primary' : ''));
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    if (iconClass) { a.appendChild(el('i', iconClass)); a.appendChild(document.createTextNode(' ')); }
    a.appendChild(document.createTextNode(label));
    return a;
  }
  function section(title, child) {
    var s = el('section', 'wd-section');
    s.appendChild(el('h2', null, title)); s.appendChild(child); return s;
  }
  function notFound() {
    root.textContent = '';
    root.appendChild(el('h1', 'wd-title', 'Project not found'));
    var p = el('p'); var a = el('a', null, 'Back to my portfolio'); a.href = '/#work';
    p.appendChild(a); root.appendChild(p);
    document.title = 'Project not found | Kolawole Samuel Bejide';
  }

  function render(w) {
    document.title = w.title + ' | Kolawole Samuel Bejide';
    root.textContent = '';

    var img = el('img', 'wd-hero');
    img.src = '/' + encodeURI(w.image); img.alt = w.title;
    root.appendChild(img);

    if (w.category) root.appendChild(el('span', 'wd-cat', w.category));
    root.appendChild(el('h1', 'wd-title', w.title));

    if (w.role) {
      var role = el('p', 'wd-role'); role.appendChild(el('strong', null, 'My role: '));
      role.appendChild(document.createTextNode(w.role)); root.appendChild(role);
    }
    if (w.tools && w.tools.length) {
      var chips = el('div', 'wd-chips');
      w.tools.forEach(function (t) { chips.appendChild(el('span', 'wd-chip', t)); });
      root.appendChild(chips);
    }
    if (w.description) {
      var wrap = el('div', 'wd-text');
      w.description.split(/\n{2,}/).forEach(function (para) { wrap.appendChild(el('p', null, para)); });
      root.appendChild(section('About this project', wrap));
    }
    if (w.result) root.appendChild(section('Result', el('p', 'wd-text', w.result)));

    var actions = el('div', 'wd-actions');
    if (isWeb(w.link)) actions.appendChild(button('View live project', w.link, 'icon-share3', true));
    if (isWeb(w.github)) actions.appendChild(button('View code on GitHub', w.github, '', false));
    if (actions.children.length) root.appendChild(actions);
  }

  var id = new URLSearchParams(location.search).get('id') || '';
  if (!/^[a-f0-9]{12}$/.test(id)) return notFound();
  fetch('/api/works/' + id, { headers: { Accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(render, notFound);
})();
