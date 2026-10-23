// =====================================================================
// Criar / editar / enviar campanha
//  - imagem junto com o texto
//  - escolher quem recebe (desmarcar / adicionar contatos)
//  - enviar para TODOS de uma vez (lista de transmissão do WhatsApp Business)
//    ou um por um (wa.me, com o nome de cada cliente)
// =====================================================================
import { supabase } from '../supabase.js';
import { ehAdmin } from '../auth.js';
import { ir, recarregar } from '../router.js';
import {
  toast, mostrarErro, confirmar, comBotaoOcupado, htmlVazio, htmlCarregando, badgeStatus,
  htmlBotoesVariaveis, ligarBotoesVariaveis,
} from '../ui.js';
import {
  esc, debounce, formatarDataHora, formatarTelefone, hojeISO, TAGS_PADRAO, lerFormulario,
  baixarArquivo, gerarVCard,
} from '../utils.js';
import { obterModelos } from '../store.js';
import { mensagemLivre, previaMensagem } from '../mensagens.js';
import { abrirFila } from '../fila.js';
import {
  prepararImagem, enviarImagem, removerImagem, baixarComoArquivo, podeCompartilharArquivo, compartilhar,
} from '../imagens.js';

const VARS_CAMPANHA = ['{nome}', '{farmacia}', '{telefone_farmacia}', '{endereco}', '{horario}'];
const LIMITE_TRANSMISSAO = 256; // máximo de contatos por lista de transmissão no WhatsApp
const CAMPOS_CLIENTE = 'id, nome, telefone, tags';

/** Público do filtro (o banco já exclui quem não autorizou ou pediu SAIR) */
async function buscarPublico(tags, aniversariantes) {
  const { data, error } = await supabase
    .rpc('clientes_publico', { p_tags: tags, p_aniversariantes: aniversariantes })
    .select(CAMPOS_CLIENTE);
  if (error) throw error;
  return data || [];
}

/** Clientes adicionados à mão (só os que autorizaram) */
async function buscarPorIds(ids) {
  const lista = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('clientes').select(CAMPOS_CLIENTE)
      .in('id', ids.slice(i, i + 100))
      .eq('ativo', true).eq('consentimento_whatsapp', true).eq('opt_out', false);
    if (error) throw error;
    lista.push(...data);
  }
  return lista;
}

