// Criar / editar / enviar campanha
import { supabase } from '../supabase.js';
import { ehAdmin } from '../auth.js';
import { ir, recarregar } from '../router.js';
import {
  toast, mostrarErro, confirmar, comBotaoOcupado, htmlVazio, badgeStatus,
  htmlBotoesVariaveis, ligarBotoesVariaveis,
} from '../ui.js';
import { esc, debounce, formatarDataHora, formatarTelefone, hojeISO, TAGS_PADRAO, lerFormulario } from '../utils.js';
import { obterModelos } from '../store.js';
import { mensagemLivre, previaMensagem } from '../mensagens.js';
import { abrirFila } from '../fila.js';

const VARS_CAMPANHA = ['{nome}', '{farmacia}', '{telefone_farmacia}', '{endereco}', '{horario}'];

/** Lista de destinatários (o banco já exclui quem não autorizou ou pediu SAIR) */
async function buscarPublico(tags, aniversariantes, apenasContar = false) {
  const q = supabase.rpc('clientes_publico', { p_tags: tags, p_aniversariantes: aniversariantes },
    apenasContar ? { count: 'exact', head: true } : undefined);
  const { data, count, error } = apenasContar ? await q : await q.select('id, nome, telefone');
  if (error) throw error;
  return apenasContar ? count : data;
}

