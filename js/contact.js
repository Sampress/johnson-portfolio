/* Contact form -> /api/contact */
(function () {
  var form = document.getElementById('contact-form');
  if (!form) return;
  var status = document.getElementById('contact-status');
  var EMAIL = 'samibejide60@gmail.com';

  function say(msg, ok) {
    status.textContent = msg;
    status.className = 'contact-status ' + (ok ? 'ok' : 'err');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      subject: form.elements.subject.value.trim(),
      message: form.elements.message.value.trim(),
      website: form.elements.website.value
    };
    if (!data.name) return say('Please enter your name.', false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return say('Please enter a valid email address.', false);
    if (data.message.length < 10) return say('Please write a slightly longer message.', false);

    var btn = form.querySelector('[type=submit]');
    btn.disabled = true; say('Sending…', true);
    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify(data)
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || 'Something went wrong.');
        });
      })
      .then(function () { form.reset(); say('Thank you! Your message has been sent. I will get back to you soon.', true); })
      .catch(function (err) {
        var offline = err instanceof TypeError;
        say((offline ? 'Could not send your message right now.' : err.message) + ' You can also email me at ' + EMAIL + '.', false);
      })
      .then(function () { btn.disabled = false; });
  });
})();
