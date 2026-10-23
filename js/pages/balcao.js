// =====================================================================
// Fluxo rápido de balcão ("Registrar compra") — meta: menos de 30 segundos
// 1) telefone → 2) cliente (acha ou cadastra) → 3) medicamento → pronto
// =====================================================================
import { supabase } from '../supabase.js';
import { toast, mostrarErro, comBotaoOcupado, htmlCarregando } from '../ui.js';
import {
  esc, normalizarTelefone, formatarTelefone, aplicarMascaraTelefone, linkWhatsApp,
  formatarData, relativo, hojeISO,
} from '../utils.js';
import {
  htmlCamposMedicamento, ligarCamposMedicamento, dadosMedicamento, registrarRecompra,
} from '../componentes/medicamento-form.js';
import { mensagemPorTipo } from '../mensagens.js';

export async function render(el) {
  passoTelefone(el);
}

// ---------------------------------------------------------------------------
// Passo 1: telefone (ou nome)
// ---------------------------------------------------------------------------
function passoTelefone(el) {
  el.innerHTML = `
    <div class="cabecalho"><h1>🛒 Registrar compra</h1></div>
    <form class="card" data-form novalidate>
      <div class="passo"><b>1</b> Telefone do cliente</div>
      <label class="campo">
        <span>WhatsApp do cliente</span>
        <input name="telefone" data-tel placeholder="(98) 9 9999-9999" style="font-size:1.3rem">
      </label>
      <button class="btn btn-primario btn-grande btn-bloco">Buscar cliente</button>
      <p class="centro pequeno" style="margin:12px 0 0">ou <a href="#" data-por-nome>buscar pelo nome</a></p>
      <div data-resultados></div>
    </form>`;

  const form = el.querySelector('[data-form]');
  const tel = el.querySelector('[data-tel]');
  aplicarMascaraTelefone(tel);
  tel.focus();
  tel.setSelectionRange(tel.value.length, tel.value.length);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const telefone = normalizarTelefone(tel.value);
    if (!telefone) return toast('Digite o telefone completo com DDD.', 'erro');
    await comBotaoOcupado(form.querySelector('button'), async () => {
      const { data, error } = await supabase.from('clientes').select('*').eq('telefone', telefone).maybeSingle();
      if (error) return mostrarErro(error);
      if (data) passoCliente(el, data);
      else passoNovoCliente(el, telefone);
    }, 'Buscando...');
  });

  // Busca por nome
  el.querySelector('[data-por-nome]').addEventListener('click', (e) => {
    e.preventDefault();
    const res = el.querySelector('[data-resultados]');
    res.innerHTML = `<label class="campo" style="margin-top:12px"><span>Nome</span>
      <input type="search" data-nome placeholder="Digite parte do nome"></label><ul class="lista" data-lista></ul>`;
    const inp = res.querySelector('[data-nome]');
    inp.focus();
    let t;
    inp.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const termo = inp.value.replace(/[,()%*]/g, ' ').trim();
        const lista = res.querySelector('[data-lista]');
        if (termo.length < 2) { lista.innerHTML = ''; return; }
        const { data } = await supabase.from('clientes').select('*').ilike('nome', `%${termo}%`).eq('ativo', true).order('nome').limit(10);
        lista.innerHTML = (data || []).map((c, i) => `
          <li class="item"><button type="button" class="btn btn-sec btn-bloco" data-i="${i}" style="justify-content:flex-start">
            ${esc(c.nome)} · <span class="suave">${esc(formatarTelefone(c.telefone))}</span></button></li>`).join('')
          || '<li class="suave pequeno" style="padding:8px 0">Nenhum cliente com esse nome.</li>';
        lista.querySelectorAll('[data-i]').forEach((b) =>
          b.addEventListener('click', () => passoCliente(el, data[Number(b.dataset.i)])));
      }, 300);
    });
  });
}

