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
  htmlBotoesVariaveis, ligarBotoesVariaveis, abrirModal,
} from '../ui.js';
import {
  esc, debounce, formatarDataHora, formatarTelefone, hojeISO, TAGS_PADRAO, lerFormulario,
  baixarArquivo, gerarVCard,
} from '../utils.js';
import { obterModelos } from '../store.js';
import { mensagemLivre, previaMensagem } from '../mensagens.js';
import { abrirFila } from '../fila.js';
import {
  prepararImagem, enviarImagem, removerImagem, baixarComoArquivo, atualizarCapa,
} from '../imagens.js';

const MAX_IMAGENS = 10;

/** Link da página pública com as fotos da campanha (promo.html) */
function linkFotos(campanhaId) {
  return new URL(`promo.html?c=${campanhaId || 'codigo-da-campanha'}`, location.href).href;
}

/** Aviso + link que vai no fim da mensagem (só no modo "por link") */
function rodapeImagens(qtd, campanhaId) {
  if (!qtd) return '';
  return `\n\n📸 Toque no link para ver ${qtd > 1 ? 'as fotos' : 'a foto'} da promoção:\n${linkFotos(campanhaId)}`;
}

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
  // Imagens: lista nova (várias) ou a antiga (uma só)
  let imagens = Array.isArray(camp.imagens) && camp.imagens.length
    ? [...camp.imagens] : (camp.imagem_url ? [camp.imagem_url] : []);
  let imagensSalvas = [...imagens];          // as que já estão gravadas na campanha
  let porLink = camp.imagens_por_link !== false; // true = link na mensagem; false = anexo manual
  let textoTodos = '';           // texto da lista de transmissão (sem nome)
  const rodape = () => (porLink ? rodapeImagens(imagens.length, camp.id) : '');

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
          <h2>🖼️ Imagens (opcional)</h2>
          <div class="galeria" data-galeria></div>
          <div class="item-acoes">
            <label class="btn btn-sec" tabindex="0">📷 Adicionar imagens
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-arquivo hidden></label>
          </div>
          <p class="suave pequeno" style="margin-top:8px" data-status-imagem>Até ${MAX_IMAGENS} imagens (pode escolher várias de uma vez).
            São reduzidas automaticamente. Use só fotos de produtos e eventos — nunca receitas ou fotos de clientes.</p>

          <div class="modo-imagem oculto" data-modo-imagem>
            <span class="campo-titulo">Como as imagens vão para o cliente?</span>
            <label class="checkbox"><input type="radio" name="imagens_por_link" value="link" ${porLink ? 'checked' : ''}>
              <span>🔗 Por link <small>A mensagem termina com "📸 Toque no link para ver as fotos da promoção"
              e o link abre uma página com todas as imagens.</small></span></label>
            <label class="checkbox"><input type="radio" name="imagens_por_link" value="manual" ${porLink ? '' : 'checked'}>
              <span>✋ Eu anexo manualmente <small>A mensagem vai sem link. Baixe as imagens e anexe você mesmo no WhatsApp (📎).</small></span></label>
            <button type="button" class="btn btn-sec oculto" data-baixar-imagens>⬇ Baixar imagens</button>
          </div>
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
            <div class="balao-imagens oculto" data-previa-imagens></div>
            <div data-previa></div></div></div>
          <p class="suave pequeno" style="margin-top:8px">Exemplo com a cliente "Maria Silva".</p>
        </div>

        ${nova ? `<div class="card"><h2>📤 Enviar</h2>
          <p class="suave">Salve a campanha para liberar as opções de envio.</p></div>` : `
        <div class="card">
          <h2>📤 Enviar</h2>

          <h3>💬 Um por um <span class="badge badge-verde">com o nome de cada cliente</span></h3>
          <p class="suave pequeno">Abre o WhatsApp de cada cliente com a mensagem pronta, um de cada vez.
            Com imagens <strong>por link</strong>, o link das fotos já vai no fim da mensagem.</p>
          <button type="button" class="btn btn-whats btn-grande btn-bloco" data-um-por-um>▶ Enviar um por um</button>

          <hr class="separador">
          <h3>📢 Lista de transmissão <span class="badge badge-cinza">grátis · você envia pelo celular</span></h3>
          <p class="suave pequeno">Você envia uma vez pelo WhatsApp Business e todos da lista recebem (sem o nome do cliente).
            Só recebe quem tem o número da farmácia salvo nos contatos.</p>
          <ol class="passos">
            <li><button type="button" class="btn btn-sec" data-vcf>⬇ Baixar os contatos selecionados</button>
              <small>No celular da farmácia, abra o arquivo para salvar os contatos (aparecem com "(cliente)" no nome).</small></li>
            <li>No WhatsApp Business: <strong>⋮ → Nova transmissão</strong>, procure por <strong>cliente</strong>,
              marque os contatos e confirme. <small>Até ${LIMITE_TRANSMISSAO} contatos por lista. Reaproveite a lista nas próximas promoções.</small></li>
            <li><button type="button" class="btn btn-sec" data-copiar>📋 Copiar texto</button>
              <small>Cole o texto na lista de transmissão. Com imagens por link, o link já vai junto;
              no modo manual, anexe as fotos baixadas (📎).</small></li>
            <li><button type="button" class="btn btn-verde" data-marcar-enviada>✓ Já enviei para a lista</button>
              <small>Registra no histórico de cada cliente selecionado.</small></li>
          </ol>
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
    $('[data-previa]').textContent = (await previaMensagem(txt.value)) + rodape();
    textoTodos = await textoParaTodos(txt.value);
  };

  /** Desenha a galeria de imagens, a prévia e a escolha link/manual */
  const mostrarImagens = () => {
    const tem = imagens.length > 0;
    $('[data-galeria]').innerHTML = imagens.map((u, i) => `
      <figure class="galeria-item">
        <img src="${esc(u)}" alt="Imagem ${i + 1}" loading="lazy">
        <button type="button" class="galeria-remover" data-remover-img="${i}" aria-label="Remover imagem ${i + 1}">✕</button>
      </figure>`).join('');
    $('[data-modo-imagem]').classList.toggle('oculto', !tem);
    $('[data-baixar-imagens]').classList.toggle('oculto', !tem || porLink);
    // Na prévia: no modo manual as fotos aparecem anexadas; no modo link, vai o link no texto
    const previaImgs = $('[data-previa-imagens]');
    previaImgs.classList.toggle('oculto', !tem || porLink);
    previaImgs.innerHTML = tem && !porLink
      ? imagens.slice(0, 4).map((u) => `<img src="${esc(u)}" alt="">`).join('') : '';
    atualizarPrevia();
  };

  ligarBotoesVariaveis(form, txt, atualizarPrevia);
  txt.addEventListener('input', debounce(atualizarPrevia, 200));
  $('[data-modelo]')?.addEventListener('change', (e) => {
    const m = modelos.find((x) => x.id === e.target.value);
    if (m) { txt.value = m.texto; atualizarPrevia(); }
  });

  // ---- Imagem -----------------------------------------------------------------
  $('[data-arquivo]').addEventListener('change', async (e) => {
    const escolhidos = [...e.target.files];
    e.target.value = '';
    if (!escolhidos.length) return;
    const vagas = MAX_IMAGENS - imagens.length;
    if (vagas <= 0) return toast(`Máximo de ${MAX_IMAGENS} imagens por campanha.`, 'erro');
    if (escolhidos.length > vagas) toast(`Só cabem mais ${vagas} imagem(ns). As demais foram ignoradas.`, 'info');

    const status = $('[data-status-imagem]');
    const lista = escolhidos.slice(0, vagas);
    let ok = 0;
    for (const [i, original] of lista.entries()) {
      status.innerHTML = `<span class="spinner pequeno escuro"></span> Enviando imagem ${i + 1} de ${lista.length}...`;
      try {
        const url = await enviarImagem(await prepararImagem(original));
        imagens.push(url);
        ok++;
        mostrarImagens();
      } catch (erro) {
        mostrarErro(erro, /bucket|not found/i.test(erro?.message)
          ? 'A pasta de imagens ainda não existe: rode a atualização 02 no Supabase.'
          : `Não foi possível enviar a imagem "${original.name}".`);
      }
    }
    status.textContent = ok
      ? `✅ ${ok} imagem(ns) adicionada(s). Não esqueça de salvar a campanha.`
      : 'Nenhuma imagem foi adicionada.';
  });

  $('[data-galeria]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remover-img]');
    if (!b) return;
    const [url] = imagens.splice(Number(b.dataset.removerImg), 1);
    // imagem que ainda não estava salva na campanha já pode ser apagada do Storage
    if (url && !imagensSalvas.includes(url)) removerImagem(url).catch(() => {});
    $('[data-status-imagem]').textContent = 'Imagem removida. Salve a campanha para confirmar.';
    mostrarImagens();
  });

  form.querySelectorAll('[name=imagens_por_link]').forEach((r) => r.addEventListener('change', () => {
    porLink = form.querySelector('[name=imagens_por_link]:checked').value === 'link';
    mostrarImagens();
  }));

  // Modo manual: baixa as imagens para anexar no WhatsApp
  $('[data-baixar-imagens]').addEventListener('click', (e) => comBotaoOcupado(e.currentTarget, async () => {
    for (const [i, u] of imagens.entries()) {
      try {
        const arq = await baixarComoArquivo(u);
        const ext = { 'image/png': 'png', 'image/webp': 'webp' }[arq.type] || 'jpg';
        baixarArquivo(`promocao-${i + 1}.${ext}`, arq, arq.type || 'image/jpeg');
        await new Promise((r) => setTimeout(r, 400)); // o navegador baixa um por vez
      } catch (erro) {
        mostrarErro(erro, `Não foi possível baixar a imagem ${i + 1}.`);
      }
    }
    toast('Imagens baixadas! Anexe no WhatsApp com o 📎.');
  }, 'Baixando...'));

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
      + (jaRecebeu.size && !faltam && sel ? '<br>✅ Todos já receberam. Editou o texto ou a imagem? Salve e use os botões de envio para mandar de novo.' : '')
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
      imagem_url: imagens[0] ?? null,
      imagens: [...imagens],
      imagens_por_link: porLink,
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
      const falta = /imagens/.test(error.message) ? '03' : /clientes_(ex|in)cluidos/.test(error.message) ? '02' : null;
      mostrarErro(error, falta ? `Falta rodar a atualização ${falta} no Supabase (veja as instruções).` : undefined);
      return null;
    }
    // Imagens tiradas da campanha: apaga do Storage
    imagensSalvas.filter((u) => !imagens.includes(u)).forEach((u) => removerImagem(u).catch(() => {}));
    imagensSalvas = [...imagens];
    camp = { ...camp, ...salva };
    // Prévia do link no WhatsApp: a 1ª imagem vira a capa da página de fotos
    if (imagens.length && porLink) {
      try {
        await atualizarCapa(imagens[0]);
      } catch (erro) {
        console.warn('Capa da prévia não atualizada:', erro);
        toast('Campanha salva, mas a prévia da imagem no WhatsApp não foi atualizada (rode a atualização 03).', 'info', 6000);
      }
    }
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

  /**
   * Decide para quem enviar. Se ninguém recebeu ainda, envia para todos os selecionados.
   * Se alguém já recebeu (ex.: você editou o texto/imagem), pergunta:
   * "só quem falta" ou "todos de novo". Resolve { lista, reenvio } ou null (cancelou).
   */
  function escolherDestino({ verbo = 'Enviar' } = {}) {
    const sel = selecionados();
    const faltam = sel.filter((c) => !jaRecebeu.has(c.id));
    if (!sel.length) {
      toast('Nenhum contato selecionado.', 'erro');
      return Promise.resolve(null);
    }
    if (faltam.length === sel.length) return Promise.resolve({ lista: sel, reenvio: false, novo: true });

    const ja = sel.length - faltam.length;
    return abrirModal({
      titulo: 'Alguns já receberam',
      html: `
        <p><strong>${ja}</strong> de ${sel.length} cliente(s) selecionado(s) já receberam esta campanha.
          Se você mudou o texto ou a imagem, pode ${verbo.toLowerCase()} de novo.</p>
        <div class="escolha-envio">
          ${faltam.length ? `<button type="button" class="btn btn-primario btn-grande" data-faltam>
            ${verbo} só para quem ainda não recebeu (${faltam.length})</button>` : ''}
          <button type="button" class="btn btn-whats btn-grande" data-todos>
            🔄 ${verbo} de novo para todos (${sel.length})</button>
          <button type="button" class="btn btn-sec" data-cancelar>Cancelar</button>
        </div>`,
      aoAbrir(dlg, fechar) {
        dlg.querySelector('[data-faltam]')?.addEventListener('click', () => fechar({ lista: faltam, reenvio: false }));
        dlg.querySelector('[data-todos]').addEventListener('click', () => fechar({ lista: sel, reenvio: true }));
        dlg.querySelector('[data-cancelar]').addEventListener('click', () => fechar(null));
      },
    }).then((r) => r ?? null);
  }

  /** Grava (ou regrava, no reenvio) o envio com a data de agora */
  async function registrarEnvios(clientes) {
    const agora = new Date().toISOString();
    for (let i = 0; i < clientes.length; i += 200) {
      const { error } = await supabase.from('campanha_envios').upsert(
        clientes.slice(i, i + 200).map((c) => ({ campanha_id: camp.id, cliente_id: c.id, status: 'enviado', enviado_em: agora })),
        { onConflict: 'campanha_id,cliente_id' },
      );
      if (error) throw error;
      clientes.slice(i, i + 200).forEach((c) => jaRecebeu.add(c.id));
    }
  }

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

  $('[data-copiar]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textoTodos + rodape());
      toast('Texto copiado! Cole no WhatsApp.');
    } catch {
      toast('Não consegui copiar. Selecione o texto da prévia e copie.', 'erro');
    }
  });

  $('[data-marcar-enviada]')?.addEventListener('click', async (e) => {
    const botao = e.currentTarget; // guardar antes do "await" (depois o navegador zera)
    const escolha = await escolherDestino({ verbo: 'Registrar' });
    if (!escolha) return;
    if (escolha.novo) {
      const ok = await confirmar({
        titulo: 'Registrar envio',
        mensagem: `Confirma que enviou esta campanha pela lista de transmissão para os ${escolha.lista.length} cliente(s) selecionado(s)?`,
        botao: 'Sim, já enviei',
      });
      if (!ok) return;
    }
    await comBotaoOcupado(botao, async () => {
      if (!(await salvar(true))) return;
      try {
        await registrarEnvios(escolha.lista);
      } catch (erro) {
        return mostrarErro(erro);
      }
      await marcarStatus('concluida');
      toast(escolha.reenvio ? 'Reenvio registrado! 🎉' : 'Envio registrado! 🎉');
      recarregar();
    }, 'Registrando...');
  });

  // Opção 2: um por um
  $('[data-um-por-um]')?.addEventListener('click', async (e) => {
    const salva = await comBotaoOcupado(e.currentTarget, () => salvar(true), 'Salvando...');
    if (!salva) return;
    const sel = selecionados();
    const escolha = await escolherDestino({ verbo: 'Enviar' });
    if (!escolha) return;
    const lista = escolha.lista;
    if (escolha.novo) {
      const ok = await confirmar({
        titulo: 'Enviar um por um',
        mensagem: `Vamos abrir o WhatsApp de ${lista.length} cliente(s), um de cada vez. Pode parar quando quiser e continuar depois.`,
        botao: 'Começar',
      });
      if (!ok) return;
    }

    await marcarStatus('enviando');
    const placar = await abrirFila({
      titulo: escolha.reenvio ? `${camp.titulo} (reenvio)` : camp.titulo,
      itens: lista,
      jaEnviados: escolha.reenvio ? 0 : sel.length - lista.length,
      total: escolha.reenvio ? lista.length : sel.length,
      montar: async (c) => ({
        nome: c.nome,
        telefone: c.telefone,
        mensagem: (await mensagemLivre(camp.mensagem, c)) + rodape(),
      }),
      aoEnviar: (c) => registrarEnvios([c]),
    });
    if (placar.enviados >= lista.length) {
      await marcarStatus('concluida');
      toast('Campanha concluída! 🎉');
    }
    recarregar();
  });

  // ---- Excluir ----------------------------------------------------------------
  $('[data-excluir]')?.addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Excluir campanha', mensagem: 'Excluir esta campanha, as imagens dela e o registro dos envios?', botao: 'Excluir', perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('campanhas').delete().eq('id', camp.id);
    if (error) return mostrarErro(error);
    new Set([...imagens, ...imagensSalvas]).forEach((u) => removerImagem(u).catch(() => {}));
    toast('Campanha excluída.');
    ir('/campanhas');
  });

  // ---- Início -----------------------------------------------------------------
  mostrarImagens();
  try {
    extras = await buscarPorIds([...incluidos]);
  } catch (erro) {
    mostrarErro(erro);
  }
  await carregarBase();
}
