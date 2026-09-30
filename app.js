// ============================================================================
// APP.JS — Lógica de la tienda (no debería hacer falta tocar este archivo
// para dar de alta un cliente nuevo; toda la personalización vive en la
// configuración de cada tienda, resuelta dinámicamente por ?slug=)
// ============================================================================

// ==================== MULTI-TIENDA: RESOLUCIÓN DINÁMICA POR SLUG ====================
// Este sitio es UNO SOLO y sirve a todos los clientes según el slug de la
// URL (ej: tuservidor.com/?slug=mundo-tic). Cada cliente sigue teniendo su
// propio proyecto de Firebase, 100% aislado del resto — lo único
// centralizado es un directorio (proyecto "master") que dice "el slug
// mundo-tic corresponde a este firebaseConfig". Ver README.md →
// "Sistema multi-tienda por slug".
//
// MASTER_FIREBASE_CONFIG viene de config.js y es el ÚNICO dato fijo de todo
// el sistema: es el mismo para todos los clientes, porque apunta al
// proyecto "directorio", no a ningún cliente en particular.

let db, auth, STORE_CONFIG;
let clienteApp, masterApp;

function leerSlug() {
    const urlSlug = new URLSearchParams(location.search).get("slug");
    if (urlSlug) {
        try { localStorage.setItem("tu_tienda_ultimo_slug", urlSlug); } catch (_) {}
        return urlSlug;
    }
    try { return localStorage.getItem("tu_tienda_ultimo_slug"); } catch (_) { return null; }
}

function mostrarErrorSlug(mensaje) {
    const el = document.getElementById("slugError");
    if (el) {
        el.querySelector("p").innerText = mensaje;
        el.style.display = "flex";
    }
    document.body.classList.add("no-scroll");
}

// Valores por defecto para cualquier campo de config/tienda que un cliente
// no haya cargado todavía, así el sitio nunca se rompe por un dato faltante.
const CONFIG_DEFAULTS = {
    storeName: "Tienda", tagline: "", city: "", logoUrl: "", pwaIconUrl: "", pwaAppName: "", pwaEnabled: true,
    address: "", horarios: "",
    businessType: "generico", businessMode: "ambos", // "mayorista" | "minorista" | "ambos"
    whatsappNumber: "", instagramUrl: "", facebookUrl: "", tiktokUrl: "",
    currency: "$", mapaUrl: "",
    pausada: false, bannerActivo: false, bannerTexto: "", bannerBgColor: "#f59e0b", bannerTextColor: "#000000",
    pagos: { efectivo: true, transferencia: false, mercadopago: false, datosTransferencia: "", descuentoTransferenciaPct: 0, cuotasCantidad: 0, cuotasRecargoPct: 0 },
    envios: { activo: false, info: "" },
    features: { wholesalePricing: true, stockControl: true, heroSlider: true, userRegistration: true, productVariants: false, mostrarMapa: false },
    layout: {
        catalogView: "grid2",     // "grid2" | "grid1" | "list"
        headerSticky: true,
        headerStyle: "floating",  // "floating" | "bar"
        imageEffect: "none",      // "none" | "zoom" | "gradient"
        addToCartAnim: "banner",  // "banner" | "shake" | "fly"
        cartStyle: "drawer",      // "drawer" | "modal"
        glowEffect: false
    },
    categories: [],
    theme: { bg: "#0f172a", card: "#1e293b", text: "#f1f5f9", accent: "#3b82f6", success: "#10b981", promo: "#f59e0b", danger: "#ef4444", radius: "18px" },
    notifications: { emailEnabled: false, emailJsServiceId: "", emailJsTemplateId: "", emailJsPublicKey: "", adminEmail: "" },
    whatsappTemplate: ""
};