// ---------------------------------------------------------------------------
// Passo 2a: cliente novo (cadastro mínimo)
// ---------------------------------------------------------------------------
function passoNovoCliente(el, telefone) {
  el.innerHTML = `
    <div class="cabecalho"><h1>🛒 Registrar compra</h1></div>
    <form class="card" data-form novalidate>
      <div class="passo"><b>2</b> Cliente novo</div>
      <div class="aviso info">Nenhum cliente com o telefone <strong>${esc(formatarTelefone(telefone))}</strong>. Cadastre rapidinho:</div>
      <label class="campo"><span>Nome completo *</span>
        <input name="nome" required autocomplete="off" autocapitalize="words"></label>
      <label class="checkbox destaque">
        <input type="checkbox" name="consentimento">
        <span>Cliente autorizou receber mensagens pelo WhatsApp (LGPD)
          <small>Pergunte: "Posso te avisar pelo WhatsApp quando seu remédio estiver acabando?"</small></span>
      </label>
      <div class="acoes-modal">
        <button type="button" class="btn btn-sec" data-voltar>← Voltar</button>
        <button class="btn btn-primario btn-grande">Continuar</button>
      </div>
    </form>`;

  const form = el.querySelector('[data-form]');
  form.nome.focus();
  el.querySelector('[data-voltar]').addEventListener('click', () => passoTelefone(el));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = form.nome.value.trim();
    if (!nome) return toast('Informe o nome.', 'erro');
    await comBotaoOcupado(form.querySelector('button:not([data-voltar])'), async () => {
      const { data, error } = await supabase.from('clientes')
        .insert({ nome, telefone, consentimento_whatsapp: form.consentimento.checked })
        .select('*').single();
      if (error) return mostrarErro(error);
      toast('Cliente cadastrado!');
      passoMedicamento(el, data, { novo: true });
    }, 'Salvando...');
  });
}

// ---------------------------------------------------------------------------
// Passo 2b: cliente encontrado → escolhe o medicamento que comprou
// ---------------------------------------------------------------------------
async function passoCliente(el, cliente) {
  el.innerHTML = htmlCarregando();
  const { data: meds, error } = await supabase.from('medicamentos_continuos')
    .select('*').eq('cliente_id', cliente.id).order('ativo', { ascending: false }).order('medicamento');
  if (error) return mostrarErro(error);

  el.innerHTML = `
    <div class="cabecalho"><h1>🛒 Registrar compra</h1></div>
    <div class="card">
      <div class="passo"><b>2</b> O que ${esc(cliente.nome.split(' ')[0])} comprou?</div>
      <div class="ficha-topo" style="margin-bottom:12px">
        <div class="avatar">${esc(cliente.nome.charAt(0).toUpperCase())}</div>
        <div class="item-principal">
          <div class="item-titulo"><a href="#/clientes/${cliente.id}">${esc(cliente.nome)}</a></div>
          <div class="item-sub">${esc(formatarTelefone(cliente.telefone))}</div>
        </div>
      </div>
      ${!cliente.consentimento_whatsapp && !cliente.opt_out ? `
        <label class="checkbox destaque" data-consent>
          <input type="checkbox"> <span>Cliente autorizou receber mensagens pelo WhatsApp (LGPD)
          <small>Ainda não autorizou. Marque se ele concordar agora.</small></span></label>` : ''}
      ${(meds || []).map((m) => `
        <div class="med ${m.ativo ? '' : 'pausado'}">
          <div class="med-topo">
            <div><div class="med-nome">${esc(m.medicamento)}</div>
              <div class="suave pequeno">${esc(m.apresentacao || '')} · última compra ${formatarData(m.ultima_compra)}
                · acaba ${relativo(m.proximo_fim)}</div></div>
          </div>
          <div class="item-acoes" style="margin-top:8px; align-items:center">
            <label class="pequeno">Caixas <input type="number" min="1" max="50" value="${m.quantidade_caixas}"
              data-qtd="${m.id}" style="width:80px;min-height:40px;display:inline-block"></label>
            <button class="btn btn-verde" data-comprou="${m.id}">✓ Comprou hoje</button>
          </div>
        </div>`).join('')}
      <button class="btn btn-primario btn-grande btn-bloco" data-novo>➕ Outro medicamento</button>
      <button class="btn btn-link btn-bloco" data-voltar style="margin-top:8px">← Outro cliente</button>
    </div>`;

  el.querySelector('[data-voltar]').addEventListener('click', () => passoTelefone(el));
  el.querySelector('[data-novo]').addEventListener('click', async () => {
    await salvarConsentimento();
    passoMedicamento(el, cliente);
  });

  async function salvarConsentimento() {
    const caixa = el.querySelector('[data-consent] input');
    if (caixa?.checked) {
      const { error } = await supabase.from('clientes').update({ consentimento_whatsapp: true }).eq('id', cliente.id);
      if (error) mostrarErro(error);
      else cliente.consentimento_whatsapp = true;
    }
  }

  el.querySelectorAll('[data-comprou]').forEach((b) => b.addEventListener('click', async () => {
    const m = meds.find((x) => x.id === b.dataset.comprou);
    const qtd = el.querySelector(`[data-qtd="${m.id}"]`).value;
    await comBotaoOcupado(b, async () => {
      try {
        await salvarConsentimento();
        await registrarRecompra(m.id, qtd, hojeISO());
        passoPronto(el, cliente, m.medicamento, false);
      } catch (erro) {
        mostrarErro(erro);
      }
    }, 'Salvando...');
  }));
}