/** Texto da lista de transmissão: igual para todos, sem o {nome} */
async function textoParaTodos(texto) {
  const pronto = await mensagemLivre(texto.replace(/\{nome\}/g, ''), { nome: '' });
  return pronto
    .replace(/[ \t]*,[ \t]*([!?.])/g, '$1') // "Oi, !" -> "Oi!"
    .replace(/[ \t]+([!?,.])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export async function render(el, { params }) {
  const nova = !params.id;
  let camp = {
    titulo: '', mensagem: '', imagem_url: null, filtro_tags: [], filtro_aniversariantes_mes: false,
    clientes_excluidos: [], clientes_incluidos: [], data_envio: hojeISO(), status: 'rascunho',
  };
  if (!nova) {
    const { data, error } = await supabase.from('campanhas').select('*').eq('id', params.id).maybeSingle();
    if (error || !data) {
      if (error) mostrarErro(error);
      el.innerHTML = htmlVazio('Campanha não encontrada.', '🔎');
      return;
    }
    camp = { clientes_excluidos: [], clientes_incluidos: [], ...data };
  }

  const modelos = (await obterModelos()).filter((m) => m.tipo === 'campanha' || m.tipo === 'aniversario');
  if (nova) camp.mensagem = modelos.find((m) => m.tipo === 'campanha' && m.padrao)?.texto ?? '';

  const { data: tagsUsadas } = await supabase.from('clientes').select('tags').neq('tags', '{}').limit(1000);
  const todasTags = [...new Set([...TAGS_PADRAO, ...(tagsUsadas || []).flatMap((c) => c.tags), ...camp.filtro_tags])];

  let envios = [];
  if (!nova) {
    const { data } = await supabase.from('campanha_envios')
      .select('cliente_id, status, enviado_em, clientes(nome, telefone)')
      .eq('campanha_id', camp.id).order('enviado_em', { ascending: false });
    envios = data || [];
  }
  const jaRecebeu = new Set(envios.filter((v) => v.status === 'enviado').map((v) => v.cliente_id));

  // ---- Estado da tela ------------------------------------------------------
  const excluidos = new Set(camp.clientes_excluidos || []);
  const incluidos = new Set(camp.clientes_incluidos || []);
  let base = [];                 // clientes do filtro escolhido
  let extras = [];               // clientes adicionados à mão
  let imagemUrl = camp.imagem_url || null;
  let arquivoImagem = null;      // a imagem já baixada, pronta para compartilhar
  let textoTodos = '';           // texto da lista de transmissão (sem nome)

  const publicoInicial = camp.filtro_aniversariantes_mes ? 'aniversariantes' : camp.filtro_tags.length ? 'tags' : 'todos';

  el.innerHTML = `
    <a class="voltar" href="#/campanhas">← Campanhas</a>
    <div class="cabecalho">
      <h1>${nova ? '📣 Nova campanha' : esc(camp.titulo)}</h1>
      ${nova ? '' : badgeStatus(camp.status)}
    </div>
    <div class="aviso">⚖️ Promova produtos como fraldas, dermocosméticos e eventos. Evite anunciar medicamentos de prescrição.</div>

    <form data-form novalidate>
    <div class="grade-dupla">
      <div>
        <div class="card">
          <h2>✍️ Mensagem</h2>
          <label class="campo"><span>Título (só aparece para a equipe) *</span>
            <input name="titulo" required value="${esc(camp.titulo)}" placeholder="Ex.: Sexta-feira da Fralda — novembro"></label>
          ${modelos.length ? `<label class="campo"><span>Começar de um modelo</span>
            <select data-modelo><option value="">— escolher —</option>
              ${modelos.map((m) => `<option value="${m.id}">${esc(m.titulo)}</option>`).join('')}</select></label>` : ''}
          <label class="campo"><span>Texto *</span>
            <textarea name="mensagem" rows="7" required>${esc(camp.mensagem)}</textarea></label>
          ${htmlBotoesVariaveis(VARS_CAMPANHA)}
          <label class="campo"><span>Data da promoção</span>
            <input type="date" name="data_envio" value="${esc(camp.data_envio)}"></label>
        </div>

        <div class="card">
          <h2>🖼️ Imagem (opcional)</h2>
          <img class="imagem-campanha oculto" data-imagem-previa alt="Imagem da campanha">
          <div class="item-acoes">
            <label class="btn btn-sec" tabindex="0">📷 <span data-rotulo-imagem>Escolher imagem</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" data-arquivo hidden></label>
            <button type="button" class="btn btn-link oculto" data-remover-imagem>Remover imagem</button>
          </div>
          <p class="suave pequeno" style="margin-top:8px" data-status-imagem>JPG ou PNG. A imagem é reduzida automaticamente.
            Use só fotos de produtos e eventos — nunca receitas ou fotos de clientes.</p>
        </div>

        <div class="card">
          <h2>👥 Quem vai receber</h2>
          <div class="chips">
            <label class="chip"><input type="radio" name="publico" value="todos" ${publicoInicial === 'todos' ? 'checked' : ''}> Todos os clientes</label>
            <label class="chip"><input type="radio" name="publico" value="tags" ${publicoInicial === 'tags' ? 'checked' : ''}> Por tags</label>
            <label class="chip"><input type="radio" name="publico" value="aniversariantes" ${publicoInicial === 'aniversariantes' ? 'checked' : ''}> Aniversariantes do mês</label>
          </div>
          <div class="chips ${publicoInicial === 'tags' ? '' : 'oculto'}" data-tags style="margin-top:10px">
            ${todasTags.map((t) => `<button type="button" class="chip" data-tag="${esc(t)}"
              aria-pressed="${camp.filtro_tags.includes(t)}">${esc(t)}</button>`).join('')}
          </div>

          <div class="aviso info" data-contagem style="margin-top:12px">Carregando...</div>

          <div class="barra-filtros">
            <label class="busca"><input type="search" data-busca placeholder="Procurar na lista" aria-label="Procurar contato na lista"></label>
            <button type="button" class="btn btn-sec btn-pequeno" data-marcar>✓ Marcar todos</button>
            <button type="button" class="btn btn-sec btn-pequeno" data-desmarcar>Desmarcar todos</button>
          </div>
          <ul class="lista lista-contatos" data-contatos></ul>

          <details class="adicionar-contato">
            <summary class="btn btn-link" style="padding-left:0">➕ Adicionar cliente que não está na lista</summary>
            <label class="busca" style="display:block;margin-top:8px"><input type="search" data-busca-add
              placeholder="Nome ou telefone" aria-label="Procurar cliente para adicionar"></label>
            <ul class="lista" data-resultados-add></ul>
          </details>
          <p class="suave pequeno" style="margin:10px 0 0">🔒 Só aparecem clientes que autorizaram receber mensagens e não pediram SAIR.</p>
        </div>

        <button type="submit" class="btn btn-primario btn-grande btn-bloco">💾 Salvar campanha</button>
        ${!nova && ehAdmin() ? '<button type="button" class="btn btn-link btn-bloco" data-excluir style="margin-top:8px">🗑️ Excluir campanha</button>' : ''}
      </div>

      <div>
        <div class="card">
          <h2>👀 Como o cliente vai ver</h2>
          <div class="previa-whats"><div class="balao">
            <img class="balao-imagem oculto" data-previa-imagem alt="">
            <div data-previa></div></div></div>
          <p class="suave pequeno" style="margin-top:8px">Exemplo com a cliente "Maria Silva".</p>
        </div>

        ${nova ? `<div class="card"><h2>📤 Enviar</h2>
          <p class="suave">Salve a campanha para liberar as opções de envio.</p></div>` : `
        <div class="card">
          <h2>📤 Enviar</h2>

          <h3>1️⃣ Para todos de uma vez <span class="badge badge-verde">recomendado para promoções</span></h3>
          <p class="suave pequeno">Pela <strong>lista de transmissão</strong> do WhatsApp Business: você envia uma vez e todos recebem,
            com a imagem. É grátis. A mensagem vai igual para todos (sem o nome do cliente).
            Só recebe quem tem o número da farmácia salvo nos contatos.</p>
          <ol class="passos">
            <li><button type="button" class="btn btn-sec" data-vcf>⬇ Baixar os contatos selecionados</button>
              <small>No celular da farmácia, abra o arquivo baixado para salvar todos os contatos de uma vez
              (eles aparecem com "(cliente)" no fim do nome). Só precisa fazer de novo quando tiver clientes novos.</small></li>
            <li>No WhatsApp Business: <strong>⋮ → Nova transmissão</strong> (ou "Listas de transmissão"),
              procure por <strong>cliente</strong>, marque os contatos e confirme.
              <small>Cada lista aceita até ${LIMITE_TRANSMISSAO} contatos. Na próxima promoção, use a mesma lista.</small></li>
            <li><button type="button" class="btn btn-whats" data-compartilhar>📤 Compartilhar imagem + texto</button>
              <small>Escolha <strong>WhatsApp Business</strong> e depois a sua lista de transmissão.</small>
              <span class="item-acoes oculto" data-alternativa style="margin-top:6px">
                <button type="button" class="btn btn-sec btn-pequeno" data-copiar>📋 Copiar texto</button>
                <button type="button" class="btn btn-sec btn-pequeno" data-baixar-imagem>⬇ Baixar imagem</button>
              </span></li>
            <li><button type="button" class="btn btn-verde" data-marcar-enviada>✓ Já enviei para a lista</button>
              <small>Registra no histórico de cada cliente selecionado.</small></li>
          </ol>

          <hr class="separador">
          <h3>2️⃣ Um por um (com o nome de cada cliente)</h3>
          <p class="suave pequeno">Um cliente de cada vez, com o nome dele na mensagem.
            <strong>Com imagem:</strong> no celular, o botão "Enviar com a imagem" abre o menu Compartilhar —
            escolha WhatsApp e o contato. No computador, copie a imagem e cole (Ctrl+V) na conversa.</p>
          <button type="button" class="btn btn-whats btn-grande btn-bloco" data-um-por-um>▶ Enviar um por um</button>
        </div>

        <div class="card"><h2>📬 Já receberam (${jaRecebeu.size})</h2>
          ${envios.length ? `<ul class="lista">${envios.map((v) => `
            <li class="item"><div class="item-principal">
              <div class="item-titulo"><a href="#/clientes/${v.cliente_id}">${esc(v.clientes?.nome)}</a></div>
              <div class="item-sub">${esc(formatarTelefone(v.clientes?.telefone))} · ${formatarDataHora(v.enviado_em)}</div>
            </div>${badgeStatus(v.status)}</li>`).join('')}</ul>`
            : htmlVazio('Ninguém recebeu ainda.', '📬')}
        </div>`}
      </div>
    </div>
    </form>`;

  const $ = (s) => el.querySelector(s);
  const form = $('[data-form]');
  const txt = form.mensagem;
  const tagsBox = $('[data-tags]');
  const listaEl = $('[data-contatos]');
  const buscaEl = $('[data-busca]');
  const contagemEl = $('[data-contagem]');

  // ---- Prévia e texto para todos ------------------------------------------
  const atualizarPrevia = async () => {
    $('[data-previa]').textContent = await previaMensagem(txt.value);
    textoTodos = await textoParaTodos(txt.value);
  };
  const mostrarImagem = () => {
    const temImagem = Boolean(imagemUrl);
    ['[data-imagem-previa]', '[data-previa-imagem]'].forEach((s) => {
      const img = $(s);
      img.classList.toggle('oculto', !temImagem);
      if (temImagem) img.src = imagemUrl; else img.removeAttribute('src');
    });
    $('[data-remover-imagem]').classList.toggle('oculto', !temImagem);
    $('[data-rotulo-imagem]').textContent = temImagem ? 'Trocar imagem' : 'Escolher imagem';
    atualizarAlternativa();
  };

  ligarBotoesVariaveis(form, txt, atualizarPrevia);
  txt.addEventListener('input', debounce(atualizarPrevia, 200));
  $('[data-modelo]')?.addEventListener('change', (e) => {
    const m = modelos.find((x) => x.id === e.target.value);
    if (m) { txt.value = m.texto; atualizarPrevia(); }
  });

  // ---- Imagem -----------------------------------------------------------------
  $('[data-arquivo]').addEventListener('change', async (e) => {
    const original = e.target.files[0];
    e.target.value = '';
    if (!original) return;
    const status = $('[data-status-imagem]');
    status.innerHTML = '<span class="spinner pequeno escuro"></span> Enviando imagem...';
    try {
      const arquivo = await prepararImagem(original);
      const url = await enviarImagem(arquivo);
      // imagem anterior que ainda não estava salva na campanha pode ser apagada
      if (imagemUrl && imagemUrl !== camp.imagem_url) removerImagem(imagemUrl).catch(() => {});
      imagemUrl = url;
      arquivoImagem = arquivo;
      status.textContent = '✅ Imagem pronta. Não esqueça de salvar a campanha.';
      mostrarImagem();
    } catch (erro) {
      status.textContent = 'Não foi possível enviar a imagem.';
      mostrarErro(erro, /bucket|not found/i.test(erro?.message) ? 'A pasta de imagens ainda não existe: rode a atualização 02 no Supabase.' : 'Não foi possível enviar a imagem.');
    }
  });
  $('[data-remover-imagem]').addEventListener('click', () => {
    if (imagemUrl && imagemUrl !== camp.imagem_url) removerImagem(imagemUrl).catch(() => {});
    imagemUrl = null;
    arquivoImagem = null;
    $('[data-status-imagem]').textContent = 'Imagem removida. Salve a campanha para confirmar.';
    mostrarImagem();
  });

  // ---- Contatos -------------------------------------------------------------
  const todosContatos = () => {
    const ids = new Set(base.map((c) => c.id));
    return [...base, ...extras.filter((c) => !ids.has(c.id))].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  };
  const selecionados = () => todosContatos().filter((c) => !excluidos.has(c.id));
  const visiveis = () => {
    const termo = buscaEl.value.trim().toLowerCase();
    const dig = termo.replace(/\D/g, '');
    return todosContatos().filter((c) => !termo || c.nome.toLowerCase().includes(termo)
      || (dig.length >= 3 && c.telefone.includes(dig)));
  };

  const atualizarContagem = () => {
    const total = todosContatos().length;
    const sel = selecionados().length;
    const faltam = selecionados().filter((c) => !jaRecebeu.has(c.id)).length;
    contagemEl.innerHTML = `👥 <strong>${sel}</strong> de ${total} cliente(s) selecionado(s)`
      + (jaRecebeu.size ? ` · faltam receber: <strong>${faltam}</strong>` : '')
      + (sel > LIMITE_TRANSMISSAO ? `<br>⚠️ Mais de ${LIMITE_TRANSMISSAO}: no WhatsApp, divida em mais de uma lista de transmissão.` : '');
  };

  const desenharContatos = () => {
    const lista = visiveis();
    listaEl.innerHTML = lista.length ? lista.map((c) => `
      <li class="item contato">
        <label class="contato-label">
          <input type="checkbox" data-id="${c.id}" ${excluidos.has(c.id) ? '' : 'checked'}>
          <span class="item-principal">
            <span class="item-titulo">${esc(c.nome)}</span>
            <span class="item-sub">${esc(formatarTelefone(c.telefone))}
              ${incluidos.has(c.id) ? ' <span class="badge badge-azul">adicionado</span>' : ''}
              ${jaRecebeu.has(c.id) ? ' <span class="badge badge-verde">já recebeu</span>' : ''}</span>
          </span>
        </label>
      </li>`).join('')
      : `<li>${htmlVazio(buscaEl.value ? 'Ninguém encontrado com essa busca.' : 'Nenhum cliente neste público.', '👥')}</li>`;
    atualizarContagem();
  };

  listaEl.addEventListener('change', (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;
    if (e.target.checked) {
      excluidos.delete(id);
    } else if (incluidos.has(id) && !base.some((c) => c.id === id)) {
      // quem foi adicionado à mão e é desmarcado sai da lista
      incluidos.delete(id);
      extras = extras.filter((c) => c.id !== id);
      desenharContatos();
      return;
    } else {
      excluidos.add(id);
    }
    atualizarContagem();
  });
  buscaEl.addEventListener('input', debounce(desenharContatos, 200));
  $('[data-marcar]').addEventListener('click', () => { visiveis().forEach((c) => excluidos.delete(c.id)); desenharContatos(); });
  $('[data-desmarcar]').addEventListener('click', () => { visiveis().forEach((c) => excluidos.add(c.id)); desenharContatos(); });

  const lerPublico = () => {
    const tipo = form.querySelector('[name=publico]:checked').value;
    const tags = tipo === 'tags' ? [...tagsBox.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.tag) : [];
    return { tipo, tags, aniversariantes: tipo === 'aniversariantes' };
  };

  let pedido = 0;
  const carregarBase = async () => {
    const meu = ++pedido;
    const p = lerPublico();
    if (p.tipo === 'tags' && !p.tags.length) {
      base = [];
      desenharContatos();
      contagemEl.innerHTML = 'Escolha pelo menos uma tag acima.' + (extras.length ? ` (${extras.length} adicionado(s) à mão)` : '');
      return;
    }
    listaEl.innerHTML = `<li>${htmlCarregando('Carregando clientes...')}</li>`;
    try {
      const dados = await buscarPublico(p.tags, p.aniversariantes);
      if (meu !== pedido) return;
      base = dados;
      desenharContatos();
    } catch (erro) {
      mostrarErro(erro, 'Não foi possível carregar os clientes.');
      listaEl.innerHTML = '';
    }
  };

  form.querySelectorAll('[name=publico]').forEach((r) => r.addEventListener('change', () => {
    tagsBox.classList.toggle('oculto', lerPublico().tipo !== 'tags');
    carregarBase();
  }));
  tagsBox.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') !== 'true');
    carregarBase();
  });

  // Adicionar cliente de fora do filtro
  const resultadosAdd = $('[data-resultados-add]');
  $('[data-busca-add]').addEventListener('input', debounce(async (e) => {
    const termo = e.target.value.replace(/[,()%*]/g, ' ').trim();
    if (termo.length < 2) { resultadosAdd.innerHTML = ''; return; }
    const dig = termo.replace(/\D/g, '');
    let q = supabase.from('clientes').select(CAMPOS_CLIENTE)
      .eq('ativo', true).eq('consentimento_whatsapp', true).eq('opt_out', false).order('nome').limit(10);
    q = dig.length >= 3 ? q.like('telefone', `%${dig}%`) : q.ilike('nome', `%${termo}%`);
    const { data, error } = await q;
    if (error) return mostrarErro(error);
    const ja = new Set(todosContatos().map((c) => c.id));
    const novos = (data || []).filter((c) => !ja.has(c.id) || excluidos.has(c.id));
    resultadosAdd.innerHTML = novos.length ? novos.map((c) => `
      <li class="item"><div class="item-principal"><div class="item-titulo">${esc(c.nome)}</div>
        <div class="item-sub">${esc(formatarTelefone(c.telefone))}</div></div>
        <button type="button" class="btn btn-primario btn-pequeno" data-add="${c.id}">➕ Adicionar</button></li>`).join('')
      : '<li class="suave pequeno" style="padding:8px 0">Nenhum cliente encontrado (ou todos já estão na lista). Clientes sem autorização não aparecem.</li>';
    resultadosAdd.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const c = novos.find((x) => x.id === b.dataset.add);
      excluidos.delete(c.id);
      if (!base.some((x) => x.id === c.id)) {
        incluidos.add(c.id);
        if (!extras.some((x) => x.id === c.id)) extras.push(c);
      }
      b.closest('li').remove();
      desenharContatos();
      toast(`${c.nome} adicionado(a).`);
    }));
  }, 300));

  // ---- Salvar -----------------------------------------------------------------
  /** Salva a campanha. silencioso = sem toast/navegação (usado antes de enviar) */
  async function salvar(silencioso = false) {
    const d = lerFormulario(form);
    const p = lerPublico();
    if (!d.titulo) { toast('Dê um título para a campanha.', 'erro'); return null; }
    if (!d.mensagem) { toast('Escreva o texto da mensagem.', 'erro'); return null; }
    if (p.tipo === 'tags' && !p.tags.length && !incluidos.size) { toast('Escolha pelo menos uma tag.', 'erro'); return null; }

    const dados = {
      titulo: d.titulo,
      mensagem: d.mensagem,
      imagem_url: imagemUrl,
      data_envio: d.data_envio || hojeISO(),
      filtro_tags: p.tags,
      filtro_aniversariantes_mes: p.aniversariantes,
      clientes_excluidos: [...excluidos],
      clientes_incluidos: [...incluidos],
    };
    const consulta = nova
      ? supabase.from('campanhas').insert(dados)
      : supabase.from('campanhas').update(dados).eq('id', camp.id);
    const { data: salva, error } = await consulta.select().single();
    if (error) {
      mostrarErro(error, /clientes_(ex|in)cluidos/.test(error.message)
        ? 'Falta rodar a atualização 02 no Supabase (veja as instruções).' : undefined);
      return null;
    }
    // A imagem antiga foi trocada/removida: apaga do Storage
    if (camp.imagem_url && camp.imagem_url !== salva.imagem_url) removerImagem(camp.imagem_url).catch(() => {});
    camp = { ...camp, ...salva };
    if (!silencioso) {
      toast('Campanha salva. ✅');
      if (nova) ir(`/campanhas/${salva.id}`);
    }
    return camp;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await comBotaoOcupado(e.submitter || form.querySelector('[type=submit]'), () => salvar(false), 'Salvando...');
  });

  // ---- Envio ------------------------------------------------------------------
  async function marcarStatus(status) {
    const { error } = await supabase.from('campanhas').update({ status }).eq('id', camp.id);
    if (error) mostrarErro(error);
  }

  // Opção 1: lista de transmissão
  $('[data-vcf]')?.addEventListener('click', () => {
    const sel = selecionados();
    if (!sel.length) return toast('Nenhum contato selecionado.', 'erro');
    baixarArquivo(`contatos-clientes-${hojeISO()}.vcf`, gerarVCard(sel), 'text/vcard;charset=utf-8');
    toast(`${sel.length} contato(s) baixado(s). Abra o arquivo no celular da farmácia.`);
  });

  function atualizarAlternativa() {
    const alt = $('[data-alternativa]');
    if (!alt) return;
    const semSuporte = !navigator.share || (imagemUrl && arquivoImagem && !podeCompartilharArquivo(arquivoImagem));
    alt.classList.toggle('oculto', !semSuporte);
    $('[data-baixar-imagem]').classList.toggle('oculto', !imagemUrl);
  }

  $('[data-compartilhar]')?.addEventListener('click', async () => {
    if (imagemUrl && !arquivoImagem) {
      toast('A imagem ainda está carregando. Tente de novo em 2 segundos.', 'info');
      return;
    }
    try {
      const r = await compartilhar({ texto: textoTodos, arquivo: imagemUrl ? arquivoImagem : null });
      if (r === 'sem-suporte') {
        $('[data-alternativa]').classList.remove('oculto');
        toast('Este aparelho não compartilha direto. Use "Copiar texto" e "Baixar imagem".', 'info', 6000);
      } else if (r === 'so-texto') {
        toast('Este aparelho só compartilhou o texto. Baixe a imagem e anexe no WhatsApp.', 'info', 6000);
        $('[data-alternativa]').classList.remove('oculto');
      }
    } catch (erro) {
      mostrarErro(erro, 'Não foi possível abrir o compartilhamento.');
    }
  });

  $('[data-copiar]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textoTodos);
      toast('Texto copiado! Cole no WhatsApp.');
    } catch {
      toast('Não consegui copiar. Selecione o texto da prévia e copie.', 'erro');
    }
  });
  $('[data-baixar-imagem]')?.addEventListener('click', () => {
    if (arquivoImagem) {
      const ext = { 'image/png': 'png', 'image/webp': 'webp' }[arquivoImagem.type] || 'jpg';
      baixarArquivo(`promocao.${ext}`, arquivoImagem, arquivoImagem.type || 'image/jpeg');
    }
  });

  $('[data-marcar-enviada]')?.addEventListener('click', async (e) => {
    const botao = e.currentTarget; // guardar antes do "await" (depois o navegador zera)
    const faltam = selecionados().filter((c) => !jaRecebeu.has(c.id));
    if (!faltam.length) return toast('Todos os selecionados já estão marcados como enviados. 👍', 'info');
    const ok = await confirmar({
      titulo: 'Registrar envio',
      mensagem: `Confirma que enviou esta campanha pela lista de transmissão para os ${faltam.length} cliente(s) selecionado(s) que ainda não tinham recebido?`,
      botao: 'Sim, já enviei',
    });
    if (!ok) return;
    await comBotaoOcupado(botao, async () => {
      if (!(await salvar(true))) return;
      for (let i = 0; i < faltam.length; i += 200) {
        const { error } = await supabase.from('campanha_envios').upsert(
          faltam.slice(i, i + 200).map((c) => ({ campanha_id: camp.id, cliente_id: c.id, status: 'enviado' })),
          { onConflict: 'campanha_id,cliente_id' },
        );
        if (error) return mostrarErro(error);
      }
      await marcarStatus('concluida');
      toast('Envio registrado! 🎉');
      recarregar();
    }, 'Registrando...');
  });

  // Opção 2: um por um
  $('[data-um-por-um]')?.addEventListener('click', async (e) => {
    const salva = await comBotaoOcupado(e.currentTarget, () => salvar(true), 'Salvando...');
    if (!salva) return;
    const sel = selecionados();
    const faltam = sel.filter((c) => !jaRecebeu.has(c.id));
    if (!faltam.length) {
      return toast(sel.length ? 'Todos os selecionados já receberam. 👍' : 'Nenhum contato selecionado.', 'info');
    }
    const ok = await confirmar({
      titulo: 'Enviar um por um',
      mensagem: `Vamos abrir o WhatsApp de ${faltam.length} cliente(s), um de cada vez. Pode parar quando quiser e continuar depois.`,
      botao: 'Começar',
    });
    if (!ok) return;

    await marcarStatus('enviando');
    const placar = await abrirFila({
      titulo: camp.titulo,
      itens: faltam,
      jaEnviados: sel.length - faltam.length,
      total: sel.length,
      arquivo: imagemUrl ? arquivoImagem : null, // a foto vai como arquivo (celular: Compartilhar; PC: colar)
      linkImagem: imagemUrl,                     // só usado se a foto não puder ir como arquivo
      montar: async (c) => ({
        nome: c.nome,
        telefone: c.telefone,
        mensagem: await mensagemLivre(camp.mensagem, c),
      }),
      aoEnviar: async (c) => {
        const { error } = await supabase.from('campanha_envios')
          .upsert({ campanha_id: camp.id, cliente_id: c.id, status: 'enviado' }, { onConflict: 'campanha_id,cliente_id' });
        if (error) throw error;
        jaRecebeu.add(c.id);
      },
    });
    if (placar.enviados >= faltam.length) {
      await marcarStatus('concluida');
      toast('Campanha concluída! 🎉');
    }
    recarregar();
  });

  // ---- Excluir ----------------------------------------------------------------
  $('[data-excluir]')?.addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Excluir campanha', mensagem: 'Excluir esta campanha, a imagem dela e o registro dos envios?', botao: 'Excluir', perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('campanhas').delete().eq('id', camp.id);
    if (error) return mostrarErro(error);
    if (camp.imagem_url) removerImagem(camp.imagem_url).catch(() => {});
    toast('Campanha excluída.');
    ir('/campanhas');
  });

  // ---- Início -----------------------------------------------------------------
  mostrarImagem();
  atualizarPrevia();
  if (imagemUrl) {
    baixarComoArquivo(imagemUrl).then((f) => { arquivoImagem = f; atualizarAlternativa(); })
      .catch(() => { $('[data-status-imagem]').textContent = '⚠️ Não foi possível carregar a imagem salva.'; });
  }
  try {
    extras = await buscarPorIds([...incluidos]);
  } catch (erro) {
    mostrarErro(erro);
  }
  await carregarBase();
}
