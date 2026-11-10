/*
 * Sign-in and the connection to the Apps Script API for the owner dashboard.
 * Owners sign in with Google; each request carries that sign-in token, and the
 * API checks it with Google and against the owner list before reading anything.
 */
(function () {
  var CFG = window.FUND_PORTAL || {};
  var KEY = "fundOwnerToken";
  var configured = /^https:\/\/script\.google\.com\//.test(CFG.API_URL || "") && /\.apps\.googleusercontent\.com$/.test(CFG.GOOGLE_CLIENT_ID || "");

  function decode(tok) {
    try {
      var p = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(decodeURIComponent(escape(atob(p + "===".slice((p.length + 3) % 4)))));
    } catch (e) { return null; }
  }
  function stored() {
    var t = null;
    try { t = localStorage.getItem(KEY); } catch (e) {}
    var p = t && decode(t);
    return p && p.exp * 1000 > Date.now() + 60e3 ? t : null;
  }
  function save(t) { try { localStorage.setItem(KEY, t); } catch (e) {} }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  // ---------- Google sign-in ----------
  var gisReady = new Promise(function (resolve) {
    if (window.google && google.accounts && google.accounts.id) return resolve();
    window.addEventListener("gis-loaded", resolve, { once: true });
  });
  var waiting = []; // requests parked until someone signs in
  var initialized = false;

  function onCredential(resp) {
    if (!resp || !resp.credential) return;
    save(resp.credential);
    showUser();
    document.body.classList.remove("gated");
    var g = document.getElementById("gate");
    if (g) g.hidden = true;
    var w = waiting; waiting = [];
    w.forEach(function (f) { f(resp.credential); });
    // Signed in after a "wrong account" stop: nothing is waiting, so start over.
    if (!w.length && window.FundDash) window.FundDash.load();
  }

  function gate(message) {
    document.body.classList.add("gated");
    var g = document.getElementById("gate");
    var m = document.getElementById("gateMsg");
    if (m) { m.textContent = message || ""; m.hidden = !message; }
    gisReady.then(function () {
      if (!initialized) {
        google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onCredential, auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true });
        initialized = true;
      }
      var slot = document.getElementById("gsiButton");
      if (slot && !slot.childElementCount) google.accounts.id.renderButton(slot, { theme: "filled_black", size: "large", shape: "pill", text: "signin_with", width: 280 });
      if (!message) google.accounts.id.prompt();
    });
    if (g) g.hidden = false;
  }

  function token() {
    var t = stored();
    if (t) return Promise.resolve(t);
    return new Promise(function (resolve) { waiting.push(resolve); gate(""); });
  }

  function showUser() {
    var t = stored(), p = t && decode(t), el = document.getElementById("who");
    if (!el) return;
    if (!p) { el.hidden = true; return; }
    el.hidden = false;
    var av = document.getElementById("whoPic");
    if (av) { if (p.picture) { av.src = p.picture; av.hidden = false; } else av.hidden = true; }
    document.getElementById("whoName").textContent = p.given_name || p.name || p.email;
    document.getElementById("whoEmail").textContent = p.email;
  }

  function signOut() {
    clear();
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    location.reload();
  }

  // ---------- the API ----------
  function post(body) {
    return fetch(CFG.API_URL, {
      method: "POST",
      // text/plain keeps this a "simple" request, so the browser doesn't send a CORS preflight Apps Script can't answer.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
    }).then(function (r) {
      if (!r.ok) throw new Error("The server answered " + r.status + ". Try again in a minute.");
      return r.json();
    }, function () {
      throw new Error("Couldn't reach the server. Check your connection and try again.");
    });
  }

  function call(action, args, retried) {
    return token().then(function (t) {
      return post({ action: action, args: args || [], idToken: t });
    }).then(function (res) {
      if (res.ok) return res.result;
      if (res.auth) {
        clear();
        if (res.notOwner) {
          gate((res.email || "That account") + " isn't one of the owner accounts. Sign in with the Google account you use for The Fund.");
          if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
        }
        if (!retried) return call(action, args, true);
        var e = new Error(res.error || "Please sign in again."); e.auth = true; throw e;
      }
      throw new Error(res.error || "Something went wrong.");
    });
  }

  // Same shape as Apps Script's google.script.run, so the dashboard code reads the same:
  // FundAPI.run.withSuccessHandler(fn).withFailureHandler(fn).addTodo(text, due)
  function runner() {
    var ok = function () {}, bad = function (e) { console.error(e); };
    var chain = new Proxy({}, {
      get: function (_, name) {
        if (name === "withSuccessHandler") return function (f) { ok = f; return chain; };
        if (name === "withFailureHandler") return function (f) { bad = f; return chain; };
        return function () {
          var args = [].slice.call(arguments);
          call(String(name), args).then(function (r) { ok(r); }, function (e) { bad(e); });
        };
      },
    });
    return chain;
  }

  window.FundAPI = {
    configured: configured,
    call: call,
    get run() { return runner(); },
  };

  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-signout]")) signOut();
  });

  document.addEventListener("DOMContentLoaded", function () {
    if (!configured) {
      document.getElementById("app").innerHTML = '<div class="wrap"><div class="setup"><h1>Almost there</h1><p>The dashboard needs two settings in <b>portal-config.js</b>: the Apps Script web app URL and the Google sign-in client ID. Steps are in <b>owner-dashboard/README.md</b>.</p></div></div>';
      return;
    }
    showUser();
    if (window.FundDash) window.FundDash.load();
  });
})();
