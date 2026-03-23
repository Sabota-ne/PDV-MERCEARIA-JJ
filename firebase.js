/**
 * PDV Pro — firebase.js
 * Firebase v9 compat via CDN
 */

var firebaseConfig = {
  apiKey:            "AIzaSyBxkvDK1sUvLBxStklq5Xig_aOh3BcE3jo",
  authDomain:        "meu-pdv-jj.firebaseapp.com",
  projectId:         "meu-pdv-jj",
  storageBucket:     "meu-pdv-jj.firebasestorage.app",
  messagingSenderId: "773429049941",
  appId:             "1:773429049941:web:a171b02cd0cfa2cc4272dc"
};

var CONFIGURADO = (
  firebaseConfig.apiKey    !== "SUA_API_KEY_AQUI" &&
  firebaseConfig.apiKey    !== ""                  &&
  firebaseConfig.projectId !== "seu-projeto"       &&
  firebaseConfig.projectId !== ""
);

if (!CONFIGURADO) {
  console.info("[PDV] firebase.js: não configurado → modo local.");
  window.FirebaseDB = {
    estaConfigurado  : function() { return false; },
    carregar         : async function() { return null; },
    ouvir            : function() { return function() {}; },
    adicionarVenda   : async function() {},
    adicionarCompra  : async function() {},
    adicionarFiado   : async function() {},
    quitarFiado      : async function() {},
    adicionarPerda   : async function() {},
    adicionarSangria : async function() {},
    adicionarDespesa : async function() {},
    salvarCaixa      : async function() {},
    salvarContaPagar : async function() {},
    salvarContaReceber: async function() {},
    salvarConfig     : async function() {},
    migrarDeBackup   : async function() {},
  };
} else {
  try {
    firebase.initializeApp(firebaseConfig);
  } catch (e) {
    if (e.code !== "app/duplicate-app") console.error("[PDV] Firebase init:", e);
  }

  var db = firebase.firestore();

  var DOC_CONFIG       = db.collection("pdv").doc("config");
  var COL_VENDAS       = "pdv_vendas";
  var COL_COMPRAS      = "pdv_compras";
  var COL_FIADO        = "pdv_fiado";
  var COL_PERDAS       = "pdv_perdas";
  var COL_SANGRIAS     = "pdv_sangrias";
  var COL_DESPESAS     = "pdv_despesas";
  var COL_CAIXAS       = "pdv_caixas";
  var COL_CONTAS_PAGAR   = "pdv_contas_pagar";
  var COL_CONTAS_RECEBER = "pdv_contas_receber";

  function clean(obj) { return JSON.parse(JSON.stringify(obj)); }
  function docRef(col, id) { return db.collection(col).doc(String(id)); }

  // Data de corte: 90 dias atrás para vendas, 60 dias para o resto
  function dataCorte(dias) {
    var d = new Date();
    d.setDate(d.getDate() - dias);
    return d.toISOString();
  }

  async function carregar() {
    try {
      var corte90 = dataCorte(90);
      var corte60 = dataCorte(60);

      var snaps = await Promise.all([
        // Config — sempre completo (produtos, clientes, taxas, nextId)
        DOC_CONFIG.get(),

        // Vendas — só últimos 90 dias (cobre relatórios mensais + trimestral)
        db.collection(COL_VENDAS).orderBy("data").startAfter(corte90).get(),

        // Compras — últimas 50 (cobre operação normal)
        db.collection(COL_COMPRAS).orderBy("data", "desc").limit(50).get(),

        // Fiado — só pendentes + últimos 60 dias
        db.collection(COL_FIADO).where("pago", "==", false).get(),

        // Perdas — últimos 60 dias
        db.collection(COL_PERDAS).orderBy("data").startAfter(corte60).get(),

        // Sangrias — últimos 60 dias
        db.collection(COL_SANGRIAS).orderBy("data").startAfter(corte60).get(),

        // Despesas — últimos 60 dias
        db.collection(COL_DESPESAS).orderBy("data").startAfter(corte60).get(),

        // Caixas — últimos 30 (histórico recente)
        db.collection(COL_CAIXAS).orderBy("dataAbertura", "desc").limit(30).get(),

        // Contas a pagar — só não pagas + últimas 20 pagas
        db.collection(COL_CONTAS_PAGAR).where("paga", "==", false).get(),

        // Contas a receber — só não recebidas
        db.collection(COL_CONTAS_RECEBER).where("recebida", "==", false).get(),
      ]);

      var cfg = snaps[0].exists ? snaps[0].data() : {};
      return {
        produtos       : cfg.produtos     || [],
        clientes       : cfg.clientes     || [],
        fornecedores   : cfg.fornecedores || [],
        taxas          : cfg.taxas        || null,
        nextId         : cfg.nextId       || null,
        vendas         : snaps[1].docs.map(function(d) { return d.data(); }),
        compras        : snaps[2].docs.map(function(d) { return d.data(); }).reverse(),
        fiado          : snaps[3].docs.map(function(d) { return d.data(); }),
        perdas         : snaps[4].docs.map(function(d) { return d.data(); }),
        sangrias       : snaps[5].docs.map(function(d) { return d.data(); }),
        despesas       : snaps[6].docs.map(function(d) { return d.data(); }),
        caixas         : snaps[7].docs.map(function(d) { return d.data(); }).reverse(),
        contasPagar    : snaps[8].docs.map(function(d) { return d.data(); }),
        contasReceber  : snaps[9].docs.map(function(d) { return d.data(); }),
      };
    } catch (err) {
      console.error("[PDV] Erro ao carregar Firestore:", err);
      throw err;
    }
  }

  function ouvir(callback) {
    return DOC_CONFIG.onSnapshot(
      function(snap) { if (snap.exists) callback(snap.data()); },
      function(err)  { console.warn("[PDV] onSnapshot:", err.code, err.message); }
    );
  }

  function salvarConfig(data) {
    return DOC_CONFIG.set(clean({
      produtos     : data.produtos     || [],
      clientes     : data.clientes     || [],
      fornecedores : data.fornecedores || [],
      taxas        : data.taxas        || {},
      nextId       : data.nextId       || {},
    })).catch(function(e) { console.error("[PDV] salvarConfig:", e); });
  }

  function adicionarVenda(v)    { return docRef(COL_VENDAS,   v.id).set(clean(v)).catch(function(e) { console.error("[PDV] adicionarVenda:", e); }); }
  function adicionarCompra(c)   { return docRef(COL_COMPRAS,  c.id).set(clean(c)).catch(function(e) { console.error("[PDV] adicionarCompra:", e); }); }
  function adicionarFiado(f)    { return docRef(COL_FIADO,    f.id).set(clean(f)).catch(function(e) { console.error("[PDV] adicionarFiado:", e); }); }
  function adicionarPerda(p)    { return docRef(COL_PERDAS,   p.id).set(clean(p)).catch(function(e) { console.error("[PDV] adicionarPerda:", e); }); }
  function adicionarSangria(s)  { return docRef(COL_SANGRIAS, s.id).set(clean(s)).catch(function(e) { console.error("[PDV] adicionarSangria:", e); }); }
  function adicionarDespesa(d)  { return docRef(COL_DESPESAS, d.id).set(clean(d)).catch(function(e) { console.error("[PDV] adicionarDespesa:", e); }); }

  function salvarCaixa(c) {
    return docRef(COL_CAIXAS, c.id).set(clean(c)).catch(function(e) { console.error("[PDV] salvarCaixa:", e); });
  }
  function salvarContaPagar(c) {
    return docRef(COL_CONTAS_PAGAR, c.id).set(clean(c)).catch(function(e) { console.error("[PDV] salvarContaPagar:", e); });
  }
  function salvarContaReceber(c) {
    return docRef(COL_CONTAS_RECEBER, c.id).set(clean(c)).catch(function(e) { console.error("[PDV] salvarContaReceber:", e); });
  }

  function quitarFiado(clienteId, todosOsFiados) {
    (todosOsFiados || []).filter(function(f) { return f.clienteId === clienteId; })
      .forEach(function(f) { docRef(COL_FIADO, f.id).set(clean(f)).catch(function(e) { console.error("[PDV] quitarFiado:", e); }); });
  }

  async function migrarDeBackup(data) {
    console.info("[PDV] Iniciando migração de backup...");
    try {
      var ops = [];
      ops.push(DOC_CONFIG.set(clean({ produtos: data.produtos||[], clientes: data.clientes||[], fornecedores: data.fornecedores||[], taxas: data.taxas||{}, nextId: data.nextId||{} })));
      var cols = [
        [COL_VENDAS,         data.vendas         || []],
        [COL_COMPRAS,        data.compras        || []],
        [COL_FIADO,          data.fiado          || []],
        [COL_PERDAS,         data.perdas         || []],
        [COL_SANGRIAS,       data.sangrias       || []],
        [COL_DESPESAS,       data.despesas       || []],
        [COL_CAIXAS,         data.caixas         || []],
        [COL_CONTAS_PAGAR,   data.contasPagar    || []],
        [COL_CONTAS_RECEBER, data.contasReceber  || []],
      ];
      cols.forEach(function(pair) {
        pair[1].forEach(function(item) { ops.push(docRef(pair[0], item.id).set(clean(item))); });
      });
      for (var i = 0; i < ops.length; i += 100) {
        await Promise.all(ops.slice(i, i + 100));
      }
      console.info("[PDV] Migração concluída — " + ops.length + " documentos.");
    } catch (err) {
      console.error("[PDV] Erro na migração:", err);
    }
  }

  window.FirebaseDB = {
    estaConfigurado    : function() { return true; },
    carregar           : carregar,
    ouvir              : ouvir,
    adicionarVenda     : adicionarVenda,
    adicionarCompra    : adicionarCompra,
    adicionarFiado     : adicionarFiado,
    quitarFiado        : quitarFiado,
    adicionarPerda     : adicionarPerda,
    adicionarSangria   : adicionarSangria,
    adicionarDespesa   : adicionarDespesa,
    salvarCaixa        : salvarCaixa,
    salvarContaPagar   : salvarContaPagar,
    salvarContaReceber : salvarContaReceber,
    salvarConfig       : salvarConfig,
    migrarDeBackup     : migrarDeBackup,
  };

  console.info("[PDV] Firebase pronto →", firebaseConfig.projectId);
}
