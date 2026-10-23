// Lembretes: Hoje / Atrasados / Próximos 7 dias / Histórico + modo fila
import { supabase } from '../supabase.js';
import { recarregar } from '../router.js';
import { toast, mostrarErro, confirmar, htmlVazio, htmlCarregando, badgeStatus } from '../ui.js';
import { esc, formatarData, formatarDataHora, formatarTelefone, linkWhatsApp, relativo } from '../utils.js';
import { mensagemLembrete } from '../mensagens.js';
import { textoModeloPadrao } from '../store.js';
import { abrirFila } from '../fila.js';
import { abrirRecompra } from '../componentes/medicamento-form.js';

const ABAS = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'atrasados', rotulo: 'Atrasados' },
  { id: 'proximos', rotulo: 'Próximos 7 dias' },
  { id: 'historico', rotulo: 'Histórico' },
];

/** Grava o lembrete como enviado */
async function marcar(item, status, mensagem = null) {
  const { error } = await supabase.rpc('marcar_lembrete', {
    p_medicamento_id: item.medicamento_id, p_status: status, p_mensagem: mensagem,
  });
  if (error) throw error;
}

export async function render(el, { query }) {
  let aba = ABAS.some((a) => a.id === query.aba) ? query.aba : 'hoje';

  const [hoje, atrasados, proximos] = await Promise.all([
    supabase.from('vw_lembretes_hoje').select('*').order('proximo_fim'),
    supabase.from('vw_atrasados').select('*').order('proximo_fim', { ascending: false }),
    supabase.from('vw_proximos_7_dias').select('*').order('data_lembrete'),
  ]);
  const erro = hoje.error || atrasados.error || proximos.error;
  if (erro) {
    mostrarErro(erro);
    el.innerHTML = htmlVazio('Não foi possível carregar os lembretes.', '⚠️');
    return;
  }
  const dados = { hoje: hoje.data, atrasados: atrasados.data, proximos: proximos.data };

  // Mensagens prontas (o clique precisa abrir o WhatsApp na hora)
  const modelo = await textoModeloPadrao('lembrete');
  const mensagens = new Map();
  for (const item of [...dados.hoje, ...dados.atrasados]) {
    mensagens.set(item.medicamento_id, await mensagemLembrete(item, modelo));
  }

  el.innerHTML = `
    <div class="cabecalho">
      <h1>🔔 Lembretes</h1>
      <div class="acoes"><button class="btn btn-whats" data-fila ${dados.hoje.length ? '' : 'disabled'}>
        ▶ Modo fila (${dados.hoje.length})</button></div>
    </div>
    <div class="abas" role="tablist">
      ${ABAS.map((a) => `<button class="aba" role="tab" data-aba="${a.id}">${a.rotulo}
        ${dados[a.id] ? `<span class="contagem">(${dados[a.id].length})</span>` : ''}</button>`).join('')}
    </div>
    <div class="card" data-conteudo></div>`;

  const conteudo = el.querySelector('[data-conteudo]');

  const mostrarAba = (id) => {
    aba = id;
    el.querySelectorAll('[data-aba]').forEach((b) => {
      b.classList.toggle('ativo', b.dataset.aba === id);
      b.setAttribute('aria-selected', b.dataset.aba === id);
    });
    history.replaceState(null, '', `#/lembretes?aba=${id}`);
    if (id === 'historico') return desenharHistorico(conteudo);
    conteudo.innerHTML = desenharLista(id, dados[id]);
  };
  el.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => mostrarAba(b.dataset.aba)));

  function desenharLista(id, lista) {
    const textos = {
      hoje: 'Nenhum lembrete para enviar hoje. 🎉',
      atrasados: 'Nenhum cliente com remédio acabado sem recompra.',
      proximos: 'Nenhum lembrete nos próximos 7 dias.',
    };
    if (!lista.length) return htmlVazio(textos[id], '✅');
    return `<ul class="lista">${lista.map((i) => `
      <li class="item">
        <div class="item-principal">
          <div class="item-titulo"><a href="#/clientes/${i.cliente_id}">${esc(i.cliente_nome)}</a></div>
          <div class="item-sub">💊 ${esc(i.medicamento)} · acaba <strong>${formatarData(i.proximo_fim)}</strong> (${relativo(i.proximo_fim)})
            ${id === 'proximos' ? ` · lembrete em ${formatarData(i.data_lembrete)}` : ''}
            <br>📱 ${esc(formatarTelefone(i.telefone))}
            ${i.lembrete_status ? ' · ' + badgeStatus(i.lembrete_status) : ''}
            ${!i.pode_receber ? ' · <span class="badge badge-amarelo">sem autorização</span>' : ''}
            ${i.lembrete_erro ? `<br>⚠️ ${esc(i.lembrete_erro)}` : ''}</div>
        </div>
        <div class="item-acoes">
          ${id !== 'proximos' && i.pode_receber ? `<button class="btn btn-whats btn-pequeno" data-enviar="${i.medicamento_id}">💬 Enviar no WhatsApp</button>` : ''}
          <button class="btn btn-verde btn-pequeno" data-recomprou="${i.medicamento_id}">✓ Recomprou</button>
          ${id === 'hoje' ? `<button class="btn btn-link btn-pequeno" data-cancelar="${i.medicamento_id}">Cancelar</button>` : ''}
        </div>
      </li>`).join('')}</ul>`;
  }

  const acharItem = (mid) => (dados[aba] || []).find((i) => i.medicamento_id === mid);

  conteudo.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;

    if (b.dataset.enviar) {
      const item = acharItem(b.dataset.enviar);
      const msg = mensagens.get(item.medicamento_id);
      window.open(linkWhatsApp(item.telefone, msg), '_blank', 'noopener');
      b.disabled = true;
      try {
        await marcar(item, 'enviado', msg);
        toast(`Lembrete de ${item.cliente_nome.split(' ')[0]} marcado como enviado.`);
        if (aba === 'hoje') b.closest('li').remove();
        else b.outerHTML = badgeStatus('enviado');
      } catch (erro) {
        mostrarErro(erro, 'O WhatsApp abriu, mas não consegui registrar o envio.');
        b.disabled = false;
      }
    } else if (b.dataset.recomprou) {
      const item = acharItem(b.dataset.recomprou);
      if (await abrirRecompra({ ...item, id: item.medicamento_id })) recarregar();
    } else if (b.dataset.cancelar) {
      const item = acharItem(b.dataset.cancelar);
      const ok = await confirmar({
        titulo: 'Cancelar lembrete',
        mensagem: `Não lembrar ${item.cliente_nome} sobre ${item.medicamento} neste ciclo?`,
        botao: 'Cancelar lembrete', perigo: true,
      });
      if (!ok) return;
      try {
        await marcar(item, 'cancelado');
        toast('Lembrete cancelado.');
        recarregar();
      } catch (erro) { mostrarErro(erro); }
    }
  });

  // Modo fila: um por vez
  const iniciarFila = async () => {
    await abrirFila({
      titulo: 'Lembretes de hoje',
      itens: dados.hoje.filter((i) => i.pode_receber),
      montar: async (i) => ({
        nome: i.cliente_nome,
        detalhe: `💊 ${esc(i.medicamento)} · acaba ${formatarData(i.proximo_fim)}`,
        telefone: i.telefone,
        mensagem: mensagens.get(i.medicamento_id),
      }),
      aoEnviar: (i, msg) => marcar(i, 'enviado', msg),
      extras: [
        { rotulo: '✓ Cliente recomprou', classe: 'btn-verde',
          acao: (i) => abrirRecompra({ ...i, id: i.medicamento_id }) },
        { rotulo: 'Cancelar', acao: (i) => marcar(i, 'cancelado') },
      ],
    });
    recarregar();
  };
  el.querySelector('[data-fila]').addEventListener('click', iniciarFila);

  mostrarAba(aba);
  if (query.fila && dados.hoje.length) iniciarFila();
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------
async function desenharHistorico(conteudo) {
  conteudo.innerHTML = `
    <div class="barra-filtros">
      <select data-status aria-label="Filtrar status">
        <option value="">Todos os status</option>
        <option value="enviado">Enviado (aguardando)</option>
        <option value="recomprou">Recomprou</option>
        <option value="sem_retorno">Sem retorno</option>
        <option value="cancelado">Cancelado</option>
        <option value="pendente">Pendente (erro)</option>
      </select>
    </div>
    <div data-tabela>${htmlCarregando()}</div>`;

  const carregar = async () => {
    const status = conteudo.querySelector('[data-status]').value;
    let q = supabase.from('lembretes')
      .select('*, clientes(nome), medicamentos_continuos(medicamento), perfis(nome)')
      .order('atualizado_em', { ascending: false }).limit(150);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    const alvo = conteudo.querySelector('[data-tabela]');
    if (error) { mostrarErro(error); alvo.innerHTML = ''; return; }
    alvo.innerHTML = data.length ? `<div class="tabela-wrap"><table>
      <thead><tr><th>Cliente</th><th>Medicamento</th><th>Acaba em</th><th>Enviado em</th><th>Por</th><th>Status</th></tr></thead>
      <tbody>${data.map((l) => `<tr>
        <td><a href="#/clientes/${l.cliente_id}">${esc(l.clientes?.nome)}</a></td>
        <td>${esc(l.medicamentos_continuos?.medicamento)}</td>
        <td>${formatarData(l.data_prevista)}</td>
        <td>${formatarDataHora(l.enviado_em)}</td>
        <td>${l.canal === 'api_whatsapp' ? 'automático' : esc(l.perfis?.nome ?? '—')}</td>
        <td>${badgeStatus(l.status)}</td></tr>`).join('')}</tbody></table></div>`
      : htmlVazio('Nenhum lembrete no histórico.', '🗂️');
  };
  conteudo.querySelector('[data-status]').addEventListener('change', carregar);
  carregar();
}