function leerCacheTienda(slug) {
    try {
        const raw = localStorage.getItem("tu_tienda_cache_" + slug);
        return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}
function guardarCacheTienda(slug, data) {
    try { localStorage.setItem("tu_tienda_cache_" + slug, JSON.stringify(data)); } catch (_) {}
}

function construirStoreConfig(slug, datosTienda) {
    datosTienda = datosTienda || {};
    return {
        ...CONFIG_DEFAULTS,
        ...datosTienda,
        features: { ...CONFIG_DEFAULTS.features, ...(datosTienda.features || {}) },
        theme: { ...CONFIG_DEFAULTS.theme, ...(datosTienda.theme || {}) },
        notifications: { ...CONFIG_DEFAULTS.notifications, ...(datosTienda.notifications || {}) },
        pagos: { ...CONFIG_DEFAULTS.pagos, ...(datosTienda.pagos || {}) },
        envios: { ...CONFIG_DEFAULTS.envios, ...(datosTienda.envios || {}) },
        layout: { ...CONFIG_DEFAULTS.layout, ...(datosTienda.layout || {}) },
        storeId: slug
    };
}


// ---- Caché local (solo datos PÚBLICOS del catálogo) para que, desde la segunda
// visita, la tienda se pinte al instante sin esperar la cadena de consultas.
function leerCacheLS(clave) {
    try { const raw = localStorage.getItem(clave); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
}
function guardarCacheLS(clave, valor) {
    try {
        const txt = JSON.stringify(valor);
        if (txt.length > 1500000) return; // demasiado grande: no vale la pena
        localStorage.setItem(clave, txt);
    } catch (_) {}
}

// Si la imagen está en Cloudinary, pide una versión liviana y en formato
// moderno (f_auto,q_auto) para las tarjetas. Con otras URLs no hace nada.
function miniaturaImg(url, ancho) {
    const u = String(url || "");
    if (u.includes("res.cloudinary.com") && /\/image\/upload\/v\d+\//.test(u)) {
        return u.replace("/image/upload/", `/image/upload/f_auto,q_auto,w_${ancho || 500}/`);
    }
    return u;
}

function obtenerFirebaseApp(nombre, config) {
    try { return firebase.app(nombre); }
    catch (_) { return firebase.initializeApp(config, nombre); }
}

function crearFirestore(app) {
    // No forzamos long-polling en Opera. Firebase Firestore 9.x puede emitir
    // "You are overriding the original host" y, según el navegador/red,
    // terminar provocando fallos de conexión. Dejamos que Firestore negocie
    // automáticamente el transporte.
    return firebase.firestore(app);
}

async function esperarFirebase(maxIntentos = 30) {
    for (let i = 0; i < maxIntentos; i++) {
        if (typeof firebase !== "undefined" && typeof firebase.initializeApp === "function" && typeof MASTER_FIREBASE_CONFIG !== "undefined") return true;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
}

function describirErrorFirebase(e) {
    const code = e && e.code ? String(e.code) : "";
    const message = e && e.message ? String(e.message) : String(e || "Error desconocido");
    return { code, message };
}

function errorFirebaseDetalle(e, etapa = "Firebase") {
    const { code, message } = describirErrorFirebase(e);
    console.error(`Detalle Firebase [${etapa}]`, { code, message, error: e });

    let ayuda = "";
    if (code === "permission-denied") ayuda = " Revisá las reglas de Firestore del proyecto indicado.";
    else if (code === "failed-precondition") ayuda = " Verificá que Cloud Firestore esté habilitado en ese proyecto.";
    else if (code === "unavailable" || code === "deadline-exceeded") ayuda = " Verificá la conexión y que el proyecto Firebase esté disponible.";
    else if (code === "not-found") ayuda = " Verificá que exista la base de datos Firestore (default) en ese proyecto.";
    else if (code === "app/invalid-app-options" || code === "invalid-argument") ayuda = " Revisá el firebaseConfig guardado en MASTER.";

    return `${etapa}: ${message}${code ? ` [${code}]` : ""}.${ayuda}`;
}

function suscribirConfigTienda(slug, firebaseConfig) {
    // Mantener actualizada la configuración visual desde el Firebase de la tienda.
    db.collection("config").doc("tienda").onSnapshot(cfgDoc => {
        const fresh = cfgDoc.exists ? (cfgDoc.data() || {}) : {};
        STORE_CONFIG = construirStoreConfig(slug, fresh);
        const previo = leerCacheTienda(slug) || {};
        guardarCacheTienda(slug, { ...previo, firebaseConfig: previo.firebaseConfig || firebaseConfig, datosTienda: fresh });
        try { aplicarTema(); } catch (e) { console.warn("aplicarTema:", e); }
        try { aplicarBranding(); } catch (e) { console.warn("aplicarBranding:", e); }
        try { renderCategorias(); } catch (e) { console.warn("renderCategorias:", e); }
        try { renderCategoriasSelect(); } catch (e) { console.warn("renderCategoriasSelect:", e); }
        try { renderBanners(); } catch (e) { console.warn("renderBanners:", e); }
        try { aplicarLayout(); } catch (e) { console.warn("aplicarLayout:", e); }
        try { aplicarManifestPWA(); } catch (e) { console.warn("aplicarManifestPWA:", e); }
        try { aplicarOpenGraph(); } catch (e) { console.warn("aplicarOpenGraph:", e); }
        try { renderHeroSlider(); } catch (e) { console.warn("renderHeroSlider:", e); }
        try { cargarFormConfig(); } catch (e) { console.warn("cargarFormConfig:", e); }
    }, e => console.warn(`CLIENTE / ${firebaseConfig.projectId} / config/tienda:`, e));
}

// Arranque rápido: la tienda ya se mostró con los datos guardados; acá se
// confirma en segundo plano con el MASTER que sigue activa y que su conexión
// no cambió. Si cambió, se actualiza la caché y se recarga UNA vez.
async function verificarMasterEnSegundoPlano(slug, configUsada) {
    try {
        let app = obtenerFirebaseApp("master", MASTER_FIREBASE_CONFIG);
        if (app && typeof app.then === "function") app = await app;
        const doc = await crearFirestore(app).collection("clientes").doc(slug).get();
        if (!doc.exists) {
            try { localStorage.removeItem("tu_tienda_cache_" + slug); } catch (_) {}
            return mostrarErrorSlug(`El slug "${slug}" no existe en Firebase MASTER. Revisá clientes/${slug}.`);
        }
        const datos = doc.data() || {};
        if (datos.activo === false) {
            try { localStorage.removeItem("tu_tienda_cache_" + slug); } catch (_) {}
            return mostrarErrorSlug(`La tienda "${slug}" está marcada como INACTIVA en Firebase MASTER.`);
        }
        const fc = datos.firebaseConfig;
        if (fc && typeof fc === "object" && JSON.stringify(fc) !== JSON.stringify(configUsada)) {
            const previo = leerCacheTienda(slug) || {};
            guardarCacheTienda(slug, { ...previo, firebaseConfig: fc });
            try {
                if (!sessionStorage.getItem("tu_tienda_recarga_cfg")) {
                    sessionStorage.setItem("tu_tienda_recarga_cfg", "1");
                    location.reload();
                }
            } catch (_) {}
        }
    } catch (e) {
        console.warn("Verificación en segundo plano (MASTER):", e);
    }
}

async function bootstrap() {
    const slug = leerSlug();

    if (!slug) {
        return mostrarErrorSlug(
            "Falta indicar la tienda en el link. Usá exactamente el enlace generado por el Panel Master con ?slug=..."
        );
    }

    if (!(await esperarFirebase())) {
        return mostrarErrorSlug("No pudimos iniciar Firebase. Recargá la página y probá nuevamente.");
    }

    // IMPORTANTE: el slug de la URL es la única fuente de verdad.
    // Nunca usamos localStorage para decidir qué tienda abrir.
    try {
        // ---------------- ARRANQUE RÁPIDO (desde la 2ª visita) ----------------
        const cache = leerCacheTienda(slug);
        if (cache && cache.firebaseConfig && cache.datosTienda) {
            try {
                clienteApp = obtenerFirebaseApp("cliente", cache.firebaseConfig);
                db = crearFirestore(clienteApp);
                auth = firebase.auth(clienteApp);
                STORE_CONFIG = construirStoreConfig(slug, cache.datosTienda);
                init();
                suscribirConfigTienda(slug, cache.firebaseConfig);
                verificarMasterEnSegundoPlano(slug, cache.firebaseConfig);
                return;
            } catch (e) {
                console.warn("Arranque rápido falló; se usa el arranque normal:", e);
            }
        }

        // ---------------- MASTER ----------------
        try {
            masterApp = obtenerFirebaseApp("master", MASTER_FIREBASE_CONFIG);
            if (masterApp && typeof masterApp.then === "function") masterApp = await masterApp;
        } catch (e) {
            return mostrarErrorSlug(errorFirebaseDetalle(e, "MASTER / inicialización"));
        }

        let masterDb;
        try {
            masterDb = crearFirestore(masterApp);
        } catch (e) {
            return mostrarErrorSlug(errorFirebaseDetalle(e, "MASTER / Firestore"));
        }

        let clienteDoc;
        try {
            // La regla del MASTER permite get público sobre clientes/{slug}.
            clienteDoc = await masterDb.collection("clientes").doc(slug).get();
        } catch (e) {
            return mostrarErrorSlug(errorFirebaseDetalle(e, `MASTER / clientes/${slug}`));
        }

        if (!clienteDoc.exists) {
            return mostrarErrorSlug(`El slug "${slug}" no existe en Firebase MASTER. Revisá clientes/${slug}.`);
        }

        const datosMaster = clienteDoc.data() || {};
        if (datosMaster.activo === false) {
            return mostrarErrorSlug(`La tienda "${slug}" está marcada como INACTIVA en Firebase MASTER.`);
        }

        const firebaseConfig = datosMaster.firebaseConfig;
        if (!firebaseConfig || typeof firebaseConfig !== "object") {
            return mostrarErrorSlug(`clientes/${slug} existe, pero no contiene firebaseConfig.`);
        }

        const requeridos = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
        const faltantes = requeridos.filter(c => !String(firebaseConfig[c] || "").trim());
        if (faltantes.length) {
            return mostrarErrorSlug(`clientes/${slug} tiene firebaseConfig incompleto. Falta: ${faltantes.join(", ")}.`);
        }

        if (firebaseConfig.projectId === MASTER_FIREBASE_CONFIG.projectId) {
            return mostrarErrorSlug(`clientes/${slug} apunta al mismo proyecto Firebase que MASTER. Cada tienda debe tener su propio projectId.`);
        }

        // ---------------- CLIENTE ----------------
        try {
            clienteApp = await obtenerFirebaseApp("cliente", firebaseConfig);
            db = crearFirestore(clienteApp);
            auth = firebase.auth(clienteApp);
            // Los comprobantes de transferencia se suben a Cloudinary (no a
            // Firebase Storage), así que no hace falta inicializar Storage.
        } catch (e) {
            return mostrarErrorSlug(errorFirebaseDetalle(e, `CLIENTE / ${firebaseConfig.projectId}`));
        }

        // ---------------- CONFIG DE LA TIENDA ----------------
        let datosTienda = {};
        try {
            const cfgDoc = await db.collection("config").doc("tienda").get();
            if (cfgDoc.exists) datosTienda = cfgDoc.data() || {};
            else console.warn(`CLIENTE / ${firebaseConfig.projectId}: no existe config/tienda; se usarán valores por defecto.`);
        } catch (e) {
            return mostrarErrorSlug(errorFirebaseDetalle(e, `CLIENTE / ${firebaseConfig.projectId} / config/tienda`));
        }

        STORE_CONFIG = construirStoreConfig(slug, datosTienda);
        guardarCacheTienda(slug, { firebaseConfig, datosTienda });
        init();
        suscribirConfigTienda(slug, firebaseConfig);

    } catch (e) {
        mostrarErrorSlug(errorFirebaseDetalle(e, "RESOLUCIÓN DE TIENDA"));
    }
}


let prods = [];
let productosListos = false; // true cuando llegó el primer dato real (o del caché) de productos
let cart = [];
let users = [];
let orders = [];
let avisosStock = [];
let heroImages = [];
let isMay = false;
let esAdmin = false;
let currentUser = null;
let usuarioLogueado = null;
let filterCat = "";
let currentProductId = null;
let currentDetailQty = 1;
let currentVariantes = []; // variantes (talle/color) del producto abierto en el detalle
let rotators = [];
let heroInterval = null;

// Convierte lo que la persona escribió en el login/registro en un "email"
// interno válido para Firebase Authentication. Si ya escribió un email real
// (contiene "@", como hace normalmente el administrador) se usa tal cual,
// para que la recuperación de contraseña por correo funcione de verdad.
// Si escribió un nombre de usuario simple (clientes mayoristas), se arma un
// email interno con el storeId (= slug) como dominio ficticio.
function toAuthEmail(input) {
    const v = (input || "").trim();
    if (v.includes("@")) return v.toLowerCase();
    return v.toLowerCase().replace(/\s+/g, "") + "@" + STORE_CONFIG.storeId + ".tienda.local";
}

let unsubUsuariosAdmin = null;
let unsubPedidosAdmin = null;
let unsubAvisosStockAdmin = null;

function detenerListenersAdmin() {
    if (typeof unsubUsuariosAdmin === "function") unsubUsuariosAdmin();
    if (typeof unsubPedidosAdmin === "function") unsubPedidosAdmin();
    if (typeof unsubAvisosStockAdmin === "function") unsubAvisosStockAdmin();
    unsubUsuariosAdmin = null;
    unsubPedidosAdmin = null;
    unsubAvisosStockAdmin = null;
}

function cargarDatosAdmin() {
    detenerListenersAdmin();
    unsubUsuariosAdmin = db.collection("usuarios").onSnapshot(snap => {
        users = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAdmU();
    }, err => console.warn("usuarios:", err.code || err));

    unsubPedidosAdmin = db.collection("pedidos").orderBy("fecha", "desc").onSnapshot(snap => {
        orders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAdmO();
        renderAdmStats();
    }, err => console.warn("pedidos:", err.code || err));

    unsubAvisosStockAdmin = db.collection("avisosStock").orderBy("fecha", "desc").onSnapshot(snap => {
        avisosStock = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAdmAvisosStock();
    }, err => console.warn("avisosStock:", err.code || err));
}

// Lista de "avisame cuando haya stock" pendientes, dentro de la pestaña
// CLIENTES. El admin las marca como avisadas (o las borra) a mano después
// de escribirle al cliente — no manda ningún mensaje automático.
function renderAdmAvisosStock() {
    const list = document.getElementById("admListAvisosStock");
    if (!list) return;
    const pendientes = avisosStock.filter(a => !a.avisado);
    if (pendientes.length === 0) {
        list.innerHTML = `<p style="opacity:0.5; padding:20px; text-align:center;">No hay avisos pendientes.</p>`;
        return;
    }
    list.innerHTML = pendientes.map(a => `
        <div class="admin-item">
            <div style="flex:1;">
                <b>${a.productoNombre || 'Producto eliminado'}</b>
                <div style="opacity:0.6; font-size:12px;">📱 ${a.contacto} — ${new Date(a.fecha).toLocaleDateString('es-AR')}</div>
            </div>
            <a href="https://wa.me/${a.contacto}" target="_blank" style="background:#25d366; color:#fff; padding:7px 12px; border-radius:9px; font-size:12px; font-weight:700; text-decoration:none;">💬 Escribir</a>
            <button onclick="marcarAvisoStockHecho('${a.id}')" title="Marcar como avisado" style="color:var(--success); font-size:18px; cursor:pointer; background:none; border:none;">✅</button>
            <button onclick="eliminarAvisoStock('${a.id}')" title="Eliminar" style="color:var(--danger); font-size:18px; cursor:pointer; background:none; border:none;">🗑️</button>
        </div>
    `).join("");
}

async function marcarAvisoStockHecho(id) {
    try { await db.collection("avisosStock").doc(id).update({ avisado: true }); }
    catch (e) { console.error(e); alert("No pudimos actualizar el aviso."); }
}

async function eliminarAvisoStock(id) {
    try { await db.collection("avisosStock").doc(id).delete(); }
    catch (e) { console.error(e); alert("No pudimos borrar el aviso."); }
}

function init() {
    // Fix autofill: algunos navegadores autocompletan este campo con el
    // email guardado (ej: el del admin) a pesar de autocomplete="off".
    const searchEl = document.getElementById("searchInput");
    if (searchEl) searchEl.value = "";

    // Cada paso va en su propio try/catch: si uno falla (ej. por un
    // archivo desactualizado en el hosting, con index.html y app.js de
    // versiones distintas), el resto de la tienda igual se termina de
    // cargar en vez de quedar todo roto en cadena.
    const pasos = [
        ["aplicarTema", aplicarTema],
        ["aplicarBranding", aplicarBranding],
        ["renderCategorias", renderCategorias],
        ["renderCategoriasSelect", renderCategoriasSelect],
        ["updateCartUI", updateCartUI],
        ["inicializarNotificaciones", inicializarNotificaciones],
        ["renderMapa", renderMapa],
        ["renderBanners", renderBanners],
        ["aplicarLayout", aplicarLayout],
        ["aplicarManifestPWA", aplicarManifestPWA],
        ["aplicarOpenGraph", aplicarOpenGraph],
        ["registrarServiceWorker", registrarServiceWorker],
        ["prepararInstalacionPWA", prepararInstalacionPWA],
        ["cargarFormConfig", cargarFormConfig],
    ];
    pasos.forEach(([nombre, fn]) => {
        try { fn(); } catch (e) { console.error(`init(): falló ${nombre}()`, e); }
    });

    // Resolver sesión: ¿invitado, administrador o cliente mayorista?
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        esAdmin = false;
        isMay = false;
        usuarioLogueado = null;
        detenerListenersAdmin();
        const logout = document.getElementById("logoutBtn");
        if (logout) logout.style.display = "none";

        if (!user) {
            mostrarPerfilVacio();
            render();
            return;
        }

        try {
            const adminDoc = await db.collection("admins").doc(user.uid).get();
            if (adminDoc.exists) {
                esAdmin = true;
                if (logout) logout.style.display = "block";
                mostrarPerfilAdmin();
                cargarDatosAdmin();
                // Firebase puede haber entregado productos/hero antes de resolver Auth.
                // Renderizamos el panel ahora que ya sabemos que es administrador.
                renderAdmP();
                renderAdmSlider();
                render();
                return;
            }

            const perfilDoc = await db.collection("usuarios").doc(user.uid).get();
            if (perfilDoc.exists && perfilDoc.data().activo) {
                isMay = STORE_CONFIG.features.wholesalePricing;
                usuarioLogueado = { id: perfilDoc.id, ...perfilDoc.data() };
                llenarPerfil(usuarioLogueado);
            } else if (perfilDoc.exists && !perfilDoc.data().activo) {
                alert("Tu cuenta está en revisión por el administrador.");
                await auth.signOut();
                return;
            } else {
                mostrarPerfilVacio();
            }
        } catch (e) {
            console.error("Error resolviendo la sesión:", e);
            mostrarPerfilVacio();
        }
        render();
    });

    // Productos y slider son los únicos datos que necesita la parte pública.
    // Usuarios y pedidos se cargan recién cuando hay un administrador.
    const slugCache = STORE_CONFIG.storeId;
    const prodsCache = leerCacheLS("tu_tienda_prods_" + slugCache);
    if (Array.isArray(prodsCache) && prodsCache.length) {
        prods = prodsCache;
        productosListos = true;
        try { render(); } catch (e) { console.warn("render (caché):", e); }
    }
    const heroCache = leerCacheLS("tu_tienda_hero_" + slugCache);
    if (Array.isArray(heroCache) && heroCache.length) {
        heroImages = heroCache;
        try { renderHeroSlider(); } catch (e) { console.warn("hero (caché):", e); }
    }

    db.collection("productos").onSnapshot(snap => {
        prods = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        prods.forEach(p => {
            const base = Array.isArray(p.imagenes) ? p.imagenes : (p.imagen ? [p.imagen] : []);
            p.imagenes = [...new Set(base.map(u => String(u || '').trim()).filter(Boolean))];
            if (typeof p.stock === 'undefined') p.stock = 10;
        });
        productosListos = true;
        guardarCacheLS("tu_tienda_prods_" + slugCache, prods);
        render();
        if (esAdmin) renderAdmP();
        poblarFiltroCompatibilidad();
    }, err => console.warn("productos:", err.code || err));

    db.collection("hero").onSnapshot(snap => {
        heroImages = snap.docs.map((doc, i) => {
            const data = doc.data() || {};
            return { id: doc.id, ...data, _fallbackOrder: i };
        }).sort((a, b) => {
            const ao = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
            const bo = Number.isFinite(Number(b.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
            return ao - bo || a._fallbackOrder - b._fallbackOrder;
        });
        guardarCacheLS("tu_tienda_hero_" + slugCache, heroImages);
        renderHeroSlider();
        if (esAdmin) renderAdmSlider();
    }, err => console.warn("hero:", err.code || err));
}

// ==================== APLICAR CONFIG.JS AL DOM ====================

function aplicarTema() {
    const root = document.documentElement;
    Object.entries(STORE_CONFIG.theme || {}).forEach(([k, v]) => root.style.setProperty(`--${k}`, v));
}

// Aplica una función a un elemento SOLO si existe en el DOM. Evita que un
// solo elemento faltante (por ejemplo, un index.html desactualizado
// respecto a este app.js) corte a mitad de camino toda la función que lo
// usa.
function conEl(id, fn) {
    const el = document.getElementById(id);
    if (el) fn(el);
    else console.warn(`conEl: no se encontró #${id} en el HTML (¿index.html desactualizado?)`);
}

function aplicarBranding() {
    document.title = STORE_CONFIG.storeName;

    // Logo: si no hay logoUrl cargado, mostramos el nombre del comercio en texto
    const tieneLogo = !!STORE_CONFIG.logoUrl;
    document.querySelectorAll(".main-logo, #drawerLogo").forEach(el => {
        el.style.display = tieneLogo ? "" : "none";
        if (tieneLogo) el.src = STORE_CONFIG.logoUrl;
    });
    document.querySelectorAll(".main-logo-text, #drawerLogoText").forEach(el => {
        el.style.display = tieneLogo ? "none" : "";
        el.innerText = STORE_CONFIG.storeName;
    });

    conEl("drawerBrand", el => el.innerText = STORE_CONFIG.storeName);
    conEl("drawerStoreName", el => el.innerText = STORE_CONFIG.storeName);
    conEl("drawerTagline", el => el.innerHTML =
        STORE_CONFIG.tagline + (STORE_CONFIG.city ? `<br>en ${STORE_CONFIG.city}` : ""));

    // Dirección y horarios (solo se muestran si están cargados)
    conEl("drawerDireccion", el => {
        if (STORE_CONFIG.address) { el.innerText = "📍 " + STORE_CONFIG.address; el.style.display = "block"; }
        else el.style.display = "none";
    });
    conEl("drawerHorarios", el => {
        if (STORE_CONFIG.horarios) { el.innerText = "🕒 " + STORE_CONFIG.horarios; el.style.display = "block"; }
        else el.style.display = "none";
    });

    conEl("waLink", el => el.href = `https://wa.me/${STORE_CONFIG.whatsappNumber}`);

    conEl("igLink", el => {
        el.href = STORE_CONFIG.instagramUrl || "#";
        el.style.display = STORE_CONFIG.instagramUrl ? "flex" : "none";
    });
    conEl("fbLink", el => {
        el.href = STORE_CONFIG.facebookUrl || "#";
        el.style.display = STORE_CONFIG.facebookUrl ? "flex" : "none";
    });
    conEl("ttLink", el => {
        el.href = STORE_CONFIG.tiktokUrl || "#";
        el.style.display = STORE_CONFIG.tiktokUrl ? "flex" : "none";
    });

    conEl("footerVersion", el => el.innerText =
        `${STORE_CONFIG.storeName}${STORE_CONFIG.city ? " • " + STORE_CONFIG.city.toUpperCase() : ""}`);

    conEl("regPrompt", el => el.style.display = STORE_CONFIG.features.userRegistration ? "" : "none");

    // Texto según el público al que apunta la tienda (mayorista/minorista/ambos)
    conEl("loginSubtitulo", el => {
        el.innerText = STORE_CONFIG.businessMode === "mayorista"
            ? "Ingresá con tu cuenta mayorista"
            : "Accedé a tu cuenta";
    });
    document.body.classList.toggle("precio-mayorista-oculto", !STORE_CONFIG.features.wholesalePricing);

    conEl("heroSlider", el => el.style.display =
        STORE_CONFIG.features.heroSlider ? "" : "none");

    document.body.classList.toggle("no-stock", !STORE_CONFIG.features.stockControl);
    document.body.classList.toggle("no-variants", !STORE_CONFIG.features.productVariants);
}

// Banner de pausa/mantenimiento y banner promocional (arriba de todo el sitio).
// Si la tienda está pausada, ese banner tiene prioridad y se oculta el
// carrito; el banner promocional no tiene sentido mostrarlo si no se están
// recibiendo pedidos.
function renderBanners() {
    const bannerPausa = document.getElementById("bannerPausa");
    const bannerPromo = document.getElementById("bannerPromo");
    const cartBtn = document.getElementById("cartIconBtn");
    if (!bannerPausa || !bannerPromo) {
        console.warn("renderBanners: faltan #bannerPausa/#bannerPromo en el HTML");
        return;
    }

    if (STORE_CONFIG.pausada) {
        bannerPausa.style.display = "block";
        bannerPromo.style.display = "none";
        if (cartBtn) cartBtn.style.display = "none";
    } else {
        bannerPausa.style.display = "none";
        if (cartBtn) cartBtn.style.display = "";
        if (STORE_CONFIG.bannerActivo && STORE_CONFIG.bannerTexto) {
            bannerPromo.innerText = STORE_CONFIG.bannerTexto;
            bannerPromo.style.background = STORE_CONFIG.bannerBgColor || "var(--promo)";
            bannerPromo.style.color = STORE_CONFIG.bannerTextColor || "#000";
            bannerPromo.style.display = "block";
        } else {
            bannerPromo.style.display = "none";
        }
    }
}

// Aplica todas las opciones de diseño/layout como clases en <body> — todo
// resuelto con CSS (más rápido y sin re-renderizar nada), salvo la
// animación de "volar al carrito" que se maneja aparte en JS.
function aplicarLayout() {
    const l = STORE_CONFIG.layout || {};
    document.body.classList.toggle("catalog-grid1", l.catalogView === "grid1");
    document.body.classList.toggle("catalog-list", l.catalogView === "list");
    document.body.classList.toggle("header-not-sticky", l.headerSticky === false);
    document.body.classList.toggle("header-bar", l.headerStyle === "bar");
    document.body.classList.toggle("img-effect-zoom", l.imageEffect === "zoom");
    document.body.classList.toggle("img-effect-gradient", l.imageEffect === "gradient");
    document.body.classList.toggle("cart-style-modal", l.cartStyle === "modal");
    document.body.classList.toggle("glow-effect", !!l.glowEffect);
}

// ==================== PWA / INSTALACIÓN ====================
// Cada tienda (slug) tiene que instalarse como una app DISTINTA, no como
// la misma para todo el mundo — si no, el navegador las confunde entre sí
// y una instalación puede pisar o reemplazar a otra. Por eso generamos el
// manifest.json al vuelo (con el slug adentro del id/start_url) en vez de
// usar siempre el mismo archivo estático.
let manifestBlobUrlActual = null;
function aplicarManifestPWA() {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link || !STORE_CONFIG || !STORE_CONFIG.storeId) return;

    const base = new URL("index.html", location.href);
    base.search = `?slug=${encodeURIComponent(STORE_CONFIG.storeId)}`;
    const startUrl = base.href;

    const iconUrl = (STORE_CONFIG.pwaIconUrl || "").trim() || new URL("icon-512.png", location.href).href;
    const nombre = (STORE_CONFIG.pwaAppName || "").trim() || STORE_CONFIG.storeName || "Tienda";

    const manifest = {
        name: nombre,
        short_name: nombre.slice(0, 20),
        id: startUrl,
        start_url: startUrl,
        scope: new URL("index.html", location.href).href,
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        background_color: (STORE_CONFIG.theme && STORE_CONFIG.theme.bg) || "#0f172a",
        theme_color: (STORE_CONFIG.theme && STORE_CONFIG.theme.accent) || "#3b82f6",
        icons: [
            { src: iconUrl, sizes: "192x192", type: "image/png", purpose: "any" },
            { src: iconUrl, sizes: "512x512", type: "image/png", purpose: "any" }
        ],
        prefer_related_applications: false,
        lang: "es",
        dir: "ltr"
    };

    const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
    const nuevaUrl = URL.createObjectURL(blob);
    link.href = nuevaUrl;
    // Liberamos el Blob anterior (si lo hubiera) recién después de asignar
    // el nuevo, para no dejar al navegador sin manifest en el medio.
    if (manifestBlobUrlActual) URL.revokeObjectURL(manifestBlobUrlActual);
    manifestBlobUrlActual = nuevaUrl;

    // El ícono para iPhone/iPad (Safari no lee el manifest para esto).
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleIcon) appleIcon.href = iconUrl;
}

function registrarServiceWorker() {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("service-worker.js", { scope: "./", updateViaCache: "none" })
            .then(reg => { if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" }); })
            .catch(e => console.warn("Service worker no registrado:", e));
    }
}

let deferredInstallPrompt = window.__tuTiendaInstallPrompt || null;

function esTiendaInstalada() {
    return !!((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true);
}

function prepararInstalacionPWA() {
    const btn = document.getElementById("btnInstalarApp");
    if (!btn) return;

    if (!STORE_CONFIG.pwaEnabled) {
        btn.style.display = "none";
        return;
    }

    if (esTiendaInstalada()) {
        btn.style.display = "none";
        return;
    }

    // El evento puede haber llegado ANTES de que Firebase terminara de iniciar.
    // Recuperamos la copia capturada en el <head>.
    deferredInstallPrompt = deferredInstallPrompt || window.__tuTiendaInstallPrompt || null;
    btn.style.display = "inline-flex";

    const recibirPrompt = () => {
        deferredInstallPrompt = window.__tuTiendaInstallPrompt || deferredInstallPrompt;
        if (STORE_CONFIG.pwaEnabled && !esTiendaInstalada()) btn.style.display = "inline-flex";
    };
    window.addEventListener("tu-tienda-install-ready", recibirPrompt);
    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        window.__tuTiendaInstallPrompt = null;
        btn.style.display = "none";
    }, { once: true });
}

async function instalarApp() {
    try {
        const slugActual = new URLSearchParams(location.search).get("slug");
        localStorage.setItem("tu_tienda_ultimo_slug", slugActual || localStorage.getItem("tu_tienda_ultimo_slug") || "");
        localStorage.setItem("tu_tienda_pwa_start", location.pathname + location.search);
    } catch (_) {}

    deferredInstallPrompt = deferredInstallPrompt || window.__tuTiendaInstallPrompt || null;
    if (deferredInstallPrompt) {
        try {
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
        } catch (e) {
            console.warn("No se pudo abrir el instalador PWA:", e);
        }
        deferredInstallPrompt = null;
        window.__tuTiendaInstallPrompt = null;
        return;
    }

    const ua = navigator.userAgent || "";
    const esIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const esFirefox = /Firefox\//i.test(ua);

    if (esIOS) {
        alert("En iPhone/iPad, abrí esta tienda en Safari → Compartir (□↑) → «Agregar a pantalla de inicio».");
    } else if (esFirefox) {
        alert("Firefox no ofrece el instalador PWA mediante este botón. Para instalar la tienda como aplicación, abrila con Chrome, Edge u Opera y usá «Instalar aplicación».");
    } else {
        alert("El navegador todavía no habilitó el instalador automático para esta página. Abrí el menú del navegador y buscá «Instalar aplicación» o «Agregar a pantalla de inicio». Si no aparece, recargá la página una vez.");
    }
}

// ==================== EDITOR DE CATEGORÍAS (panel admin → CONFIGURACIÓN) ====================
// Trabaja sobre una copia local (categoriasEditando) y recién se guarda de
// verdad en Firestore al tocar "GUARDAR CONFIGURACIÓN" — así se puede
// reordenar/probar sin ir escribiendo en la base a cada click.

let categoriasEditando = [];

// Pinta la barra de categorías del catálogo público (#catBar) a partir de
// STORE_CONFIG.categories. Cada chip usa setCat() para filtrar productos.
function renderCategorias() {
    const cont = document.getElementById("catBar");
    if (!cont) return;
    const categorias = STORE_CONFIG.categories || [];
    const chipTodos = `<div class="cat-item${filterCat === "" ? " active" : ""}" onclick="setCat(this, '')">🗂️ Todos</div>`;
    const chips = categorias.map(c => `
        <div class="cat-item${filterCat === c.id ? " active" : ""}" onclick="setCat(this, '${String(c.id).replace(/'/g, "\\'")}')">${c.icon || ""} ${(c.label || "").replace(/</g, "&lt;")}</div>
    `).join("");
    cont.innerHTML = chipTodos + chips;
}

// Llena el <select id="fCat"> del formulario de producto (panel admin) con
// las mismas categorías configuradas en STORE_CONFIG.categories.
function renderCategoriasSelect() {
    const sel = document.getElementById("fCat");
    if (!sel) return;
    const categorias = STORE_CONFIG.categories || [];
    const valorPrevio = sel.value;
    sel.innerHTML = categorias.map(c => `<option value="${c.id}">${c.icon || ""} ${(c.label || "").replace(/</g, "&lt;")}</option>`).join("");
    if (categorias.some(c => c.id === valorPrevio)) sel.value = valorPrevio;
}

// ==================== OPEN GRAPH ====================
// OJO: esto actualiza las etiquetas DESPUÉS de que carga la página, así que
// sirve para quien ya abrió el link (título de pestaña, compartir desde el
// navegador) pero NO cambia la vista previa que arma WhatsApp/Facebook al
// pegar el link — esas apps leen el HTML antes de que corra este JS, y este
// sitio es 100% estático (GitHub Pages, sin servidor), así que esa vista
// previa por-tienda no es posible sin agregar un servidor/función edge.
function aplicarOpenGraph() {
    const nombre = STORE_CONFIG.storeName || "Tienda";
    const desc = (STORE_CONFIG.tagline || "").trim() || "Catálogo online — mirá productos, precios y hacé tu pedido por WhatsApp.";
    const imagen = (STORE_CONFIG.pwaIconUrl || STORE_CONFIG.logoUrl || "").trim() || new URL("icon-512.png", location.href).href;
    const url = location.href;

    document.title = nombre;
    const set = (selector, attr, valor) => {
        const el = document.querySelector(selector);
        if (el) el.setAttribute(attr, valor);
    };
    set('meta[name="description"]', "content", desc);
    set('meta[property="og:title"]', "content", nombre);
    set('meta[property="og:site_name"]', "content", nombre);
    set('meta[property="og:description"]', "content", desc);
    set('meta[property="og:image"]', "content", imagen);
    set('meta[property="og:url"]', "content", url);
    set('meta[name="twitter:title"]', "content", nombre);
    set('meta[name="twitter:description"]', "content", desc);
    set('meta[name="twitter:image"]', "content", imagen);
}

function slugCategoria(texto) {
    return normalizarTexto(texto).replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || ('cat-' + Date.now());
}

function cargarCategoriasEditor() {
    categoriasEditando = JSON.parse(JSON.stringify(STORE_CONFIG.categories || []));
    renderCategoriasEditor();
}

function renderCategoriasEditor() {
    const cont = document.getElementById("categoriasEditor");
    if (!cont) return;
    if (categoriasEditando.length === 0) {
        cont.innerHTML = '<p style="opacity:0.4; padding:10px 0;">Todavía no hay categorías cargadas.</p>';
        return;
    }
    cont.innerHTML = categoriasEditando.map((c, i) => `
        <div class="admin-item" style="padding:10px; gap:8px;">
            <input value="${(c.icon || '').replace(/"/g, '&quot;')}" onchange="actualizarCategoria(${i}, 'icon', this.value)" placeholder="🔧" style="width:50px; text-align:center; flex:none;">
            <input value="${(c.label || '').replace(/"/g, '&quot;')}" onchange="actualizarCategoria(${i}, 'label', this.value)" placeholder="Nombre" style="flex:1;">
            <button onclick="moverCategoria(${i}, -1)" ${i === 0 ? 'disabled' : ''} style="background:none; border:none; cursor:pointer; font-size:16px; opacity:${i === 0 ? '0.3' : '1'};">⬆️</button>
            <button onclick="moverCategoria(${i}, 1)" ${i === categoriasEditando.length - 1 ? 'disabled' : ''} style="background:none; border:none; cursor:pointer; font-size:16px; opacity:${i === categoriasEditando.length - 1 ? '0.3' : '1'};">⬇️</button>
            <button onclick="borrarCategoriaEditor(${i})" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:16px;">🗑️</button>
        </div>
    `).join('');
}

function actualizarCategoria(i, campo, valor) {
    if (!categoriasEditando[i]) return;
    categoriasEditando[i][campo] = valor;
}

function agregarCategoriaEditor() {
    const icono = document.getElementById("catNuevoIcono").value.trim();
    const label = document.getElementById("catNuevoLabel").value.trim();
    if (!label) return alert("Escribí un nombre para la categoría");
    let id = slugCategoria(label);
    // Evita chocar con un id ya existente (ej: dos categorías "Ofertas")
    if (categoriasEditando.some(c => c.id === id)) id += '-' + Math.floor(Math.random() * 1000);
    categoriasEditando.push({ id, icon: icono, label });
    document.getElementById("catNuevoIcono").value = "";
    document.getElementById("catNuevoLabel").value = "";
    renderCategoriasEditor();
}

function moverCategoria(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= categoriasEditando.length) return;
    [categoriasEditando[i], categoriasEditando[j]] = [categoriasEditando[j], categoriasEditando[i]];
    renderCategoriasEditor();
}

