/* ============================================================================
   PROVEEDORES.JS — Páginas donde comprás repuestos/insumos + armador de
   presupuestos (usado por el taller: reparaciones.html)
   ----------------------------------------------------------------------------
   1) "Mis páginas": guardás las webs de tus proveedores (nombre, link,
      categoría, notas). Escribís UNA vez qué repuesto necesitás y con un toque
      lo buscás en cada página (si cargás la dirección de búsqueda del sitio
      con {q}, busca directo ahí; si no, usa una búsqueda de Google limitada a
      ese sitio).
   2) "Presupuesto": armás la lista de repuestos con su costo y proveedor,
      sumás mano de obra y margen, y te da el precio sugerido. Podés copiar o
      mandar el presupuesto por WhatsApp (sin mostrar tus costos) o convertirlo
      en un trabajo nuevo con un toque.

   Colección de Firestore: "proveedores" (solo administrador, ver reglas).
   El borrador del presupuesto se guarda en este navegador (localStorage).
   ============================================================================ */
(function () {
    "use strict";

    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    // El borrador se guarda por negocio (slug): GitHub Pages comparte el
    // localStorage entre todos los negocios del mismo dominio, así que sin el
    // slug en la clave se mezclarían los presupuestos de distintos negocios.
    function claveBorrador() {
        let slug = "";
        try { slug = (new URLSearchParams(location.search).get("slug") || "").trim().toLowerCase(); } catch (_) {}
        if (!slug) { try { slug = (localStorage.getItem("tu_taller_ultimo_slug") || "").trim().toLowerCase(); } catch (_) {} }
        return "taller_presupuesto_borrador_" + (slug || "sin-slug");
    }
    const CATEGORIAS_BASE = ["Repuestos", "Herramientas", "Insumos", "Pantallas y módulos", "Baterías", "Accesorios", "Envíos y logística"];

    let lista = [];
    let unsub = null;
    let cargando = true;
    let tab = "links";
    let cat = "";
    let q = "";
    let editandoId = null;
    let borrador = leerBorrador();

    // ---------------------------------------------------------------- helpers
    const fmt = n => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
    const qtyDe = l => (l.qty === "" || l.qty == null) ? 1 : (Number(l.qty) || 0);

    function urlSegura(u) {
        u = String(u || "").trim();
        if (!u) return "";
        if (!/^https?:\/\//i.test(u)) u = "https://" + u;
        try {
            const x = new URL(u);
            return (x.protocol === "http:" || x.protocol === "https:") ? x.href : "";
        } catch (_) { return ""; }
    }

    // La dirección de búsqueda conserva el {q} tal cual (no se re-codifica).
    function urlBusquedaSegura(u) {
        u = String(u || "").trim();
        if (!u) return "";
        if (!/^https?:\/\//i.test(u)) u = "https://" + u;
        try {
            new URL(u.replace(/\{q\}/g, "prueba"));
            return u;
        } catch (_) { return ""; }
    }

    function host(u) {
        try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
    }

    function borradorVacio() {
        return { cliente: "", telefono: "", equipo: "", lineas: [{ desc: "", prov: "", costo: "", qty: 1 }], mano: "", margen: 30, precioFinal: "" };
    }

    function leerBorrador() {
        try {
            const raw = localStorage.getItem(claveBorrador());
            if (raw) {
                const b = { ...borradorVacio(), ...JSON.parse(raw) };
                if (!Array.isArray(b.lineas) || b.lineas.length === 0) b.lineas = borradorVacio().lineas;
                return b;
            }
        } catch (_) {}
        return borradorVacio();
    }

    function guardarBorrador() {
        try { localStorage.setItem(claveBorrador(), JSON.stringify(borrador)); } catch (_) {}
    }

    function inyectarEstilos() {
        if ($("provEstilos")) return;
        const s = document.createElement("style");
        s.id = "provEstilos";
        s.textContent = `
        .prov-row{display:grid;grid-template-columns:1.5fr 1.1fr .8fr .6fr 42px;gap:8px;margin-bottom:8px;align-items:center}
        .prov-row input,.prov-row select{min-width:0;width:100%;padding:12px;border-radius:12px;font-size:14px}
        .prov-row button{height:46px;border:1px solid rgba(239,68,68,.45);background:rgba(239,68,68,.10);color:var(--danger);border-radius:12px;cursor:pointer;font-size:18px}
        .prov-pill{display:inline-block;background:rgba(59,130,246,.16);border:1px solid rgba(59,130,246,.3);font-size:11px;font-weight:700;padding:3px 10px;border-radius:9999px;margin-left:8px}
        @media(max-width:560px){
            .prov-row{grid-template-columns:1fr 1fr 42px}
            .prov-row .pl-desc,.prov-row .pl-prov{grid-column:1 / 4}
        }`;
        document.head.appendChild(s);
    }

    // ------------------------------------------------------------- Firestore
    function escuchar() {
        if (unsub) return;
        try {
            unsub = db.collection("proveedores").onSnapshot(snap => {
                lista = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
                cargando = false;
                refrescarDatos();
            }, err => {
                console.warn("proveedores:", err.code);
                unsub = null;
                cargando = false;
                const l = $("provLista");
                if (l) l.innerHTML = `<p style="opacity:.7; padding:20px; text-align:center;">No se pudieron cargar las páginas (${esc(err.code || "error")}). Revisá que publicaste las reglas de Firestore actualizadas.</p>`;
            });
        } catch (e) {
            console.error(e);
            unsub = null;
        }
    }

    // ------------------------------------------------------------- ventana
    function abrir() {
        borrador = leerBorrador();
        inyectarEstilos();
        asegurarModales();
        $("proveedoresModal").style.display = "flex";
        escuchar();
        pintar();
    }

    function cerrar() {
        const m = $("proveedoresModal");
        if (m) m.style.display = "none";
    }

    function asegurarModales() {
        if ($("proveedoresModal")) return;

        const m = document.createElement("div");
        m.className = "modal";
        m.id = "proveedoresModal";
        m.style.cssText = "align-items:flex-start; overflow-y:auto;";
        m.innerHTML = `
        <div class="modal-content" style="max-width:760px; width:100%; margin:30px auto; padding:25px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
                <h3 style="margin:0;">🛒 Proveedores y presupuestos</h3>
                <button type="button" onclick="Proveedores.cerrar()" style="background:none; border:none; color:var(--text); font-size:26px; cursor:pointer;">✕</button>
            </div>
            <div style="display:flex; gap:8px; margin-bottom:20px;">
                <button type="button" id="provTabLinks" onclick="Proveedores.setTab('links')" style="flex:1; border:none; padding:12px; border-radius:12px; cursor:pointer; font-weight:700; color:#fff;">🔗 Mis páginas</button>
                <button type="button" id="provTabPres" onclick="Proveedores.setTab('presupuesto')" style="flex:1; border:none; padding:12px; border-radius:12px; cursor:pointer; font-weight:700; color:#fff;">🧮 Presupuesto</button>
            </div>
            <div id="provCont"></div>
        </div>`;

        const f = document.createElement("div");
        f.className = "modal";
        f.id = "provFormModal";
        f.style.cssText = "align-items:flex-start; overflow-y:auto; z-index:9000;";
        f.innerHTML = `
        <div class="modal-content" style="max-width:480px; width:100%; margin:30px auto; padding:25px;">
            <h3 id="provFTitulo" style="margin-top:0;">Agregar página</h3>
            <div class="form-group"><label>Nombre</label><input id="provFNombre" placeholder="Ej: Mayorista Tech"></div>
            <div class="form-group"><label>Dirección de la página</label><input id="provFUrl" placeholder="https://www.sitio.com"></div>
            <div class="form-group"><label>Categoría / rubro (opcional)</label>
                <input id="provFCat" list="provCats" placeholder="Ej: Repuestos, Herramientas...">
                <datalist id="provCats"></datalist>
            </div>
            <div class="form-group"><label>Dirección de búsqueda del sitio (opcional)</label>
                <input id="provFBusqueda" placeholder="https://www.sitio.com/buscar?q={q}">
                <small style="display:block; opacity:.55; margin-top:6px; line-height:1.45;">Para buscar directo en esa página: hacé una búsqueda en el sitio, copiá la dirección del navegador y reemplazá la palabra buscada por {q}. Si la dejás vacía, se usa una búsqueda de Google limitada a ese sitio.</small>
            </div>
            <div class="form-group"><label>Notas (opcional)</label><textarea id="provFNotas" rows="2" placeholder="Ej: envían en 48hs, mínimo de compra, usuario..."></textarea></div>
            <button type="button" class="btn-add" style="background:var(--success);" onclick="Proveedores.guardar()">GUARDAR</button>
            <button type="button" class="btn-add" style="background:none; color:white; margin-top:10px; opacity:.6;" onclick="Proveedores.cerrarForm()">Cancelar</button>
        </div>`;

        document.body.appendChild(m);
        document.body.appendChild(f);
    }

    function setTab(t) {
        if (tab === "presupuesto" && $("pLineas")) { leerForm(); guardarBorrador(); }
        tab = t === "presupuesto" ? "presupuesto" : "links";
        pintar();
    }

    function pintar() {
        const c = $("provCont");
        if (!c) return;
        $("provTabLinks").style.background = tab === "links" ? "var(--accent)" : "rgba(255,255,255,0.08)";
        $("provTabPres").style.background = tab === "presupuesto" ? "var(--accent)" : "rgba(255,255,255,0.08)";
        if (tab === "links") pintarLinks(); else pintarPresupuesto();
    }

    // Cuando llegan datos nuevos de Firestore: refresca sin pisar lo que se está escribiendo.
    function refrescarDatos() {
        if (!$("provCont")) return;
        if (tab === "links") {
            refrescarCats();
            pintarLista();
        } else if ($("pLineas")) {
            leerForm();
            pintarLineas();
            recalcular();
        }
    }

    // ------------------------------------------------------ TAB: mis páginas
    function categoriasExistentes() {
        return [...new Set(lista.map(p => (p.categoria || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    }

    function opcionesCat() {
        return `<option value="">Todas las categorías</option>` +
            categoriasExistentes().map(c => `<option value="${esc(c)}" ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("");
    }

    function refrescarCats() {
        const s = $("provCat");
        if (!s) return;
        if (cat && !categoriasExistentes().includes(cat)) cat = "";
        s.innerHTML = opcionesCat();
    }

    function pintarLinks() {
        $("provCont").innerHTML = `
        <div class="form-group">
            <label>🔎 ¿Qué repuesto o producto querés cotizar?</label>
            <input id="provQ" value="${esc(q)}" placeholder="Ej: pantalla Samsung A32, batería iPhone 11..." oninput="Proveedores.setQ(this.value)">
            <small style="display:block; opacity:.55; margin-top:6px;">Escribilo una vez y tocá «Buscar» en cada página para ver el precio ahí mismo.</small>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px;">
            <div class="form-group" style="flex:1; min-width:150px; margin:0;">
                <select id="provCat" onchange="Proveedores.setCat(this.value)">${opcionesCat()}</select>
            </div>
            <button type="button" class="btn-add" style="flex:1; min-width:150px; margin:0; background:var(--success);" onclick="Proveedores.nuevo()">+ AGREGAR PÁGINA</button>
        </div>
        <div id="provLista"></div>`;
        pintarLista();
    }

    function setQ(v) { q = v || ""; }
    function setCat(v) { cat = v || ""; pintarLista(); }

    function pintarLista() {
        const cont = $("provLista");
        if (!cont) return;
        if (cargando) { cont.innerHTML = `<p style="opacity:.5; padding:20px; text-align:center;">Cargando...</p>`; return; }
        const items = lista.filter(p => !cat || (p.categoria || "").trim() === cat);
        if (items.length === 0) {
            cont.innerHTML = `<div style="text-align:center; padding:40px 20px; opacity:.5;">
                <div style="font-size:40px; margin-bottom:10px;">🛒</div>
                ${lista.length === 0 ? "Todavía no guardaste ninguna página. Agregá la primera con el botón verde." : "No hay páginas en esta categoría."}
            </div>`;
            return;
        }
        cont.innerHTML = items.map(p => {
            const url = urlSegura(p.url);
            return `
            <div class="admin-item" style="flex-direction:column; align-items:stretch; gap:10px;">
                <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
                    <div style="min-width:0;">
                        <b style="font-size:16px;">${esc(p.nombre)}</b>${p.categoria ? `<span class="prov-pill">${esc(p.categoria)}</span>` : ""}
                        ${p.notas ? `<div style="opacity:.65; font-size:13px; margin-top:6px; line-height:1.4;">${esc(p.notas)}</div>` : ""}
                    </div>
                    <small style="opacity:.45; flex-shrink:0;">${esc(host(url))}</small>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="flex:1; min-width:110px; text-align:center; text-decoration:none; background:var(--accent); color:#fff; padding:10px; border-radius:10px; font-weight:700;">🔗 Abrir página</a>` : ""}
                    <button type="button" onclick="Proveedores.buscar('${p.id}')" style="flex:1; min-width:100px; background:rgba(255,255,255,0.08); border:none; color:var(--text); padding:10px; border-radius:10px; cursor:pointer; font-weight:700;">🔎 Buscar</button>
                    <button type="button" onclick="Proveedores.cotizarCon('${p.id}')" style="flex:1; min-width:100px; background:rgba(255,255,255,0.08); border:none; color:var(--text); padding:10px; border-radius:10px; cursor:pointer; font-weight:700;">🧮 Cotizar</button>
                    <button type="button" onclick="Proveedores.editar('${p.id}')" style="background:rgba(255,255,255,0.06); border:none; color:var(--text); padding:10px 14px; border-radius:10px; cursor:pointer;">✏️</button>
                    <button type="button" onclick="Proveedores.borrar('${p.id}')" style="background:none; border:none; color:var(--danger); padding:10px; cursor:pointer;">🗑️</button>
                </div>
            </div>`;
        }).join("");
    }

    function buscar(id) {
        const p = lista.find(x => x.id === id);
        if (!p) return;
        const t = q.trim();
        if (!t) {
            alert("Escribí arriba qué repuesto querés buscar.");
            const i = $("provQ");
            if (i) i.focus();
            return;
        }
        let url;
        if (p.urlBusqueda && /^https?:\/\//i.test(p.urlBusqueda) && p.urlBusqueda.includes("{q}")) {
            url = p.urlBusqueda.replace(/\{q\}/g, encodeURIComponent(t));
        } else {
            url = "https://www.google.com/search?q=" + encodeURIComponent(t + " site:" + host(urlSegura(p.url)));
        }
        window.open(url, "_blank", "noopener");
    }

    // ---------------------------------------------- alta / edición de páginas
    function nuevo() {
        editandoId = null;
        abrirForm({});
    }

    function editar(id) {
        const p = lista.find(x => x.id === id);
        if (!p) return;
        editandoId = id;
        abrirForm(p);
    }

    function abrirForm(p) {
        $("provFTitulo").innerText = editandoId ? "Editar página" : "Agregar página";
        $("provFNombre").value = p.nombre || "";
        $("provFUrl").value = p.url || "";
        $("provFCat").value = p.categoria || "";
        $("provFBusqueda").value = p.urlBusqueda || "";
        $("provFNotas").value = p.notas || "";

        const sugeridas = [...CATEGORIAS_BASE];
        try {
            if (typeof rubrosActivos === "function") rubrosActivos().forEach(r => r && r.nombre && sugeridas.push(r.nombre));
        } catch (_) {}
        categoriasExistentes().forEach(c => sugeridas.push(c));
        $("provCats").innerHTML = [...new Set(sugeridas)].map(c => `<option value="${esc(c)}"></option>`).join("");

        $("provFormModal").style.display = "flex";
    }

    function cerrarForm() {
        const m = $("provFormModal");
        if (m) m.style.display = "none";
        editandoId = null;
    }

    async function guardar() {
        const nombre = $("provFNombre").value.trim();
        if (!nombre) return alert("Escribí el nombre de la página o proveedor.");
        const url = urlSegura($("provFUrl").value);
        if (!url) return alert("La dirección de la página no es válida. Ejemplo: https://www.sitio.com");

        let urlBusqueda = "";
        const rawBusq = $("provFBusqueda").value.trim();
        if (rawBusq) {
            urlBusqueda = urlBusquedaSegura(rawBusq);
            if (!urlBusqueda) return alert("La dirección de búsqueda no es válida.");
            if (!urlBusqueda.includes("{q}")) return alert("En la dirección de búsqueda tenés que escribir {q} donde va la palabra buscada. Ej: https://sitio.com/buscar?q={q}\n\nSi no la tenés a mano, dejá ese campo vacío.");
        }

        const datos = {
            nombre,
            url,
            categoria: $("provFCat").value.trim(),
            urlBusqueda,
            notas: $("provFNotas").value.trim()
        };
        try {
            if (editandoId) {
                await db.collection("proveedores").doc(editandoId).update(datos);
            } else {
                datos.fecha = Date.now();
                await db.collection("proveedores").add(datos);
            }
            cerrarForm();
        } catch (e) {
            console.error(e);
            alert("No se pudo guardar: " + (e.message || e));
        }
    }

    async function borrar(id) {
        const p = lista.find(x => x.id === id);
        if (!p) return;
        if (!confirm(`¿Eliminar "${p.nombre}" de tus páginas? No se puede deshacer.`)) return;
        try {
            await db.collection("proveedores").doc(id).delete();
        } catch (e) {
            console.error(e);
            alert("No se pudo borrar: " + (e.message || e));
        }
    }

    // ------------------------------------------------------- TAB: presupuesto
    function pintarPresupuesto() {
        const b = borrador;
        $("provCont").innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px;">
            <div class="form-group" style="margin-bottom:12px;"><label>Cliente (opcional)</label><input id="pCliente" value="${esc(b.cliente)}" oninput="Proveedores.cambio()"></div>
            <div class="form-group" style="margin-bottom:12px;"><label>Teléfono (opcional)</label><input id="pTelefono" value="${esc(b.telefono)}" placeholder="5493424123456" oninput="Proveedores.cambio()"></div>
            <div class="form-group" style="margin-bottom:12px;"><label>Equipo / trabajo (opcional)</label><input id="pEquipo" value="${esc(b.equipo)}" oninput="Proveedores.cambio()"></div>
        </div>

        <div class="form-group" style="margin-bottom:8px;"><label>Repuestos / materiales</label></div>
        <div id="pLineas"></div>
        <button type="button" class="btn-add" style="width:auto; background:rgba(255,255,255,0.1); margin:4px 0 20px;" onclick="Proveedores.agregarLinea()">+ Agregar repuesto</button>

        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px;">
            <div class="form-group" style="margin-bottom:12px;"><label>Mano de obra (costo)</label><input id="pMano" type="number" min="0" step="any" value="${esc(b.mano)}" placeholder="0" oninput="Proveedores.cambio()"></div>
            <div class="form-group" style="margin-bottom:12px;"><label>Margen de ganancia %</label><input id="pMargen" type="number" min="0" step="any" value="${esc(b.margen)}" oninput="Proveedores.cambio()"></div>
            <div class="form-group" style="margin-bottom:12px;"><label>Precio final (opcional)</label><input id="pFinal" type="number" min="0" step="any" value="${esc(b.precioFinal)}" oninput="Proveedores.cambio()"></div>
        </div>

        <div id="pResumen" style="background:rgba(255,255,255,0.05); border-radius:16px; padding:16px; margin:6px 0 16px; line-height:1.9; font-size:14px;"></div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button type="button" class="btn-add" style="flex:1; min-width:140px; margin:0; background:var(--accent);" onclick="Proveedores.copiar()">📋 Copiar</button>
            <button type="button" class="btn-add" style="flex:1; min-width:140px; margin:0; background:#25d366;" onclick="Proveedores.enviarWA()">📲 WhatsApp</button>
            <button type="button" class="btn-add" style="flex:2; min-width:200px; margin:0; background:var(--success);" onclick="Proveedores.crearTrabajo()">➕ Crear trabajo con este presupuesto</button>
        </div>
        <button type="button" class="btn-add" style="background:none; color:var(--danger); margin-top:12px; opacity:.8;" onclick="Proveedores.limpiar()">🗑️ Empezar un presupuesto nuevo</button>
        <small style="display:block; opacity:.5; margin-top:8px; line-height:1.4;">El texto que se copia o se envía muestra solo los repuestos y el total: tus costos y proveedores no aparecen. El borrador queda guardado en este navegador.</small>`;
        pintarLineas();
        recalcular();
    }

    function pintarLineas() {
        const cont = $("pLineas");
        if (!cont) return;
        const opciones = sel => `<option value="">Proveedor (opcional)</option>` +
            lista.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.nombre)}</option>`).join("");
        cont.innerHTML = borrador.lineas.map((l, i) => `
            <div class="prov-row">
                <input class="pl-desc" placeholder="Repuesto o material" value="${esc(l.desc)}" oninput="Proveedores.cambio()">
                <select class="pl-prov" onchange="Proveedores.cambio()">${opciones(l.prov)}</select>
                <input class="pl-costo" type="number" min="0" step="any" placeholder="Costo" value="${esc(l.costo)}" oninput="Proveedores.cambio()">
                <input class="pl-qty" type="number" min="0" step="any" placeholder="Cant." value="${esc(l.qty)}" oninput="Proveedores.cambio()">
                <button type="button" title="Quitar" aria-label="Quitar repuesto" onclick="Proveedores.quitarLinea(${i})">✕</button>
            </div>`).join("");
    }

    function leerForm() {
        const v = id => { const el = $(id); return el ? el.value : ""; };
        if (!$("pLineas")) return;
        borrador.cliente = v("pCliente");
        borrador.telefono = v("pTelefono");
        borrador.equipo = v("pEquipo");
        borrador.mano = v("pMano");
        borrador.margen = v("pMargen");
        borrador.precioFinal = v("pFinal");
        borrador.lineas = [...document.querySelectorAll("#pLineas .prov-row")].map(r => ({
            desc: r.querySelector(".pl-desc").value,
            prov: r.querySelector(".pl-prov").value,
            costo: r.querySelector(".pl-costo").value,
            qty: r.querySelector(".pl-qty").value
        }));
        if (borrador.lineas.length === 0) borrador.lineas = borradorVacio().lineas;
    }

    function cambio() {
        leerForm();
        guardarBorrador();
        recalcular();
    }

    function agregarLinea(prov) {
        leerForm();
        const ult = borrador.lineas[borrador.lineas.length - 1];
        const ultVacia = ult && !ult.desc.trim() && ult.costo === "" && !ult.prov;
        if (prov && ultVacia) ult.prov = prov;
        else borrador.lineas.push({ desc: "", prov: prov || "", costo: "", qty: 1 });
        guardarBorrador();
        pintarLineas();
        recalcular();
        const filas = document.querySelectorAll("#pLineas .prov-row .pl-desc");
        if (filas.length) filas[filas.length - 1].focus();
    }

    function quitarLinea(i) {
        leerForm();
        borrador.lineas.splice(i, 1);
        if (borrador.lineas.length === 0) borrador.lineas = borradorVacio().lineas;
        guardarBorrador();
        pintarLineas();
        recalcular();
    }

    // "Cotizar" desde una página: pasa al presupuesto con ese proveedor elegido
    function cotizarCon(id) {
        setTab("presupuesto");
        agregarLinea(id);
    }

    function calcular() {
        const rep = borrador.lineas.reduce((a, l) => a + (Number(l.costo) || 0) * qtyDe(l), 0);
        const mano = Number(borrador.mano) || 0;
        const costo = rep + mano;
        const margen = Number(borrador.margen) || 0;
        const sugerido = Math.round(costo * (1 + margen / 100));
        const hayFinal = borrador.precioFinal !== "" && borrador.precioFinal != null;
        const final = hayFinal ? (Number(borrador.precioFinal) || 0) : sugerido;
        return { rep, mano, costo, margen, sugerido, final, ganancia: final - costo };
    }

    function recalcular() {
        const el = $("pResumen");
        if (!el) return;
        const r = calcular();
        const fin = $("pFinal");
        if (fin) fin.placeholder = "Sugerido: " + Math.round(r.sugerido);
        el.innerHTML = `
            <div style="display:flex; justify-content:space-between;"><span style="opacity:.65;">Repuestos y materiales</span><b>${fmt(r.rep)}</b></div>
            <div style="display:flex; justify-content:space-between;"><span style="opacity:.65;">Mano de obra</span><b>${fmt(r.mano)}</b></div>
            <div style="display:flex; justify-content:space-between;"><span style="opacity:.65;">Costo total</span><b>${fmt(r.costo)}</b></div>
            <div style="display:flex; justify-content:space-between;"><span style="opacity:.65;">Precio sugerido (+${r.margen}%)</span><b>${fmt(r.sugerido)}</b></div>
            <div style="display:flex; justify-content:space-between; font-size:18px; margin-top:6px; padding-top:8px; border-top:1px solid rgba(255,255,255,.1);"><span>Precio al cliente</span><b style="color:var(--success);">${fmt(r.final)}</b></div>
            <div style="display:flex; justify-content:space-between;"><span style="opacity:.65;">Tu ganancia</span><b style="color:${r.ganancia < 0 ? "var(--danger)" : "var(--success)"};">${fmt(r.ganancia)}</b></div>`;
    }

    // --------------------------------------------------- compartir / exportar
    function textoPresupuesto() {
        leerForm();
        const r = calcular();
        let negocio = "";
        try { if (typeof TALLER_CONFIG !== "undefined" && TALLER_CONFIG) negocio = TALLER_CONFIG.nombreNegocio || ""; } catch (_) {}
        let objeto = "Equipo";
        try { if (typeof presetRubro === "function") objeto = presetRubro().campoObjeto || objeto; } catch (_) {}
        const lineas = borrador.lineas.filter(l => l.desc.trim());
        let t = `*PRESUPUESTO${negocio ? " — " + negocio : ""}*\n`;
        if (borrador.cliente.trim()) t += `Cliente: ${borrador.cliente.trim()}\n`;
        if (borrador.equipo.trim()) t += `${objeto}: ${borrador.equipo.trim()}\n`;
        if (lineas.length) {
            t += `\n*Detalle:*\n` + lineas.map(l => "• " + l.desc.trim() + (qtyDe(l) > 1 ? " x" + qtyDe(l) : "")).join("\n") + "\n";
        }
        t += `\n*TOTAL: ${fmt(r.final)}*\n_Presupuesto sujeto a disponibilidad de repuestos._`;
        return t;
    }

    async function copiar() {
        const t = textoPresupuesto();
        try {
            await navigator.clipboard.writeText(t);
            alert("✅ Presupuesto copiado.");
        } catch (_) {
            const ta = document.createElement("textarea");
            ta.value = t;
            ta.style.cssText = "position:fixed; opacity:0;";
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand("copy"); } catch (_) {}
            document.body.removeChild(ta);
            alert(ok ? "✅ Presupuesto copiado." : "No se pudo copiar automáticamente.");
        }
    }

    function enviarWA() {
        const t = textoPresupuesto();
        const tel = String(borrador.telefono || "").replace(/\D/g, "");
        window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(t), "_blank");
    }

    function crearTrabajo() {
        leerForm();
        guardarBorrador();
        if (typeof abrirFormNuevo !== "function" || typeof renderRepuestos !== "function") {
            return alert("No se pudo abrir el formulario de trabajos.");
        }
        const r = calcular();
        const items = borrador.lineas.filter(l => l.desc.trim()).map(l => ({
            nombre: l.desc.trim() + (qtyDe(l) > 1 ? " x" + qtyDe(l) : ""),
            costo: (Number(l.costo) || 0) * qtyDe(l)
        }));
        cerrar();
        abrirFormNuevo();
        $("rCliente").value = borrador.cliente.trim();
        $("rTelefono").value = borrador.telefono.trim();
        $("rEquipo").value = borrador.equipo.trim();
        renderRepuestos(items);
        $("rManoObra").value = r.mano || "";
        $("rPrecio").value = r.final ? Math.round(r.final) : "";
        if (typeof actualizarGananciaPreview === "function") actualizarGananciaPreview();
    }

    function limpiar() {
        if (!confirm("¿Empezar un presupuesto nuevo? Se borra el borrador actual.")) return;
        borrador = borradorVacio();
        guardarBorrador();
        pintarPresupuesto();
    }

    window.Proveedores = {
        abrir, cerrar, setTab, setQ, setCat, buscar,
        nuevo, editar, guardar, borrar, cerrarForm,
        cambio, agregarLinea, quitarLinea, cotizarCon,
        copiar, enviarWA, crearTrabajo, limpiar
    };
})();
