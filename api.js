// Recreates google.script.run so the existing page code works unchanged on GitHub Pages.
(function () {
  // Paste your Apps Script Web App URL here (it ends in /exec).
  var API_URL = 'https://script.google.com/macros/s/AKfycbwYga_XiVy9mKhPBVkGrEIY0pLcfosKNvhRmxHG6VzPdt7GIEpWR3OFDSFZbikw4qzZKA/exec';

  function call(fn, args) {
    return fetch(API_URL, {
      method: 'POST',
      // text/plain avoids a CORS preflight request, which Apps Script cannot answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error);
        return res.result;
      });
  }

  function runner(onOk, onFail) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (f) { return runner(f, onFail); };
        if (prop === 'withFailureHandler') return function (f) { return runner(onOk, f); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          call(String(prop), args).then(
            function (r) { if (onOk) onOk(r); },
            function (e) { if (onFail) onFail(e); else console.error(e); }
          );
        };
      }
    });
  }

  window.google = { script: { run: runner(null, null) } };
})();