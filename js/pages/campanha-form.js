// =====================================================================
// Criar / editar campanha (somente administrador — o banco também confere)
//  - nome, categoria livre, descrição, período, mensagem, imagens
//  - público (todos / grupos / aniversariantes / período de cadastro)
//  - salvar como rascunho ou ativar
// =====================================================================
import { supabase } from '../supabase.js';
import { ir } from '../router.js';
import {
  toast, mostrarErro, comBotaoOcupado, htmlVazio, htmlBotoesVariaveis, ligarBotoesVariaveis,
} from '../ui.js';
import { esc, debounce, hojeISO, TAGS_PADRAO, lerFormulario, baixarArquivo } from '../utils.js';
import { obterModelos } from '../store.js';
import { previaMensagem } from '../mensagens.js';
import {
  prepararImagem, enviarImagem, removerImagem, baixarComoArquivo, atualizarCapa,
} from '../imagens.js';
import {
  CATEGORIAS_SUGERIDAS, SUGESTOES, imagensDe, rodapeImagens, badgeSituacao, situacao,
} from '../campanhas-comum.js';
import { montarSeletor, buscarElegiveisPorIds } from '../componentes/seletor-clientes.js';

const MAX_IMAGENS = 10;
const VARS_CAMPANHA = ['{nome}', '{farmacia}', '{telefone_farmacia}', '{endereco}', '{horario}'];