function borrarCategoriaEditor(i) {
    const cat = categoriasEditando[i];
    if (!cat) return;
    if (!confirm(`¿Eliminar la categoría "${cat.label}"? Los productos que ya la tengan asignada no se borran, pero van a dejar de verse agrupados bajo esa categoría hasta que los reasignes.`)) return;
    categoriasEditando.splice(i, 1);
    renderCategoriasEditor();
}

function mostrarPerfilVacio() {
    document.getElementById("perfilContenido").style.display = "none";
    const vacio = document.getElementById("perfilVacio");
    vacio.style.display = "block";
    vacio.innerHTML = `<div style="font-size:50px; margin-bottom:20px;">👤</div><p>Iniciá sesión para ver tu información y precios especiales.</p>`;
    document.getElementById("logoutBtn").style.display = "none";
}

// Cuando quien inició sesión es el administrador (no un cliente mayorista),
// el cartel de "iniciá sesión para ver tus precios" no aplica — mostramos
// un aviso corto en su lugar.
function mostrarPerfilAdmin() {
    document.getElementById("perfilContenido").style.display = "none";
    const vacio = document.getElementById("perfilVacio");
    vacio.style.display = "block";
    vacio.innerHTML = `<div style="font-size:50px; margin-bottom:20px;">🛠️</div><p>Sesión de administrador iniciada.</p>`;
}

// ==================== NOTIFICACIÓN AUTOMÁTICA POR EMAIL (opcional) ====================
// Usa EmailJS (sin backend propio). Ver README.md → "Notificación
// automática de pedidos" para el paso a paso de configuración.

function inicializarNotificaciones() {
    const n = STORE_CONFIG.notifications;
    if (n && n.emailEnabled && typeof emailjs !== 'undefined' && n.emailJsPublicKey) {
        emailjs.init({ publicKey: n.emailJsPublicKey });
    }
}

function notificarPedidoPorEmail(textoPedido, total) {
    const n = STORE_CONFIG.notifications;
    if (!n || !n.emailEnabled) return;
    if (typeof emailjs === 'undefined') return console.warn("EmailJS no está cargado.");
    if (!n.emailJsServiceId || !n.emailJsTemplateId || !n.adminEmail) {
        return console.warn("Notificaciones por email activadas pero falta completar config.js → notifications.");
    }
    // Si falla, solo lo dejamos en consola: nunca debe romper el checkout,
    // que ya se confirmó igual por WhatsApp y quedó guardado en Firestore.
    emailjs.send(n.emailJsServiceId, n.emailJsTemplateId, {
        to_email: n.adminEmail,
        tienda: STORE_CONFIG.storeName,
        total: total,
        mensaje: textoPedido
    }).catch(err => console.warn("No se pudo enviar el email de notificación:", err));
}

// ==================== HERO SLIDER ====================

function renderHeroSlider() {
    const hero = document.getElementById("heroSlider");
    let content = hero.querySelector('.hero-content');
    if (!content) {
        content = document.createElement('div');
        content.className = 'hero-content';
    }
    content.innerHTML = `<h1>${STORE_CONFIG.storeName}</h1><p>${STORE_CONFIG.tagline}</p>`;
    hero.innerHTML = '';
    hero.appendChild(content);

    if (heroImages.length === 0) {
        const defaultSlide = document.createElement('div');
        defaultSlide.className = 'hero-slide active';
        defaultSlide.style.backgroundImage = "url('https://images.unsplash.com/photo-1542831371-29b0f74f9713?q=80&w=1470&auto=format&fit=crop')";
        hero.appendChild(defaultSlide);
        return;
    }

    heroImages.forEach((slide, index) => {
        const div = document.createElement('div');
        div.className = 'hero-slide';
        if (index === 0) div.classList.add('active');
        div.style.backgroundImage = `url('${slide.url}')`;
        hero.appendChild(div);
    });

    let current = 0;
    if (heroInterval) clearInterval(heroInterval);
    heroInterval = setInterval(() => {
        current = (current + 1) % heroImages.length;
        document.querySelectorAll('.hero-slide')
            .forEach((s, i) => s.classList.toggle('active', i === current));
    }, 5000);
}

function startProductImageRotators() {
    rotators.forEach(clearInterval);
    rotators = [];
    document.querySelectorAll('.product-card').forEach(card => {
        const id = card.getAttribute('data-id');
        const product = prods.find(p => p.id === id);
        if (!product || !product.imagenes || product.imagenes.length <= 1) return;
        let index = 0;
        const imgEl = card.querySelector('.img-box img');
        const interval = setInterval(() => {
            index = (index + 1) % product.imagenes.length;
            imgEl.style.opacity = '0';
            setTimeout(() => {
                imgEl.src = product.imagenes[index];
                imgEl.style.opacity = '1';
            }, 300);
        }, 4500);
        rotators.push(interval);
    });
}

// ==================== CATÁLOGO ====================

// Arma las opciones del filtro Marca/Modelo a partir de los productos que
// tengan compatibilidad cargada. Si ninguno tiene, el filtro queda oculto
// por completo — no todas las tiendas lo necesitan (ej: indumentaria).
function poblarFiltroCompatibilidad() {
    const cont = document.getElementById("filtroCompatContainer");
    const marcaSel = document.getElementById("filtroMarca");
    if (!cont || !marcaSel) return;

    const marcas = new Set();
    prods.forEach(p => (p.compatibilidad || []).forEach(c => { if (c.marca) marcas.add(c.marca); }));

    if (marcas.size === 0) {
        cont.style.display = "none";
        return;
    }
    cont.style.display = "flex";

    const marcaPrevia = marcaSel.value;
    marcaSel.innerHTML = '<option value="">🔧 Todas las marcas</option>' +
        [...marcas].sort().map(m => `<option value="${m}">${m}</option>`).join('');
    if ([...marcas].includes(marcaPrevia)) marcaSel.value = marcaPrevia;

    poblarFiltroModelo();
}

function poblarFiltroModelo() {
    const marcaSel = document.getElementById("filtroMarca");
    const modeloSel = document.getElementById("filtroModelo");
    if (!marcaSel || !modeloSel) return;
    const marca = marcaSel.value;
    const modeloPrevio = modeloSel.value;

    if (!marca) {
        modeloSel.innerHTML = '<option value="">Todos los modelos</option>';
        modeloSel.value = "";
        return;
    }
    const modelos = new Set();
    prods.forEach(p => (p.compatibilidad || []).forEach(c => {
        if (c.marca === marca && c.modelo) modelos.add(c.modelo);
    }));
    modeloSel.innerHTML = '<option value="">Todos los modelos</option>' +
        [...modelos].sort().map(m => `<option value="${m}">${m}</option>`).join('');
    if ([...modelos].includes(modeloPrevio)) modeloSel.value = modeloPrevio;
}

function cambiarFiltroMarca() {
    poblarFiltroModelo();
    render();
}

function render() {
    // Mientras todavía no llegaron los productos, se deja el esqueleto de carga
    // en vez de mostrar "No se encontraron productos..." por un instante.
    if (!productosListos && prods.length === 0) return;
    const query = document.getElementById("searchInput").value.toLowerCase().trim();
    const cont = document.getElementById("productsCont");
    const marcaSel = document.getElementById("filtroMarca");
    const modeloSel = document.getElementById("filtroModelo");
    const marcaElegida = marcaSel ? marcaSel.value : "";
    const modeloElegido = modeloSel ? modeloSel.value : "";
    const filtered = prods.filter(p =>
        p.nombre.toLowerCase().includes(query) &&
        (filterCat === "" || p.categoria === filterCat) &&
        (marcaElegida === "" || (Array.isArray(p.compatibilidad) && p.compatibilidad.some(c =>
            c.marca === marcaElegida && (modeloElegido === "" || c.modelo === modeloElegido)
        )))
    );

    if (filtered.length === 0) {
        cont.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:80px 20px; opacity:0.5;">No se encontraron productos...</div>`;
        return;
    }

    cont.innerHTML = filtered.map((p, idxCard) => {
        const precioActual = isMay ? (p.precio_may || p.precio) : p.precio;
        const firstImg = p.imagenes && p.imagenes.length > 0 ? p.imagenes[0] : (p.imagen || 'https://placehold.co/300x300?text=Sin+imagen');
        const conVariantes = p.tieneVariantes && STORE_CONFIG.features.productVariants;
        const sinStock = p.sinStock || (!conVariantes && Number(p.stock) <= 0);
        const bajoStock = !sinStock && !conVariantes && Number(p.stock) > 0 && Number(p.stock) < 3;
        return `
            <div class="product-card" data-id="${p.id}" onclick="if(!event.target.closest('.btn-add')) showProductDetail('${p.id}')">
                ${p.promo ? `<div class="promo-badge">${p.promo}</div>` : ''}
                ${p.destacado ? `<div class="badge-destacado">⭐ DESTACADO</div>` : ''}
                ${p.nuevo ? `<div class="badge-nuevo">🆕 NUEVO</div>` : ''}
                <div class="img-box">
                    ${sinStock ? `<div class="badge-agotado-overlay"><span>SIN STOCK</span></div>` : ''}
                    <img src="${miniaturaImg(firstImg, 500)}" alt="${p.nombre}" loading="${idxCard < 6 ? 'eager' : 'lazy'}" decoding="async">
                </div>
                <div class="info-box">
                    <div class="prod-title">${p.nombre}</div>
                    <div class="price-val">${STORE_CONFIG.currency}${precioActual}</div>
                    ${conVariantes ? '' : bajoStock ? `<div class="stock-info stock-bajo">⚡ ¡Solo quedan ${p.stock}!</div>` : `<div class="stock-info">Stock: ${p.stock} unidades</div>`}
                    ${sinStock && !conVariantes
                        ? `<button class="btn-add btn-avisar" onclick="event.stopImmediatePropagation(); abrirAvisoStock('${p.id}')">🔔 Avisame cuando haya</button>`
                        : `<button class="btn-add" onclick="event.stopImmediatePropagation(); ${conVariantes ? `showProductDetail('${p.id}')` : `addToCart('${p.id}', event)`}">🛒 ${conVariantes ? 'Ver opciones' : 'Agregar'}</button>`}
                </div>
            </div>`;
    }).join("");
    startProductImageRotators();
}

// ==================== BUSCADOR CON SUGERENCIAS ====================
// Todo client-side, sin servicios externos: coincidencia por texto y, si
// no hay resultados, una tolerancia simple a errores de tipeo.