export async function render(el, { params }) {
  const nova = !params.id;
  let camp = {
    titulo: '', mensagem: '', imagem_url: '', filtro_tags: [], filtro_aniversariantes_mes: false,
    data_envio: hojeISO(), status: 'rascunho',
  };
  if (!nova) {
    const { data, error } = await supabase.from('campanhas').select('*').eq('id', params.id).maybeSingle();
    if (error || !data) {
      el.innerHTML = htmlVazio('Campanha não encontrada.', '🔎');
      return;
    }
    camp = data;
  }

  const modelos = (await obterModelos()).filter((m) => m.tipo === 'campanha' || m.tipo === 'aniversario');
  if (nova && !camp.mensagem) camp.mensagem = modelos.find((m) => m.tipo === 'campanha' && m.padrao)?.texto ?? '';

  // Tags já usadas pelos clientes (além das padrão)
  const { data: tagsUsadas } = await supabase.from('clientes').select('tags').neq('tags', '{}').limit(1000);
  const todasTags = [...new Set([...TAGS_PADRAO, ...(tagsUsadas || []).flatMap((c) => c.tags), ...camp.filtro_tags])];

  const publicoInicial = camp.filtro_aniversariantes_mes ? 'aniversariantes' : camp.filtro_tags.length ? 'tags' : 'todos';
  const concluida = camp.status === 'concluida';

  el.innerHTML = `
    <a class="voltar" href="#/campanhas">← Campanhas</a>
    <div class="cabecalho">
      <h1>${nova ? 'Nova campanha' : esc(camp.titulo)}</h1>
      ${nova ? '' : badgeStatus(camp.status)}
    </div>
    <div class="aviso">⚖️ Promova produtos como fraldas, dermocosméticos e eventos. Evite anunciar medicamentos de prescrição.</div>

    <div class="grade-dupla">
      <form class="card" data-form novalidate>
        <label class="campo"><span>Título (só aparece para a equipe) *</span>
          <input name="titulo" required value="${esc(camp.titulo)}" placeholder="Ex.: Sexta-feira da Fralda — novembro"></label>

        ${modelos.length ? `<label class="campo"><span>Começar de um modelo</span>
          <select data-modelo><option value="">— escolher —</option>
            ${modelos.map((m) => `<option value="${m.id}">${esc(m.titulo)}</option>`).join('')}</select></label>` : ''}

        <label class="campo"><span>Mensagem *</span>
          <textarea name="mensagem" rows="8" required>${esc(camp.mensagem)}</textarea></label>
        ${htmlBotoesVariaveis(VARS_CAMPANHA)}

        <label class="campo"><span>Link de imagem (opcional)</span>
          <input name="imagem_url" type="url" value="${esc(camp.imagem_url)}" placeholder="https://...">
          <small>O link vai no fim da mensagem e o WhatsApp mostra a prévia da imagem.</small></label>

        <label class="campo"><span>Data de envio</span>
          <input type="date" name="data_envio" value="${esc(camp.data_envio)}"></label>

        <fieldset class="campo" style="border:0;padding:0;margin:0 0 14px">
          <span style="font-weight:600;font-size:.9rem">Quem vai receber</span>
          <div class="chips" style="margin-top:6px">
            <label class="chip"><input type="radio" name="publico" value="todos" ${publicoInicial === 'todos' ? 'checked' : ''}> Todos</label>
            <label class="chip"><input type="radio" name="publico" value="tags" ${publicoInicial === 'tags' ? 'checked' : ''}> Por tags</label>
            <label class="chip"><input type="radio" name="publico" value="aniversariantes" ${publicoInicial === 'aniversariantes' ? 'checked' : ''}> Aniversariantes do mês</label>
          </div>
          <div class="chips ${publicoInicial === 'tags' ? '' : 'oculto'}" data-tags style="margin-top:10px">
            ${todasTags.map((t) => `<button type="button" class="chip" data-tag="${esc(t)}"
              aria-pressed="${camp.filtro_tags.includes(t)}">${esc(t)}</button>`).join('')}
          </div>
        </fieldset>
        <div class="aviso info" data-contagem>Calculando destinatários...</div>

        <div class="acoes-modal">
          <button type="submit" class="btn btn-sec" data-acao="salvar">💾 Salvar rascunho</button>
          <button type="submit" class="btn btn-whats btn-grande" data-acao="enviar">
            ${camp.status === 'enviando' ? '▶ Continuar envio' : concluida ? '▶ Enviar aos que faltam' : '▶ Salvar e enviar'}</button>
        </div>
        ${!nova && ehAdmin() ? '<button type="button" class="btn btn-link" data-excluir style="margin-top:8px">🗑️ Excluir campanha</button>' : ''}
      </form>

      <div>
        <div class="card">
          <h2>👀 Pré-visualização</h2>
          <div class="previa-whats"><div class="balao" data-previa></div></div>
          <p class="suave pequeno" style="margin-top:8px">Exemplo com a cliente "Maria Silva".</p>
        </div>
        ${nova ? '' : '<div class="card"><h2>📬 Envios</h2><div data-envios></div></div>'}
      </div>
    </div>`;

  const form = el.querySelector('[data-form]');
  const txt = form.mensagem;
  const tagsBox = el.querySelector('[data-tags]');
  const contagemEl = el.querySelector('[data-contagem]');

  const lerPublico = () => {
    const tipo = form.querySelector('[name=publico]:checked').value;
    const tags = tipo === 'tags' ? [...tagsBox.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.tag) : [];
    return { tipo, tags, aniversariantes: tipo === 'aniversariantes' };
  };

  const atualizarPrevia = async () => {
    const img = form.imagem_url.value.trim();
    el.querySelector('[data-previa]').textContent = (await previaMensagem(txt.value)) + (img ? `\n\n${img}` : '');
  };
  const atualizarContagem = debounce(async () => {
    const p = lerPublico();
    if (p.tipo === 'tags' && !p.tags.length) {
      contagemEl.textContent = 'Escolha pelo menos uma tag.';
      return;
    }
    try {
      const n = await buscarPublico(p.tags, p.aniversariantes, true);
      contagemEl.innerHTML = `👥 <strong>${n}</strong> cliente(s) vão receber (somente quem autorizou e não pediu SAIR).`;
    } catch (e) {
      contagemEl.textContent = 'Não foi possível contar os destinatários.';
    }
  }, 300);

  ligarBotoesVariaveis(form, txt, atualizarPrevia);
  txt.addEventListener('input', atualizarPrevia);
  form.imagem_url.addEventListener('input', atualizarPrevia);
  form.querySelectorAll('[name=publico]').forEach((r) => r.addEventListener('change', () => {
    tagsBox.classList.toggle('oculto', lerPublico().tipo !== 'tags');
    atualizarContagem();
  }));
  tagsBox.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') !== 'true');
    atualizarContagem();
  });
  el.querySelector('[data-modelo]')?.addEventListener('change', (e) => {
    const m = modelos.find((x) => x.id === e.target.value);
    if (m) { txt.value = m.texto; atualizarPrevia(); }
  });
  atualizarPrevia();
  atualizarContagem();

  // Envios já feitos
  let enviadosIds = new Set();
  if (!nova) {
    const { data: envios } = await supabase.from('campanha_envios')
      .select('cliente_id, status, enviado_em, clientes(nome, telefone)')
      .eq('campanha_id', camp.id).order('enviado_em', { ascending: false });
    enviadosIds = new Set((envios || []).map((v) => v.cliente_id));
    el.querySelector('[data-envios]').innerHTML = (envios || []).length ? `<ul class="lista">${envios.map((v) => `
      <li class="item"><div class="item-principal">
        <div class="item-titulo"><a href="#/clientes/${v.cliente_id}">${esc(v.clientes?.nome)}</a></div>
        <div class="item-sub">${esc(formatarTelefone(v.clientes?.telefone))} · ${formatarDataHora(v.enviado_em)}</div>
      </div>${badgeStatus(v.status)}</li>`).join('')}</ul>`
      : htmlVazio('Nenhum envio ainda.', '📬');
  }

  // Salvar / enviar
  let acao = 'salvar';
  form.querySelectorAll('[type=submit]').forEach((b) => b.addEventListener('click', () => { acao = b.dataset.acao; }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = lerFormulario(form);
    const p = lerPublico();
    if (!d.titulo) return toast('Dê um título para a campanha.', 'erro');
    if (!d.mensagem) return toast('Escreva a mensagem.', 'erro');
    if (p.tipo === 'tags' && !p.tags.length) return toast('Escolha pelo menos uma tag.', 'erro');

    const dados = {
      titulo: d.titulo,
      mensagem: d.mensagem,
      imagem_url: d.imagem_url || null,
      data_envio: d.data_envio || hojeISO(),
      filtro_tags: p.tags,
      filtro_aniversariantes_mes: p.aniversariantes,
    };

    const botao = e.submitter || form.querySelector('[type=submit]');
    await comBotaoOcupado(botao, async () => {
      const consulta = nova
        ? supabase.from('campanhas').insert(dados)
        : supabase.from('campanhas').update(dados).eq('id', camp.id);
      const { data: salva, error } = await consulta.select().single();
      if (error) return mostrarErro(error);
      camp = salva;

      if (acao === 'salvar') {
        toast('Campanha salva.');
        return nova ? ir(`/campanhas/${salva.id}`) : recarregar();
      }
      await enviar();
    }, 'Salvando...');
  });

  async function enviar() {
    let publico;
    try {
      publico = await buscarPublico(camp.filtro_tags, camp.filtro_aniversariantes_mes);
    } catch (e) {
      return mostrarErro(e);
    }
    const faltam = publico.filter((c) => !enviadosIds.has(c.id));
    if (!faltam.length) {
      toast(publico.length ? 'Todos os destinatários já receberam. 👍' : 'Nenhum cliente neste público.', 'info');
      if (publico.length && camp.status !== 'concluida') {
        await supabase.from('campanhas').update({ status: 'concluida' }).eq('id', camp.id);
      }
      return nova ? ir(`/campanhas/${camp.id}`) : recarregar();
    }
    const ok = await confirmar({
      titulo: 'Iniciar envio',
      mensagem: `Vamos abrir o WhatsApp para ${faltam.length} cliente(s), um por vez. Pode parar quando quiser e continuar depois.`,
      botao: 'Começar',
    });
    if (!ok) return nova ? ir(`/campanhas/${camp.id}`) : undefined;

    await supabase.from('campanhas').update({ status: 'enviando' }).eq('id', camp.id);

    const img = camp.imagem_url ? `\n\n${camp.imagem_url}` : '';
    const placar = await abrirFila({
      titulo: camp.titulo,
      itens: faltam,
      jaEnviados: publico.length - faltam.length,
      total: publico.length,
      montar: async (c) => ({
        nome: c.nome,
        telefone: c.telefone,
        mensagem: (await mensagemLivre(camp.mensagem, c)) + img,
      }),
      aoEnviar: async (c) => {
        const { error } = await supabase.from('campanha_envios')
          .upsert({ campanha_id: camp.id, cliente_id: c.id, status: 'enviado' }, { onConflict: 'campanha_id,cliente_id' });
        if (error) throw error;
      },
    });

    if (placar.enviados + (publico.length - faltam.length) >= publico.length) {
      await supabase.from('campanhas').update({ status: 'concluida' }).eq('id', camp.id);
      toast('Campanha concluída! 🎉');
    }
    nova ? ir(`/campanhas/${camp.id}`) : recarregar();
  }

  el.querySelector('[data-excluir]')?.addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Excluir campanha', mensagem: 'Excluir esta campanha e o registro dos envios?', botao: 'Excluir', perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('campanhas').delete().eq('id', camp.id);
    if (error) return mostrarErro(error);
    toast('Campanha excluída.');
    ir('/campanhas');
  });
}
