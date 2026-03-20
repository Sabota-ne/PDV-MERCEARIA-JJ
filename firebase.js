/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║               PDV Pro — firebase.js                             ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  COMO CONFIGURAR:                                               ║
 * ║  1. console.firebase.google.com → criar projeto                 ║
 * ║  2. Firestore Database → modo teste (ou use firestore.rules)    ║
 * ║  3. Configurações (⚙️) → Seus apps → Web (</>)                  ║
 * ║  4. Copie o bloco firebaseConfig e cole AQUI ABAIXO             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ARQUITETURA DE COLEÇÕES — evita o limite de 1 MB por documento:
 *
 *   pdv/config          → { produtos[], clientes[], taxas, nextId }
 *                          (único documento, sincronizado em tempo real)
 *
 *   pdv_vendas/{id}     → cada venda é um documento separado
 *   pdv_compras/{id}    → cada compra é um documento separado
 *   pdv_fiado/{id}      → cada registro de fiado / quitação
 *
 * REQUISITO: Firebase v9 compat CDN — NÃO misturar com import modular.
 * A ordem dos <script> no index.html é obrigatória:
 *   firebase-app-compat → firebase-firestore-compat → firebase.js → React → Babel → pdv-system.jsx
 */

// ─── COLE SUA CONFIGURAÇÃO AQUI ──────────────────────────────────
var firebaseConfig = {
  apiKey:            "AIzaSyBxkvDK1sUvLBxStklq5Xig_aOh3BcE3jo",
  authDomain:        "meu-pdv-jj.firebaseapp.com",
  projectId:         "meu-pdv-jj",
  storageBucket:     "meu-pdv-jj.firebasestorage.app",
  messagingSenderId: "773429049941",
  appId:             "1:773429049941:web:a171b02cd0cfa2cc4272dc"
};
// ─────────────────────────────────────────────────────────────────

var CONFIGURADO = (
  firebaseConfig.apiKey    !== "SUA_API_KEY_AQUI" &&
  firebaseConfig.apiKey    !== ""                  &&
  firebaseConfig.projectId !== "seu-projeto"       &&
  firebaseConfig.projectId !== ""
);