function normalizarTexto(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function distanciaEdicion(a, b) {
    const dp = [];
    for (let i = 0; i <= a.length; i++) dp.push([i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[a.length][b.length];
}

function actualizarSugerencias() {
    const box = document.getElementById("searchSuggestions");
    if (!box) return;
    const qRaw = document.getElementById("searchInput").value.trim();
    if (!qRaw) { box.style.display = "none"; box.innerHTML = ""; return; }
    const q = normalizarTexto(qRaw);

    let candidatos = prods.filter(p => normalizarTexto(p.nombre).includes(q));
    if (candidatos.length === 0 && q.length >= 3) {
        // Sin coincidencia directa: probamos tolerar un par de errores de tipeo
        candidatos = prods
            .map(p => ({ p, dist: distanciaEdicion(q, normalizarTexto(p.nombre).slice(0, q.length + 3)) }))
            .filter(x => x.dist <= 2)
            .sort((a, b) => a.dist - b.dist)
            .map(x => x.p);
    }
    candidatos = candidatos.slice(0, 6);

    if (candidatos.length === 0) { box.style.display = "none"; box.innerHTML = ""; return; }

    box.innerHTML = candidatos.map(p => {
        const img = (p.imagenes && p.imagenes[0]) ? p.imagenes[0] : (p.imagen || 'https://placehold.co/40x40');
        return `<div class="suggestion-item" onmousedown="elegirSugerencia('${p.id}')">
            <img src="${img}" alt="" loading="lazy">
            <span>${p.nombre}</span>
        </div>`;
    }).join('');
    box.style.display = "block";
}

function elegirSugerencia(id) {
    const p = prods.find(x => x.id === id);
    if (!p) return;
    document.getElementById("searchInput").value = p.nombre;
    document.getElementById("searchSuggestions").style.display = "none";
    render();
}

// Limpia la lista de imágenes de un producto para el modal de detalle:
// saca vacíos/espacios y URLs duplicadas, manteniendo el orden original.
function normalizarImagenesLista(lista) {
    if (!Array.isArray(lista)) return [];
    const vistas = new Set();
    const limpia = [];
    lista.forEach(url => {
        const u = String(url || "").trim();
        if (u && !vistas.has(u)) { vistas.add(u); limpia.push(u); }
    });
    return limpia;
}

async function showProductDetail(id) {
    const p = prods.find(x => x.id === id);
    if (!p) return;
    currentProductId = id;
    currentDetailQty = 1;
    document.getElementById('detailQtyInput').value = 1;

    const imgs = normalizarImagenesLista((p.imagenes && p.imagenes.length > 0) ? [...p.imagenes] : (p.imagen ? [p.imagen] : []));
    if (!imgs.length) imgs.push('https://placehold.co/600x600?text=Sin+imagen');

    document.getElementById('detailImg').src = imgs[0];
    const thumbsContainer = document.getElementById('thumbnails');
    thumbsContainer.innerHTML = '';

    imgs.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = `thumb ${index === 0 ? 'active' : ''}`;
        thumb.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
        thumb.onclick = () => {
            document.getElementById('detailImg').src = url;
            document.querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
        };
        thumbsContainer.appendChild(thumb);
    });

    document.getElementById('detailTitle').innerText = p.nombre;
    const precioAMostrar = isMay ? (p.precio_may || p.precio) : p.precio;
    document.getElementById('detailPrice').innerHTML = `${STORE_CONFIG.currency} <strong>${precioAMostrar}</strong>`;

    // Calculador de descuento por transferencia / cuotas (si el dueño los cargó)
    const descEl = document.getElementById('detailDescuentos');
    if (descEl) {
        const pagosCfg = STORE_CONFIG.pagos || {};
        const filas = [];
        if (pagosCfg.transferencia && pagosCfg.descuentoTransferenciaPct > 0) {
            const conDescuento = Math.round(precioAMostrar * (1 - pagosCfg.descuentoTransferenciaPct / 100));
            filas.push(`<span style="color:var(--success); font-weight:700;">💸 ${pagosCfg.descuentoTransferenciaPct}% OFF por transferencia: ${STORE_CONFIG.currency}${conDescuento}</span>`);
        }
        if (pagosCfg.cuotasCantidad > 0) {
            const montoConRecargo = precioAMostrar * (1 + (pagosCfg.cuotasRecargoPct || 0) / 100);
            const porCuota = Math.round(montoConRecargo / pagosCfg.cuotasCantidad);
            const leyenda = pagosCfg.cuotasRecargoPct > 0 ? '' : ' sin interés';
            filas.push(`<span style="opacity:0.75;">💳 ${pagosCfg.cuotasCantidad} cuotas de ${STORE_CONFIG.currency}${porCuota}${leyenda}</span>`);
        }
        descEl.innerHTML = filas.join('');
        descEl.style.display = filas.length ? 'flex' : 'none';
    }

    // Variantes (talle/color) si el producto y la tienda las tienen activadas
    const varSection = document.getElementById('detailVarianteSection');
    const varSelect = document.getElementById('detailVarianteSelect');
    const detailStockEl = document.getElementById('detailStock');
    const addBtn = document.getElementById('detailAddBtn');
    const avisoBtn = document.getElementById('detailAvisoBtn');
    const qtySection = document.getElementById('detailQtySection');
    if (p.tieneVariantes && STORE_CONFIG.features.productVariants) {
        detailStockEl.style.display = 'none';
        varSection.style.display = 'block';
        qtySection.style.display = '';
        addBtn.style.display = '';
        avisoBtn.style.display = 'none';
        varSelect.innerHTML = '<option value="">Cargando...</option>';
        try {
            const snap = await db.collection("productos").doc(id).collection("variantes").orderBy("orden").get();
            currentVariantes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            console.error(e);
            currentVariantes = [];
        }
        varSelect.innerHTML = currentVariantes.length === 0
            ? '<option value="">Sin opciones disponibles</option>'
            : '<option value="">Elegí una opción...</option>' + currentVariantes.map(v =>
                `<option value="${v.nombre}" ${v.stock <= 0 ? 'disabled' : ''}>${v.nombre} ${v.stock > 0 ? `(${v.stock} disp.)` : '(sin stock)'}</option>`
              ).join('');
    } else {
        currentVariantes = [];
        varSection.style.display = 'none';
        detailStockEl.style.display = '';
        const sinStock = p.sinStock || Number(p.stock) <= 0;
        const bajoStock = !sinStock && Number(p.stock) > 0 && Number(p.stock) < 3;
        detailStockEl.innerHTML = bajoStock
            ? `<strong style="color:var(--promo);">⚡ ¡Solo quedan ${p.stock} disponibles!</strong>`
            : `Stock: <strong>${p.stock}</strong>`;
        if (sinStock) {
            qtySection.style.display = 'none';
            addBtn.style.display = 'none';
            avisoBtn.style.display = '';
        } else {
            qtySection.style.display = '';
            addBtn.style.display = '';
            avisoBtn.style.display = 'none';
        }
    }

    document.getElementById('detailDesc').innerHTML = p.descripcion?.replace(/\n/g, '<br>') || '';
    document.getElementById('detailCaract').innerHTML = p.caracteristicas?.replace(/\n/g, '<br>') || '';
    document.getElementById('detailFicha').innerHTML = p.ficha?.replace(/\n/g, '<br>') || '';

    // Ocultar secciones vacías del detalle (descripción / características / ficha)
    const detailLinks = document.getElementById('detailLinks');
    const detailLinksSection = document.getElementById('detailLinksSection');
    const links = normalizarLinksProducto(p.linksDescarga || p.downloadLinks || p.enlaces || p.links || []);
    if (detailLinks && detailLinksSection) {
        detailLinks.innerHTML = links.length
            ? links.map((link, i) => `<a class="download-link-btn" href="${link.url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">⬇️ ${link.nombre || `Descarga ${i + 1}`}</a>`).join('')
            : '';
        detailLinksSection.style.display = links.length ? '' : 'none';
    }

    document.querySelectorAll('#productDetailModal .detail-sections details').forEach(det => {
        const content = det.querySelector('.detail-content');
        det.style.display = (content && content.innerHTML.trim()) ? '' : 'none';
    });

    document.getElementById('productDetailModal').style.display = 'flex';
    document.body.classList.add("modal-open");
}

function changeDetailQty(delta) {
    let qty = parseInt(document.getElementById('detailQtyInput').value) || 1;
    qty = Math.max(1, qty + delta);
    document.getElementById('detailQtyInput').value = qty;
    currentDetailQty = qty;
}

function closeProductDetail() {
    document.getElementById('productDetailModal').style.display = 'none';
    document.body.classList.remove("modal-open");
    currentProductId = null;
}

function addCurrentToCart() {
    if (!currentProductId) return;
    const p = prods.find(x => x.id === currentProductId);
    if (!p) return;

    let variante = null;
    if (p.tieneVariantes && STORE_CONFIG.features.productVariants) {
        variante = document.getElementById('detailVarianteSelect').value;
        if (!variante) return alert("Elegí una opción antes de agregar al carrito");
        const v = currentVariantes.find(x => x.nombre === variante);
        if (!v || v.stock < currentDetailQty) return alert(`❌ Solo quedan ${v ? v.stock : 0} unidades de "${variante}"`);
    } else {
        if (p.stock < currentDetailQty) return alert(`❌ Solo quedan ${p.stock} unidades`);
    }

    const exist = cart.find(i => i.id === currentProductId && (i.variante || null) === variante);
    if (exist) exist.qty += currentDetailQty;
    else cart.push({id: currentProductId, qty: currentDetailQty, variante});
    updateCartUI();
    vibrar();
    animarAgregarCarrito(document.getElementById('detailImg'));
    closeProductDetail();
}

// Vibración táctil sutil (solo funciona en Android/Chrome — iOS Safari no
// soporta la API de vibración, así que ahí simplemente no hace nada).
function vibrar(ms = 35) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {}
}

// ==================== AVISOS DE STOCK ====================
let avisoStockProductoId = null;

function abrirAvisoStock(id) {
    const p = prods.find(x => x.id === id);
    if (!p) return;
    avisoStockProductoId = id;
    document.getElementById("avisoStockProducto").innerText = p.nombre;
    document.getElementById("avisoStockTel").value = "";
    openModal("avisoStockModal");
}

async function confirmarAvisoStock() {
    const tel = document.getElementById("avisoStockTel").value.trim().replace(/[^0-9]/g, '');
    if (!tel || tel.length < 6) return alert("Ingresá un WhatsApp válido");
    const p = prods.find(x => x.id === avisoStockProductoId);
    if (!p) return;
    try {
        await db.collection("avisosStock").add({
            productoId: p.id,
            productoNombre: p.nombre,
            contacto: tel,
            fecha: Date.now(),
            avisado: false
        });
        closeAll();
        alert("✅ Listo — te avisamos por WhatsApp apenas haya stock.");
    } catch (e) {
        console.error(e);
        alert("No pudimos guardar tu aviso. Probá de nuevo en un momento.");
    }
}

function addToCart(id, evt) {
    const p = prods.find(x => x.id === id);
    if (!p) return;
    if (p.tieneVariantes && STORE_CONFIG.features.productVariants) return showProductDetail(id);
    if (p.stock < 1) return alert("Stock insuficiente");
    const exist = cart.find(i => i.id === id && !i.variante);
    if (exist) exist.qty++;
    else cart.push({id, qty: 1, variante: null});
    updateCartUI();
    vibrar();
    const origenCard = evt && evt.target && evt.target.closest ? evt.target.closest('.product-card') : null;
    animarAgregarCarrito(origenCard ? origenCard.querySelector('.img-box img') : null);
}

function showToast() {
    const toast = document.getElementById("toast");
    toast.style.display = "flex";
    setTimeout(() => toast.style.display = "none", 2200);
}

// ==================== ANIMACIÓN AL AGREGAR AL CARRITO ====================

function animarAgregarCarrito(imgOrigen) {
    const anim = (STORE_CONFIG.layout && STORE_CONFIG.layout.addToCartAnim) || "banner";

    if (anim === "shake") {
        sacudirIconoCarrito();
        showToast();
    } else if (anim === "fly" && imgOrigen) {
        volarAlCarrito(imgOrigen);
    } else {
        showToast(); // "banner" (default) o fallback si no hay imagen de origen para "fly"
    }
}

function sacudirIconoCarrito() {
    const cartBtn = document.getElementById("cartIconBtn");
    if (!cartBtn) return;
    cartBtn.classList.remove("shake-cart");
    void cartBtn.offsetWidth; // fuerza reflow para poder repetir la animación seguidas veces
    cartBtn.classList.add("shake-cart");
    setTimeout(() => cartBtn.classList.remove("shake-cart"), 450);
}

// Clona la imagen del producto y la anima "volando" hasta el ícono del
// carrito. Puramente visual — no afecta el carrito en sí (eso ya se hizo
// antes de llamar a esta función).
function volarAlCarrito(imgOrigen) {
    const cartBtn = document.getElementById("cartIconBtn");
    if (!cartBtn || !imgOrigen) { showToast(); return; }

    const rectOrigen = imgOrigen.getBoundingClientRect();
    const rectDestino = cartBtn.getBoundingClientRect();
    if (rectOrigen.width === 0 || rectDestino.width === 0) { showToast(); return; }

    const clon = imgOrigen.cloneNode(true);
    clon.style.position = "fixed";
    clon.style.left = rectOrigen.left + "px";
    clon.style.top = rectOrigen.top + "px";
    clon.style.width = rectOrigen.width + "px";
    clon.style.height = rectOrigen.height + "px";
    clon.style.borderRadius = "12px";
    clon.style.objectFit = "cover";
    clon.style.zIndex = "9999";
    clon.style.pointerEvents = "none";
    clon.style.transition = "left 0.6s cubic-bezier(0.4,0,0.2,1), top 0.6s cubic-bezier(0.4,0,0.2,1), width 0.6s, height 0.6s, opacity 0.6s";
    document.body.appendChild(clon);

    requestAnimationFrame(() => {
        clon.style.left = (rectDestino.left + rectDestino.width / 2 - 15) + "px";
        clon.style.top = (rectDestino.top + rectDestino.height / 2 - 15) + "px";
        clon.style.width = "30px";
        clon.style.height = "30px";
        clon.style.opacity = "0.2";
    });

    setTimeout(() => {
        clon.remove();
        sacudirIconoCarrito();
    }, 620);
}

// ==================== CARRITO ====================

function updateCartUI() {
    let total = 0;
    let count = 0;
    const list = document.getElementById("cartItems");
    list.innerHTML = cart.map((item, idx) => {
        const p = prods.find(x => x.id === item.id);
        if (!p) return "";
        const precio = isMay ? (p.precio_may || p.precio) : p.precio;
        const sub = precio * item.qty;
        total += sub;
        count += item.qty;
        return `
            <div style="padding:18px 0; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center;">
                <div style="flex:1;">
                    <div style="font-weight:700; font-size:14px; margin-bottom:4px;">${p.nombre}${item.variante ? ` <span style="opacity:0.6; font-weight:500;">(${item.variante})</span>` : ''}</div>
                    <div style="color:var(--accent); font-weight:800;">${STORE_CONFIG.currency}${sub}</div>
                </div>
                <div style="display:flex; align-items:center; gap:12px;">
                    <button class="qty-btn" onclick="changeQty(${idx}, -1)" style="background:#64748b;">−</button>
                    <b style="min-width:25px; text-align:center;">${item.qty}</b>
                    <button class="qty-btn" onclick="changeQty(${idx}, 1)">+</button>
                </div>
            </div>`;
    }).join("");
    document.getElementById("cartTotal").innerText = STORE_CONFIG.currency + total;
    document.getElementById("cartCount").innerText = count;
}

function changeQty(idx, delta) {
    const item = cart[idx];
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) cart.splice(idx, 1);
    updateCartUI();
}

// ==================== AUTENTICACIÓN (Firebase Auth real) ====================

async function doLogin() {
    const u = document.getElementById("uInp").value.trim();
    const p = document.getElementById("pInp").value.trim();
    if (!u || !p) return alert("Completá usuario y contraseña");
    try {
        await auth.signInWithEmailAndPassword(toAuthEmail(u), p);
        closeAll();
    } catch (e) {
        console.error(e);
        alert("Usuario o contraseña incorrectos.");
    }
}

async function recuperarClave() {
    const u = document.getElementById("uInp").value.trim();
    if (!u.includes("@")) {
        return alert("Esta opción es para cuentas con email real (por ejemplo, la del administrador). Si sos cliente mayorista y olvidaste tu contraseña, pedile al administrador que te dé de alta de nuevo.");
    }
    try {
        await auth.sendPasswordResetEmail(u.toLowerCase());
        alert("Te enviamos un email para restablecer tu contraseña.");
    } catch (e) {
        console.error(e);
        alert("No pudimos enviar el email. Verificá que esté bien escrito.");
    }
}

function llenarPerfil(data) {
    document.getElementById("perfilContenido").style.display = "block";
    document.getElementById("perfilVacio").style.display = "none";
    document.getElementById("logoutBtn").style.display = "block";
    document.getElementById("p-user").innerText = data.user;
    document.getElementById("p-tel").innerText = data.tel || "--";
    document.getElementById("p-dir").innerText = data.dir || "Sin dirección registrada";
    document.getElementById("misPedidosList").innerHTML = ""; // se carga recién al tocar el botón

    // El cartel de "mayorista" solo tiene sentido si la tienda vende con
    // precios mayoristas. En una tienda solo minorista, esto no debe
    // mencionar la palabra "mayorista" para nada.
    const estadoEl = document.getElementById("p-estadoMayorista");
    if (estadoEl) {
        if (STORE_CONFIG.features.wholesalePricing) {
            estadoEl.style.display = "block";
            estadoEl.innerText = "✓ ESTADO: CLIENTE MAYORISTA ACTIVO";
        } else {
            estadoEl.style.display = "block";
            estadoEl.innerText = "✓ CUENTA ACTIVA";
        }
    }
}

// Le muestra al cliente logueado sus propios pedidos (las reglas de
// Firestore solo dejan leer pedidos donde clienteUid == su propio uid).
// Los pedidos hechos antes de esta actualización no tienen ese campo, así
// que no van a aparecer acá — es una limitación de los datos viejos, no
// un error.
// ==================== SEGUIMIENTO DE ESTADO DEL PEDIDO ====================
const ESTADOS_PEDIDO = [
    { id: "recibido", label: "Recibido", icon: "📥" },
    { id: "preparacion", label: "En preparación", icon: "📦" },
    { id: "despachado", label: "Despachado", icon: "🚀" }
];

function renderEstadoPedidoHTML(estadoActual) {
    const idx = Math.max(0, ESTADOS_PEDIDO.findIndex(e => e.id === (estadoActual || "recibido")));
    return `<div class="estado-pedido-track">
        ${ESTADOS_PEDIDO.map((e, i) => `
            <div class="estado-pedido-step ${i <= idx ? 'activo' : ''}">
                <span class="estado-pedido-dot">${i < idx ? '✓' : e.icon}</span>
                <span class="estado-pedido-label">${e.label}</span>
            </div>
            ${i < ESTADOS_PEDIDO.length - 1 ? `<div class="estado-pedido-line ${i < idx ? 'activo' : ''}"></div>` : ''}
        `).join('')}
    </div>`;
}

async function verMisPedidos() {
    if (!usuarioLogueado) return;
    const cont = document.getElementById("misPedidosList");
    cont.innerHTML = '<p style="opacity:0.5; text-align:center; padding:20px;">Cargando...</p>';
    try {
        const snap = await db.collection("pedidos").where("clienteUid", "==", usuarioLogueado.id).get();
        const propios = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.fecha - a.fecha);
        if (propios.length === 0) {
            cont.innerHTML = '<p style="opacity:0.5; text-align:center; padding:20px;">Todavía no hiciste ningún pedido.</p>';
            return;
        }
        cont.innerHTML = propios.map(o => `
            <div class="admin-item" style="flex-direction:column; align-items:flex-start;">
                <div class="flex-between" style="width:100%;">
                    <b style="color:var(--accent);">${o.total}</b>
                    <small>${new Date(o.fecha).toLocaleDateString('es-ES')}</small>
                </div>
                ${renderEstadoPedidoHTML(o.estado)}
                <div style="font-size:12px; opacity:0.7; white-space:pre-wrap; margin-top:6px;">${o.detalle}</div>
            </div>
        `).join('');
    } catch (e) {
        console.error(e);
        cont.innerHTML = '<p style="opacity:0.5; text-align:center; padding:20px;">No pudimos cargar tus pedidos.</p>';
    }
}