export async function render(el, { params }) {
  const nova = !params.id;
  let camp = {
    titulo: '', categoria: '', descricao: '', mensagem: '', status: 'rascunho',
    data_inicio: hojeISO(), data_fim: '', imagens: [], imagens_por_link: true,
    filtro_tags: [], filtro_aniversariantes_mes: false, filtro_cadastro_de: '', filtro_cadastro_ate: '',
  };
  if (!nova) {
    const { data, error } = await supabase.from('campanhas').select('*').eq('id', params.id).maybeSingle();
    if (error || !data) {
      if (error) mostrarErro(error);
      el.innerHTML = htmlVazio('Campanha não encontrada.', '🔎');
      return;
    }
    camp = { ...camp, ...data };
  }

  const [modelos, { data: tagsUsadas }, { data: catsUsadas }] = await Promise.all([
    obterModelos().then((l) => l.filter((m) => m.tipo === 'campanha' || m.tipo === 'aniversario')).catch(() => []),
    supabase.from('clientes').select('tags').neq('tags', '{}').limit(1000),
    supabase.from('campanhas').select('categoria').limit(2000),
  ]);
  const todasTags = [...new Set([...TAGS_PADRAO, ...(tagsUsadas || []).flatMap((c) => c.tags), ...(camp.filtro_tags || [])])];
  const categorias = [...new Set([...CATEGORIAS_SUGERIDAS, ...(catsUsadas || []).map((c) => c.categoria).filter(Boolean)])];

  // ---- Estado --------------------------------------------------------------
  let imagens = imagensDe(camp);
  let imagensSalvas = [...imagens];
  let porLink = camp.imagens_por_link !== false;
  const publicoInicial = camp.publico_manual ? 'manual'
    : camp.filtro_aniversariantes_mes ? 'aniversariantes'
    : camp.filtro_tags?.length ? 'tags'
      : (camp.filtro_cadastro_de || camp.filtro_cadastro_ate) ? 'cadastro' : 'todos';
  const ehRascunho = camp.status === 'rascunho';

  el.innerHTML = `
    <a class="voltar" href="${nova ? '#/campanhas' : `#/campanhas/${camp.id}`}">← ${nova ? 'Campanhas' : 'Voltar para a campanha'}</a>
    <div class="cabecalho">
      <div class="cabecalho-texto">
        <h1>${nova ? 'Nova campanha' : `Editar: ${esc(camp.titulo)}`}</h1>
        <p class="suave">${nova ? 'Cadastre qualquer campanha: data comemorativa, promoção, evento ou o que precisar.'
          : `Situação atual: ${badgeSituacao(camp)}`}</p>
      </div>
    </div>

    <form data-form novalidate>
    <div class="grade-dupla">
      <div>
        ${nova ? `
        <div class="card">
          <h2>✨ Começar de uma sugestão <span class="suave pequeno">(opcional)</span></h2>
          <p class="suave pequeno">Preenche nome, categoria e mensagem. Você pode mudar tudo depois.</p>
          <div class="chips" data-sugestoes>
            ${SUGESTOES.map((s, i) => `<button type="button" class="chip" data-sugestao="${i}">${esc(s.titulo)}</button>`).join('')}
          </div>
        </div>` : ''}

        <div class="card">
          <h2>📋 Dados da campanha</h2>
          <label class="campo"><span>Nome da campanha *</span>
            <input name="titulo" required maxlength="150" value="${esc(camp.titulo)}" placeholder="Ex.: Semana do Bebê — dezembro"></label>
          <label class="campo"><span>Categoria *</span>
            <input name="categoria" list="lista-categorias" maxlength="60" value="${esc(camp.categoria)}"
              placeholder="Escolha da lista ou digite uma nova">
            <datalist id="lista-categorias">${categorias.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
          <label class="campo"><span>Descrição (só a equipe vê)</span>
            <textarea name="descricao" rows="3" maxlength="2000" placeholder="Objetivo, produtos envolvidos, observações internas...">${esc(camp.descricao ?? '')}</textarea></label>
          <div class="grade-2">
            <label class="campo"><span>Data inicial *</span>
              <input type="date" name="data_inicio" required value="${esc(camp.data_inicio ?? '')}"></label>
            <label class="campo"><span>Data final</span>
              <input type="date" name="data_fim" value="${esc(camp.data_fim ?? '')}">
              <small>Vazio = sem data para terminar.</small></label>
          </div>
        </div>

        <div class="card">
          <h2>✍️ Mensagem</h2>
          ${modelos.length ? `<label class="campo"><span>Usar um modelo de mensagem</span>
            <select data-modelo><option value="">— escolher —</option>
              ${modelos.map((m) => `<option value="${m.id}">${esc(m.titulo)}</option>`).join('')}</select></label>` : ''}
          <label class="campo"><span>Texto da mensagem *</span>
            <textarea name="mensagem" rows="7" maxlength="4000">${esc(camp.mensagem)}</textarea>
            <small>Não cite nomes de medicamentos, doenças ou tratamentos. Termine com a opção de sair (ex.: “responda SAIR”).</small></label>
          ${htmlBotoesVariaveis(VARS_CAMPANHA)}
        </div>

        <div class="card">
          <h2>🖼️ Imagens <span class="suave pequeno">(opcional)</span></h2>
          <div class="galeria" data-galeria></div>
          <div class="item-acoes">
            <label class="btn btn-sec" tabindex="0">📷 Adicionar imagens
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-arquivo hidden></label>
          </div>
          <p class="suave pequeno" style="margin-top:8px" data-status-imagem>Até ${MAX_IMAGENS} imagens.
            São reduzidas automaticamente. Use só fotos de produtos e eventos — nunca receitas ou fotos de clientes.</p>
          <div class="modo-imagem oculto" data-modo-imagem>
            <span class="campo-titulo">Como as imagens vão para o cliente?</span>
            <label class="checkbox"><input type="radio" name="imagens_por_link" value="link" ${porLink ? 'checked' : ''}>
              <span>🔗 Por link <small>A mensagem termina com “📸 Confira aqui:” e o link abre uma página com as imagens.</small></span></label>
            <label class="checkbox"><input type="radio" name="imagens_por_link" value="manual" ${porLink ? '' : 'checked'}>
              <span>✋ Eu anexo manualmente <small>A mensagem vai sem link. Baixe as imagens e anexe no WhatsApp (📎).</small></span></label>
            <button type="button" class="btn btn-sec oculto" data-baixar-imagens>⬇ Baixar imagens</button>
          </div>
        </div>

        <div class="card">
          <h2>👥 Público</h2>
          <div class="chips">
            <label class="chip"><input type="radio" name="publico" value="todos" ${publicoInicial === 'todos' ? 'checked' : ''}> Todos que autorizaram</label>
            <label class="chip"><input type="radio" name="publico" value="tags" ${publicoInicial === 'tags' ? 'checked' : ''}> Por grupos</label>
            <label class="chip"><input type="radio" name="publico" value="aniversariantes" ${publicoInicial === 'aniversariantes' ? 'checked' : ''}> Aniversariantes do mês</label>
            <label class="chip"><input type="radio" name="publico" value="cadastro" ${publicoInicial === 'cadastro' ? 'checked' : ''}> Cadastrados em um período</label>
            <label class="chip"><input type="radio" name="publico" value="manual" ${publicoInicial === 'manual' ? 'checked' : ''}> Escolher clientes um a um</label>
          </div>
          <div class="chips ${publicoInicial === 'tags' ? '' : 'oculto'}" data-tags style="margin-top:12px">
            ${todasTags.map((t) => `<button type="button" class="chip" data-tag="${esc(t)}"
              aria-pressed="${(camp.filtro_tags || []).includes(t)}">${esc(t)}</button>`).join('')}
          </div>
          <div class="grade-2 ${publicoInicial === 'cadastro' ? '' : 'oculto'}" data-cadastro style="margin-top:12px">
            <label class="campo"><span>Cadastrados de</span>
              <input type="date" name="filtro_cadastro_de" value="${esc(camp.filtro_cadastro_de ?? '')}"></label>
            <label class="campo"><span>até</span>
              <input type="date" name="filtro_cadastro_ate" value="${esc(camp.filtro_cadastro_ate ?? '')}"></label>
          </div>
          <div class="aviso info oculto" data-contagem style="margin-top:12px"></div>
          <p class="suave pequeno" style="margin:12px 0 0">🔒 Só entram clientes ativos que autorizaram <strong>receber campanhas</strong>
            e não pediram para sair.</p>
        </div>

        <div class="card">
          <h2>✅ Clientes que vão receber</h2>
          <p class="suave pequeno" data-ajuda-selecao></p>
          <div data-seletor>Carregando clientes...</div>
        </div>
      </div>

      <div class="coluna-fixa">
        <div class="card">
          <h2>👀 Pré-visualização</h2>
          <div class="previa-whats"><div class="balao"><div class="balao-imagens oculto" data-previa-imagens></div><div data-previa></div></div></div>
          <p class="suave pequeno" style="margin-top:8px">Exemplo com a cliente “Maria Silva”.</p>
        </div>

        <div class="card">
          <h2>💾 Salvar</h2>
          ${nova || ehRascunho ? `
            <p class="suave pequeno">Rascunho: fica guardado e ninguém consegue enviar.<br>
              Ativar: libera o botão “Enviar pelo WhatsApp”.</p>
            <div class="botoes-empilhados">
              <button type="submit" class="btn btn-primario btn-grande btn-bloco" data-status="ativa">✓ Salvar e ativar</button>
              <button type="submit" class="btn btn-sec btn-bloco" data-status="rascunho">Salvar como rascunho</button>
            </div>`
          : `<button type="submit" class="btn btn-primario btn-grande btn-bloco" data-status="">💾 Salvar alterações</button>
             <p class="suave pequeno" style="margin-top:8px">Para encerrar, arquivar ou reabrir, use os botões na página da campanha.</p>`}
        </div>
      </div>
    </div>
    </form>`;

  const $ = (s) => el.querySelector(s);
  const form = $('[data-form]');
  const txt = form.mensagem;
  const tagsBox = $('[data-tags]');
  const cadastroBox = $('[data-cadastro]');
  const contagemEl = $('[data-contagem]');

  // ---- Prévia --------------------------------------------------------------
  const rodape = () => rodapeImagens({ id: camp.id, imagens_por_link: porLink }, imagens);
  const atualizarPrevia = async () => {
    $('[data-previa]').textContent = txt.value.trim()
      ? (await previaMensagem(txt.value)) + rodape()
      : 'A mensagem aparece aqui.';
  };

  const mostrarImagens = () => {
    const tem = imagens.length > 0;
    $('[data-galeria]').innerHTML = imagens.map((u, i) => `
      <figure class="galeria-item">
        <img src="${esc(u)}" alt="Imagem ${i + 1}" loading="lazy">
        <button type="button" class="galeria-remover" data-remover-img="${i}" aria-label="Remover imagem ${i + 1}">✕</button>
      </figure>`).join('');
    $('[data-modo-imagem]').classList.toggle('oculto', !tem);
    $('[data-baixar-imagens]').classList.toggle('oculto', !tem || porLink);
    const previaImgs = $('[data-previa-imagens]');
    previaImgs.classList.toggle('oculto', !tem || porLink);
    previaImgs.innerHTML = tem && !porLink ? imagens.slice(0, 4).map((u) => `<img src="${esc(u)}" alt="">`).join('') : '';
    atualizarPrevia();
  };

  ligarBotoesVariaveis(form, txt, atualizarPrevia);
  txt.addEventListener('input', debounce(atualizarPrevia, 200));
  $('[data-modelo]')?.addEventListener('change', (e) => {
    const m = modelos.find((x) => x.id === e.target.value);
    if (m) { txt.value = m.texto; atualizarPrevia(); }
  });

  $('[data-sugestoes]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sugestao]');
    if (!b) return;
    const s = SUGESTOES[Number(b.dataset.sugestao)];
    form.titulo.value = `${s.titulo} ${new Date().getFullYear()}`;
    form.categoria.value = s.categoria;
    txt.value = s.mensagem;
    el.querySelectorAll('[data-sugestao]').forEach((x) => x.classList.toggle('ativo', x === b));
    atualizarPrevia();
  });

  // ---- Imagens ---------------------------------------------------------------
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
        imagens.push(await enviarImagem(await prepararImagem(original)));
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
    if (url && !imagensSalvas.includes(url)) removerImagem(url).catch(() => {});
    $('[data-status-imagem]').textContent = 'Imagem removida. Salve a campanha para confirmar.';
    mostrarImagens();
  });

  form.querySelectorAll('[name=imagens_por_link]').forEach((r) => r.addEventListener('change', () => {
    porLink = form.querySelector('[name=imagens_por_link]:checked').value === 'link';
    mostrarImagens();
  }));

  $('[data-baixar-imagens]').addEventListener('click', (e) => comBotaoOcupado(e.currentTarget, async () => {
    for (const [i, u] of imagens.entries()) {
      try {
        const arq = await baixarComoArquivo(u);
        const ext = { 'image/png': 'png', 'image/webp': 'webp' }[arq.type] || 'jpg';
        baixarArquivo(`campanha-${i + 1}.${ext}`, arq, arq.type || 'image/jpeg');
        await new Promise((r) => setTimeout(r, 400));
      } catch (erro) {
        mostrarErro(erro, `Não foi possível baixar a imagem ${i + 1}.`);
      }
    }
    toast('Imagens baixadas! Anexe no WhatsApp com o 📎.');
  }, 'Baixando...'));

  // ---- Público ---------------------------------------------------------------
  const lerPublico = () => {
    const tipo = form.querySelector('[name=publico]:checked').value;
    return {
      tipo,
      filtro_tags: tipo === 'tags' ? [...tagsBox.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.tag) : [],
      filtro_aniversariantes_mes: tipo === 'aniversariantes',
      filtro_cadastro_de: tipo === 'cadastro' ? (form.filtro_cadastro_de.value || null) : null,
      filtro_cadastro_ate: tipo === 'cadastro' ? (form.filtro_cadastro_ate.value || null) : null,
    };
  };

  // ---- Clientes que vão receber (seleção já no cadastro) ---------------------
  const AJUDA = {
    manual: 'Marque um a um quem deve receber. Use a busca para achar o cliente.',
    filtro: 'Todos do público começam marcados. Desmarque quem não deve receber ou adicione alguém de fora.',
  };
  const marcados = new Set();
  let seletor = null;
  let ultimoTipo = null;
  let pedido = 0;

  const avisar = (texto) => {
    contagemEl.classList.toggle('oculto', !texto);
    contagemEl.textContent = texto || '';
  };

  const carregarBase = debounce(async () => {
    const meu = ++pedido;
    const p = lerPublico();
    const manual = p.tipo === 'manual';
    $('[data-ajuda-selecao]').textContent = manual ? AJUDA.manual : AJUDA.filtro;

    let base = [];
    if (p.tipo === 'tags' && !p.filtro_tags.length) avisar('Escolha pelo menos um grupo acima.');
    else if (p.tipo === 'cadastro' && !p.filtro_cadastro_de && !p.filtro_cadastro_ate) avisar('Informe pelo menos uma das datas de cadastro.');
    else {
      avisar('');
      const { data, error } = await supabase.rpc('clientes_publico', {
        p_tags: p.filtro_tags, p_aniversariantes: p.filtro_aniversariantes_mes,
        p_cadastro_de: p.filtro_cadastro_de, p_cadastro_ate: p.filtro_cadastro_ate,
      }).select('id, nome, telefone');
      if (meu !== pedido) return;
      if (error) {
        avisar(/function|clientes_publico/i.test(error.message)
          ? 'Falta rodar a atualização 05 no Supabase.' : 'Não foi possível carregar o público.');
        return;
      }
      base = data || [];
    }

    // 1ª vez: monta com a seleção que já estava salva na campanha
    if (!seletor) {
      const incluidos = camp.clientes_incluidos || [];
      const naBase = new Set(base.map((c) => c.id));
      let extras = [];
      try {
        extras = manual ? [] : await buscarElegiveisPorIds(incluidos.filter((id) => !naBase.has(id)));
      } catch (erro) {
        mostrarErro(erro);
      }
      if (meu !== pedido) return;
      if (manual) incluidos.forEach((id) => marcados.add(id));
      else {
        const excl = new Set(camp.clientes_excluidos || []);
        base.forEach((c) => { if (!excl.has(c.id)) marcados.add(c.id); });
        extras.forEach((c) => marcados.add(c.id));
      }
      seletor = montarSeletor($('[data-seletor]'), {
        base, extras, marcados,
        textoVazio: manual ? 'Nenhum cliente autorizou campanhas ainda.' : 'Nenhum cliente neste público.',
      });
      ultimoTipo = p.tipo;
      return;
    }

    // Trocou de "escolher um a um" para um filtro: começa com todos do filtro marcados
    if (ultimoTipo === 'manual' && !manual) {
      marcados.clear();
      base.forEach((c) => marcados.add(c.id));
    }
    seletor.atualizarBase(base, { marcarNovos: !manual });
    ultimoTipo = p.tipo;
  }, 250);

  form.querySelectorAll('[name=publico]').forEach((r) => r.addEventListener('change', () => {
    const tipo = lerPublico().tipo;
    tagsBox.classList.toggle('oculto', tipo !== 'tags');
    cadastroBox.classList.toggle('oculto', tipo !== 'cadastro');
    carregarBase();
  }));
  tagsBox.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') !== 'true');
    carregarBase();
  });
  cadastroBox.addEventListener('change', carregarBase);

  // ---- Salvar ----------------------------------------------------------------
  async function salvar(novoStatus) {
    const d = lerFormulario(form);
    const p = lerPublico();
    const status = novoStatus || camp.status;
    const ativando = status !== 'rascunho';

    if (!d.titulo) { form.titulo.focus(); return toast('Dê um nome para a campanha.', 'erro'); }
    if (!d.data_inicio) { form.data_inicio.focus(); return toast('Informe a data inicial.', 'erro'); }
    if (d.data_fim && d.data_fim < d.data_inicio) { form.data_fim.focus(); return toast('A data final não pode ser antes da inicial.', 'erro'); }
    if (ativando) {
      if (!d.categoria) { form.categoria.focus(); return toast('Escolha ou digite uma categoria.', 'erro'); }
      if (!d.mensagem) { txt.focus(); return toast('Escreva o texto da mensagem para ativar a campanha.', 'erro'); }
      if (p.tipo === 'tags' && !p.filtro_tags.length) return toast('Escolha pelo menos um grupo de clientes.', 'erro');
      if (p.tipo === 'cadastro' && !p.filtro_cadastro_de && !p.filtro_cadastro_ate) {
        return toast('Informe o período de cadastro dos clientes.', 'erro');
      }
      if (p.tipo === 'manual' && !(seletor?.selecionados().length)) {
        return toast('Marque pelo menos um cliente para receber a campanha.', 'erro');
      }
    }
    if (!seletor) return toast('Aguarde a lista de clientes terminar de carregar.', 'info');

    // Seleção de clientes: no modo manual guarda os escolhidos; no filtro, só os ajustes
    const manual = p.tipo === 'manual';
    const idsBase = seletor.base().map((c) => c.id);
    const selecao = manual
      ? { publico_manual: true, clientes_incluidos: seletor.selecionados().map((c) => c.id), clientes_excluidos: [] }
      : {
        publico_manual: false,
        clientes_excluidos: idsBase.filter((id) => !marcados.has(id)),
        clientes_incluidos: seletor.extras().filter((c) => marcados.has(c.id)).map((c) => c.id),
      };
    if (p.filtro_cadastro_de && p.filtro_cadastro_ate && p.filtro_cadastro_ate < p.filtro_cadastro_de) {
      return toast('No período de cadastro, a data final não pode ser antes da inicial.', 'erro');
    }

    const dados = {
      titulo: d.titulo,
      categoria: d.categoria || 'Personalizada',
      descricao: d.descricao || null,
      mensagem: d.mensagem || '',
      data_inicio: d.data_inicio,
      data_fim: d.data_fim || null,
      status,
      imagem_url: imagens[0] ?? null,
      imagens: [...imagens],
      imagens_por_link: porLink,
      filtro_tags: p.filtro_tags,
      filtro_aniversariantes_mes: p.filtro_aniversariantes_mes,
      filtro_cadastro_de: p.filtro_cadastro_de,
      filtro_cadastro_ate: p.filtro_cadastro_ate,
      ...selecao,
    };
    const consulta = nova
      ? supabase.from('campanhas').insert(dados)
      : supabase.from('campanhas').update(dados).eq('id', camp.id);
    const { data: salva, error } = await consulta.select().single();
    if (error) {
      const falta = /publico_manual/.test(error.message) ? '06'
        : /categoria|data_inicio|filtro_cadastro|status_check/.test(error.message) ? '05' : null;
      mostrarErro(error, falta ? `Falta rodar a atualização ${falta} no Supabase (veja as instruções).` : undefined);
      return;
    }

    // Imagens tiradas da campanha: apaga do Storage
    imagensSalvas.filter((u) => !imagens.includes(u)).forEach((u) => removerImagem(u).catch(() => {}));
    imagensSalvas = [...imagens];
    camp = { ...camp, ...salva };

    // Prévia do link no WhatsApp: a 1ª imagem vira a capa da página de fotos
    if (imagens.length && porLink && situacao(camp) !== 'rascunho') {
      try {
        await atualizarCapa(imagens[0]);
      } catch (erro) {
        console.warn('Capa da prévia não atualizada:', erro);
        toast('Campanha salva, mas a prévia da imagem no WhatsApp não foi atualizada.', 'info', 6000);
      }
    }

    toast(status === 'rascunho' ? 'Rascunho salvo. ✅' : nova || ehRascunho ? 'Campanha ativada! ✅' : 'Alterações salvas. ✅');
    salvo = true;
    ir(`/campanhas/${salva.id}`);
  }

  // Aviso ao sair sem salvar
  let salvo = false;
  let mexeu = false;
  form.addEventListener('input', () => { mexeu = true; }, { once: true });
  const aoSairDaPagina = (e) => {
    if (mexeu && !salvo) { e.preventDefault(); e.returnValue = ''; }
  };
  window.addEventListener('beforeunload', aoSairDaPagina);
  window.addEventListener('hashchange', () => window.removeEventListener('beforeunload', aoSairDaPagina), { once: true });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const botao = e.submitter || form.querySelector('[type=submit]');
    await comBotaoOcupado(botao, () => salvar(botao.dataset.status || ''), 'Salvando...');
  });

  // ---- Início ----------------------------------------------------------------
  mostrarImagens();
  carregarBase();
}
