// =====================================================================
// Página de detalhes da campanha
//  - dados, mensagem, imagens e público
//  - "Enviar pelo WhatsApp" (manual)
//  - histórico de registros de envio
//  - admin: editar, duplicar (usar como modelo), ativar, encerrar,
//    reabrir, arquivar, excluir
// =====================================================================
import { supabase } from '../supabase.js';
import { ehAdmin } from '../auth.js';
import { ir, recarregar } from '../router.js';
import { toast, mostrarErro, confirmar, comBotaoOcupado, htmlVazio, abrirModal, htmlCarregando } from '../ui.js';
import { esc, formatarData, formatarDataHora, formatarTelefone, hojeISO, baixarArquivo } from '../utils.js';
import { previaMensagem } from '../mensagens.js';
import { copiarImagem, removerImagem, baixarComoArquivo } from '../imagens.js';
import { abrirEnvioCampanha } from '../envio-campanha.js';
import {
  badgeSituacao, situacao, podeEnviar, motivoNaoEnviar, textoPeriodo, descreverPublico,
  parametrosPublico, imagensDe, rodapeImagens, mensagemParaTodos, copiarTexto,
} from '../campanhas-comum.js';

const CANAIS = {
  individual: 'Um por um (WhatsApp aberto pelo sistema)',
  transmissao: 'Lista de transmissão (registrado pelo atendente)',
};

