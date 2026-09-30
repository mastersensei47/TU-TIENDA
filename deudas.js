/* ============================================================================
   DEUDAS.JS — Anotador de deudores y deudas
   ----------------------------------------------------------------------------
   Módulo compartido: lo usan el TALLER (reparaciones.html) y la TIENDA
   (index.html → panel admin → pestaña DEUDORES). Usa la variable global `db`
   (Firestore del propio negocio) y guarda todo en la colección "deudas".
   Solo el administrador puede leer y escribir (ver firestore.rules).

   Cada deuda tiene:
     tipo      "cobrar" (alguien te debe) | "pagar" (vos le debés a alguien)
     nombre, telefono, concepto, monto (total), vence (fecha opcional), notas
     pagos     lista de pagos parciales { monto, fecha, nota }
     pagado    suma de los pagos      saldada  true/false

   Uso:
     Deudas.iniciar("idDelContenedor")   → dibuja el anotador dentro de ese div
     Deudas.abrirModal()                 → lo abre en una ventana (taller)
   ============================================================================ */
(function () {
    "use strict";

    let lista = [];
    let contId = null;
    let unsub = null;
    let cargando = true;
    let tipoActual = "cobrar";
    let editandoId = null;
    let pagandoId = null;

    // ---------------------------------------------------------------- helpers
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    function moneda() {
        try { return (typeof STORE_CONFIG !== "undefined" && STORE_CONFIG && STORE_CONFIG.currency) || "$"; }
        catch (_) { return "$"; }
    }
    function nombreNegocio() {
        try {
            if (typeof STORE_CONFIG !== "undefined" && STORE_CONFIG && STORE_CONFIG.storeName) return STORE_CONFIG.storeName;
        } catch (_) {}
        try {
            if (typeof TALLER_CONFIG !== "undefined" && TALLER_CONFIG && TALLER_CONFIG.nombreNegocio) return TALLER_CONFIG.nombreNegocio;
        } catch (_) {}
        return "";
    }
    const fmt = n => moneda() + (Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
    const hoy = () => {
        const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    };
    const fechaCorta = ms => ms ? new Date(ms).toLocaleDateString("es-AR") : "";
    const fechaISO = iso => iso ? new Date(iso + "T00:00:00").toLocaleDateString("es-AR") : "";

    const restante = d => Math.max(0, (Number(d.monto) || 0) - (Number(d.pagado) || 0));
    const estaSaldada = d => restante(d) <= 0.004;
    const estaVencida = d => !estaSaldada(d) && !!d.vence && d.vence < hoy();

    // ------------------------------------------------------------ Firestore
    function escuchar() {
        if (unsub) return;
        try {
            unsub = db.collection("deudas").orderBy("fecha", "desc").onSnapshot(snap => {
                lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                cargando = false;
                pintar();
            }, err => {
                console.warn("deudas:", err.code);
                unsub = null;
                cargando = false;
                const l = $("deuLista");
                if (l) l.innerHTML = `<p style="opacity:.7; padding:20px; text-align:center;">No se pudieron cargar las deudas (${esc(err.code || "error")}). Revisá que publicaste las reglas de Firestore actualizadas.</p>`;
            });
        } catch (e) {
            console.error(e);
            unsub = null;
        }
    }

    // ------------------------------------------------------------- pantalla
    function esqueleto() {
        return `
        <div id="deuResumen" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; margin-bottom:16px;"></div>
        <div style="display:flex; gap:8px; margin-bottom:14px;">
            <button type="button" id="deuTabCobrar" onclick="Deudas.setTipo('cobrar')" style="flex:1; border:none; padding:12px; border-radius:12px; cursor:pointer; font-weight:700; color:#fff;">👤 Me deben</button>
            <button type="button" id="deuTabPagar" onclick="Deudas.setTipo('pagar')" style="flex:1; border:none; padding:12px; border-radius:12px; cursor:pointer; font-weight:700; color:#fff;">🏪 Yo debo</button>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
            <div class="form-group" style="flex:2; min-width:160px; margin:0;"><input id="deuBuscar" placeholder="Buscar por nombre o concepto..." oninput="Deudas.pintarLista()"></div>
            <div class="form-group" style="flex:1; min-width:120px; margin:0;">
                <select id="deuEstado" onchange="Deudas.pintarLista()">
                    <option value="abiertas">Pendientes</option>
                    <option value="saldadas">Saldadas</option>
                    <option value="todas">Todas</option>
                </select>
            </div>
        </div>
        <button type="button" class="btn-add" style="background:var(--success); margin:0 0 16px;" onclick="Deudas.nueva()">+ ANOTAR DEUDA</button>
        <div id="deuLista"><p style="opacity:.5; padding:20px; text-align:center;">Cargando...</p></div>`;
    }

    function iniciar(idContenedor) {
        contId = idContenedor;
        const cont = $(contId);
        if (!cont) return;
        asegurarModales();
        if (!cont.dataset.deuListo) {
            cont.innerHTML = esqueleto();
            cont.dataset.deuListo = "1";
        }
        escuchar();
        pintar();
    }

    function box(titulo, valor, color, sub) {
        return `<div style="background:rgba(255,255,255,0.05); border-radius:16px; padding:14px; text-align:center;">
            <small style="opacity:.55; font-weight:700; font-size:11px; letter-spacing:.5px;">${titulo}</small>
            <div style="font-size:22px; font-weight:800; margin-top:4px; color:${color};">${valor}</div>
            ${sub ? `<small style="opacity:.45; font-size:11px;">${sub}</small>` : ""}
        </div>`;
    }

    function pintar() {
        if (!contId || !$("deuResumen")) return;
        let cobrar = 0, pagar = 0, nCobrar = 0, nPagar = 0, vencidas = 0;
        lista.forEach(d => {
            if (estaSaldada(d)) return;
            const r = restante(d);
            if ((d.tipo || "cobrar") === "pagar") { pagar += r; nPagar++; } else { cobrar += r; nCobrar++; }
            if (estaVencida(d)) vencidas++;
        });
        $("deuResumen").innerHTML =
            box("ME DEBEN", fmt(cobrar), "var(--success)", nCobrar + (nCobrar === 1 ? " deuda abierta" : " deudas abiertas")) +
            box("YO DEBO", fmt(pagar), "var(--promo)", nPagar + (nPagar === 1 ? " deuda abierta" : " deudas abiertas")) +
            box("⚠️ VENCIDAS", vencidas, vencidas ? "var(--danger)" : "var(--text)", "sin saldar");

        const tc = $("deuTabCobrar"), tp = $("deuTabPagar");
        if (tc) tc.style.background = tipoActual === "cobrar" ? "var(--accent)" : "rgba(255,255,255,0.08)";
        if (tp) tp.style.background = tipoActual === "pagar" ? "var(--accent)" : "rgba(255,255,255,0.08)";
        pintarLista();
    }

    function filtradas() {
        const q = norm(($("deuBuscar") || {}).value);
        const est = ($("deuEstado") || {}).value || "abiertas";
        const items = lista
            .filter(d => (d.tipo || "cobrar") === tipoActual)
            .filter(d => est === "todas" ? true : est === "saldadas" ? estaSaldada(d) : !estaSaldada(d))
            .filter(d => !q || norm(d.nombre).includes(q) || norm(d.concepto).includes(q));
        // Las vencidas primero (el resto conserva el orden: más nuevas arriba)
        return items.sort((a, b) => (estaVencida(b) ? 1 : 0) - (estaVencida(a) ? 1 : 0));
    }

    function pintarLista() {
        const cont = $("deuLista");
        if (!cont || cargando) return;
        const items = filtradas();
        if (items.length === 0) {
            cont.innerHTML = `<div style="text-align:center; padding:40px 20px; opacity:.5;">
                <div style="font-size:40px; margin-bottom:10px;">📒</div>
                ${lista.length === 0 ? "Todavía no anotaste ninguna deuda." : "No hay resultados para mostrar."}
            </div>`;
            return;
        }
        const cobrando = tipoActual === "cobrar";
        cont.innerHTML = items.map(d => {
            const monto = Number(d.monto) || 0, pagado = Number(d.pagado) || 0, rest = restante(d);
            const sal = estaSaldada(d), venc = estaVencida(d);
            const color = sal ? "var(--success)" : venc ? "var(--danger)" : pagado > 0 ? "var(--promo)" : "var(--accent)";
            const pct = monto > 0 ? Math.min(100, Math.round(pagado / monto * 100)) : 0;
            const pagos = Array.isArray(d.pagos) ? d.pagos : [];
            const badge = sal ? "✅ Saldada" : venc ? "⚠️ Vencida" : pagado > 0 ? "Pago parcial" : "";
            return `
            <div class="admin-item" style="flex-direction:column; align-items:stretch; gap:10px; border-left:4px solid ${color};">
                <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
                    <div style="min-width:0;">
                        <b style="font-size:16px;">${esc(d.nombre)}</b>
                        ${badge ? `<span style="background:${color}; color:#fff; font-size:11px; font-weight:700; padding:3px 10px; border-radius:9999px; margin-left:8px; white-space:nowrap;">${badge}</span>` : ""}
                        ${d.concepto ? `<div style="opacity:.75; font-size:13px; margin-top:4px;">${esc(d.concepto)}</div>` : ""}
                        <div style="opacity:.5; font-size:12px; margin-top:3px;">
                            ${fechaCorta(d.fecha)}${d.telefono ? " · " + esc(d.telefono) : ""}${d.vence ? " · Vence: " + fechaISO(d.vence) : ""}
                        </div>
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <div style="font-weight:800; font-size:18px; color:${sal ? "var(--success)" : cobrando ? "var(--text)" : "var(--promo)"};">${fmt(sal ? monto : rest)}</div>
                        <small style="opacity:.5;">${sal ? "total" : "de " + fmt(monto)}</small>
                    </div>
                </div>
                <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:9999px; overflow:hidden;">
                    <div style="height:100%; width:${pct}%; background:${color};"></div>
                </div>
                ${d.notas ? `<div style="font-size:12px; opacity:.6;">📝 ${esc(d.notas)}</div>` : ""}
                ${pagos.length ? `
                <details style="font-size:12px;">
                    <summary style="cursor:pointer; opacity:.7;">Historial de pagos (${pagos.length}) — pagado ${fmt(pagado)}</summary>
                    ${pagos.map((p, i) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,.06);">
                        <span>${fechaCorta(p.fecha)}${p.nota ? " — " + esc(p.nota) : ""}</span>
                        <span><b>${fmt(p.monto)}</b>
                            <button type="button" title="Quitar este pago" onclick="Deudas.borrarPago('${d.id}', ${i})" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:4px 8px;">✕</button>
                        </span>
                    </div>`).join("")}
                </details>` : ""}
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    ${sal ? "" : `<button type="button" onclick="Deudas.pagar('${d.id}')" style="flex:2; min-width:130px; background:var(--success); border:none; color:#fff; padding:10px; border-radius:10px; cursor:pointer; font-weight:700;">💵 ${cobrando ? "Registrar cobro" : "Registrar pago"}</button>`}
                    ${!sal && cobrando && d.telefono ? `<button type="button" onclick="Deudas.recordar('${d.id}')" style="flex:1; min-width:100px; background:rgba(255,255,255,0.08); border:none; color:var(--text); padding:10px; border-radius:10px; cursor:pointer; font-weight:700;">📲 Recordar</button>` : ""}
                    <button type="button" onclick="Deudas.editar('${d.id}')" style="background:rgba(255,255,255,0.06); border:none; color:var(--text); padding:10px 14px; border-radius:10px; cursor:pointer;">✏️</button>
                    <button type="button" onclick="Deudas.borrar('${d.id}')" style="background:none; border:none; color:var(--danger); padding:10px; cursor:pointer;">🗑️</button>
                </div>
            </div>`;
        }).join("");
    }

    function setTipo(t) {
        tipoActual = t === "pagar" ? "pagar" : "cobrar";
        pintar();
    }

    // -------------------------------------------------------------- modales
    function asegurarModales() {
        if ($("deudaFormModal")) return;
        const estilo = "align-items:flex-start; overflow-y:auto; z-index:9000;";
        const contenido = "max-width:480px; width:100%; margin:30px auto; padding:25px;";

        const form = document.createElement("div");
        form.className = "modal";
        form.id = "deudaFormModal";
        form.style.cssText = estilo;
        form.innerHTML = `
        <div class="modal-content" style="${contenido}">
            <h3 id="deuFTitulo" style="margin-top:0;">Anotar deuda</h3>
            <div class="form-group"><label>Tipo</label>
                <select id="deuFTipo" onchange="Deudas.actualizarLabels()">
                    <option value="cobrar">👤 Me deben (deudor)</option>
                    <option value="pagar">🏪 Yo debo (a un proveedor u otra persona)</option>
                </select>
            </div>
            <div class="form-group"><label id="deuFLblNombre">Deudor (quién te debe)</label><input id="deuFNombre" placeholder="Nombre"></div>
            <div class="form-group"><label>Teléfono (opcional)</label><input id="deuFTelefono" placeholder="Ej: 5493424123456"></div>
            <div class="form-group"><label>Concepto (opcional)</label><input id="deuFConcepto" placeholder="Ej: reparación de pantalla, mercadería..."></div>
            <div class="form-group"><label>Monto total</label><input id="deuFMonto" type="number" min="0" step="any" placeholder="0"></div>
            <div class="form-group" id="deuFEntregaBox"><label>Entrega inicial (opcional)</label><input id="deuFEntrega" type="number" min="0" step="any" placeholder="0"></div>
            <div class="form-group"><label>Fecha de vencimiento (opcional)</label><input id="deuFVence" type="date"></div>
            <div class="form-group"><label>Notas (opcional)</label><textarea id="deuFNotas" rows="2"></textarea></div>
            <button type="button" class="btn-add" style="background:var(--success);" onclick="Deudas.guardar()">GUARDAR</button>
            <button type="button" class="btn-add" style="background:none; color:white; margin-top:10px; opacity:.6;" onclick="Deudas.cerrarForm()">Cancelar</button>
        </div>`;

        const pago = document.createElement("div");
        pago.className = "modal";
        pago.id = "deudaPagoModal";
        pago.style.cssText = estilo;
        pago.innerHTML = `
        <div class="modal-content" style="${contenido}">
            <h3 id="deuPTitulo" style="margin-top:0;">Registrar pago</h3>
            <div id="deuPInfo" style="margin-bottom:18px; line-height:1.5;"></div>
            <div class="form-group"><label>Monto</label><input id="deuPMonto" type="number" min="0" step="any"></div>
            <div class="form-group"><label>Nota (opcional)</label><input id="deuPNota" placeholder="Ej: transferencia, efectivo..."></div>
            <button type="button" class="btn-add" style="background:var(--success);" onclick="Deudas.confirmarPago()">CONFIRMAR</button>
            <button type="button" class="btn-add" style="background:none; color:white; margin-top:10px; opacity:.6;" onclick="Deudas.cerrarPago()">Cancelar</button>
        </div>`;

        document.body.appendChild(form);
        document.body.appendChild(pago);
    }

    function actualizarLabels() {
        const l = $("deuFLblNombre");
        if (l) l.innerText = $("deuFTipo").value === "pagar" ? "Acreedor (a quién le debés)" : "Deudor (quién te debe)";
    }

    function nueva() {
        editandoId = null;
        abrirForm({});
    }

    function editar(id) {
        const d = lista.find(x => x.id === id);
        if (!d) return;
        editandoId = id;
        abrirForm(d);
    }

    function abrirForm(d) {
        asegurarModales();
        $("deuFTitulo").innerText = editandoId ? "Editar deuda" : "Anotar deuda";
        $("deuFTipo").value = d.tipo || tipoActual;
        $("deuFNombre").value = d.nombre || "";
        $("deuFTelefono").value = d.telefono || "";
        $("deuFConcepto").value = d.concepto || "";
        $("deuFMonto").value = d.monto || "";
        $("deuFEntrega").value = "";
        $("deuFEntregaBox").style.display = editandoId ? "none" : "block";
        $("deuFVence").value = d.vence || "";
        $("deuFNotas").value = d.notas || "";
        actualizarLabels();
        $("deudaFormModal").style.display = "flex";
    }

    function cerrarForm() {
        const m = $("deudaFormModal");
        if (m) m.style.display = "none";
        editandoId = null;
    }

    async function guardar() {
        const tipo = $("deuFTipo").value === "pagar" ? "pagar" : "cobrar";
        const nombre = $("deuFNombre").value.trim();
        const monto = parseFloat($("deuFMonto").value);
        if (!nombre) return alert("Escribí el nombre.");
        if (!(monto > 0)) return alert("Ingresá un monto mayor a 0.");

        const datos = {
            tipo,
            nombre,
            telefono: $("deuFTelefono").value.trim(),
            concepto: $("deuFConcepto").value.trim(),
            monto,
            vence: $("deuFVence").value || null,
            notas: $("deuFNotas").value.trim()
        };

        try {
            if (editandoId) {
                const actual = lista.find(x => x.id === editandoId) || {};
                datos.saldada = (Number(actual.pagado) || 0) >= monto - 0.004;
                await db.collection("deudas").doc(editandoId).update(datos);
            } else {
                const entrega = parseFloat($("deuFEntrega").value) || 0;
                if (entrega > monto) return alert("La entrega inicial no puede ser mayor al monto total.");
                datos.fecha = Date.now();
                datos.pagos = entrega > 0 ? [{ monto: entrega, fecha: Date.now(), nota: "Entrega inicial" }] : [];
                datos.pagado = entrega;
                datos.saldada = entrega >= monto - 0.004;
                await db.collection("deudas").add(datos);
                tipoActual = tipo;
            }
            cerrarForm();
        } catch (e) {
            console.error(e);
            alert("No se pudo guardar: " + (e.message || e));
        }
    }

    async function borrar(id) {
        const d = lista.find(x => x.id === id);
        if (!d) return;
        if (!confirm(`¿Eliminar la deuda de "${d.nombre}"? No se puede deshacer.`)) return;
        try {
            await db.collection("deudas").doc(id).delete();
        } catch (e) {
            console.error(e);
            alert("No se pudo borrar: " + (e.message || e));
        }
    }

    // ---------------------------------------------------------------- pagos
    function pagar(id) {
        const d = lista.find(x => x.id === id);
        if (!d) return;
        asegurarModales();
        pagandoId = id;
        const cobrando = (d.tipo || "cobrar") === "cobrar";
        $("deuPTitulo").innerText = cobrando ? "Registrar cobro" : "Registrar pago";
        $("deuPInfo").innerHTML = `<b>${esc(d.nombre)}</b>${d.concepto ? " — " + esc(d.concepto) : ""}<br>
            <span style="opacity:.6;">Saldo pendiente: ${fmt(restante(d))} (de ${fmt(d.monto)})</span>`;
        $("deuPMonto").value = restante(d);
        $("deuPNota").value = "";
        $("deudaPagoModal").style.display = "flex";
    }

    function cerrarPago() {
        const m = $("deudaPagoModal");
        if (m) m.style.display = "none";
        pagandoId = null;
    }

    async function guardarPagos(d, pagos) {
        const pagado = pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0);
        const saldada = pagado >= (Number(d.monto) || 0) - 0.004;
        await db.collection("deudas").doc(d.id).update({ pagos, pagado, saldada });
    }

    async function confirmarPago() {
        const d = lista.find(x => x.id === pagandoId);
        if (!d) return cerrarPago();
        const monto = parseFloat($("deuPMonto").value);
        if (!(monto > 0)) return alert("Ingresá un monto válido.");
        if (monto > restante(d) + 0.005) return alert(`El monto (${fmt(monto)}) es mayor al saldo pendiente (${fmt(restante(d))}).`);
        const pagos = [...(Array.isArray(d.pagos) ? d.pagos : []), { monto, fecha: Date.now(), nota: $("deuPNota").value.trim() }];
        try {
            await guardarPagos(d, pagos);
            cerrarPago();
        } catch (e) {
            console.error(e);
            alert("No se pudo registrar: " + (e.message || e));
        }
    }

    async function borrarPago(id, idx) {
        const d = lista.find(x => x.id === id);
        if (!d || !Array.isArray(d.pagos) || !d.pagos[idx]) return;
        if (!confirm(`¿Quitar el pago de ${fmt(d.pagos[idx].monto)}? La deuda vuelve a tener ese saldo pendiente.`)) return;
        try {
            await guardarPagos(d, d.pagos.filter((_, i) => i !== idx));
        } catch (e) {
            console.error(e);
            alert("No se pudo quitar el pago: " + (e.message || e));
        }
    }

    // ------------------------------------------------------- recordatorio
    function recordar(id) {
        const d = lista.find(x => x.id === id);
        if (!d) return;
        const tel = String(d.telefono || "").replace(/\D/g, "");
        if (!tel) return alert("Esta deuda no tiene teléfono cargado.");
        const negocio = nombreNegocio();
        const msg = `Hola ${d.nombre}! ${negocio ? "Te escribo de " + negocio + ". " : ""}` +
            `Te recuerdo que tenés un saldo pendiente de ${fmt(restante(d))}` +
            `${d.concepto ? " por " + d.concepto : ""}` +
            `${d.vence ? " (vencimiento: " + fechaISO(d.vence) + ")" : ""}. ¡Gracias!`;
        window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg), "_blank");
    }

    // ------------------------------------------------- ventana (para taller)
    function abrirModal() {
        let m = $("deudasPanelModal");
        if (!m) {
            m = document.createElement("div");
            m.className = "modal";
            m.id = "deudasPanelModal";
            m.style.cssText = "align-items:flex-start; overflow-y:auto;";
            m.innerHTML = `
            <div class="modal-content" style="max-width:640px; width:100%; margin:30px auto; padding:25px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3 style="margin:0;">📒 Deudores y deudas</h3>
                    <button type="button" onclick="Deudas.cerrarModal()" style="background:none; border:none; color:var(--text); font-size:26px; cursor:pointer;">✕</button>
                </div>
                <div id="deudasPanelCont"></div>
            </div>`;
            document.body.appendChild(m);
        }
        m.style.display = "flex";
        iniciar("deudasPanelCont");
    }

    function cerrarModal() {
        const m = $("deudasPanelModal");
        if (m) m.style.display = "none";
    }

    window.Deudas = {
        iniciar, abrirModal, cerrarModal, setTipo, pintarLista,
        nueva, editar, guardar, borrar, cerrarForm, actualizarLabels,
        pagar, confirmarPago, cerrarPago, borrarPago, recordar
    };
})();