// Abre el modal de registro adaptado al modo de la tienda: si vende con
// precios mayoristas, pide los datos del comercio y la cuenta queda
// pendiente de aprobación (así el dueño decide quién ve esos precios). Si
// es solo minorista, no hay nada que aprobar — se salta ese paso y la
// cuenta queda activa al toque, solo para historial de pedidos.
function abrirRegistro() {
    const esMayorista = !!STORE_CONFIG.features.wholesalePricing;
    document.getElementById("regTitulo").innerText = esMayorista ? "Nueva Solicitud" : "Creá tu cuenta";
    document.getElementById("regSubtitulo").innerText = esMayorista ? "Completá los datos de tu comercio" : "Para ver tu historial de pedidos";
    document.getElementById("regDireccionGroup").style.display = esMayorista ? "block" : "none";
    document.getElementById("regBtnEnviar").innerText = esMayorista ? "ENVIAR PARA REVISIÓN" : "CREAR CUENTA";
    openModal("regModal");
}

async function registrarUsuario() {
    if (!STORE_CONFIG.features.userRegistration) {
        return alert("Esta tienda no acepta registro de cuentas en este momento.");
    }
    const esMayorista = !!STORE_CONFIG.features.wholesalePricing;
    const u = document.getElementById("rU").value.trim();
    const p = document.getElementById("rP").value.trim();
    const t = document.getElementById("rT").value.trim();
    const d = document.getElementById("rD").value.trim();
    if (!u || !p || !t || (esMayorista && !d)) return alert("Completá todos los campos");
    if (u.includes("@")) return alert("El nombre de usuario no puede contener '@'.");
    if (p.length < 6) return alert("La contraseña debe tener al menos 6 caracteres");

    try {
        const cred = await auth.createUserWithEmailAndPassword(toAuthEmail(u), p);
        await db.collection("usuarios").doc(cred.user.uid).set({
            user: u, tel: t, dir: d, activo: !esMayorista, fecha: Date.now()
        });
        if (esMayorista) {
            await auth.signOut(); // que no quede logueado hasta ser aprobado
            alert("✅ Solicitud enviada correctamente. Esperá la validación.");
        } else {
            alert("✅ ¡Cuenta creada! Ya podés ver tu historial de pedidos.");
        }
        closeAll();
        document.querySelectorAll('#regModal input, #regModal textarea').forEach(i => i.value = "");
    } catch (e) {
        console.error(e);
        if (e.code === 'auth/email-already-in-use') alert("Ese nombre de usuario ya está en uso.");
        else if (e.code === 'auth/weak-password') alert("La contraseña es muy débil (mínimo 6 caracteres).");
        else if (e.code === 'auth/operation-not-allowed') alert("El login por usuario/contraseña no está habilitado en este proyecto de Firebase todavía (Authentication → Sign-in method → Email/Password).");
        else if (e.code === 'permission-denied') alert("Las reglas de seguridad de Firestore de esta tienda no dejan completar el registro. Revisá que esté pegado el firestore.rules más reciente.");
        else alert("Error al enviar la solicitud" + (e.code ? " (" + e.code + ")" : "") + ". Si persiste, revisá la consola del navegador (F12) para más detalle.");
    }
}

// ==================== PRIMER INGRESO — CREAR CUENTA DE ADMINISTRADOR ====================
// No hay usuario/contraseña "de fábrica" en el código (sería inseguro:
// quedaría visible para cualquiera que vea el código fuente). En cambio,
// el dueño de la tienda crea su propia cuenta acá, protegida por dos
// candados: que su email coincida con el que se autorizó en Firestore
// (config/setup → allowedAdminEmail) y que lo verifique de verdad
// haciendo clic en el link que le llega por correo. Ver README.md →
// "Alta de un cliente nuevo".

async function crearCuentaAdmin() {
    const email = document.getElementById("setupEmail").value.trim().toLowerCase();
    const pass = document.getElementById("setupPass").value.trim();
    if (!email.includes("@")) return alert("Ingresá un email válido");
    if (pass.length < 6) return alert("La contraseña debe tener al menos 6 caracteres");

    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await cred.user.sendEmailVerification();
        document.getElementById("setupPaso1").style.display = "none";
        document.getElementById("setupPaso2").style.display = "block";
    } catch (e) {
        console.error(e);
        if (e.code === 'auth/email-already-in-use') alert("Ya existe una cuenta con ese email. Si es tuya, iniciá sesión normalmente desde 'Usuario (o email de administrador)'.");
        else alert("No pudimos crear la cuenta: " + (e.message || e));
    }
}

async function confirmarAdminVerificado() {
    if (!auth.currentUser) return alert("Se cerró la sesión. Volvé a intentar desde 'Crear cuenta'.");
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true); // refresca el token para que email_verified esté al día
    if (!auth.currentUser.emailVerified) {
        return alert("Todavía no verificaste tu email. Revisá tu bandeja de entrada (y spam) y volvé a intentar.");
    }
    try {
        await db.collection("admins").doc(auth.currentUser.uid).set({
            email: auth.currentUser.email, creado: Date.now()
        });
        alert("✅ ¡Listo! Ya sos administrador de esta tienda. La página se va a recargar para activarlo.");
        location.reload(); // fuerza a re-resolver esAdmin ahora que el documento ya existe
    } catch (e) {
        console.error(e);
        alert("Ese email (" + auth.currentUser.email + ") no está autorizado como administrador de esta tienda. Verificá que sea EXACTAMENTE igual al campo allowedAdminEmail en config/setup de este proyecto.");
    }
}

// ==================== PANEL ADMIN — PRODUCTOS ====================

const UMBRAL_STOCK_BAJO = 3; // productos con menos unidades que esto se resaltan en rojo

function renderAdmP() {
    const list = document.getElementById("admListP");
    if (!list) return;
    const q = normalizarTexto((document.getElementById("adminProductSearch")?.value || "").trim());
    const filtered = q ? prods.filter(p => {
        const hay = [p.nombre, p.categoria, p.descripcion, p.caracteristicas, p.ficha].map(normalizarTexto).join(" ");
        return hay.includes(q);
    }) : prods;
    const count = document.getElementById("adminProductCount");
    if (count) count.textContent = q ? `${filtered.length} de ${prods.length}` : `${prods.length} productos`;
    list.innerHTML = filtered.length === 0
        ? `<p style="text-align:center; padding:40px; opacity:0.4;">No se encontraron productos.</p>`
        : filtered.map(p => {
            const firstImg = p.imagenes && p.imagenes.length > 0 ? p.imagenes[0] : (p.imagen || 'https://placehold.co/70x70');
            const stockBajo = !p.tieneVariantes && typeof p.stock === 'number' && p.stock < UMBRAL_STOCK_BAJO;
            return `
            <div class="admin-item" style="${stockBajo ? 'border-left:4px solid var(--danger); background:rgba(239,68,68,0.08);' : ''}">
                <img src="${firstImg}" class="admin-item-img" alt="${p.nombre}" loading="lazy">
                <div style="flex:1; min-width:0;">
                    <b>${p.nombre}</b><br>
                    <small>${STORE_CONFIG.currency}${p.precio} (May: ${STORE_CONFIG.currency}${p.precio_may || p.precio})${p.tieneVariantes ? ' | Con variantes' : ` | Stock: ${p.stock}`}</small>
                    ${stockBajo ? ' <span style="color:var(--danger); font-weight:800; font-size:11px;">⚠️ STOCK BAJO</span>' : ''}<br>
                    <span style="background:#334155; color:white; padding:2px 8px; border-radius:9999px; font-size:11px;">${p.categoria || 'sin categoría'}</span>
                </div>
                <div>
                    <button onclick="abrirGeneradorBanner('${p.id}')" title="Crear banner para redes" style="font-size:18px; margin-right:8px; cursor:pointer; background:none; border:none;">🎨</button>
                    <button onclick="editP('${p.id}')" title="Editar" style="font-size:18px; margin-right:8px; cursor:pointer; background:none; border:none;">✏️</button>
                    <button onclick="del('productos','${p.id}')" title="Eliminar" style="color:var(--danger); font-size:18px; cursor:pointer; background:none; border:none;">🗑️</button>
                </div>
            </div>`;
        }).join("");
}

// ==================== GALERÍA DE IMÁGENES DEL PRODUCTO (panel admin) ====================
// Estas 3 funciones faltaban por completo en el archivo: el botón
// "+ AGREGAR IMAGEN" no hacía nada y al guardar el producto no se
// mandaban imágenes, por eso el catálogo público mostraba todo en blanco.

function cargarImagenesProducto(imagenes = []) {
    const cont = document.getElementById("imagenesProducto");
    if (!cont) return;
    cont.innerHTML = "";
    const lista = Array.isArray(imagenes) ? imagenes.filter(u => (u || "").trim()) : [];
    if (lista.length === 0) {
        agregarImagenProducto();
        return;
    }
    lista.forEach(url => agregarImagenProducto(url));
}

function agregarImagenProducto(url = "") {
    const cont = document.getElementById("imagenesProducto");
    if (!cont) return;
    const row = document.createElement("div");
    row.className = "image-url-row";
    row.innerHTML = `
        <span class="image-number"></span>
        <input class="image-url-input" type="url" placeholder="https://i.postimg.cc/..." value="${String(url).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}">
        <button type="button" title="Eliminar imagen" aria-label="Eliminar imagen">✕</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
        row.remove();
        const cont2 = document.getElementById("imagenesProducto");
        if (cont2 && !cont2.querySelector(".image-url-row")) agregarImagenProducto();
        renumerarImagenesProducto();
    });
    cont.appendChild(row);
    renumerarImagenesProducto();
}

function renumerarImagenesProducto() {
    const cont = document.getElementById("imagenesProducto");
    if (!cont) return;
    [...cont.querySelectorAll(".image-url-row")].forEach((row, i) => {
        const num = row.querySelector(".image-number");
        if (num) num.textContent = i + 1;
    });
}

function obtenerImagenesProducto() {
    const cont = document.getElementById("imagenesProducto");
    if (!cont) return [];
    return [...cont.querySelectorAll(".image-url-input")].map(inp => inp.value.trim()).filter(Boolean);
}

// ==================== DATOS DE TRANSFERENCIA (formato de filas) ====================
// Antes era un textarea donde había que escribir "CBU: ...\nAlias: ..." todo
// junto. Ahora es una fila por dato (etiqueta + valor), igual que los links
// de descarga. Acepta el formato viejo (texto plano) y lo convierte solo,
// así las tiendas que ya tenían datos cargados no pierden nada.
function normalizarDatosTransferencia(datos) {
    if (Array.isArray(datos)) {
        return datos.map(d => ({
            etiqueta: String((d || {}).etiqueta || (d || {}).label || "").trim(),
            valor: String((d || {}).valor || (d || {}).value || "").trim()
        })).filter(x => x.valor);
    }
    // Formato viejo: un solo bloque de texto con una línea por dato.
    if (typeof datos === "string" && datos.trim()) {
        return datos.split("\n").map(linea => {
            const l = linea.trim();
            if (!l) return null;
            const i = l.indexOf(":");
            if (i > 0) return { etiqueta: l.slice(0, i).trim(), valor: l.slice(i + 1).trim() };
            return { etiqueta: "", valor: l };
        }).filter(x => x && x.valor);
    }
    return [];
}

function obtenerDatosTransferencia() {
    const cont = document.getElementById("datosTransferenciaLista");
    if (!cont) return [];
    return [...cont.querySelectorAll(".transfer-row")].map(row => ({
        etiqueta: row.querySelector(".transfer-label")?.value.trim() || "",
        valor: row.querySelector(".transfer-value")?.value.trim() || ""
    })).filter(x => x.valor);
}

function renderDatosTransferencia(datos = []) {
    const cont = document.getElementById("datosTransferenciaLista");
    if (!cont) return;
    const lista = normalizarDatosTransferencia(datos);
    cont.innerHTML = "";
    if (lista.length === 0) {
        agregarDatoTransferencia();
        return;
    }
    lista.forEach(d => agregarDatoTransferencia(d.etiqueta, d.valor));
}

function agregarDatoTransferencia(etiqueta = "", valor = "") {
    const cont = document.getElementById("datosTransferenciaLista");
    if (!cont) return;
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const row = document.createElement("div");
    row.className = "download-link-row transfer-row";
    row.innerHTML = `
        <input class="download-link-name transfer-label" placeholder="Dato (ej: CBU)" value="${esc(etiqueta)}">
        <input class="download-link-url transfer-value" placeholder="Valor (ej: 0000003100010000000001)" value="${esc(valor)}">
        <button type="button" title="Eliminar dato" aria-label="Eliminar dato">✕</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
        row.remove();
        const cont2 = document.getElementById("datosTransferenciaLista");
        if (cont2 && !cont2.querySelector(".transfer-row")) agregarDatoTransferencia();
    });
    cont.appendChild(row);
}

// Convierte las filas al texto que se manda por WhatsApp.
function textoDatosTransferencia(datos) {
    return normalizarDatosTransferencia(datos)
        .map(d => d.etiqueta ? `${d.etiqueta}: ${d.valor}` : d.valor)
        .join("\n");
}

// ==================== COMPATIBILIDAD (Marca/Modelo) ====================
function normalizarCompatibilidad(lista) {
    if (!Array.isArray(lista)) return [];
    return lista.map(x => ({
        marca: String((x || {}).marca || "").trim(),
        modelo: String((x || {}).modelo || "").trim()
    })).filter(x => x.marca);
}

function obtenerCompatibilidad() {
    const cont = document.getElementById("compatibilidadLista");
    if (!cont) return [];
    return [...cont.querySelectorAll(".download-link-row")].map(row => ({
        marca: row.querySelector(".compat-marca")?.value.trim() || "",
        modelo: row.querySelector(".compat-modelo")?.value.trim() || ""
    })).filter(x => x.marca);
}

function renderCompatibilidad(lista = []) {
    const cont = document.getElementById("compatibilidadLista");
    if (!cont) return;
    const items = normalizarCompatibilidad(lista);
    cont.innerHTML = "";
    if (items.length === 0) { agregarCompatibilidad(); return; }
    items.forEach(x => agregarCompatibilidad(x.marca, x.modelo));
}

function agregarCompatibilidad(marca = "", modelo = "") {
    const cont = document.getElementById("compatibilidadLista");
    if (!cont) return;
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const row = document.createElement("div");
    row.className = "download-link-row";
    row.innerHTML = `
        <input class="download-link-name compat-marca" placeholder="Marca (ej: Samsung)" value="${esc(marca)}">
        <input class="download-link-url compat-modelo" placeholder="Modelo (ej: Galaxy A32)" value="${esc(modelo)}">
        <button type="button" title="Eliminar" aria-label="Eliminar">✕</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
        row.remove();
        const cont2 = document.getElementById("compatibilidadLista");
        if (cont2 && !cont2.querySelector(".download-link-row")) agregarCompatibilidad();
    });
    cont.appendChild(row);
}

function normalizarLinksProducto(links) {
    if (!Array.isArray(links)) return [];
    return links.map(link => {
        if (typeof link === "string") return { nombre: "Link de descarga", url: link.trim() };
        const x = link || {};
        return {
            nombre: String(x.nombre || x.name || x.titulo || "").trim(),
            url: String(x.url || x.href || x.link || "").trim()
        };
    }).filter(x => x.url);
}

function obtenerLinksProducto() {
    const cont = document.getElementById("linksDescargaProducto");
    if (!cont) return [];
    return [...cont.querySelectorAll(".download-link-row")].map(row => ({
        nombre: row.querySelector(".download-link-name")?.value.trim() || "Link de descarga",
        url: row.querySelector(".download-link-url")?.value.trim() || ""
    })).filter(x => x.url);
}

function renderLinksProducto(links = []) {
    const cont = document.getElementById("linksDescargaProducto");
    if (!cont) return;
    const lista = normalizarLinksProducto(links);
    cont.innerHTML = "";
    if (lista.length === 0) {
        agregarLinkProducto();
        return;
    }
    lista.forEach(link => agregarLinkProducto(link.nombre, link.url));
}

function agregarLinkProducto(nombre = "", url = "") {
    const cont = document.getElementById("linksDescargaProducto");
    if (!cont) return;
    const row = document.createElement("div");
    row.className = "download-link-row";
    row.innerHTML = `
        <input class="download-link-name" placeholder="Nombre (ej: Parte 1)" value="${String(nombre).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')}">
        <input class="download-link-url" type="url" placeholder="URL de descarga" value="${String(url).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')}">
        <button type="button" title="Eliminar link" aria-label="Eliminar link">✕</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
        row.remove();
        const cont2 = document.getElementById("linksDescargaProducto");
        if (cont2 && !cont2.querySelector(".download-link-row")) agregarLinkProducto();
    });
    cont.appendChild(row);
}