// ══════════════════════════════════════════════════════════════════
// MODO NÃO CONFIGURADO — stubs silenciosos
// O PDV abre instantaneamente em modo localStorage. Zero loading.
// ══════════════════════════════════════════════════════════════════
if (!CONFIGURADO) {
  console.info("[PDV] firebase.js: não configurado → modo local (localStorage).");

  window.FirebaseDB = {
    estaConfigurado : function() { return false; },
    carregar        : async function() { return null; },
    ouvir           : function() { return function() {}; },
    adicionarVenda  : async function() {},
    adicionarCompra : async function() {},
    adicionarFiado  : async function() {},
    quitarFiado     : async function() {},
    salvarConfig    : async function() {},
    migrarDeBackup  : async function() {},
  };

} else {
  // ══════════════════════════════════════════════════════════════
  // MODO FIREBASE REAL
  // Firebase v9 compat — acesso via firebase.firestore() global.
  // ══════════════════════════════════════════════════════════════
  try {
    firebase.initializeApp(firebaseConfig);
  } catch (e) {
    if (e.code !== "app/duplicate-app") {
      console.error("[PDV] Firebase initializeApp:", e);
    }
  }

  var db = firebase.firestore();

  // ── Referências ────────────────────────────────────────────────
  var DOC_CONFIG   = db.collection("pdv").doc("config");
  var COL_VENDAS   = "pdv_vendas";
  var COL_COMPRAS  = "pdv_compras";
  var COL_FIADO    = "pdv_fiado";

  // ── Helper: remove undefined (Firestore rejeita campos undefined)
  function clean(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function docRef(colecao, id) {
    return db.collection(colecao).doc(String(id));
  }

  // ── carregar() ─────────────────────────────────────────────────
  // Carga inicial: config (produtos+clientes) + subcoleções transacionais.
  // Chamada uma única vez na inicialização do React.
  async function carregar() {
    try {
      var snapshots = await Promise.all([
        DOC_CONFIG.get(),
        db.collection(COL_VENDAS).orderBy("data").get(),
        db.collection(COL_COMPRAS).orderBy("data").get(),
        db.collection(COL_FIADO).get(),
      ]);

      var configSnap  = snapshots[0];
      var vendasSnap  = snapshots[1];
      var comprasSnap = snapshots[2];
      var fiadoSnap   = snapshots[3];

      var config = configSnap.exists ? configSnap.data() : {};

      return {
        produtos : config.produtos || [],
        clientes : config.clientes || [],
        taxas    : config.taxas    || null,
        nextId   : config.nextId   || null,
        vendas   : vendasSnap.docs.map(function(d)  { return d.data(); }),
        compras  : comprasSnap.docs.map(function(d) { return d.data(); }),
        fiado    : fiadoSnap.docs.map(function(d)   { return d.data(); }),
      };
    } catch (err) {
      console.error("[PDV] Erro ao carregar Firestore:", err);
      throw err;
    }
  }

  // ── ouvir(callback) ────────────────────────────────────────────
  // Listener em tempo real no documento pdv/config.
  // Dispara callback(configPartial) sempre que produtos, clientes,
  // taxas ou nextId mudarem em QUALQUER dispositivo.
  //
  // O React mescla configPartial no state preservando vendas/compras/fiado
  // que já foram carregados na memória (append-only, não precisam de sync).
  //
  // Retorna função unsubscribe.
  function ouvir(callback) {
    return DOC_CONFIG.onSnapshot(
      function(snap) {
        if (snap.exists) {
          callback(snap.data()); // { produtos, clientes, taxas, nextId }
        }
      },
      function(err) {
        console.warn("[PDV] onSnapshot config:", err.code, err.message);
      }
    );
  }

  // ── salvarConfig(fullData) ─────────────────────────────────────
  // Salva produtos + clientes + taxas + nextId no documento pdv/config.
  // Chamada pelo diffSync do React toda vez que esses dados mudam.
  // Para uma mercearia com < 500 produtos isso fica bem abaixo de 1 MB.
  function salvarConfig(data) {
    var config = {
      produtos : data.produtos || [],
      clientes : data.clientes || [],
      taxas    : data.taxas    || {},
      nextId   : data.nextId   || {},
    };
    return DOC_CONFIG.set(clean(config))
      .catch(function(e) { console.error("[PDV] salvarConfig:", e); });
  }

  // ── adicionarVenda(venda) ──────────────────────────────────────
  // Cada venda é gravada como documento próprio (sem limite de crescimento).
  function adicionarVenda(venda) {
    return docRef(COL_VENDAS, venda.id).set(clean(venda))
      .catch(function(e) { console.error("[PDV] adicionarVenda:", e); });
  }

  // ── adicionarCompra(compra) ────────────────────────────────────
  function adicionarCompra(compra) {
    return docRef(COL_COMPRAS, compra.id).set(clean(compra))
      .catch(function(e) { console.error("[PDV] adicionarCompra:", e); });
  }

  // ── adicionarFiado(fiado) ──────────────────────────────────────
  // Novo registro de fiado (pago = false).
  function adicionarFiado(fiado) {
    return docRef(COL_FIADO, fiado.id).set(clean(fiado))
      .catch(function(e) { console.error("[PDV] adicionarFiado:", e); });
  }

  // ── quitarFiado(clienteId, todosOsFiados) ─────────────────────
  // Atualiza os registros de fiado de um cliente que foram quitados.
  // Recebe o clienteId e o array completo de fiados do state.
  function quitarFiado(clienteId, todosOsFiados) {
    var fiadosDoCliente = (todosOsFiados || []).filter(function(f) {
      return f.clienteId === clienteId;
    });
    fiadosDoCliente.forEach(function(f) {
      docRef(COL_FIADO, f.id).set(clean(f))
        .catch(function(e) { console.error("[PDV] quitarFiado:", e); });
    });
  }

  // ── migrarDeBackup(data) ───────────────────────────────────────
  // Sobe um backup .json completo para o Firestore.
  // Chamada quando o usuário importa dados via modal de backup.
  // Executa gravações em lotes de 100 para não sobrecarregar.
  async function migrarDeBackup(data) {
    console.info("[PDV] Iniciando migração de backup para Firestore...");
    try {
      var ops = [];

      // Config (produtos + clientes + taxas + nextId)
      ops.push(
        DOC_CONFIG.set(clean({
          produtos : data.produtos || [],
          clientes : data.clientes || [],
          taxas    : data.taxas    || {},
          nextId   : data.nextId   || {},
        }))
      );

      // Subcoleções transacionais
      (data.vendas  || []).forEach(function(v) { ops.push(docRef(COL_VENDAS,  v.id).set(clean(v))); });
      (data.compras || []).forEach(function(c) { ops.push(docRef(COL_COMPRAS, c.id).set(clean(c))); });
      (data.fiado   || []).forEach(function(f) { ops.push(docRef(COL_FIADO,   f.id).set(clean(f))); });

      // Lotes de 100 (conservador — o limite do Firestore é 500 por batch)
      for (var i = 0; i < ops.length; i += 100) {
        await Promise.all(ops.slice(i, i + 100));
      }

      console.info("[PDV] Migração concluída — " + ops.length + " documentos gravados.");
    } catch (err) {
      console.error("[PDV] Erro na migração:", err);
    }
  }

  // ── API pública ────────────────────────────────────────────────
  window.FirebaseDB = {
    estaConfigurado : function() { return true; },
    carregar        : carregar,        // Promise<{produtos,clientes,taxas,nextId,vendas,compras,fiado}>
    ouvir           : ouvir,           // (callback) → unsubscribe
    adicionarVenda  : adicionarVenda,  // (venda)
    adicionarCompra : adicionarCompra, // (compra)
    adicionarFiado  : adicionarFiado,  // (fiado)
    quitarFiado     : quitarFiado,     // (clienteId, todosOsFiados)
    salvarConfig    : salvarConfig,    // (fullData) — extrai produtos/clientes/taxas/nextId
    migrarDeBackup  : migrarDeBackup,  // (data) — sobe backup completo
  };

  console.info("[PDV] Firebase Firestore pronto → projeto:", firebaseConfig.projectId);
}
