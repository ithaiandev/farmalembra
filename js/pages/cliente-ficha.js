// Ficha do cliente: dados, medicamentos, compras, lembretes, campanhas, opt-out
import { supabase } from '../supabase.js';
import { ehAdmin } from '../auth.js';
import { ir, recarregar } from '../router.js';
import {
  toast, mostrarErro, confirmar, abrirModal, htmlVazio, badgeStatus, badgeConsentimento, htmlTags,
} from '../ui.js';
import {
  esc, formatarData, formatarDataHora, formatarTelefone, linkWhatsApp, relativo, hojeISO,
} from '../utils.js';
import { abrirFormMedicamento, abrirRecompra, registrarRecompra } from '../componentes/medicamento-form.js';
import { mensagemPorTipo, mensagemLembrete } from '../mensagens.js';

export async function render(el, { params, query }) {
  const id = params.id;
  const [cli, meds, compras, lembretes, envios] = await Promise.all([
    supabase.from('clientes').select('*, criado_por_perfil:perfis!clientes_criado_por_fkey(nome)').eq('id', id).maybeSingle(),
    supabase.from('medicamentos_continuos').select('*').eq('cliente_id', id).order('ativo', { ascending: false }).order('proximo_fim'),
    supabase.from('compras').select('*, medicamentos_continuos(medicamento), perfis(nome)').eq('cliente_id', id)
      .order('data_compra', { ascending: false }).order('criado_em', { ascending: false }).limit(50),
    supabase.from('lembretes').select('*, medicamentos_continuos(medicamento), perfis(nome)').eq('cliente_id', id)
      .order('data_prevista', { ascending: false }).limit(50),
    supabase.from('campanha_envios').select('*, campanhas(titulo)').eq('cliente_id', id)
      .order('enviado_em', { ascending: false }).limit(50),
  ]);

  if (cli.error) mostrarErro(cli.error);
  const c = cli.data;
  if (!c) {
    el.innerHTML = htmlVazio('Cliente não encontrado.', '🔎');
    return;
  }
  const podeReceber = c.consentimento_whatsapp && !c.opt_out && c.ativo;
  const listaMeds = meds.data || [];

  el.innerHTML = `
    <a class="voltar" href="#/clientes">← Clientes</a>

    ${query.boasVindas && podeReceber ? `
      <div class="aviso ok">
        <span>👋 Cliente cadastrado com autorização. Quer enviar a mensagem de boas-vindas?</span>
        <button class="btn btn-whats btn-pequeno" data-boas-vindas>💬 Enviar boas-vindas</button>
      </div>` : ''}

    <div class="card">
      <div class="ficha-topo">
        <div class="avatar">${esc(c.nome.charAt(0).toUpperCase())}</div>
        <div class="item-principal">
          <h1 style="margin:0">${esc(c.nome)}</h1>
          <div>${badgeConsentimento(c)} ${c.ativo ? '' : '<span class="badge badge-cinza">Arquivado</span>'} ${htmlTags(c.tags)}</div>
        </div>
      </div>
      <dl class="dados">
        <dt>WhatsApp</dt><dd>${esc(formatarTelefone(c.telefone))}</dd>
        ${c.data_nascimento ? `<dt>Nascimento</dt><dd>${formatarData(c.data_nascimento)}</dd>` : ''}
        ${c.cpf ? `<dt>CPF</dt><dd>${esc(c.cpf)}</dd>` : ''}
        ${c.endereco || c.bairro ? `<dt>Endereço</dt><dd>${esc([c.endereco, c.bairro].filter(Boolean).join(' – '))}</dd>` : ''}
        ${c.observacoes ? `<dt>Observações</dt><dd>${esc(c.observacoes)}</dd>` : ''}
        <dt>Autorização</dt><dd>${c.consentimento_em ? `sim, em ${formatarDataHora(c.consentimento_em)}` : 'não autorizou'}</dd>
        ${c.opt_out ? `<dt>Pediu SAIR</dt><dd>${formatarDataHora(c.opt_out_em)}</dd>` : ''}
        <dt>Cadastrado</dt><dd>${formatarDataHora(c.criado_em)}${c.criado_por_perfil?.nome ? ` por ${esc(c.criado_por_perfil.nome)}` : ''}</dd>
      </dl>
      <div class="acoes-rapidas" style="margin-bottom:0">
        <a class="btn btn-whats" href="${linkWhatsApp(c.telefone)}" target="_blank" rel="noopener">💬 Abrir WhatsApp</a>
        <a class="btn btn-sec" href="#/clientes/${c.id}/editar">✏️ Editar dados</a>
        ${c.opt_out
          ? '<button class="btn btn-sec" data-voltar-receber>✅ Cliente voltou a autorizar</button>'
          : '<button class="btn btn-sec" data-opt-out>🚫 Cliente pediu para não receber mensagens</button>'}
      </div>
    </div>

    <div class="card">
      <h2>💊 Medicamentos contínuos
        <span class="acoes"><button class="btn btn-primario btn-pequeno" data-novo-med>➕ Adicionar</button></span></h2>
      <div data-meds>
        ${listaMeds.length ? listaMeds.map((m) => htmlMed(m)).join('')
          : htmlVazio('Nenhum medicamento cadastrado. Adicione o primeiro!', '💊')}
      </div>
    </div>

    <div class="grade-dupla">
      <div class="card">
        <h2>🧾 Histórico de compras</h2>
        ${(compras.data || []).length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Data</th><th>Medicamento</th><th class="num">Cx.</th><th>Registrado por</th></tr></thead>
          <tbody>${compras.data.map((x) => `<tr>
            <td>${formatarData(x.data_compra)}</td>
            <td>${esc(x.medicamentos_continuos?.medicamento)}</td>
            <td class="num">${x.quantidade_caixas}</td>
            <td>${esc(x.perfis?.nome ?? '—')}</td></tr>`).join('')}</tbody></table></div>`
          : htmlVazio('Sem compras registradas.', '🧾')}
      </div>

      <div class="card">
        <h2>🔔 Lembretes</h2>
        ${(lembretes.data || []).length ? `<ul class="lista">${lembretes.data.map((l) => `
          <li class="item"><div class="item-principal">
            <div class="item-titulo">${esc(l.medicamentos_continuos?.medicamento)}</div>
            <div class="item-sub">Acaba em ${formatarData(l.data_prevista)}
              ${l.enviado_em ? ` · enviado ${formatarDataHora(l.enviado_em)}` : ''}
              ${l.perfis?.nome ? ` por ${esc(l.perfis.nome)}` : ''}
              ${l.canal === 'api_whatsapp' ? ' · automático' : ''}
              ${l.erro ? `<br>⚠️ ${esc(l.erro)}` : ''}</div>
          </div>${badgeStatus(l.status)}</li>`).join('')}</ul>`
          : htmlVazio('Nenhum lembrete ainda.', '🔔')}

        <h2 style="margin-top:18px">📣 Campanhas recebidas</h2>
        ${(envios.data || []).length ? `<ul class="lista">${envios.data.map((v) => `
          <li class="item"><div class="item-principal">
            <div class="item-titulo">${esc(v.campanhas?.titulo)}</div>
            <div class="item-sub">${formatarDataHora(v.enviado_em)}</div>
          </div>${badgeStatus(v.status)}</li>`).join('')}</ul>`
          : htmlVazio('Nenhuma campanha recebida.', '📣')}
      </div>
    </div>

    ${ehAdmin() ? `
      <div class="card">
        <h2>Área do administrador</h2>
        <div class="acoes-rapidas" style="margin:0">
          <button class="btn btn-sec" data-arquivar>${c.ativo ? '🗄️ Arquivar cliente' : '♻️ Reativar cliente'}</button>
          <button class="btn btn-perigo" data-excluir>🗑️ Excluir cliente e todos os dados</button>
        </div>
      </div>` : ''}`;

  // ---- Ações dos medicamentos -------------------------------------------
  const acharMed = (mid) => listaMeds.find((m) => m.id === mid);

  el.querySelector('[data-meds]').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-acao]');
    if (!b) return;
    const m = acharMed(b.dataset.id);
    const acao = b.dataset.acao;

    if (acao === 'recompra') {
      // Um clique: hoje, mesma quantidade de caixas
      b.disabled = true;
      try {
        await registrarRecompra(m.id, m.quantidade_caixas, hojeISO());
        toast(`Recompra de ${m.medicamento} registrada! ✅`);
        recarregar();
      } catch (erro) {
        mostrarErro(erro);
        b.disabled = false;
      }
    } else if (acao === 'recompra-outra') {
      if (await abrirRecompra(m)) recarregar();
    } else if (acao === 'editar') {
      if (await abrirFormMedicamento({ clienteId: c.id, medicamento: m })) recarregar();
    } else if (acao === 'pausar') {
      const { error } = await supabase.from('medicamentos_continuos').update({ ativo: !m.ativo }).eq('id', m.id);
      if (error) return mostrarErro(error);
      toast(m.ativo ? 'Medicamento pausado (sem lembretes).' : 'Medicamento reativado.');
      recarregar();
    } else if (acao === 'lembrar') {
      // Envio avulso do lembrete deste medicamento
      const msg = await mensagemLembrete({ ...m, cliente_nome: c.nome });
      abrirEnvioAvulso(c, msg, async (texto) => {
        const { error } = await supabase.rpc('marcar_lembrete', {
          p_medicamento_id: m.id, p_status: 'enviado', p_mensagem: texto,
        });
        if (error) throw error;
      });
    } else if (acao === 'excluir') {
      const ok = await confirmar({
        titulo: 'Excluir medicamento',
        mensagem: `Excluir ${m.medicamento} e todo o histórico de compras e lembretes dele? Isso não pode ser desfeito.`,
        botao: 'Excluir', perigo: true,
      });
      if (!ok) return;
      const { error } = await supabase.from('medicamentos_continuos').delete().eq('id', m.id);
      if (error) return mostrarErro(error);
      toast('Medicamento excluído.');
      recarregar();
    }
  });

  const novoMed = async () => {
    if (await abrirFormMedicamento({ clienteId: c.id })) ir(`/clientes/${c.id}`);
  };
  el.querySelector('[data-novo-med]').addEventListener('click', novoMed);

  // ---- Boas-vindas --------------------------------------------------------
  const btnBV = el.querySelector('[data-boas-vindas]');
  if (btnBV) {
    const msgBV = await mensagemPorTipo('boas_vindas', c);
    btnBV.addEventListener('click', () => {
      window.open(linkWhatsApp(c.telefone, msgBV), '_blank', 'noopener');
      btnBV.closest('.aviso').remove();
    });
  }

  // ---- Opt-out / voltar a receber ----------------------------------------
  el.querySelector('[data-opt-out]')?.addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Parar de enviar mensagens',
      mensagem: `${c.nome} não vai mais receber lembretes nem campanhas. Confirmar?`,
      botao: 'Sim, parar de enviar', perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('clientes').update({ opt_out: true }).eq('id', c.id);
    if (error) return mostrarErro(error);
    toast('Pronto. Este cliente não receberá mais mensagens.');
    recarregar();
  });

  el.querySelector('[data-voltar-receber]')?.addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Voltar a enviar mensagens',
      mensagem: `Confirme que ${c.nome} pediu/autorizou novamente receber mensagens pelo WhatsApp.`,
      botao: 'Cliente autorizou',
    });
    if (!ok) return;
    const { error } = await supabase.from('clientes')
      .update({ opt_out: false, consentimento_whatsapp: true }).eq('id', c.id);
    if (error) return mostrarErro(error);
    toast('Autorização registrada.');
    recarregar();
  });

  // ---- Admin: arquivar / excluir -----------------------------------------
  el.querySelector('[data-arquivar]')?.addEventListener('click', async () => {
    const { error } = await supabase.from('clientes').update({ ativo: !c.ativo }).eq('id', c.id);
    if (error) return mostrarErro(error);
    toast(c.ativo ? 'Cliente arquivado.' : 'Cliente reativado.');
    recarregar();
  });

  el.querySelector('[data-excluir]')?.addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Excluir cliente',
      mensagem: `Excluir ${c.nome} com TODOS os medicamentos, compras e lembretes? Use isso quando o cliente pedir a exclusão dos dados (LGPD). Não pode ser desfeito.`,
      botao: 'Excluir definitivamente', perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('clientes').delete().eq('id', c.id);
    if (error) return mostrarErro(error);
    toast('Cliente excluído.');
    ir('/clientes');
  });

  if (query.novoMed) {
    history.replaceState(null, '', `#/clientes/${c.id}`);
    novoMed();
  }

  // ---------------------------------------------------------------------------
  function htmlMed(m) {
    const dias = m.ativo ? `<span class="badge ${m.proximo_fim < hojeISO() ? 'badge-vermelho' : 'badge-azul'}">acaba ${relativo(m.proximo_fim)}</span>` : '<span class="badge badge-cinza">Pausado</span>';
    return `
      <div class="med ${m.ativo ? '' : 'pausado'}">
        <div class="med-topo">
          <div><div class="med-nome">${esc(m.medicamento)}</div>
            ${m.apresentacao ? `<div class="suave pequeno">${esc(m.apresentacao)}</div>` : ''}</div>
          ${dias}
        </div>
        <div class="med-datas">
          <span>Última compra: <strong>${formatarData(m.ultima_compra)}</strong></span>
          <span>${m.quantidade_caixas} cx × ${m.duracao_dias} dias</span>
          <span>Acaba: <strong>${formatarData(m.proximo_fim)}</strong></span>
          <span>Lembrete: <strong>${formatarData(m.data_lembrete)}</strong></span>
        </div>
        ${m.observacoes ? `<p class="pequeno suave">${esc(m.observacoes)}</p>` : ''}
        <div class="item-acoes">
          <button class="btn btn-verde btn-pequeno" data-acao="recompra" data-id="${m.id}">✓ Recomprou hoje</button>
          <button class="btn btn-sec btn-pequeno" data-acao="recompra-outra" data-id="${m.id}">Outra data/qtd.</button>
          ${podeReceber && m.ativo ? `<button class="btn btn-sec btn-pequeno" data-acao="lembrar" data-id="${m.id}">💬 Lembrar agora</button>` : ''}
          <button class="btn btn-sec btn-pequeno" data-acao="editar" data-id="${m.id}">✏️ Editar</button>
          <button class="btn btn-sec btn-pequeno" data-acao="pausar" data-id="${m.id}">${m.ativo ? '⏸ Pausar' : '▶ Reativar'}</button>
          ${ehAdmin() ? `<button class="btn btn-link btn-pequeno" data-acao="excluir" data-id="${m.id}">Excluir</button>` : ''}
        </div>
      </div>`;
  }
}

/** Modal com a mensagem editável e o botão que abre o WhatsApp */
function abrirEnvioAvulso(cliente, mensagem, aoEnviar) {
  return abrirModal({
    titulo: `Mensagem para ${cliente.nome}`,
    html: `
      <label class="campo"><span>Mensagem</span><textarea rows="7" data-msg>${esc(mensagem)}</textarea></label>
      <div class="acoes-modal">
        <button type="button" class="btn btn-sec" data-cancelar>Cancelar</button>
        <button type="button" class="btn btn-whats btn-grande" data-enviar>💬 Enviar no WhatsApp</button>
      </div>`,
    aoAbrir(dlg, fechar) {
      dlg.querySelector('[data-cancelar]').addEventListener('click', () => fechar());
      dlg.querySelector('[data-enviar]').addEventListener('click', async () => {
        const texto = dlg.querySelector('[data-msg]').value.trim();
        window.open(linkWhatsApp(cliente.telefone, texto), '_blank', 'noopener');
        try {
          await aoEnviar(texto);
          toast('Lembrete registrado como enviado.');
        } catch (erro) {
          mostrarErro(erro, 'Abri o WhatsApp, mas não consegui registrar o envio.');
        }
        fechar(true);
        recarregar();
      });
    },
  });
}