export async function render(el, { params }) {
  const { data: camp, error } = await supabase.from('campanhas').select('*').eq('id', params.id).maybeSingle();
  if (error || !camp) {
    if (error) mostrarErro(error);
    el.innerHTML = htmlVazio('Campanha não encontrada.', '🔎');
    return;
  }

  const admin = ehAdmin();
  const sit = situacao(camp);
  const imagens = imagensDe(camp);

  const [disparosRes, registradosRes, publicoRes, origemRes] = await Promise.all([
    supabase.from('campanha_disparos')
      .select('id, canal, total_selecionados, criado_em, criado_por, campanha_disparo_clientes(whatsapp_aberto_em)')
      .eq('campanha_id', camp.id).order('criado_em', { ascending: false }).limit(50),
    supabase.from('campanha_envios').select('id', { count: 'exact', head: true })
      .eq('campanha_id', camp.id).eq('status', 'enviado'),
    supabase.rpc('clientes_publico', parametrosPublico(camp)).select('id'),
    camp.origem_id
      ? supabase.from('campanhas').select('id, titulo').eq('id', camp.origem_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const disparos = disparosRes.data || [];
  if (disparosRes.error) console.warn(disparosRes.error);

  // Nomes de quem criou / alterou / registrou
  const idsPerfis = [...new Set([camp.criado_por, camp.atualizado_por, ...disparos.map((d) => d.criado_por)].filter(Boolean))];
  const nomes = {};
  if (idsPerfis.length) {
    const { data } = await supabase.from('perfis').select('id, nome').in('id', idsPerfis);
    (data || []).forEach((p) => { nomes[p.id] = p.nome; });
  }

  const publicoHoje = publicoRes.error ? null : publicoRes.data.length;
  const registrados = registradosRes.count ?? 0;
  const ultimo = disparos[0]?.criado_em;

  el.innerHTML = `
    <a class="voltar" href="#/campanhas">← Campanhas</a>

    <div class="card camp-topo">
      ${imagens[0] ? `<img class="camp-capa" src="${esc(imagens[0])}" alt="">` : '<div class="camp-capa camp-capa-vazia" aria-hidden="true">📣</div>'}
      <div class="camp-topo-info">
        <div class="camp-card-topo">
          <span class="badge badge-azul">${esc(camp.categoria || 'Personalizada')}</span>
          ${badgeSituacao(camp)}
        </div>
        <h1>${esc(camp.titulo)}</h1>
        <p class="suave">📅 ${esc(textoPeriodo(camp))}</p>
        ${camp.descricao ? `<p class="camp-descricao">${esc(camp.descricao)}</p>` : ''}
        <p class="suave pequeno">Criada em ${formatarDataHora(camp.criado_em)}${nomes[camp.criado_por] ? ` por ${esc(nomes[camp.criado_por])}` : ''}
          ${camp.atualizado_em && camp.atualizado_em !== camp.criado_em ? ` · alterada em ${formatarDataHora(camp.atualizado_em)}${nomes[camp.atualizado_por] ? ` por ${esc(nomes[camp.atualizado_por])}` : ''}` : ''}
          ${origemRes.data ? ` · criada a partir de <a href="#/campanhas/${origemRes.data.id}">${esc(origemRes.data.titulo)}</a>` : ''}</p>
      </div>
      <div class="camp-topo-acoes">
        ${podeEnviar(camp)
          ? '<button type="button" class="btn btn-whats btn-grande" data-enviar>💬 Enviar pelo WhatsApp</button>'
          : `<div class="aviso">${esc(motivoNaoEnviar(camp))}</div>`}
        ${admin ? `
          <div class="item-acoes">
            <a class="btn btn-sec btn-pequeno" href="#/campanhas/${camp.id}/editar">✏️ Editar</a>
            <button type="button" class="btn btn-sec btn-pequeno" data-duplicar>⧉ Usar como modelo</button>
            ${sit === 'rascunho' ? '<button type="button" class="btn btn-primario btn-pequeno" data-ativar>✓ Ativar</button>' : ''}
            ${sit === 'ativa' || sit === 'agendada' ? '<button type="button" class="btn btn-sec btn-pequeno" data-encerrar>⏹ Encerrar</button>' : ''}
            ${sit === 'encerrada' ? '<button type="button" class="btn btn-sec btn-pequeno" data-reabrir>↺ Reabrir</button>' : ''}
            ${camp.arquivada_em
              ? '<button type="button" class="btn btn-sec btn-pequeno" data-desarquivar>📤 Desarquivar</button>'
              : '<button type="button" class="btn btn-sec btn-pequeno" data-arquivar>🗄️ Arquivar</button>'}
          </div>` : ''}
      </div>
    </div>

    <div class="grade-cards camp-numeros">
      <div class="numero"><span class="valor">${publicoHoje ?? '—'}</span><span class="rotulo">Clientes no público hoje</span></div>
      <div class="numero verde"><span class="valor">${registrados}</span><span class="rotulo">Clientes com envio registrado</span></div>
      <div class="numero amarelo"><span class="valor">${disparos.length}</span><span class="rotulo">Registros de envio</span></div>
      <div class="numero"><span class="valor valor-texto">${ultimo ? formatarData(ultimo.slice(0, 10)) : '—'}</span><span class="rotulo">Último registro</span></div>
    </div>

    <div class="grade-dupla">
      <div>
        <div class="card">
          <h2>✍️ Mensagem <span class="acoes"><button type="button" class="btn btn-sec btn-pequeno" data-copiar>📋 Copiar texto</button></span></h2>
          <div class="previa-whats"><div class="balao">${imagens.length && camp.imagens_por_link === false
              ? `<div class="balao-imagens">${imagens.slice(0, 4).map((u) => `<img src="${esc(u)}" alt="">`).join('')}</div>` : ''}<div data-previa>${camp.mensagem ? '' : '<em>Sem mensagem ainda.</em>'}</div></div></div>
          <p class="suave pequeno" style="margin-top:8px">Exemplo com a cliente “Maria Silva”. Cada cliente recebe com o próprio nome.</p>
        </div>

        ${imagens.length ? `
        <div class="card">
          <h2>🖼️ Imagens (${imagens.length})
            ${camp.imagens_por_link === false ? '<span class="acoes"><button type="button" class="btn btn-sec btn-pequeno" data-baixar-imagens>⬇ Baixar</button></span>' : ''}</h2>
          <div class="galeria">${imagens.map((u, i) => `<figure class="galeria-item"><img src="${esc(u)}" alt="Imagem ${i + 1}" loading="lazy"></figure>`).join('')}</div>
          <p class="suave pequeno">${camp.imagens_por_link === false
            ? 'Modo manual: baixe as imagens e anexe no WhatsApp (📎).'
            : 'Vão por link no fim da mensagem (“📸 Confira aqui”).'}</p>
        </div>` : ''}

        <div class="card">
          <h2>👥 Público</h2>
          <p>${esc(descreverPublico(camp))}</p>
          <p class="suave pequeno">🔒 Só recebem clientes ativos que autorizaram campanhas e não pediram para sair.
            ${publicoHoje === null ? '' : `Hoje são <strong>${publicoHoje}</strong> cliente(s).`}</p>
        </div>
      </div>

      <div>
        <div class="card">
          <h2>📝 Histórico de envios</h2>
          <p class="suave pequeno">Registro interno: data, quem fez e quais clientes foram selecionados.
            “WhatsApp aberto” indica que a conversa foi aberta com a mensagem pronta — não confirma a entrega.</p>
          ${disparos.length ? `<ul class="lista">${disparos.map((d) => {
            const total = d.campanha_disparo_clientes?.length ?? d.total_selecionados;
            const abertos = (d.campanha_disparo_clientes || []).filter((x) => x.whatsapp_aberto_em).length;
            return `
            <li class="item">
              <div class="item-principal">
                <div class="item-titulo">${formatarDataHora(d.criado_em)}</div>
                <div class="item-sub">${esc(CANAIS[d.canal] || d.canal)}${nomes[d.criado_por] ? ` · por ${esc(nomes[d.criado_por])}` : ''}</div>
                <div class="item-sub">${total} selecionado(s)${d.canal === 'individual' ? ` · WhatsApp aberto para ${abertos}` : ''}</div>
              </div>
              <button type="button" class="btn btn-sec btn-pequeno" data-ver-disparo="${d.id}">Ver clientes</button>
            </li>`;
          }).join('')}</ul>` : htmlVazio('Nenhum envio registrado ainda.', '📭')}
        </div>
        ${admin ? `<button type="button" class="btn btn-link btn-bloco texto-perigo" data-excluir>🗑️ Excluir campanha</button>` : ''}
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);

  // ---- Prévia ----------------------------------------------------------------
  if (camp.mensagem) {
    $('[data-previa]').textContent = (await previaMensagem(camp.mensagem)) + rodapeImagens(camp);
  }

  $('[data-copiar]').addEventListener('click', async () => {
    if (!camp.mensagem) return toast('Esta campanha ainda não tem mensagem.', 'erro');
    toast(await copiarTexto(await mensagemParaTodos(camp))
      ? 'Texto copiado (sem o nome do cliente).' : 'Não consegui copiar. Selecione o texto e copie.');
  });

  $('[data-baixar-imagens]')?.addEventListener('click', (e) => comBotaoOcupado(e.currentTarget, async () => {
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
  }, 'Baixando...'));

  // ---- Enviar ----------------------------------------------------------------
  $('[data-enviar]')?.addEventListener('click', async () => {
    if (await abrirEnvioCampanha(camp)) recarregar();
  });

  // ---- Clientes de um registro --------------------------------------------
  el.querySelectorAll('[data-ver-disparo]').forEach((b) => b.addEventListener('click', () => {
    const d = disparos.find((x) => x.id === b.dataset.verDisparo);
    abrirModal({
      titulo: `Envio de ${formatarDataHora(d.criado_em)}`,
      largura: 'modal-largo',
      html: `<div data-itens>${htmlCarregando()}</div>`,
      async aoAbrir(dlg) {
        const area = dlg.querySelector('[data-itens]');
        const { data, error: e } = await supabase.from('campanha_disparo_clientes')
          .select('cliente_id, whatsapp_aberto_em, clientes(nome, telefone)')
          .eq('disparo_id', d.id).limit(5000);
        if (e) { mostrarErro(e); area.innerHTML = htmlVazio('Não foi possível carregar.', '⚠️'); return; }
        const lista = (data || []).sort((a, b) => (a.clientes?.nome || '').localeCompare(b.clientes?.nome || '', 'pt-BR'));
        area.innerHTML = `
          <p class="suave pequeno">${esc(CANAIS[d.canal] || d.canal)}${nomes[d.criado_por] ? ` · por ${esc(nomes[d.criado_por])}` : ''}</p>
          ${lista.length ? `<ul class="lista">${lista.map((x) => `
            <li class="item"><div class="item-principal">
              <div class="item-titulo"><a href="#/clientes/${x.cliente_id}">${esc(x.clientes?.nome ?? 'Cliente removido')}</a></div>
              <div class="item-sub">${esc(formatarTelefone(x.clientes?.telefone))}</div></div>
              ${d.canal === 'transmissao'
                ? '<span class="badge badge-cinza">Registrado</span>'
                : x.whatsapp_aberto_em
                  ? `<span class="badge badge-verde" title="Conversa aberta pelo sistema">WhatsApp aberto ${formatarDataHora(x.whatsapp_aberto_em)}</span>`
                  : '<span class="badge badge-amarelo">Não aberto</span>'}
            </li>`).join('')}</ul>` : htmlVazio('Nenhum cliente neste registro.', '👥')}`;
        area.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => dlg.close()));
      },
    });
  }));

  if (!admin) return;

  // ---- Ações do admin --------------------------------------------------------
  async function atualizar(dados, msgOk) {
    const { error: e } = await supabase.from('campanhas').update(dados).eq('id', camp.id);
    if (e) return mostrarErro(e);
    toast(msgOk);
    recarregar();
  }

  $('[data-ativar]')?.addEventListener('click', async () => {
    if (!camp.mensagem?.trim()) {
      toast('Escreva a mensagem antes de ativar.', 'erro');
      return ir(`/campanhas/${camp.id}/editar`);
    }
    if (await confirmar({ titulo: 'Ativar campanha', mensagem: 'Ativar libera o botão “Enviar pelo WhatsApp” para a equipe. Continuar?', botao: 'Ativar' })) {
      atualizar({ status: 'ativa' }, 'Campanha ativada. ✅');
    }
  });

  $('[data-encerrar]')?.addEventListener('click', async () => {
    if (await confirmar({
      titulo: 'Encerrar campanha',
      mensagem: 'Depois de encerrada, ninguém consegue registrar novos envios. O histórico continua guardado. Encerrar?',
      botao: 'Encerrar', perigo: true,
    })) atualizar({ status: 'encerrada' }, 'Campanha encerrada.');
  });

  $('[data-reabrir]')?.addEventListener('click', async () => {
    if (camp.data_fim && camp.data_fim < hojeISO()) {
      toast('A data final já passou. Ajuste a data final, salve e, se precisar, clique em “Reabrir”.', 'info', 7000);
      return ir(`/campanhas/${camp.id}/editar`);
    }
    if (await confirmar({ titulo: 'Reabrir campanha', mensagem: 'A campanha volta a ficar ativa e pode ser enviada de novo.', botao: 'Reabrir' })) {
      atualizar({ status: 'ativa' }, 'Campanha reaberta.');
    }
  });

  $('[data-arquivar]')?.addEventListener('click', async () => {
    if (await confirmar({
      titulo: 'Arquivar campanha',
      mensagem: 'A campanha sai da lista principal (fica em “Arquivadas”) e não pode ser enviada. Nada é apagado.',
      botao: 'Arquivar',
    })) atualizar({ arquivada_em: new Date().toISOString() }, 'Campanha arquivada.');
  });

  $('[data-desarquivar]')?.addEventListener('click', () => atualizar({ arquivada_em: null }, 'Campanha desarquivada.'));

  $('[data-duplicar]').addEventListener('click', async (e) => {
    const botao = e.currentTarget;
    const ok = await confirmar({
      titulo: 'Usar como modelo',
      mensagem: 'Cria uma campanha nova (rascunho) com o mesmo texto, imagens, categoria e público. '
        + 'O histórico de envios não é copiado. Você poderá editar tudo antes de ativar.',
      botao: 'Criar cópia',
    });
    if (!ok) return;
    await comBotaoOcupado(botao, async () => {
      const novas = [];
      for (const u of imagens) {
        try {
          novas.push(await copiarImagem(u));
        } catch (erro) {
          console.warn('Imagem não copiada:', erro);
        }
      }
      if (novas.length < imagens.length) toast('Algumas imagens não puderam ser copiadas. Confira na edição.', 'info', 6000);
      const { data: nova, error: e2 } = await supabase.from('campanhas').insert({
        titulo: `${camp.titulo} (cópia)`.slice(0, 150),
        categoria: camp.categoria || 'Personalizada',
        descricao: camp.descricao,
        mensagem: camp.mensagem || '',
        imagens: novas,
        imagem_url: novas[0] ?? null,
        imagens_por_link: camp.imagens_por_link !== false,
        filtro_tags: camp.filtro_tags || [],
        filtro_aniversariantes_mes: !!camp.filtro_aniversariantes_mes,
        filtro_cadastro_de: camp.filtro_cadastro_de,
        filtro_cadastro_ate: camp.filtro_cadastro_ate,
        data_inicio: hojeISO(),
        data_fim: null,
        status: 'rascunho',
        origem_id: camp.id,
      }).select('id').single();
      if (e2) {
        novas.forEach((u) => removerImagem(u).catch(() => {}));
        return mostrarErro(e2);
      }
      toast('Cópia criada como rascunho. Ajuste o que precisar. ✅');
      ir(`/campanhas/${nova.id}/editar`);
    }, 'Copiando...');
  });

  $('[data-excluir]').addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Excluir campanha',
      mensagem: disparos.length
        ? `Esta campanha tem ${disparos.length} registro(s) de envio. Excluir apaga a campanha, as imagens e TODO o histórico. `
          + 'Para guardar o histórico, prefira “Arquivar”. Excluir mesmo assim?'
        : 'Excluir esta campanha e as imagens dela? Não dá para desfazer.',
      botao: 'Excluir', perigo: true,
    });
    if (!ok) return;
    const { error: e } = await supabase.from('campanhas').delete().eq('id', camp.id);
    if (e) return mostrarErro(e);
    imagens.forEach((u) => removerImagem(u).catch(() => {}));
    toast('Campanha excluída.');
    ir('/campanhas');
  });
}
