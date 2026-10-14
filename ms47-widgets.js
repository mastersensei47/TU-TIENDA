/* MS47 Widgets: chat + novedades (Firebase Realtime Database)
   Uso en cada página:
   <script>window.MS47_FIREBASE_CONFIG = { ...tu config de Firebase (con databaseURL)... };</script>
   <script src="ms47-widgets.js"></script>
   Opcional: <script src="ms47-widgets.js" data-page="mi-id-de-pagina"></script> */
(function () {
  const S = document.currentScript;
  const CFG = window.MS47_FIREBASE_CONFIG;
  const PAGE = ((S && S.dataset.page) || ((location.pathname.replace(/^\//, '') || 'index') + location.search))
    .replace(/[.$#\[\]\/]/g, '_').slice(0, 120);
  const GLOBAL = '_global';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const $ = id => document.getElementById(id);
  const load = src => new Promise((ok, err) => {
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = err; document.head.appendChild(s);
  });

  const CSS = `
#w47{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#fff;position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
#w47 *{box-sizing:border-box}
#w47 .p{width:340px;max-width:92vw;height:440px;max-height:70vh;background:rgba(14,18,24,.94);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.5)}
#w47 .p[hidden],#w47 [hidden]{display:none!important}
#w47 .h{display:flex;align-items:center;gap:6px;padding:10px 12px;background:rgba(255,255,255,.06);font-size:14px}
#w47 .h b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#w47 button{cursor:pointer;border:0;border-radius:8px;background:#2a7f80;color:#fff;padding:6px 10px;font-size:13px}
#w47 .h button{background:transparent;padding:2px 6px;font-size:16px}
#w47 .b{flex:1;overflow-y:auto;padding:10px 12px;font-size:14px}
#w47 .m{margin-bottom:8px;word-break:break-word;position:relative}
#w47 .m small{display:block;color:#7fd1d3;font-size:11px}
#w47 .m.a small{color:#ffd166}
#w47 .m .ac{display:none;position:absolute;right:0;top:0}
#w47 .m:hover .ac{display:block}
#w47 .m .ac button{background:rgba(0,0,0,.6);padding:1px 5px;margin-left:2px}
#w47 .pin{padding:7px 12px;font-size:13px;background:rgba(255,209,102,.12);border-bottom:1px solid rgba(255,209,102,.3);word-break:break-word}
#w47 .pin button{background:transparent;padding:0 4px}
#w47 .f{display:flex;gap:6px;padding:8px;border-top:1px solid rgba(255,255,255,.1)}
#w47 .f input{flex:1;min-width:0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:8px 10px;font-size:14px}
#w47 .hint{padding:0 12px 6px;font-size:12px;color:#ffb4a2;min-height:0}
#w47 .n{margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.1)}
#w47 .n h4{margin:0 0 2px;font-size:15px}
#w47 .n small{color:#8aa;font-size:11px}
#w47 .n p{margin:6px 0;white-space:pre-wrap;word-break:break-word}
#w47 .n img{max-width:100%;border-radius:8px;margin:4px 0}
#w47 .n a{display:inline-block;background:#2a7f80;color:#fff;padding:5px 10px;border-radius:8px;text-decoration:none;font-size:13px}
#w47 .bt{display:flex;gap:8px}
#w47 .bt button{position:relative;width:46px;height:46px;border-radius:12px;font-size:20px;background:rgba(14,18,24,.94);border:1px solid rgba(255,255,255,.18)}
#w47 .bt button.on{background:#2a7f80}
#w47 .bt i{position:absolute;top:5px;right:5px;width:10px;height:10px;border-radius:50%;background:#ff4d4d}`;

  const HTML = `
<div class="p" id="w47n" hidden><div class="h"><b>📣 Novedades</b><button data-x="x">×</button></div><div class="b" id="w47nl"></div></div>
<div class="p" id="w47c" hidden>
 <div class="h"><b id="w47ct">Chat</b><button id="w47ch" title="Cambiar usuario">✎</button><button data-x="x">×</button></div>
 <div class="pin" id="w47pin" hidden></div>
 <div class="b" id="w47ml"></div>
 <div class="hint" id="w47h"></div>
 <form class="f" id="w47nu"><input id="w47ni" maxlength="20" placeholder="Elegí tu usuario" autocomplete="off"><button>Entrar</button></form>
 <form class="f" id="w47mf" hidden><input id="w47mi" placeholder="Enviar mensaje..." autocomplete="off"><button>➤</button></form>
</div>
<div class="bt"><button id="w47bn" title="Novedades">📣<i id="w47dot" hidden></i></button><button id="w47bc" title="Chat">💬</button></div>`;

  async function boot() {
    if (!window.firebase) {
      await load(SDK + 'firebase-app-compat.js');
      await load(SDK + 'firebase-auth-compat.js');
      await load(SDK + 'firebase-database-compat.js');
    } else {
      if (!firebase.auth) await load(SDK + 'firebase-auth-compat.js');
      if (!firebase.database) await load(SDK + 'firebase-database-compat.js');
    }
    if (!firebase.apps.length) {
      if (!CFG) { console.error('MS47 widgets: falta window.MS47_FIREBASE_CONFIG'); return; }
      firebase.initializeApp(CFG);
    }
    const db = firebase.database();

    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const root = document.createElement('div'); root.id = 'w47'; root.innerHTML = HTML; document.body.appendChild(root);

    let cfg = null, isAdmin = false, room = null, built = '', refM = null, refP = null;
    let user = localStorage.ms47w_user || '', last = 0, banned = false, first = true, newestNews = 0;
    let dev = localStorage.ms47w_dev; if (!dev) { dev = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.ms47w_dev = dev; }
    const ml = $('w47ml'), pin = $('w47pin'), hint = t => { $('w47h').textContent = t || ''; };

    function effective(s) {
      const g = Object.assign({ chatEnabled: true, newsEnabled: true, chatOpen: false, newsOpen: false, chatMode: 'page', slow: 3, maxLen: 300, words: '', reserved: 'admin,administrador,mod,moderador' }, s.global || {});
      const p = (s.pages && s.pages[PAGE]) || {};
      ['chatEnabled', 'newsEnabled', 'chatOpen', 'newsOpen', 'chatMode'].forEach(k => { if (p[k] !== undefined && p[k] !== null && p[k] !== 'auto') g[k] = p[k]; });
      g.adminUid = s.adminUid || '';
      return g;
    }

    // ---- abrir / cerrar paneles (uno a la vez) ----
    function show(w) {   // w: 'c' | 'n' | 'x'
      $('w47c').hidden = w !== 'c'; $('w47n').hidden = w !== 'n';
      $('w47bc').classList.toggle('on', w === 'c'); $('w47bn').classList.toggle('on', w === 'n');
      sessionStorage['w47s_' + PAGE] = w;
      if (w === 'c') ml.scrollTop = ml.scrollHeight;
      if (w === 'n' && newestNews) { localStorage.ms47w_ns = newestNews; $('w47dot').hidden = true; }
    }
    const cur = () => sessionStorage['w47s_' + PAGE] || 'x';
    $('w47bc').onclick = () => show(cur() === 'c' ? 'x' : 'c');
    $('w47bn').onclick = () => show(cur() === 'n' ? 'x' : 'n');
    root.querySelectorAll('[data-x]').forEach(b => b.onclick = () => show('x'));

    // ---- chat ----
    function label() { $('w47ct').textContent = (room === GLOBAL ? 'Chat global' : 'Chat de esta página') + (isAdmin ? ' [' + PAGE + ']' : ''); }
    function renderPin(p) {
      pin.hidden = !p; if (!p) return;
      pin.textContent = '📌 ' + p.u + ': ' + p.t;
      if (isAdmin) { const b = document.createElement('button'); b.textContent = '✖'; b.title = 'Quitar fijado'; b.onclick = () => db.ref('widgets/chat/' + room + '/pinned').remove(); pin.append(b); }
    }
    function act(a, id, m) {
      const r = db.ref('widgets/chat/' + room);
      if (a === 'del') r.child('messages/' + id).remove();
      if (a === 'pin') r.child('pinned').set({ u: m.u, t: m.t, ts: m.ts });
      if (a === 'ban' && confirm('¿Bloquear a ' + m.u + ' por 24 h?')) db.ref('widgets/bans/' + m.d).set({ u: m.u, until: Date.now() + 864e5 });
    }
    function addMsg(id, m) {
      const near = ml.scrollHeight - ml.scrollTop - ml.clientHeight < 60;
      const el = document.createElement('div'); el.className = 'm' + (m.admin ? ' a' : ''); el.id = 'w47m' + id;
      const h = document.createElement('small');
      h.textContent = m.u + (m.admin ? ' ★' : '') + ' · ' + new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const t = document.createElement('div'); t.textContent = m.t;
      el.append(h, t);
      if (isAdmin) {
        const c = document.createElement('span'); c.className = 'ac';
        [['🗑', 'del'], ['📌', 'pin'], ['🚫', 'ban']].forEach(([i, a]) => { const b = document.createElement('button'); b.textContent = i; b.onclick = () => act(a, id, m); c.append(b); });
        el.append(c);
      }
      ml.append(el); if (near) ml.scrollTop = ml.scrollHeight;
    }
    function joinRoom() {
      const r = cfg.chatMode === 'global' ? GLOBAL : PAGE, key = r + '|' + isAdmin;
      if (key === built) { label(); return; }
      built = key; room = r;
      if (refM) refM.off(); if (refP) refP.off();
      ml.innerHTML = ''; pin.hidden = true; label();
      refM = db.ref('widgets/chat/' + r + '/messages').orderByChild('ts').limitToLast(100);
      refM.on('child_added', s => addMsg(s.key, s.val()));
      refM.on('child_removed', s => { const e = $('w47m' + s.key); if (e) e.remove(); });
      refP = db.ref('widgets/chat/' + r + '/pinned'); refP.on('value', s => renderPin(s.val()));
    }
    function gate() { $('w47nu').hidden = !!user; $('w47mf').hidden = !user; if (user) $('w47mi').disabled = banned; }
    gate();
    $('w47ch').onclick = () => { localStorage.removeItem('ms47w_user'); user = ''; $('w47ni').value = ''; gate(); };
    $('w47nu').onsubmit = e => {
      e.preventDefault();
      const n = $('w47ni').value.trim();
      if (!/^[\p{L}\p{N}_.\-]{2,20}$/u.test(n)) { hint('Usuario: 2 a 20 caracteres (letras, números, _ . -)'); return; }
      if (!isAdmin && (cfg.reserved || '').toLowerCase().split(',').map(x => x.trim()).includes(n.toLowerCase())) { hint('Ese nombre está reservado'); return; }
      user = n; localStorage.ms47w_user = n; hint(''); gate(); $('w47mi').focus();
    };
    $('w47mf').onsubmit = e => {
      e.preventDefault();
      if (banned) return;
      const now = Date.now();
      if (now - last < (cfg.slow || 0) * 1000) { hint('Esperá un momento antes de enviar otro mensaje'); return; }
      let t = $('w47mi').value.trim().slice(0, cfg.maxLen || 300); if (!t) return;
      (cfg.words || '').split(',').map(w => w.trim()).filter(Boolean).forEach(w => { t = t.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '***'); });
      const m = { u: user, t, ts: firebase.database.ServerValue.TIMESTAMP, d: dev }; if (isAdmin) m.admin = true;
      db.ref('widgets/chat/' + room + '/messages').push(m).then(() => { $('w47mi').value = ''; last = now; hint(''); }).catch(() => hint('No se pudo enviar el mensaje'));
    };
    db.ref('widgets/bans/' + dev).on('value', s => {
      const b = s.val(); banned = !!b && b.until > Date.now();
      hint(banned ? 'Estás bloqueado hasta ' + new Date(b.until).toLocaleString() : ''); gate();
    });

    // ---- novedades ----
    db.ref('widgets/news').orderByChild('ts').limitToLast(40).on('value', s => {
      const items = []; s.forEach(c => { const v = c.val(); if (v.scope === 'global' || v.scope === PAGE) items.push(v); });
      items.reverse();
      const box = $('w47nl'); box.innerHTML = '';
      if (!items.length) box.textContent = 'Todavía no hay novedades.';
      items.forEach(v => {
        const n = document.createElement('div'); n.className = 'n';
        const h = document.createElement('h4'); h.textContent = v.title || '';
        const d = document.createElement('small'); d.textContent = new Date(v.ts).toLocaleDateString();
        n.append(h, d);
        if (v.img && /^https?:\/\//i.test(v.img)) { const i = document.createElement('img'); i.src = v.img; i.loading = 'lazy'; n.append(i); }
        if (v.body) { const p = document.createElement('p'); p.textContent = v.body; n.append(p); }
        if (v.link && /^https?:\/\//i.test(v.link)) { const a = document.createElement('a'); a.href = v.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Ver más'; n.append(a); }
        box.append(n);
      });
      newestNews = items.length ? items[0].ts : 0;
      $('w47dot').hidden = !(newestNews > (+localStorage.ms47w_ns || 0)) || cur() === 'n';
    });

    // ---- ajustes (los maneja el panel admin) ----
    function apply(s) {
      cfg = effective(s);
      $('w47bc').hidden = !cfg.chatEnabled; $('w47bn').hidden = !cfg.newsEnabled;
      joinRoom();
      if (first) {
        first = false;
        if (!sessionStorage['w47s_' + PAGE]) show(cfg.chatEnabled && cfg.chatOpen ? 'c' : cfg.newsEnabled && cfg.newsOpen ? 'n' : 'x');
        else show(cur());
      }
      if ((!cfg.chatEnabled && cur() === 'c') || (!cfg.newsEnabled && cur() === 'n')) show('x');
    }
    let lastS = {};
    db.ref('widgets/settings').on('value', s => { lastS = s.val() || {}; apply(lastS); });
    firebase.auth().onAuthStateChanged(u => { isAdmin = !!u && !!lastS.adminUid && u.uid === lastS.adminUid; if (cfg) apply(lastS); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
