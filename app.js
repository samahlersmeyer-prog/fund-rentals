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
  const titleOf = (p) => `${p.beds === 0 ? "Studio" : p.beds + "-bed"} ${p.type.toLowerCase()} · ${p.name}`;

  // ---------- views ----------
  function listView() {
    const all = DATA.properties;
    const open = all.filter(isOpen).length;
    const isHouse = (p) => /house|home/i.test(p.type);
    let list = all.filter((p) =>
      state.filter === "open" ? isOpen(p) :
      state.filter === "houses" ? isHouse(p) :
      state.filter === "apts" ? !isHouse(p) : true);

    list = list.slice().sort((a, b) => {
      if (state.sort === "rent-asc") return priceLow(a) - priceLow(b);
      if (state.sort === "rent-desc") return priceLow(b) - priceLow(a);
      if (state.sort === "beds") return b.beds - a.beds || priceLow(a) - priceLow(b);
      return statusOf(a).sortKey - statusOf(b).sortKey || priceLow(a) - priceLow(b);
    });

    const chip = (key, label) => `<button class="chip" data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`;
    const asks = all.filter(isOpen).map((p) => p.askingRent).filter(Boolean);
    const minRent = asks.length ? Math.min(...asks) : 0;
    const openList = list.filter(isOpen), leasedList = list.filter((p) => !isOpen(p));
    const sections = !list.length ? emptyHTML() : `
      ${openList.length ? `<h2 class="list-h">Available &amp; coming soon</h2><div class="grid">${openList.map(cardHTML).join("")}</div>` : (state.filter === "open" ? emptyHTML() : "")}
      ${leasedList.length ? `<h2 class="list-h">Currently leased</h2><p class="muted list-sub">Like one of these? Tap it and ask to be notified when it opens up.</p><div class="grid">${leasedList.map(cardHTML).join("")}</div>` : ""}`;

    app.innerHTML = `
      <section class="hero">
        <h1>Homes and apartments for rent in Fort Wayne</h1>
        <p>Every place here is owned and managed by us. See what's open now, what's coming up, and what our places look like.</p>
        <div class="stats">
          ${open ? `<span class="stat"><b>${open}</b> available or coming up</span>` : `<span class="stat">Fully leased right now · <a href="#/contact">ask about openings</a></span>`}
          <span class="stat"><b>${all.length}</b> homes &amp; apartments</span>
          ${minRent ? `<span class="stat">Available from <b>${money(minRent)}</b>/mo</span>` : ""}
        </div>
      </section>
      <div class="filters" role="toolbar" aria-label="Filter listings">
        ${chip("all", "All")}${chip("open", "Available")}${chip("houses", "Houses")}${chip("apts", "Apartments")}
        <span class="spacer"></span>
        <select class="sort" aria-label="Sort listings">
          <option value="featured"${state.sort === "featured" ? " selected" : ""}>Soonest available</option>
          <option value="rent-asc"${state.sort === "rent-asc" ? " selected" : ""}>Rent: low to high</option>
          <option value="rent-desc"${state.sort === "rent-desc" ? " selected" : ""}>Rent: high to low</option>
          <option value="beds"${state.sort === "beds" ? " selected" : ""}>Most bedrooms</option>
        </select>
      </div>
      ${sections}
    `;

    app.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { state.filter = b.dataset.filter; listView(); }));
    app.querySelector(".sort").addEventListener("change", (e) => { state.sort = e.target.value; listView(); });
    document.title = "The Fund Worldwide · Fort Wayne Rentals";
  }

  function cardHTML(p) {
    const s = statusOf(p);
    return `
      <a class="card" href="#/p/${esc(p.id)}">
        <div class="card-photo">
          ${p.photos.length ? `<img src="${img(p.photos[0], 700)}" alt="${esc(p.name)}" loading="lazy">` : ""}
          <span class="badge ${s.kind}">${esc(s.short)}</span>
          ${p.photos.length > 1 ? `<span class="count">${p.photos.length} photos</span>` : ""}
        </div>
        <div class="card-body">
          ${priceHTML(p, "card-rent")}
          <div class="card-title">${esc(p.name)}</div>
          <div class="facts">${factsOf(p).map((f) => `<span>${esc(f)}</span>`).join("")}</div>
          <div class="facts">${esc(p.type)} · ${esc(p.city)} ${esc(p.zip)}</div>
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
              ${p.utilities ? `<li>Utilities included: ${esc(p.utilities)}</li>` : ""}
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
        <span class="who">${esc(c.name)}</span>
        <span class="links">
          <a class="pill" href="tel:${digits(c.phone)}">Call</a>
          <a class="pill" href="sms:${digits(c.phone)}">Text</a>
          <a class="pill" href="mailto:${esc(c.email)}">Email</a>
        </span>
      </div>`).join("");

    return `
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
  fetch("listings.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((d) => { DATA = d; footer(); route(); window.addEventListener("hashchange", route); })
    .catch(() => { app.innerHTML = `<div class="empty" style="margin-top:32px"><h3>Couldn't load listings</h3><p class="muted">Please refresh the page.</p></div>`; });
})();
