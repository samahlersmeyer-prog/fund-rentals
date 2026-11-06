/* The Fund Worldwide – rental listings. All content comes from listings.json. */
(function () {
  "use strict";

  const app = document.getElementById("app");
  let DATA = null;
  const state = { filter: "all", sort: "featured" };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const img = (id, w) => `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w${w}`;
  const money = (n) => "$" + Number(n).toLocaleString("en-US");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parseDate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const fmtDate = (d, withYear = true) => `${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? ", " + d.getFullYear() : ""}`;
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const bathsLabel = (b) => `${b} ${b === 1 ? "bath" : "baths"}`;
  const bedsLabel = (b) => (b === 0 ? "Studio" : `${b} ${b === 1 ? "bed" : "beds"}`);
  const digits = (p) => String(p).replace(/\D/g, "");

  // Status: "available" (now or a date) or "leased" (with leaseEnds date / month-to-month)
  function statusOf(p) {
    if (p.status === "available") {
      const d = parseDate(p.availableDate);
      if (!d || d <= today()) return { kind: "available", short: "Available now", long: "Available now", sortKey: 0 };
      return { kind: "soon", short: `Available ${fmtDate(d, false)}`, long: `Available ${fmtDate(d)}`, sortKey: 1 + d.getTime() / 1e13 };
    }
    if (p.leaseEnds === "month-to-month") return { kind: "leased", short: "Leased", long: "Currently leased (month-to-month)", sortKey: 3 };
    const end = parseDate(p.leaseEnds);
    if (end) return { kind: "leased", short: "Leased", long: `Currently leased · lease ends ${fmtDate(end)}`, sortKey: 2 + end.getTime() / 1e13 };
    return { kind: "leased", short: "Leased", long: "Currently leased", sortKey: 3 };
  }
  const isOpen = (p) => statusOf(p).kind !== "leased";

  // Leased homes show the street only; open units show the full address.
  function addressOf(p) {
    const tail = `${p.city}, ${p.state} ${p.zip}`;
    return isOpen(p) ? `${p.number} ${p.street}, ${tail}` : `${p.street}, ${tail}`;
  }
  const factsOf = (p) => [bedsLabel(p.beds), bathsLabel(p.baths), p.sqft ? `${p.sqft.toLocaleString()} sq ft` : null].filter(Boolean);
  // What we advertise: the asking rent for open units, a typical range for leased ones.
  const priceLow = (p) => p.askingRent || (p.rentRange ? p.rentRange[0] : 0);
  function priceHTML(p, cls) {
    if (isOpen(p) && p.askingRent) return `<div class="${cls}">${money(p.askingRent)}<small> /month</small></div>`;
    if (p.rentRange) return `<div class="${cls} range"><small>Rents typically</small> ${money(p.rentRange[0])}–${money(p.rentRange[1]).slice(1)}<small> /mo</small></div>`;
    return `<div class="${cls} range"><small>Ask about rent</small></div>`;
  }
  function avatarHTML(m, size) {
    const initials = m.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
    return m.photo
      ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${img(m.photo, size * 3)}" alt="${esc(m.name)}">`
      : `<span class="avatar initials" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.6)}px" aria-hidden="true">${esc(initials)}</span>`;
  }
  function meetHTML() {
    const team = DATA.team || [];
    if (!team.length) return "";
    return `<section class="meet">
      <div class="faces">${team.map((m) => avatarHTML(m, 64)).join("")}</div>
      <div>
        <h2>Meet your landlords</h2>
        <p>${esc(DATA.about || "")}</p>
        <p class="names">${team.map((m) => `<span>${esc(m.name.split(" ")[0])}</span>`).join("")}</p>
      </div>
    </section>`;
  }
  const titleOf = (p) => `${p.beds === 0 ? "Studio" : p.beds + "-bed"} ${p.type.toLowerCase()} · ${p.name}`;

  // ---------- views ----------
  function listView() {
    const all = DATA.properties;
    const openAll = all.filter(isOpen);
    const isHouse = (p) => /house|home/i.test(p.type);
    const list = all.filter((p) =>
      state.filter === "open" ? isOpen(p) :
      state.filter === "houses" ? isHouse(p) :
      state.filter === "apts" ? !isHouse(p) : true);
    const areaName = (z) => (DATA.areas || {})[z] || "Fort Wayne";
    const zips = [...new Set(list.map((p) => p.zip))].sort();
    const chip = (key, label) => `<button class="chip" data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`;

    const groups = zips.map((z) => {
      const items = list.filter((p) => p.zip === z)
        .sort((a, b) => statusOf(a).sortKey - statusOf(b).sortKey || b.beds - a.beds);
      const nOpen = items.filter(isOpen).length;
      return `<section class="area" id="area-${z}">
        <div class="area-h">
          <h2>${esc(areaName(z))} <span class="zip">${z}</span></h2>
          <span class="area-meta">${items.length} ${items.length === 1 ? "rental" : "rentals"}${nOpen ? `, <b>${nOpen} available</b>` : ""}</span>
          <button class="linkish" data-fly="${z}">See on map</button>
        </div>
        <div class="grid">${items.map(cardHTML).join("")}</div>
      </section>`;
    }).join("");

    const asks = openAll.map((p) => p.askingRent).filter(Boolean);
    const summary = openAll.length
      ? `${openAll.length} ${openAll.length === 1 ? "place is" : "places are"} available or opening soon${asks.length ? `, from ${money(Math.min(...asks))} a month` : ""}.`
      : "Everything is leased right now, but tell us what you're looking for and we'll reach out when something opens.";

    app.innerHTML = `
      <section class="hero-map">
        <div id="map" role="region" aria-label="Map of our rentals across Fort Wayne"></div>
        <div class="hero-panel">
          <h1>Rentals across Fort Wayne, from people who live here</h1>
          <p>${summary}</p>
          <div class="legend">
            <span><i class="lg-tag">$</i> Available</span>
            <span><i class="lg-dot"></i> Leased, ask about openings</span>
          </div>
        </div>
      </section>
      ${meetHTML()}
      <div class="filters" role="toolbar" aria-label="Filter listings">
        ${chip("all", "All")}${chip("open", `Available${openAll.length ? ` (${openAll.length})` : ""}`)}${chip("houses", "Houses")}${chip("apts", "Apartments")}
        <span class="spacer"></span>
        <label class="jump">Jump to
          <select aria-label="Jump to an area">${zips.map((z) => `<option value="${z}">${esc(areaName(z))} (${z})</option>`).join("")}</select>
        </label>
      </div>
      ${list.length ? groups : emptyHTML()}
    `;

    app.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { state.filter = b.dataset.filter; listView(); }));
    const jump = app.querySelector(".jump select");
    if (jump) jump.addEventListener("change", () => document.getElementById("area-" + jump.value)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    initMap(list);
    app.querySelectorAll("[data-fly]").forEach((b) => b.addEventListener("click", () => flyToZip(b.dataset.fly)));
    document.title = "The Fund Worldwide · Fort Wayne Rentals";
  }

  // ---------- map ----------
  let MAP = null, MARKERS = {};
  function initMap(list) {
    const el = document.getElementById("map");
    if (!el || !window.L) { if (el) { el.closest(".hero-map")?.classList.add("no-map"); el.remove(); } return; }
    if (MAP) { MAP.remove(); MAP = null; }
    MARKERS = {};
    MAP = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 17, subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(MAP);
    MAP.on("click focus", () => MAP.scrollWheelZoom.enable());

    // One marker per spot; duplexes and side-by-side homes share a marker.
    const spots = {};
    list.forEach((p) => { if (!p.loc) return; const k = p.loc.join(","); (spots[k] = spots[k] || []).push(p); });
    const bounds = [];
    Object.entries(spots).forEach(([k, units]) => {
      const opens = units.filter(isOpen);
      const cheapest = opens.map((u) => u.askingRent).filter(Boolean).sort((a, b) => a - b)[0];
      const html = opens.length
        ? `<span class="pin-tag">${cheapest ? money(cheapest) : "Open"}${units.length > 1 ? `<small>+${units.length - 1}</small>` : ""}</span>`
        : `<span class="pin-dot">${units.length > 1 ? units.length : ""}</span>`;
      const icon = L.divIcon({ className: "pin " + (opens.length ? "pin-open" : "pin-leased"), html, iconSize: null });
      const m = L.marker(k.split(",").map(Number), { icon, keyboard: true, title: units.map((u) => u.name).join(", "), zIndexOffset: opens.length ? 1000 : 0 }).addTo(MAP);
      m.bindPopup(popupHTML(units), { closeButton: false, maxWidth: 260, minWidth: 220 });
      units.forEach((u) => { MARKERS[u.id] = m; });
      bounds.push(k.split(",").map(Number));
    });
    if (bounds.length) MAP.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });

    // Hovering a card lifts its pin on the map.
    app.querySelectorAll(".card[data-id]").forEach((c) => {
      const m = MARKERS[c.dataset.id];
      if (!m) return;
      c.addEventListener("mouseenter", () => m.getElement()?.classList.add("is-hot"));
      c.addEventListener("mouseleave", () => m.getElement()?.classList.remove("is-hot"));
    });
  }

  function popupHTML(units) {
    return units.map((u) => `
      <a class="pop" href="#/p/${esc(u.id)}">
        ${u.photos[0] ? `<img src="${img(u.photos[0], 300)}" alt="">` : ""}
        <span class="pop-body">
          <b>${esc(u.name)}</b>
          <span>${esc(factsOf(u).slice(0, 2).join(", "))}</span>
          <span class="pop-price ${isOpen(u) ? "open" : ""}">${isOpen(u) && u.askingRent ? `${money(u.askingRent)}/mo, ${esc(statusOf(u).short.toLowerCase())}` : "Leased"}</span>
        </span>
      </a>`).join("");
  }

  function flyToZip(z) {
    if (!MAP) return;
    const pts = DATA.properties.filter((p) => p.zip === z && p.loc).map((p) => p.loc);
    document.querySelector(".hero-map")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (pts.length === 1) MAP.flyTo(pts[0], 14);
    else if (pts.length) MAP.flyToBounds(pts, { padding: [60, 60], maxZoom: 14 });
  }

  function cardHTML(p) {
    const s = statusOf(p);
    return `
      <a class="card" href="#/p/${esc(p.id)}" data-id="${esc(p.id)}">
        <div class="card-photo">
          ${p.photos.length ? `<img src="${img(p.photos[0], 700)}" alt="${esc(p.name)}" loading="lazy">` : ""}
          <span class="badge ${s.kind}">${esc(s.short)}</span>
          ${p.photos.length > 1 ? `<span class="count">${p.photos.length} photos</span>` : ""}
        </div>
        <div class="card-body">
          ${priceHTML(p, "card-rent")}
          <div class="card-title">${esc(p.name)}</div>
          <div class="facts"><span>${esc(p.type)}</span>${factsOf(p).map((f) => `<span>${esc(f)}</span>`).join("")}</div>
          ${(p.utilities || (p.features || []).length) ? `<div class="tags">${[p.utilities, ...(p.features || []).filter((f) => !/hookups|parking|Washer/.test(f))].filter(Boolean).slice(0, 3).map((f) => `<span>${esc(f)}</span>`).join("")}</div>` : ""}
        </div>
      </a>`;
  }

  function emptyHTML() {
    return `<div class="empty">
      <h3>Nothing open right now</h3>
      <p class="muted">Everything is leased at the moment. Send us a note and we'll reach out when something opens up.</p>
      <p><a class="btn" href="#/contact">Get on the list</a></p>
    </div>`;
  }

  function detailView(id) {
    const p = DATA.properties.find((x) => x.id === id);
    if (!p) { location.hash = "#/"; return; }
    const s = statusOf(p);
    const photos = p.photos.length ? p.photos : [];

    app.innerHTML = `
      <a class="back" href="#/">← All rentals</a>
      <div class="detail">
        <div>
          <div class="gallery">
            <div class="slides" tabindex="0" aria-label="Photos of ${esc(p.name)}">
              ${photos.map((ph, i) => `<img src="${img(ph, 1600)}" alt="${esc(p.name)} photo ${i + 1}" ${i ? 'loading="lazy"' : ""}>`).join("")}
            </div>
            ${photos.length > 1 ? `
            <div class="gallery-bar">
              <button class="nav-btn" data-nav="-1" aria-label="Previous photo">‹</button>
              <div class="thumbs">${photos.map((ph, i) => `<button data-go="${i}" aria-label="Photo ${i + 1}" aria-current="${i === 0}"><img src="${img(ph, 160)}" alt="" loading="lazy"></button>`).join("")}</div>
              <button class="nav-btn" data-nav="1" aria-label="Next photo">›</button>
            </div>` : ""}
          </div>
          <div class="info">
            <span class="badge ${s.kind}">${esc(s.short)}</span>
            <h1>${esc(titleOf(p))}</h1>
            <p class="addr">${esc(addressOf(p))}</p>
            ${priceHTML(p, "price")}
            <div class="spec-grid">
              <div class="spec"><div class="k">Bedrooms</div><div class="v">${p.beds}</div></div>
              <div class="spec"><div class="k">Bathrooms</div><div class="v">${p.baths}</div></div>
              ${p.sqft ? `<div class="spec"><div class="k">Square feet</div><div class="v">${p.sqft.toLocaleString()}</div></div>` : ""}
              <div class="spec"><div class="k">Type</div><div class="v">${esc(p.type)}</div></div>
            </div>
            <div class="status-line">${esc(s.long)}${s.kind === "leased" ? ". Interested? Send us a note and we'll let you know when it opens up." : "."}</div>
            ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ""}
            ${(p.features && p.features.length) || p.utilities ? `
            <h2 class="section-h">What's included</h2>
            <ul class="features">
              ${(p.features || []).map((f) => `<li>${esc(f)}</li>`).join("")}
              ${p.utilities ? `<li>${esc(p.utilities)}</li>` : ""}
            </ul>` : ""}
            <h2 class="section-h">Location</h2>
            <p class="muted map-note">${isOpen(p) ? esc(addressOf(p)) : `${esc(p.street)} area, ${esc(p.city)} ${esc(p.zip)}. Exact address shared when you inquire.`}</p>
            <div class="map"><iframe title="Map of ${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
              src="https://www.google.com/maps?q=${encodeURIComponent(isOpen(p) ? addressOf(p) : `${p.street}, ${p.city}, ${p.state} ${p.zip}`)}&z=${isOpen(p) ? 16 : 14}&output=embed"></iframe></div>
          </div>
        </div>
        <aside class="panel" id="inquire">
          ${inquiryHTML(p)}
        </aside>
      </div>`;

    wireGallery();
    wireForm(p);
    document.title = `${p.name}${isOpen(p) && p.askingRent ? " · " + money(p.askingRent) + "/mo" : ""} · The Fund Worldwide`;
    window.scrollTo(0, 0);
  }

  function contactView() {
    app.innerHTML = `
      <div class="contact-wrap">
        <a class="back" href="#/">← All rentals</a>
        <div class="panel">${inquiryHTML(null)}</div>
      </div>`;
    wireForm(null);
    document.title = "Contact · The Fund Worldwide";
    window.scrollTo(0, 0);
  }

  // ---------- inquiry ----------
  function inquiryHTML(p) {
    const cfg = DATA.inquiry || {};
    const heading = p ? (isOpen(p) ? "Interested in this place?" : "Want to know when it opens up?") : "Get in touch";
    const sub = p ? `Tell us a little about yourself and we'll get back to you about ${esc(p.name)}.` : "Looking for a place? Tell us what you need and we'll reach out.";

    let form;
    if (cfg.mode === "jotform" && cfg.jotformId) {
      const q = p ? `?property=${encodeURIComponent(p.name)}` : "";
      form = `<iframe class="jotform-frame" title="Inquiry form" src="https://form.jotform.com/${encodeURIComponent(cfg.jotformId)}${q}" loading="lazy"></iframe>`;
    } else {
      const propOptions = DATA.properties.map((x) => `<option value="${esc(x.name)}"${p && p.id === x.id ? " selected" : ""}>${esc(x.name)}${isOpen(x) ? " · available" : ""}</option>`).join("");
      form = `
        <form class="form" novalidate>
          <input class="hp" type="checkbox" name="botcheck" tabindex="-1" autocomplete="off" aria-hidden="true">
          <label>Your name<input name="name" autocomplete="name" required></label>
          <div class="row">
            <label>Phone<input name="phone" type="tel" autocomplete="tel" inputmode="tel" required></label>
            <label>Email<input name="email" type="email" autocomplete="email"></label>
          </div>
          <div class="row">
            <label>Property<select name="property"><option value="Any / not sure">Any / not sure</option>${propOptions}</select></label>
            <label>Move-in date<input name="movein" type="date"></label>
          </div>
          <label>${p && !isOpen(p) ? "Anything else? (what you're looking for, when you'd move)" : "Anything else?"}<textarea name="message" placeholder="Questions, how many bedrooms you need, best time to reach you…"></textarea></label>
          <button class="btn" type="submit">${p && !isOpen(p) ? "Notify me when it opens" : "Send inquiry"}</button>
          <div class="form-msg" hidden></div>
          ${cfg.mode === "email" || !cfg.mode ? `<p class="form-note">This opens your email app with your message ready to send.</p>` : ""}
        </form>`;
    }

    const applyHref = DATA.applyUrl ? DATA.applyUrl + (p && p.innagoPid ? `?pid=${encodeURIComponent(p.innagoPid)}` : "") : "";
    const apply = applyHref ? `<a class="btn secondary" href="${esc(applyHref)}" target="_blank" rel="noopener">Apply online${p ? " for this place" : ""}</a>` : "";
    const people = (DATA.contacts || []).map((c) => `
      <div class="person">
        <span class="who">${avatarHTML((DATA.team || []).find((m) => m.name === c.name) || c, 36)} ${esc(c.name)}</span>
        <span class="links">
          <a class="pill" href="tel:${digits(c.phone)}">Call</a>
          <a class="pill" href="sms:${digits(c.phone)}">Text</a>
          <a class="pill" href="mailto:${esc(c.email)}">Email</a>
        </span>
      </div>`).join("");

    const faces = (DATA.team || []).length ? `<div class="faces small">${DATA.team.map((m) => avatarHTML(m, 40)).join("")}</div>` : "";
    return `
      ${faces}
      <h2>${heading}</h2>
      <p class="sub">${sub}</p>
      ${form}
      ${apply ? `<div class="actions">${apply}</div>` : ""}
      <div class="people"><span class="muted" style="font-size:13.5px">Rather talk now? Reach either of us:</span>${people}</div>`;
  }

  function wireForm(p) {
    const form = app.querySelector("form.form");
    if (!form) return;
    const msg = form.querySelector(".form-msg");
    const show = (text, ok) => { msg.hidden = false; msg.className = "form-msg " + (ok ? "ok" : "err"); msg.textContent = text; };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      if (f.botcheck) return;
      if (!f.name.trim() || !f.phone.trim()) { show("Please add your name and a phone number so we can reach you.", false); return; }

      const lines = [
        `Name: ${f.name}`, `Phone: ${f.phone}`, `Email: ${f.email || "—"}`,
        `Property: ${f.property}`, `Move-in: ${f.movein || "—"}`, "", f.message || "",
      ];
      const subject = `Rental inquiry: ${f.property} – ${f.name}`;
      const cfg = DATA.inquiry || {};

      if (cfg.mode === "web3forms" && cfg.web3formsKey) {
        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true; btn.textContent = "Sending…";
        try {
          const r = await fetch("https://api.web3forms.com/submit", {
            method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ access_key: cfg.web3formsKey, subject, from_name: "Fund Worldwide Rentals", ccemail: (DATA.contacts || []).slice(1).map((c) => c.email).join(","), ...f, message: lines.join("\n") }),
          });
          const j = await r.json();
          if (!j.success) throw new Error(j.message || "Failed");
          form.reset(); show("Thanks! We got your message and will be in touch soon.", true);
        } catch (err) {
          show("Sorry, that didn't go through. Please call or text us instead.", false);
        } finally { btn.disabled = false; btn.textContent = "Send inquiry"; }
        return;
      }

      // Default: open the visitor's email app addressed to both of us.
      const to = (DATA.contacts || []).map((c) => c.email).join(",");
      location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
      show("Your email app should open with your message. If it didn't, call or text us below.", true);
    });
  }

  function wireGallery() {
    const slides = app.querySelector(".slides");
    if (!slides) return;
    const thumbs = [...app.querySelectorAll(".thumbs button")];
    const count = slides.children.length;
    const current = () => Math.round(slides.scrollLeft / slides.clientWidth);
    const go = (i) => slides.scrollTo({ left: Math.max(0, Math.min(count - 1, i)) * slides.clientWidth, behavior: "smooth" });
    thumbs.forEach((t) => t.addEventListener("click", () => go(+t.dataset.go)));
    app.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => {
      const i = current() + +b.dataset.nav; go(i < 0 ? count - 1 : i >= count ? 0 : i);
    }));
    slides.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") go(current() + 1); if (e.key === "ArrowLeft") go(current() - 1); });
    let t;
    slides.addEventListener("scroll", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const i = current();
        thumbs.forEach((b, j) => b.setAttribute("aria-current", String(i === j)));
        thumbs[i]?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }, 60);
    });
  }

  function footer() {
    document.getElementById("footer-contacts").innerHTML = (DATA.contacts || []).map((c) =>
      `<div>${esc(c.name)} · <a href="tel:${digits(c.phone)}">${esc(c.phone)}</a></div>`).join("");
  }

  // ---------- router ----------
  function route() {
    const h = location.hash || "#/";
    const m = /^#\/p\/(.+)$/.exec(h);
    if (m) detailView(decodeURIComponent(m[1]));
    else if (h === "#/contact") contactView();
    else listView();
  }

  app.innerHTML = `<div class="grid" style="margin-top:32px">${'<div class="card"><div class="card-photo skeleton"></div><div class="card-body"><div class="skeleton" style="height:22px;width:40%;border-radius:6px"></div></div></div>'.repeat(6)}</div>`;
  fetch("listings.json?v=" + Date.now(), { cache: "no-store" })
    .then((r) => r.json())
    .then((d) => { DATA = d; footer(); route(); window.addEventListener("hashchange", route); })
    .catch(() => { app.innerHTML = `<div class="empty" style="margin-top:32px"><h3>Couldn't load listings</h3><p class="muted">Please refresh the page.</p></div>`; });
})();
