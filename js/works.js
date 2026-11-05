/* Renders the "Recent Works" grid from /api/works */
(function () {
  var grid = document.getElementById('works-grid');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function isWeb(u) { return /^https?:\/\//i.test(u || ''); }
  function iconLink(href, iconClass, label) {
    var s = el('span'); var a = el('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', label);
    a.appendChild(el('i', iconClass));
    s.appendChild(a); return s;
  }

  function card(w) {
    var col = el('div', 'col-md-6 animated fadeInUp');
    var project = el('div', 'project');
    project.style.backgroundImage = 'url("' + encodeURI(w.image).replace(/"/g, '%22') + '")';
    project.setAttribute('role', 'img');
    project.setAttribute('aria-label', w.title);
    var desc = el('div', 'desc');
    var con = el('div', 'con');

    var h3 = el('h3');
    var a = el('a', null, w.title);
    a.href = 'work.html?id=' + encodeURIComponent(w.id);
    h3.appendChild(a); con.appendChild(h3);
    if (w.category) con.appendChild(el('span', null, w.category));

    if (isWeb(w.link)) {
      var icons = el('p', 'icon');
      if (isWeb(w.link)) icons.appendChild(iconLink(w.link, 'icon-share3', 'Open live project'));
      con.appendChild(icons);
    }
    desc.appendChild(con); project.appendChild(desc); col.appendChild(project);
    return col;
  }

  // Allow links like /#work or /#contact (the template's menu doesn't read the address hash)
  function jumpToHash() {
    var h = (location.hash || '').slice(1);
    if (!/^[a-z]+$/.test(h)) return;
    var t = document.querySelector('[data-section="' + h + '"]');
    if (t) t.scrollIntoView();
  }

  if (!grid) return;
  fetch('/api/works', { headers: { Accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (works) {
      grid.textContent = '';
      works.forEach(function (w) { grid.appendChild(card(w)); });
    })
    .catch(function () { /* leave the grid empty if the API is unreachable */ })
    .then(function () { setTimeout(jumpToHash, 100); });
})();