// ---------------------------------------------------------------------------
// Passo 3: novo medicamento
// ---------------------------------------------------------------------------
function passoMedicamento(el, cliente, { novo = false } = {}) {
  el.innerHTML = `
    <div class="cabecalho"><h1>🛒 Registrar compra</h1></div>
    <form class="card" data-form novalidate>
      <div class="passo"><b>3</b> Medicamento de uso contínuo</div>
      <p class="suave">${esc(cliente.nome)} · ${esc(formatarTelefone(cliente.telefone))}</p>
      ${htmlCamposMedicamento({})}
      <div class="acoes-modal">
        ${novo ? '' : '<button type="button" class="btn btn-sec" data-voltar>← Voltar</button>'}
        <button class="btn btn-verde btn-grande">✓ Salvar compra</button>
      </div>
    </form>`;

  const form = el.querySelector('[data-form]');
  ligarCamposMedicamento(form);
  form.medicamento.focus();
  el.querySelector('[data-voltar]')?.addEventListener('click', () => passoCliente(el, cliente));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const dados = dadosMedicamento(form);
    await comBotaoOcupado(form.querySelector('button:not([data-voltar])'), async () => {
      const { error } = await supabase.from('medicamentos_continuos').insert({ ...dados, cliente_id: cliente.id });
      if (error) return mostrarErro(error);
      passoPronto(el, cliente, dados.medicamento, novo);
    }, 'Salvando...');
  });
}

// ---------------------------------------------------------------------------
// Pronto!
// ---------------------------------------------------------------------------
async function passoPronto(el, cliente, medicamento, novo) {
  const pode = cliente.consentimento_whatsapp && !cliente.opt_out;
  const msgBV = novo && pode ? await mensagemPorTipo('boas_vindas', cliente) : '';
  el.innerHTML = `
    <div class="card centro">
      <div class="vazio-icone">✅</div>
      <h2>Compra registrada!</h2>
      <p>${esc(cliente.nome)} · ${esc(medicamento)}</p>
      ${!pode ? '<div class="aviso">Este cliente não autorizou mensagens, então não receberá lembretes.</div>' : ''}
      <div class="acoes-rapidas">
        ${msgBV ? `<a class="btn btn-whats btn-grande" target="_blank" rel="noopener"
            href="${esc(linkWhatsApp(cliente.telefone, msgBV))}">💬 Enviar boas-vindas</a>` : ''}
        <button class="btn btn-primario btn-grande" data-de-novo>🛒 Próximo cliente</button>
        <a class="btn btn-sec btn-grande" href="#/clientes/${cliente.id}">Ver ficha</a>
      </div>
    </div>`;
  el.querySelector('[data-de-novo]').addEventListener('click', () => passoTelefone(el));
}