async function saveP() {
    const id = document.getElementById("fId").value;
    const nom = document.getElementById("fNom").value.trim();
    if (!nom) return alert("El nombre del producto es obligatorio");

    const imagenes = obtenerImagenesProducto();

    // Variantes: una por línea, formato "Nombre | Stock" (ej: "M | 8")
    const variantesRaw = document.getElementById("fVariantes").value.trim();
    const variantesParsed = variantesRaw ? variantesRaw.split('\n').map(line => {
        const [nombreV, stockStr] = line.split('|').map(s => (s || '').trim());
        return nombreV ? { nombre: nombreV, stock: parseInt(stockStr) || 0 } : null;
    }).filter(Boolean) : [];

    const data = {
        nombre: nom,
        precio: parseFloat(document.getElementById("fPre").value) || 0,
        precio_may: parseFloat(document.getElementById("fPreMay").value) || 0,
        stock: parseInt(document.getElementById("fStock").value) || 0,
        promo: document.getElementById("fPro").value.trim(),
        destacado: document.getElementById("fDestacado").checked,
        nuevo: document.getElementById("fNuevo").checked,
        sinStock: document.getElementById("fSinStock").checked,
        categoria: document.getElementById("fCat").value.trim().toLowerCase(),
        imagenes: imagenes,
        descripcion: document.getElementById("fDesc").value.trim(),
        caracteristicas: document.getElementById("fCaract").value.trim(),
        ficha: document.getElementById("fFicha").value.trim(),
        linksDescarga: obtenerLinksProducto(),
        compatibilidad: obtenerCompatibilidad(),
        tieneVariantes: variantesParsed.length > 0
    };

    try {
        let productId = id;
        if (id) {
            await db.collection("productos").doc(id).update(data);
        } else {
            const ref = await db.collection("productos").add(data);
            productId = ref.id;
        }

        // Sincronizar la subcolección de variantes: se reemplaza entera por los
        // valores actuales del formulario (que se precargan siempre con datos
        // en vivo desde editP, así que no se pisa stock real por accidente).
        const varCol = db.collection("productos").doc(productId).collection("variantes");
        const oldSnap = await varCol.get();
        const syncBatch = db.batch();
        oldSnap.forEach(doc => syncBatch.delete(doc.ref));
        variantesParsed.forEach((v, i) => {
            syncBatch.set(varCol.doc(), { nombre: v.nombre, stock: v.stock, orden: i });
        });
        await syncBatch.commit();

        limpiarP();
        alert("✅ Producto guardado correctamente");
    } catch (e) {
        console.error("Error Firebase:", e);
        alert("❌ Error al guardar el producto\n\n" + (e.message || e));
    }
}

function limpiarP() {
    document.getElementById("fId").value = "";
    document.getElementById("fNom").value = "";
    document.getElementById("fPre").value = "";
    document.getElementById("fPreMay").value = "";
    document.getElementById("fStock").value = "10";
    document.getElementById("fPro").value = "";
    document.getElementById("fDestacado").checked = false;
    document.getElementById("fNuevo").checked = false;
    document.getElementById("fSinStock").checked = false;
    if (document.getElementById("fCat").options.length) document.getElementById("fCat").selectedIndex = 0;
    document.getElementById("fVariantes").value = "";
    cargarImagenesProducto([]);
    document.getElementById("fDesc").value = "";
    document.getElementById("fCaract").value = "";
    document.getElementById("fFicha").value = "";
    renderLinksProducto([]);
    renderCompatibilidad([]);
}

async function editP(id) {
    const p = prods.find(x => x.id === id);
    if (!p) return;
    document.getElementById("fId").value = p.id;
    document.getElementById("fNom").value = p.nombre || "";
    document.getElementById("fPre").value = p.precio || "";
    document.getElementById("fPreMay").value = p.precio_may || "";
    document.getElementById("fStock").value = p.stock !== undefined ? p.stock : 10;
    document.getElementById("fPro").value = p.promo || "";
    document.getElementById("fDestacado").checked = !!p.destacado;
    document.getElementById("fNuevo").checked = !!p.nuevo;
    document.getElementById("fSinStock").checked = !!p.sinStock;
    document.getElementById("fCat").value = p.categoria || "";

    // Cargar la galería en filas independientes y eliminar URLs repetidas.
    let imagesToFill = p.imagenes || [];
    if (imagesToFill.length === 0 && p.imagen) imagesToFill = [p.imagen];
    cargarImagenesProducto(imagesToFill);

    document.getElementById("fDesc").value = p.descripcion || "";
    document.getElementById("fCaract").value = p.caracteristicas || "";
    document.getElementById("fFicha").value = p.ficha || "";
    renderLinksProducto(p.linksDescarga || p.downloadLinks || p.enlaces || p.links || []);
    renderCompatibilidad(p.compatibilidad || []);

    // Traer las variantes en vivo desde Firestore (no desde caché) para no
    // pisar por accidente el stock real con datos viejos al guardar.
    const fVar = document.getElementById("fVariantes");
    fVar.value = p.tieneVariantes ? "Cargando..." : "";
    try {
        const snap = await db.collection("productos").doc(id).collection("variantes").orderBy("orden").get();
        fVar.value = snap.docs.map(d => `${d.data().nombre} | ${d.data().stock}`).join('\n');
    } catch (e) {
        console.error(e);
        fVar.value = "";
    }

    tab('t-prod');
    setTimeout(() => {
        const adminModalContent = document.querySelector('#adminModal');
        if(adminModalContent) adminModalContent.scrollTo({ top: 0, behavior: "smooth" });
    }, 200);
}

// ==================== PANEL ADMIN — CLIENTES ====================

// Firebase NO deja que un admin cambie o resetee la contraseña de OTRO
// usuario desde el navegador (eso requeriría un backend propio con el
// Admin SDK, algo que este proyecto evita a propósito por costo/
// complejidad — ver README.md). Lo único que se puede hacer sin backend
// es esto: darle al admin el "usuario interno" exacto para que borre esa
// cuenta desde la consola de Firebase, y que el cliente se registre de
// nuevo con una contraseña nueva.
function ayudaContrasenaOlvidada(username) {
    const emailInterno = toAuthEmail(username);
    const mensaje =
        `No es posible resetear la contraseña de otro usuario desde acá — Firebase no lo permite sin un servidor propio.\n\n` +
        `Solución en 3 pasos:\n` +
        `1) Firebase Console → Authentication → Users → buscá:\n   ${emailInterno}\n   → Eliminar ese usuario.\n\n` +
        `2) Volvé a este panel y borrá también su perfil con el 🗑️ de al lado.\n\n` +
        `3) Avisale al cliente que se registre de nuevo (mismo usuario "${username}", contraseña nueva a elección) y aprobalo otra vez — como ya es un cliente conocido, es cuestión de un click.`;
    alert(mensaje);
}

function renderAdmU() {
    const list = document.getElementById("admListU");
    const pen = users.filter(u => !u.activo);
    const act = users.filter(u => u.activo);
    let html = `<h4 style="margin:0 0 15px 5px; opacity:0.6;">Solicitudes pendientes (${pen.length})</h4>`;
    if (pen.length === 0) html += `<p style="opacity:0.4; margin-left:10px;">No hay solicitudes pendientes.</p>`;
    html += pen.map(u => `
        <div class="admin-item" style="border-left:4px solid var(--promo); flex-direction:column; align-items:flex-start; gap:12px;">
            <div style="width:100%;">
                <b style="font-size:17px;">${u.user}</b>
                <div style="display:flex; gap:12px; margin-top:8px;">
                    <span style="background:#f59e0b; color:#000; padding:2px 10px; border-radius:9999px; font-size:11px; font-weight:700;">EN REVISIÓN</span>
                    <small>${new Date(u.fecha).toLocaleDateString('es-ES')}</small>
                </div>
            </div>
            <div style="width:100%; font-size:14px;">
                📱 <strong>${u.tel}</strong><br>
                📍 ${u.dir || 'Sin dirección'}
            </div>
            <button onclick="updU('${u.id}', true)" style="background:var(--success); padding:8px 20px; width:100%; cursor:pointer; border:none; border-radius:12px; color:white; font-weight:bold;">✅ Aprobar cliente</button>
        </div>
    `).join("");
    html += `<h4 style="margin:40px 0 15px 5px; opacity:0.6;">Clientes activos (${act.length})</h4>`;
    html += act.map(u => `
        <div class="admin-item">
            <div style="flex:1;">
                <b style="font-size:17px;">${u.user}</b><br>
                📱 <strong>${u.tel}</strong><br>
                📍 ${u.dir || 'Sin dirección'}
                <div style="margin-top:8px;">
                    <span style="background:#10b981; color:white; padding:2px 10px; border-radius:9999px; font-size:11px; font-weight:700;">ACTIVO</span>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; align-self:center;">
                <button onclick="ayudaContrasenaOlvidada('${u.user}')" title="Olvidó su contraseña" style="background:none; border:none; font-size:18px; cursor:pointer;">🔑</button>
                <button onclick="del('usuarios','${u.id}')" style="color:var(--danger); font-size:18px; background:none; border:none; cursor:pointer;">🗑️</button>
            </div>
        </div>
    `).join("");
    list.innerHTML = html;
}

// ==================== PANEL ADMIN — PEDIDOS ====================

function renderAdmO() {
    const list = document.getElementById("admListO");
    if (orders.length === 0) {
        list.innerHTML = `<p style="text-align:center; padding:40px; opacity:0.4;">No hay pedidos aún.</p>`;
        return;
    }
    list.innerHTML = orders.map(o => `
        <div class="admin-item" style="flex-direction:column; align-items:flex-start;">
            <div class="flex-between" style="width:100%;">
                <b style="color:var(--accent);">${o.total}</b>
                <small>${new Date(o.fecha).toLocaleString('es-ES')}</small>
            </div>
            ${o.clienteUid ? `
                <select onchange="cambiarEstadoPedido('${o.id}', this.value)" style="margin-top:8px; padding:8px 10px; border-radius:8px; background:var(--card); color:var(--text); border:1px solid rgba(255,255,255,0.15); font-size:12px; font-weight:700;">
                    ${ESTADOS_PEDIDO.map(e => `<option value="${e.id}" ${(o.estado || 'recibido') === e.id ? 'selected' : ''}>${e.icon} ${e.label}</option>`).join('')}
                </select>
            ` : `<span style="margin-top:8px; font-size:11px; opacity:0.4;">Pedido de invitado — sin seguimiento (no tiene cuenta)</span>`}
            ${o.comprobanteUrl ? `<a href="${o.comprobanteUrl}" target="_blank" rel="noopener" style="margin-top:8px; display:inline-block; background:var(--accent); color:#fff; padding:7px 14px; border-radius:9px; font-size:12px; font-weight:700; text-decoration:none;">🧾 Ver comprobante</a>` : ''}
            <div style="font-size:13px; white-space:pre-wrap; background:rgba(0,0,0,0.2); padding:10px; border-radius:10px; margin-top:8px; width:100%;">
                ${o.detalle}
            </div>
        </div>
    `).join("");
}

async function cambiarEstadoPedido(id, nuevoEstado) {
    try { await db.collection("pedidos").doc(id).update({ estado: nuevoEstado }); }
    catch (e) { console.error(e); alert("No pudimos actualizar el estado del pedido."); }
}

// Exporta el historial de pedidos como CSV (se abre directo en Excel/Sheets,
// sin depender de ninguna librería externa).
function exportarPedidosCSV() {
    if (orders.length === 0) return alert("No hay pedidos para exportar.");
    const filas = [["Fecha", "Total", "Cliente", "Detalle"]];
    orders.forEach(o => {
        filas.push([
            new Date(o.fecha).toLocaleString('es-ES'),
            o.total || '',
            o.clienteUser || 'Minorista',
            (o.detalle || '').replace(/\n/g, ' | ')
        ]);
    });
    const csv = filas.map(fila => fila.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM: que Excel reconozca tildes/ñ
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pedidos_${STORE_CONFIG.storeId}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== GENERADOR DE BANNERS PARA REDES (Canvas) ====================
// Dibuja un banner vertical (formato historia) con la foto, nombre y precio
// del producto. Nota técnica importante: si la imagen del producto viene de
// un servicio de hosting que no envía cabeceras CORS, el navegador bloquea
// la descarga por seguridad ("lienzo contaminado") — no es un bug de acá,
// es una protección del navegador. Con postimg.cc, Imgur y la mayoría de
// los hosts de imágenes gratuitos conocidos funciona bien.

function abrirGeneradorBanner(productId) {
    const p = prods.find(x => x.id === productId);
    if (!p) return;
    const firstImg = (p.imagenes && p.imagenes[0]) || p.imagen;
    if (!firstImg) return alert("Este producto no tiene ninguna imagen cargada todavía.");

    document.getElementById("bannerDescargarBtn").style.display = "none";
    document.getElementById("bannerError").style.display = "none";
    document.getElementById("bannerModal").style.display = "flex";
    dibujarBanner(p, firstImg);
}

function cerrarBannerModal() {
    document.getElementById("bannerModal").style.display = "none";
}

function dibujarBanner(p, urlImagen) {
    const canvas = document.getElementById("bannerCanvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 1080;
    canvas.height = 1350;

    const t = STORE_CONFIG.theme || {};
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, t.bg || "#0f172a");
    grad.addColorStop(1, t.card || "#1e293b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const img = new Image();
    img.crossOrigin = "anonymous"; // necesario para poder exportar el canvas después
    img.onload = () => {
        const maxW = 880, maxH = 680;
        let w = img.width, h = img.height;
        const ratio = Math.min(maxW / w, maxH / h, 1);
        w *= ratio; h *= ratio;
        const x = (canvas.width - w) / 2;
        const y = 130;

        ctx.fillStyle = "#ffffff";
        dibujarRectRedondeado(ctx, x - 24, y - 24, w + 48, h + 48, 28);
        ctx.fill();
        ctx.drawImage(img, x, y, w, h);

        ctx.textAlign = "center";
        ctx.fillStyle = t.text || "#ffffff";
        ctx.font = "bold 58px Inter, sans-serif";
        dibujarTextoConSalto(ctx, p.nombre || "", canvas.width / 2, y + h + 110, 920, 66);

        ctx.fillStyle = t.accent || "#3b82f6";
        ctx.font = "bold 96px Inter, sans-serif";
        ctx.fillText(`${STORE_CONFIG.currency}${p.precio}`, canvas.width / 2, y + h + 250);

        if (p.promo) {
            ctx.fillStyle = t.promo || "#f59e0b";
            dibujarRectRedondeado(ctx, canvas.width / 2 - 220, y + h + 285, 440, 76, 38);
            ctx.fill();
            ctx.fillStyle = "#000000";
            ctx.font = "bold 34px Inter, sans-serif";
            ctx.fillText(p.promo, canvas.width / 2, y + h + 334);
        }

        ctx.globalAlpha = 0.75;
        ctx.fillStyle = t.text || "#ffffff";
        ctx.font = "bold 38px Inter, sans-serif";
        ctx.fillText(STORE_CONFIG.storeName || "", canvas.width / 2, canvas.height - 55);
        ctx.globalAlpha = 1;

        document.getElementById("bannerDescargarBtn").style.display = "inline-block";
    };
    img.onerror = () => {
        document.getElementById("bannerError").innerText =
            "No pudimos cargar esta imagen para armar el banner (puede ser un problema temporal de conexión con el hosting de la foto). Probá de nuevo o usá otra imagen para este producto.";
        document.getElementById("bannerError").style.display = "block";
    };
    img.src = urlImagen;
}

function dibujarRectRedondeado(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function dibujarTextoConSalto(ctx, texto, x, y, maxWidth, lineHeight) {
    const palabras = texto.split(' ');
    let linea = '', lineas = [];
    palabras.forEach(palabra => {
        const prueba = linea + palabra + ' ';
        if (ctx.measureText(prueba).width > maxWidth && linea) {
            lineas.push(linea.trim());
            linea = palabra + ' ';
        } else {
            linea = prueba;
        }
    });
    lineas.push(linea.trim());
    lineas.slice(0, 2).forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight)); // máximo 2 líneas
}

function descargarBanner() {
    const canvas = document.getElementById("bannerCanvas");
    try {
        const url = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = `banner-${STORE_CONFIG.storeId}-${Date.now()}.png`;
        a.click();
    } catch (e) {
        console.error(e);
        document.getElementById("bannerError").innerText =
            "No pudimos descargar este banner: la imagen del producto viene de un servicio que no permite exportarla por una restricción de seguridad del navegador (CORS). Probá subiendo la foto a postimg.cc o Imgur, o hacé una captura de pantalla de este banner como alternativa.";
        document.getElementById("bannerError").style.display = "block";
    }
}

// ==================== PANEL ADMIN — ESTADÍSTICAS ====================
// Todo se calcula en el navegador a partir de los pedidos ya cargados
// (orders), sin servicios ni costos extra. Los pedidos guardados antes de
// esta actualización no tienen los campos nuevos (items/montoTotal/
// clienteUser), así que no aportan al detalle por producto/cliente, pero
// sí se cuentan en el total de pedidos e ingresos cuando se puede leer el
// monto desde el texto "total".

function getWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function calcularEstadisticas() {
    const stats = { totalPedidos: orders.length, ingresosTotales: 0, productosVendidos: {}, clientes: {}, porSemana: {} };
    orders.forEach(o => {
        const monto = typeof o.montoTotal === 'number' ? o.montoTotal : (parseFloat(String(o.total || '').replace(/[^\d.-]/g, '')) || 0);
        stats.ingresosTotales += monto;

        const cliente = o.clienteUser || 'Minorista';
        if (!stats.clientes[cliente]) stats.clientes[cliente] = { pedidos: 0, monto: 0 };
        stats.clientes[cliente].pedidos++;
        stats.clientes[cliente].monto += monto;

        (o.items || []).forEach(it => {
            const key = it.nombre + (it.variante ? ` (${it.variante})` : '');
            stats.productosVendidos[key] = (stats.productosVendidos[key] || 0) + it.qty;
        });

        const d = new Date(o.fecha);
        const semanaKey = `${d.getFullYear()}-S${getWeekNumber(d)}`;
        stats.porSemana[semanaKey] = (stats.porSemana[semanaKey] || 0) + monto;
    });
    return stats;
}

function renderAdmStats() {
    const cont = document.getElementById("admStats");
    if (!cont) return;
    const stats = calcularEstadisticas();
    const topProductos = Object.entries(stats.productosVendidos).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topClientes = Object.entries(stats.clientes).sort((a, b) => b[1].monto - a[1].monto).slice(0, 10);
    const semanas = Object.entries(stats.porSemana).sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 8);
    const vacio = (txt) => `<p style="opacity:0.4; padding:15px 5px;">${txt}</p>`;

    cont.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:10px;">
            <div class="admin-item" style="flex-direction:column; text-align:center;">
                <small style="opacity:0.5;">PEDIDOS TOTALES</small>
                <div style="font-size:26px; font-weight:800; color:var(--accent);">${stats.totalPedidos}</div>
            </div>
            <div class="admin-item" style="flex-direction:column; text-align:center;">
                <small style="opacity:0.5;">INGRESOS TOTALES</small>
                <div style="font-size:26px; font-weight:800; color:var(--success);">${STORE_CONFIG.currency}${stats.ingresosTotales.toFixed(0)}</div>
            </div>
        </div>

        <h4 style="opacity:0.6; margin: 25px 0 10px 5px;">Productos más vendidos</h4>
        ${topProductos.length === 0 ? vacio("Todavía no hay pedidos con detalle suficiente.") :
            topProductos.map(([nombre, qty]) => `
            <div class="admin-item"><div style="flex:1;">${nombre}</div><b style="color:var(--accent);">${qty} vendidos</b></div>
        `).join('')}

        <h4 style="opacity:0.6; margin: 30px 0 10px 5px;">Clientes más activos</h4>
        ${topClientes.length === 0 ? vacio("Todavía no hay datos suficientes.") :
            topClientes.map(([user, d]) => `
            <div class="admin-item"><div style="flex:1;">${user}</div><b>${d.pedidos} pedidos — ${STORE_CONFIG.currency}${d.monto.toFixed(0)}</b></div>
        `).join('')}

        <h4 style="opacity:0.6; margin: 30px 0 10px 5px;">Ingresos por semana</h4>
        ${semanas.length === 0 ? vacio("Todavía no hay datos suficientes.") :
            semanas.map(([semana, monto]) => `
            <div class="admin-item"><div style="flex:1;">${semana}</div><b>${STORE_CONFIG.currency}${monto.toFixed(0)}</b></div>
        `).join('')}
    `;
}

// ==================== PANEL ADMIN — SLIDER HERO ====================

function renderAdmSlider() {
    const list = document.getElementById("admListSlider");
    if (heroImages.length === 0) {
        list.innerHTML = `<p style="opacity:0.5; padding:30px; text-align:center;">No hay imágenes en el slider.</p>`;
        return;
    }
    list.innerHTML = heroImages.map(h => `
        <div class="admin-item" style="cursor:pointer;" onclick="previsualizarHero('${h.url.replace(/'/g, "\\'")}')" title="Tocar para previsualizar">
            <img src="${h.url}" class="admin-item-img" alt="slide" loading="lazy">
            <div style="flex:1;"><b>Imagen ${h.order + 1}</b></div>
            <button onclick="event.stopPropagation(); deleteHeroImage('${h.id}')" style="color:var(--danger); font-size:18px; cursor:pointer; background:none; border:none;">🗑️</button>
        </div>
    `).join("");
}

// Vista previa tipo "banner de YouTube": muestra cómo queda recortada la
// imagen en una pantalla de PC (banner ancho y bajo) y en un celular
// (más angosto), ya que el hero usa background-size:cover en las dos.
function previsualizarHero(url) {
    const box = document.getElementById("heroPreviewBox");
    const pc = document.getElementById("heroPreviewPC");
    const mobile = document.getElementById("heroPreviewMobile");
    if (!box || !pc || !mobile) return;
    url = (url || "").trim();
    if (!url) { box.style.display = "none"; return; }
    pc.style.backgroundImage = `url('${url}')`;
    mobile.style.backgroundImage = `url('${url}')`;
    box.style.display = "block";
}

async function addHeroImage() {
    const url = document.getElementById("sliderUrl").value.trim();
    if (!url) return alert("Ingresa una URL válida");
    const order = heroImages.length;
    await db.collection("hero").add({ url: url, order: order });
    document.getElementById("sliderUrl").value = "";
    document.getElementById("heroPreviewBox").style.display = "none";
    alert("Imagen agregada al slider");
}

async function deleteHeroImage(id) {
    if (confirm("¿Eliminar esta imagen del slider?")) {
        await db.collection("hero").doc(id).delete();
    }
}

// ==================== PANEL ADMIN — CONFIGURACIÓN DE LA TIENDA ====================
// Edita el documento config/tienda del propio Firestore de esta tienda
// (colores, mapa, y qué secciones mostrar), sin tocar Firestore a mano.

// Acepta el <iframe> completo que da Google Maps ("Compartir" → "Insertar
// un mapa" → "Copiar HTML"), o directamente una URL ya extraída.
function extraerUrlIframe(textoPegado) {
    if (!textoPegado) return "";
    const texto = textoPegado.trim();
    const m = texto.match(/src=["']([^"']+)["']/i);
    let url = m ? m[1] : (/^https?:\/\//i.test(texto) ? texto : "");
    return url.replace(/["'<>]/g, ""); // nunca debería haber esto en una URL válida
}

function renderMapa() {
    const cont = document.getElementById("mapaContainer");
    if (!cont) return;
    if (!STORE_CONFIG.features.mostrarMapa) {
        cont.innerHTML = "";
        cont.style.display = "none";
        return;
    }
    const imagen = (STORE_CONFIG.mapaImagen || "").trim();
    if (imagen) {
        // Imagen del local en vez del mapa de Google. Si además hay un mapa
        // cargado, la imagen se vuelve clickeable para abrirlo aparte.
        const img = `<img src="${imagen}" alt="Ubicación del local" style="width:100%; height:220px; object-fit:cover; border-radius:var(--radius); display:block;">`;
        cont.innerHTML = STORE_CONFIG.mapaUrl
            ? `<a href="${STORE_CONFIG.mapaUrl}" target="_blank" rel="noopener" style="display:block;">${img}</a>`
            : img;
        cont.style.display = "block";
    } else if (STORE_CONFIG.mapaUrl) {
        cont.innerHTML = `<iframe src="${STORE_CONFIG.mapaUrl}" width="100%" height="220" style="border:0; border-radius:var(--radius); display:block;" allowfullscreen="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        cont.style.display = "block";
    } else {
        cont.innerHTML = "";
        cont.style.display = "none";
    }
}

// Temas rápidos: aplican una combinación de colores armoniosa de una vez.
// El admin puede ajustar accent/bg a mano después igual.
const THEME_PRESETS = {
    oscuro:     { bg: "#0f172a", card: "#1e293b", text: "#f1f5f9", accent: "#3b82f6", success: "#10b981", promo: "#f59e0b", danger: "#ef4444" },
    claro:      { bg: "#f1f5f9", card: "#ffffff", text: "#0f172a", accent: "#2563eb", success: "#059669", promo: "#d97706", danger: "#dc2626" },
    neon:       { bg: "#0d0221", card: "#1b0c3d", text: "#f5e9ff", accent: "#ff00e5", success: "#00ff9f", promo: "#ffea00", danger: "#ff2079" },
    elegante:   { bg: "#1a1a1a", card: "#242424", text: "#e8e6e1", accent: "#c9a961", success: "#7c9885", promo: "#c9a961", danger: "#b85c5c" },
    cyberpunk:  { bg: "#0a0a0f", card: "#16161f", text: "#f5f5ff", accent: "#f9e900", success: "#00ffc8", promo: "#05d9e8", danger: "#ff003c" },
    deportivo:  { bg: "#ffffff", card: "#f5f5f5", text: "#1a1a1a", accent: "#e63946", success: "#2a9d3f", promo: "#e63946", danger: "#c1121f" }
};
let presetTemaSeleccionado = null; // solo se aplica de verdad al guardar

// Vista previa en vivo: cambia la variable CSS al toque, sin esperar a
// guardar. Si se recarga la página sin guardar, se pierde (vuelve a
// mostrarse lo que está guardado de verdad en Firestore).
function previsualizarColor(variableCSS, valor) {
    document.documentElement.style.setProperty(variableCSS, valor);
}

function aplicarPresetTema() {
    const preset = document.getElementById("cfgThemePreset").value;
    if (!preset || !THEME_PRESETS[preset]) { presetTemaSeleccionado = null; return; }
    presetTemaSeleccionado = THEME_PRESETS[preset];
    document.getElementById("cfgAccent").value = presetTemaSeleccionado.accent;
    document.getElementById("cfgBg").value = presetTemaSeleccionado.bg;
    // Vista previa en vivo de la paleta completa (no solo accent/bg)
    Object.entries(presetTemaSeleccionado).forEach(([k, v]) => previsualizarColor(`--${k}`, v));
}

function cargarFormConfig() {
    const accentEl = document.getElementById("cfgAccent");
    if (!accentEl) return; // el panel admin todavía no está en el DOM (no debería pasar, pero por las dudas)

    document.getElementById("cfgStoreName").value = STORE_CONFIG.storeName || "";
    document.getElementById("cfgBusinessMode").value = STORE_CONFIG.businessMode || "ambos";
    document.getElementById("cfgWhatsapp").value = STORE_CONFIG.whatsappNumber || "";
    document.getElementById("cfgAddress").value = STORE_CONFIG.address || "";
    document.getElementById("cfgHorarios").value = STORE_CONFIG.horarios || "";
    document.getElementById("cfgInstagram").value = STORE_CONFIG.instagramUrl || "";
    document.getElementById("cfgFacebook").value = STORE_CONFIG.facebookUrl || "";
    document.getElementById("cfgTiktok").value = STORE_CONFIG.tiktokUrl || "";

    document.getElementById("cfgPausada").checked = !!STORE_CONFIG.pausada;
    document.getElementById("cfgBannerActivo").checked = !!STORE_CONFIG.bannerActivo;
    document.getElementById("cfgBannerTexto").value = STORE_CONFIG.bannerTexto || "";
    document.getElementById("cfgBannerBg").value = STORE_CONFIG.bannerBgColor || "#f59e0b";
    document.getElementById("cfgBannerColor").value = STORE_CONFIG.bannerTextColor || "#000000";

    const pagos = STORE_CONFIG.pagos || {};
    document.getElementById("cfgPagoEfectivo").checked = pagos.efectivo !== false;
    document.getElementById("cfgPagoTransferencia").checked = !!pagos.transferencia;
    document.getElementById("cfgDescuentoTransferencia").value = pagos.descuentoTransferenciaPct || "";
    document.getElementById("cfgCuotasCantidad").value = pagos.cuotasCantidad || "";
    document.getElementById("cfgCuotasRecargo").value = pagos.cuotasRecargoPct || "";
    renderDatosTransferencia(pagos.datosTransferencia);

    const env = STORE_CONFIG.envios || {};
    document.getElementById("cfgEnviosActivo").checked = !!env.activo;
    document.getElementById("cfgEnviosInfo").value = env.info || "";
    document.getElementById("cfgPagoMercadoPago").checked = !!pagos.mercadopago;

    document.getElementById("cfgLogoUrl").value = STORE_CONFIG.logoUrl || "";
    document.getElementById("cfgPwaIconUrl").value = STORE_CONFIG.pwaIconUrl || "";
    document.getElementById("cfgPwaAppName").value = STORE_CONFIG.pwaAppName || "";
    document.getElementById("cfgPwaEnabled").checked = STORE_CONFIG.pwaEnabled !== false;
    document.getElementById("cfgThemePreset").value = "";
    presetTemaSeleccionado = null;
    accentEl.value = STORE_CONFIG.theme.accent || "#3b82f6";
    document.getElementById("cfgBg").value = STORE_CONFIG.theme.bg || "#0f172a";
    const radioSel = document.getElementById("cfgRadius");
    const radioActual = STORE_CONFIG.theme.radius || "18px";
    radioSel.value = ["0px", "8px", "20px"].includes(radioActual) ? radioActual : "8px";

    document.getElementById("cfgMostrarHero").checked = STORE_CONFIG.features.heroSlider !== false;
    document.getElementById("cfgMostrarMapa").checked = !!STORE_CONFIG.features.mostrarMapa;
    document.getElementById("cfgMapaIframe").value = STORE_CONFIG.mapaUrl || "";
    document.getElementById("cfgMapaImagen").value = STORE_CONFIG.mapaImagen || "";

    cargarCategoriasEditor();

    const l = STORE_CONFIG.layout || {};
    document.getElementById("cfgCatalogView").value = l.catalogView || "grid2";
    document.getElementById("cfgHeaderSticky").checked = l.headerSticky !== false;
    document.getElementById("cfgHeaderStyle").value = l.headerStyle || "floating";
    document.getElementById("cfgImageEffect").value = l.imageEffect || "none";
    document.getElementById("cfgAddToCartAnim").value = l.addToCartAnim || "banner";
    document.getElementById("cfgCartStyle").value = l.cartStyle || "drawer";
    document.getElementById("cfgGlowEffect").checked = !!l.glowEffect;

    document.getElementById("cfgWhatsappTemplate").value = STORE_CONFIG.whatsappTemplate || "";
}

async function guardarConfigTienda() {
    const iframePegado = document.getElementById("cfgMapaIframe").value.trim();
    const mapaUrl = extraerUrlIframe(iframePegado);
    if (iframePegado && !mapaUrl) {
        return alert('No pudimos reconocer el link del mapa. En Google Maps: Compartir → Insertar un mapa → Copiar HTML, y pegá ese código completo (o directamente la URL que aparece dentro de src="...").');
    }

    // El WhatsApp ya NO bloquea el guardado del resto de la configuración
    // (antes, si estaba vacío, no se guardaba nada de nada — bug).
    const whatsapp = document.getElementById("cfgWhatsapp").value.trim().replace(/[^0-9]/g, '');

    const themeBase = presetTemaSeleccionado || STORE_CONFIG.theme;

    // El modo de negocio define si se muestra precio mayorista, pero el
    // registro de cuentas queda SIEMPRE disponible — sirve para que
    // cualquier cliente (mayorista o no) pueda ver su historial de
    // pedidos ("Ver mis pedidos"), tenga o no precios especiales.
    const businessMode = document.getElementById("cfgBusinessMode").value;
    const esSoloMinorista = businessMode === "minorista";

    const storeName = document.getElementById("cfgStoreName").value.trim() || STORE_CONFIG.storeName;

    const datos = {
        storeName: storeName,
        businessMode: businessMode,
        whatsappNumber: whatsapp,
        address: document.getElementById("cfgAddress").value.trim(),
        horarios: document.getElementById("cfgHorarios").value.trim(),
        instagramUrl: document.getElementById("cfgInstagram").value.trim(),
        facebookUrl: document.getElementById("cfgFacebook").value.trim(),
        tiktokUrl: document.getElementById("cfgTiktok").value.trim(),
        pausada: document.getElementById("cfgPausada").checked,
        bannerActivo: document.getElementById("cfgBannerActivo").checked,
        bannerTexto: document.getElementById("cfgBannerTexto").value.trim(),
        bannerBgColor: document.getElementById("cfgBannerBg").value,
        bannerTextColor: document.getElementById("cfgBannerColor").value,
        pagos: {
            efectivo: document.getElementById("cfgPagoEfectivo").checked,
            transferencia: document.getElementById("cfgPagoTransferencia").checked,
            datosTransferencia: obtenerDatosTransferencia(),
            descuentoTransferenciaPct: parseFloat(document.getElementById("cfgDescuentoTransferencia").value) || 0,
            mercadopago: document.getElementById("cfgPagoMercadoPago").checked,
            cuotasCantidad: parseInt(document.getElementById("cfgCuotasCantidad").value) || 0,
            cuotasRecargoPct: parseFloat(document.getElementById("cfgCuotasRecargo").value) || 0
        },
        logoUrl: document.getElementById("cfgLogoUrl").value.trim(),
        pwaIconUrl: document.getElementById("cfgPwaIconUrl").value.trim(),
        pwaAppName: document.getElementById("cfgPwaAppName").value.trim(),
        pwaEnabled: document.getElementById("cfgPwaEnabled").checked,
        theme: { ...themeBase, accent: document.getElementById("cfgAccent").value, bg: document.getElementById("cfgBg").value, radius: document.getElementById("cfgRadius").value },
        features: {
            ...STORE_CONFIG.features,
            heroSlider: document.getElementById("cfgMostrarHero").checked,
            mostrarMapa: document.getElementById("cfgMostrarMapa").checked,
            wholesalePricing: !esSoloMinorista,
            userRegistration: true
        },
        layout: {
            catalogView: document.getElementById("cfgCatalogView").value,
            headerSticky: document.getElementById("cfgHeaderSticky").checked,
            headerStyle: document.getElementById("cfgHeaderStyle").value,
            imageEffect: document.getElementById("cfgImageEffect").value,
            addToCartAnim: document.getElementById("cfgAddToCartAnim").value,
            cartStyle: document.getElementById("cfgCartStyle").value,
            glowEffect: document.getElementById("cfgGlowEffect").checked
        },
        mapaUrl: mapaUrl,
        mapaImagen: document.getElementById("cfgMapaImagen").value.trim(),
        envios: {
            activo: document.getElementById("cfgEnviosActivo").checked,
            info: document.getElementById("cfgEnviosInfo").value.trim()
        },
        categories: categoriasEditando,
        whatsappTemplate: document.getElementById("cfgWhatsappTemplate").value.trim()
    };

    try {
        await db.collection("config").doc("tienda").set(datos, { merge: true });
        STORE_CONFIG = { ...STORE_CONFIG, ...datos };
        presetTemaSeleccionado = null;
        aplicarTema();
        aplicarBranding();
        aplicarLayout();
        aplicarManifestPWA();
        aplicarOpenGraph();
        {
            const btnPwa = document.getElementById("btnInstalarApp");
            if (btnPwa) btnPwa.style.display = (STORE_CONFIG.pwaEnabled && !esTiendaInstalada()) ? "inline-flex" : "none";
        }
        renderMapa();
        renderBanners();
        renderMetodoPagoSelector();
        renderEntregaSelector();
        renderCategorias();
        renderCategoriasSelect();
        render(); // por si cambió la vista de catálogo (grid/lista) o el modo minorista/mayorista
        alert(whatsapp ? "✅ Configuración guardada" : "✅ Configuración guardada.\n\n⚠️ Ojo: el WhatsApp para pedidos quedó vacío — el checkout no va a funcionar hasta que lo completes.");
    } catch (e) {
        console.error(e);
        alert("Error al guardar: " + (e.message || e) + (e.code ? " (" + e.code + ")" : ""));
    }
}

// ==================== NAVEGACIÓN DEL PANEL / CATEGORÍAS ====================

function tab(id, e) {
    document.querySelectorAll("#t-prod, #t-user, #t-order, #t-slider, #t-stats, #t-debt, #t-config").forEach(el => el.style.display = "none");
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.getElementById(id).style.display = "block";
    if (id === "t-prod") renderAdmP();
    if (id === "t-slider") renderAdmSlider();
    if (id === "t-debt" && window.Deudas) window.Deudas.iniciar("admDeudas");
    if (e && e.target) {
        e.target.classList.add("active");
    } else {
        const targetBtn = document.querySelector(`.tab-btn[onclick*="${id}"]`);
        if (targetBtn) targetBtn.classList.add("active");
    }
}

// Pestañas internas de CONFIGURACIÓN (General / Apariencia / Catálogo /
// Medios de pago / PWA) — mismo mecanismo que tab() pero acotado a los
// paneles de adentro, para no tener que scrollear un formulario larguísimo.
function subtab(id, e) {
    document.querySelectorAll(".admin-subtab-panel").forEach(el => el.style.display = "none");
    document.querySelectorAll(".subtab-btn").forEach(b => b.classList.remove("active"));
    const panel = document.getElementById("subtab-" + id);
    if (panel) panel.style.display = "block";
    if (e && e.target) {
        e.target.classList.add("active");
    } else {
        const targetBtn = document.querySelector(`.subtab-btn[onclick*="'${id}'"]`);
        if (targetBtn) targetBtn.classList.add("active");
    }
}

function setCat(el, cat) {
    filterCat = cat;
    document.querySelectorAll('.cat-item').forEach(item => item.classList.remove('active'));
    el.classList.add('active');
    render();
}

// ==================== CHECKOUT POR WHATSAPP ====================

// ==================== MEDIOS DE PAGO ====================

function metodosPagoActivos() {
    const p = STORE_CONFIG.pagos || {};
    const metodos = [];
    if (p.efectivo) metodos.push({ id: "efectivo", label: "Efectivo" });
    if (p.transferencia) metodos.push({ id: "transferencia", label: "Transferencia bancaria" });
    if (p.mercadopago) metodos.push({ id: "mercadopago", label: "Mercado Pago" });
    return metodos;
}

// Si hay 2 o más métodos activos, el cliente elige uno antes de enviar el
// pedido. Si hay uno solo, se usa directo sin mostrar el selector.
function renderMetodoPagoSelector() {
    const metodos = metodosPagoActivos();
    const cont = document.getElementById("metodoPagoContainer");
    if (!cont) return;
    if (metodos.length <= 1) {
        cont.style.display = "none";
        actualizarVisibilidadComprobante();
        return;
    }
    document.getElementById("metodoPagoSelect").innerHTML = metodos.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
    cont.style.display = "block";
    actualizarVisibilidadComprobante();
}

// El método "efectivo" de un solo elemento no muestra selector — por eso
// esta función recalcula cuál es el método REALMENTE elegido en cada caso,
// en vez de asumir que siempre hay un <select> visible.
function metodoPagoElegidoActual() {
    const metodos = metodosPagoActivos();
    if (metodos.length === 0) return null;
    if (metodos.length === 1) return metodos[0].id;
    const sel = document.getElementById("metodoPagoSelect");
    return (sel && sel.value) || metodos[0].id;
}

function actualizarVisibilidadComprobante() {
    const cont = document.getElementById("comprobanteContainer");
    if (!cont) return;
    const esTransferencia = metodoPagoElegidoActual() === "transferencia";
    cont.style.display = esTransferencia ? "block" : "none";
    if (!esTransferencia) {
        comprobanteURL = null;
        const input = document.getElementById("comprobanteInput");
        const estado = document.getElementById("comprobanteEstado");
        if (input) input.value = "";
        if (estado) estado.innerText = "";
    }
}

// ==================== COMPROBANTE DE TRANSFERENCIA ====================
// Sube la imagen a Cloudinary (upload preset "unsigned", sin API secret en
// el navegador) y guarda la URL segura para adjuntarla al pedido, tanto en
// Firestore (campo comprobanteUrl) como en el mensaje de WhatsApp. Como
// WhatsApp no deja mandar una imagen dentro de un link de "click to chat",
// el mensaje incluye el link al comprobante: al tocarlo, el dueño la ve.
const CLOUDINARY_CLOUD_NAME = "fe1xog5q";
const CLOUDINARY_UPLOAD_PRESET = "vktq9pvm";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

let comprobanteURL = null;
let subiendoComprobante = false;

async function subirComprobante(file) {
    const estado = document.getElementById("comprobanteEstado");
    comprobanteURL = null;
    if (!file) {
        if (estado) estado.innerText = "";
        return;
    }
    if (!file.type.startsWith("image/")) {
        if (estado) estado.innerText = "⚠️ Tiene que ser una imagen.";
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        if (estado) estado.innerText = "⚠️ La imagen pesa más de 8MB, probá con una más liviana (una captura de pantalla común sirve).";
        return;
    }
    if (estado) estado.innerText = "⏳ Subiendo...";
    subiendoComprobante = true;
    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

        const respuesta = await fetch(CLOUDINARY_UPLOAD_URL, {
            method: "POST",
            body: formData
        });
        const data = await respuesta.json();
        if (!respuesta.ok || !data.secure_url) {
            throw new Error((data.error && data.error.message) || `Cloudinary respondió ${respuesta.status}`);
        }
        comprobanteURL = data.secure_url;
        if (estado) estado.innerText = "✅ Comprobante listo para enviar.";
    } catch (e) {
        console.error("Error subiendo comprobante a Cloudinary:", e);
        comprobanteURL = null;
        if (estado) estado.innerText = "❌ No pudimos subir el comprobante. Podés seguir sin adjuntarlo.";
    } finally {
        subiendoComprobante = false;
    }
}

// Selector de entrega: solo aparece si el comercio activó los envíos.
// Si no, se asume retiro en el local y no se muestra nada.
function renderEntregaSelector() {
    const cont = document.getElementById("entregaContainer");
    if (!cont) return;
    const envios = STORE_CONFIG.envios || {};
    cont.style.display = envios.activo ? "block" : "none";
    const info = document.getElementById("entregaInfo");
    if (info) {
        info.innerText = envios.info || "";
        info.style.display = envios.info ? "block" : "none";
    }
}

// ==================== PRESUPUESTO EN PDF ====================
// Genera una cotización formal del carrito actual, sin descontar stock ni
// mandar nada — es solo un documento para el cliente (ideal para compras
// corporativas o mayoristas que necesitan algo formal antes de confirmar).
async function cargarImagenComoDataURL(url) {
    try {
        const resp = await fetch(url, { mode: "cors" });
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (_) {
        return null; // el host de la imagen no permite CORS — seguimos sin logo
    }
}

async function descargarPresupuestoPDF() {
    if (cart.length === 0) return alert("El carrito está vacío.");
    if (!window.jspdf || !window.jspdf.jsPDF) return alert("No pudimos cargar el generador de PDF. Revisá tu conexión y probá de nuevo.");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Logo (mejor esfuerzo — si el host de la imagen no permite CORS, se
    // sigue de largo sin romper nada y el PDF queda solo con texto).
    if (STORE_CONFIG.logoUrl) {
        const dataUrl = await cargarImagenComoDataURL(STORE_CONFIG.logoUrl);
        if (dataUrl) {
            try {
                doc.addImage(dataUrl, "JPEG", 15, y, 28, 28);
            } catch (_) { /* formato no soportado, seguimos sin logo */ }
        }
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(STORE_CONFIG.storeName || "Tienda", 50, y + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100);
    if (STORE_CONFIG.address) doc.text(STORE_CONFIG.address, 50, y + 15);
    if (STORE_CONFIG.whatsappNumber) doc.text(`WhatsApp: ${STORE_CONFIG.whatsappNumber}`, 50, y + 21);

    y += 40;
    doc.setDrawColor(200);
    doc.line(15, y, pageWidth - 15, y);
    y += 12;

    doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("PRESUPUESTO", 15, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(new Date().toLocaleDateString('es-AR'), pageWidth - 15, y, { align: "right" });
    y += 8;
    if (usuarioLogueado) {
        doc.text(`Cliente: ${usuarioLogueado.user}`, 15, y);
        y += 6;
    }
    y += 6;

    // Encabezado de la tabla
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.setFontSize(10);
    doc.text("Producto", 15, y);
    doc.text("Cant.", pageWidth - 75, y, { align: "right" });
    doc.text("Precio unit.", pageWidth - 45, y, { align: "right" });
    doc.text("Subtotal", pageWidth - 15, y, { align: "right" });
    y += 3;
    doc.setDrawColor(0);
    doc.line(15, y, pageWidth - 15, y);
    y += 7;

    doc.setFont("helvetica", "normal");
    let totalNumerico = 0;
    cart.forEach(item => {
        const p = prods.find(x => x.id === item.id);
        if (!p) return;
        const precioUnit = isMay ? (p.precio_may || p.precio) : p.precio;
        const subtotal = precioUnit * item.qty;
        totalNumerico += subtotal;

        if (y > 270) { doc.addPage(); y = 20; }
        const nombreLinea = item.variante ? `${p.nombre} — ${item.variante}` : p.nombre;
        doc.text(nombreLinea.length > 45 ? nombreLinea.slice(0, 45) + "…" : nombreLinea, 15, y);
        doc.text(String(item.qty), pageWidth - 75, y, { align: "right" });
        doc.text(`${STORE_CONFIG.currency}${precioUnit}`, pageWidth - 45, y, { align: "right" });
        doc.text(`${STORE_CONFIG.currency}${subtotal}`, pageWidth - 15, y, { align: "right" });
        y += 8;
    });

    y += 4;
    doc.line(15, y, pageWidth - 15, y);
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`TOTAL: ${STORE_CONFIG.currency}${totalNumerico}`, pageWidth - 15, y, { align: "right" });

    y += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(130);
    doc.text("Presupuesto sujeto a disponibilidad de stock al momento de confirmar la compra.", 15, y);
    doc.text("No incluye costo de envío salvo que se indique lo contrario.", 15, y + 5);

    const nombreArchivo = `presupuesto-${(STORE_CONFIG.storeName || "tienda").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}.pdf`;
    doc.save(nombreArchivo);
    vibrar();
}

const PLANTILLA_WHATSAPP_DEFAULT = "*📦 NUEVO PEDIDO — {tienda}*\n*Cliente:* {cliente}\n{pago}----------------------------\n{lista}----------------------------\n*TOTAL ESTIMADO: {total}*";

async function finalizarYEnviar() {
    if (STORE_CONFIG.pausada) return alert("Esta tienda no está recibiendo pedidos en este momento.");
    if (cart.length === 0) return alert("El carrito está vacío.");
    if (subiendoComprobante) return alert("⏳ Todavía se está subiendo el comprobante. Esperá unos segundos y volvé a tocar Enviar.");

    const clienteTexto = usuarioLogueado
        ? `${usuarioLogueado.user}\n*Local:* ${usuarioLogueado.dir || 'Sin dirección'}`
        : "Minorista";

    // Medio de pago elegido (si hay más de uno configurado, el que
    // seleccionó el cliente; si hay uno solo, se usa directo)
    const metodos = metodosPagoActivos();
    const metodoElegido = metodoPagoElegidoActual();
    let pagoTexto = "";
    const envios = STORE_CONFIG.envios || {};
    if (envios.activo) {
        const selEntrega = document.getElementById("entregaSelect");
        const modo = (selEntrega && selEntrega.value) || "retiro";
        pagoTexto += `*Entrega:* ${modo === "envio" ? "Envío a domicilio" : "Retiro en el local"}\n`;
    }
    if (metodoElegido) {
        const metodoInfo = metodos.find(m => m.id === metodoElegido);
        pagoTexto += `*Medio de pago:* ${metodoInfo ? metodoInfo.label : metodoElegido}\n`;
        if (metodoElegido === "transferencia" && STORE_CONFIG.pagos.datosTransferencia) {
            const txt = textoDatosTransferencia(STORE_CONFIG.pagos.datosTransferencia);
            if (txt) pagoTexto += `*Datos para transferir:*\n${txt}\n`;
        }
        if (metodoElegido === "transferencia" && comprobanteURL) {
            pagoTexto += `*Comprobante:* ${comprobanteURL}\n`;
        }
    }

    const batch = db.batch();
    let montoTotalNumerico = 0;
    const itemsPedido = [];
    let listaTexto = "";

    // Revalidamos el stock en vivo (no el que quedó cacheado en pantalla) y
    // armamos el batch de descuento. Para productos con variante, el
    // descuento se hace sobre el documento de esa variante puntual, no
    // sobre el producto.
    try {
        for (const item of cart) {
            const p = prods.find(x => x.id === item.id);
            if (!p) continue;

            const precioUnit = isMay ? (p.precio_may || p.precio) : p.precio;
            montoTotalNumerico += precioUnit * item.qty;
            itemsPedido.push({ id: p.id, nombre: p.nombre, qty: item.qty, variante: item.variante || null });

            if (item.variante) {
                const snap = await db.collection("productos").doc(p.id).collection("variantes")
                    .where("nombre", "==", item.variante).limit(1).get();
                if (snap.empty) return alert(`❌ La opción "${item.variante}" de ${p.nombre} ya no está disponible. Actualizá la página.`);
                const varDoc = snap.docs[0];
                const varData = varDoc.data();
                if (varData.stock < item.qty) return alert(`❌ Stock insuficiente para ${p.nombre} (${item.variante})`);
                listaTexto += `• ${p.nombre} — ${item.variante} [x${item.qty}]\n`;
                // Descontar stock de la variante. Las reglas de seguridad solo
                // dejan bajar este campo puntual (nunca nombre/precio/etc.).
                batch.update(varDoc.ref, { stock: varData.stock - item.qty });
            } else {
                if (p.stock < item.qty) return alert(`❌ Stock insuficiente para ${p.nombre}`);
                listaTexto += `• ${p.nombre} [x${item.qty}]\n`;
                // Descontar stock en Firebase. Las reglas de seguridad solo
                // dejan bajar este campo puntual, así que esto funciona
                // incluso para compradores sin cuenta.
                batch.update(db.collection("productos").doc(p.id), { stock: p.stock - item.qty });
            }
        }
    } catch (e) {
        console.error(e);
        return alert("No pudimos verificar el stock. Probá de nuevo.");
    }

    const total = document.getElementById("cartTotal").innerText;

    const plantilla = (STORE_CONFIG.whatsappTemplate || "").trim() || PLANTILLA_WHATSAPP_DEFAULT;
    let textoPedido = plantilla
        .replaceAll("{tienda}", STORE_CONFIG.storeName.toUpperCase())
        .replaceAll("{cliente}", clienteTexto)
        .replaceAll("{pago}", pagoTexto)
        .replaceAll("{lista}", listaTexto)
        .replaceAll("{total}", total);

    try {
        await batch.commit(); // Ejecuta las actualizaciones de stock
        await db.collection("pedidos").add({
            detalle: textoPedido,
            total: total,
            fecha: Date.now(),
            montoTotal: montoTotalNumerico,
            clienteUid: usuarioLogueado ? usuarioLogueado.id : null,
            clienteUser: usuarioLogueado ? usuarioLogueado.user : null,
            items: itemsPedido,
            estado: "recibido",
            comprobanteUrl: (metodoElegido === "transferencia" && comprobanteURL) ? comprobanteURL : null
        });

        notificarPedidoPorEmail(textoPedido, total); // no bloquea ni rompe el checkout si falla

        window.open(`https://wa.me/${STORE_CONFIG.whatsappNumber}?text=${encodeURIComponent(textoPedido)}`);

        vibrar([40, 60, 40]);
        cart = [];
        comprobanteURL = null;
        const compInput = document.getElementById("comprobanteInput");
        const compEstado = document.getElementById("comprobanteEstado");
        if (compInput) compInput.value = "";
        if (compEstado) compEstado.innerText = "";
        updateCartUI();
        closeAll();
        alert("✅ Pedido enviado y stock actualizado");
    } catch(e) {
        console.error(e);
        alert("Error al procesar el pedido.");
    }
}

// ==================== UTILIDADES GENERALES ====================

async function del(col, id) {
    if (confirm("¿Eliminar este registro?")) {
        await db.collection(col).doc(id).delete();
    }
}

async function updU(id, stat) {
    await db.collection("usuarios").doc(id).update({activo: stat});
}

async function vaciarHistorial() {
    if (confirm("¿Borrar TODO el historial de pedidos?")) {
        const snap = await db.collection("pedidos").get();
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        alert("Historial vaciado.");
    }
}

function toggleTheme() { document.body.classList.toggle("light"); }

function openModal(id) {
    closeAll();
    document.body.classList.add("no-scroll");
    document.getElementById(id).style.display = "flex";
}

function toggleInfo() {
    const d = document.getElementById("infoDrawer");
    d.classList.toggle("active");
    document.getElementById("ov").classList.toggle("active");
    document.body.classList.toggle("no-scroll", d.classList.contains("active"));
}

function toggleCart() {
    const d = document.getElementById("cartDrawer");
    d.classList.toggle("active");
    document.getElementById("ov").classList.toggle("active");
    document.body.classList.toggle("no-scroll", d.classList.contains("active"));
    updateCartUI();
    renderMetodoPagoSelector();
    renderEntregaSelector();
}

function closeAll() {
    document.querySelectorAll(".modal").forEach(m => m.style.display = "none");
    document.querySelectorAll(".drawer").forEach(d => d.classList.remove("active"));
    document.getElementById("ov").classList.remove("active");
    document.body.classList.remove("no-scroll");
}

function logout() {
    if (confirm("¿Cerrar sesión?")) {
        auth.signOut().then(() => location.reload());
    }
}

function verificarAdmin() {
    if (esAdmin) {
        closeAll();
        openModal("adminModal");
    } else {
        closeAll();
        alert("Iniciá sesión con tu cuenta de administrador para acceder.");
        openModal("loginModal");
    }
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const modal = document.getElementById("productDetailModal");
        if (modal && modal.style.display === "flex") closeProductDetail();
    }
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap); else bootstrap();

// Refuerzo extra del fix de autofill: cuando se vuelve a esta página con el
// botón "atrás" del navegador, algunos navegadores restauran el HTML desde
// caché (bfcache) sin volver a disparar "load" ni bootstrap() — así que acá
// forzamos de nuevo la limpieza del buscador por las dudas.
window.addEventListener("pageshow", () => {
    const searchEl = document.getElementById("searchInput");
    if (searchEl) searchEl.value = "";
});
