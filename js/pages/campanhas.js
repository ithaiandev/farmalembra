// =====================================================================
// Lista de campanhas: busca, filtros (categoria, situação, período) e paginação
// =====================================================================
import { supabase } from '../supabase.js';
import { ehAdmin } from '../auth.js';
import { mostrarErro, htmlVazio, htmlCarregando } from '../ui.js';
import { esc, debounce, hojeISO } from '../utils.js';
import {
  badgeSituacao, textoPeriodo, descreverPublico, htmlMiniatura,
} from '../campanhas-comum.js';

const POR_PAGINA = 12;

// Filtros ficam guardados enquanto o sistema está aberto (voltar da campanha mantém a busca)
const estado = { busca: '', categoria: '', situacao: 'atuais', de: '', ate: '', pagina: 0 };

const SITUACOES = [
  ['atuais', 'Atuais (não arquivadas)'],
  ['ativa', 'Ativas e agendadas'],
  ['rascunho', 'Rascunhos'],
  ['encerrada', 'Encerradas'],
  ['arquivada', 'Arquivadas'],
  ['todas', 'Todas'],
];

export async function render(el) {
  const admin = ehAdmin();
  el.innerHTML = `
    <div class="cabecalho">
      <div class="cabecalho-texto">
        <h1>Campanhas</h1>
        <p class="suave">Crie, acompanhe e envie campanhas de relacionamento pelo WhatsApp.</p>
      </div>
      ${admin ? '<div class="acoes"><a href="#/campanhas/nova" class="btn btn-primario">＋ Nova campanha</a></div>' : ''}
    </div>

    <div class="card filtros-card">
      <div class="barra-filtros">
        <label class="busca"><input type="search" data-f="busca" placeholder="Buscar pelo nome da campanha"
          aria-label="Buscar campanha pelo nome" value="${esc(estado.busca)}"></label>
        <select data-f="categoria" aria-label="Categoria"><option value="">Todas as categorias</option></select>
        <select data-f="situacao" aria-label="Situação">
          ${SITUACOES.map(([v, t]) => `<option value="${v}" ${estado.situacao === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="barra-filtros periodo">
        <span class="suave pequeno">Período:</span>
        <label class="campo-inline"><span>de</span><input type="date" data-f="de" value="${esc(estado.de)}"></label>
        <label class="campo-inline"><span>até</span><input type="date" data-f="ate" value="${esc(estado.ate)}"></label>
        <button type="button" class="btn btn-link btn-pequeno" data-limpar>Limpar filtros</button>
      </div>
    </div>

    <div data-resultado></div>`;

  const $ = (s) => el.querySelector(s);
  const resultado = $('[data-resultado]');

  // Categorias já usadas (para o filtro)
  supabase.from('campanhas').select('categoria').limit(2000).then(({ data }) => {
    const sel = $('[data-f="categoria"]');
    if (!sel) return;
    const cats = [...new Set((data || []).map((c) => c.categoria).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (estado.categoria && !cats.includes(estado.categoria)) cats.push(estado.categoria);
    sel.insertAdjacentHTML('beforeend', cats.map((c) =>
      `<option value="${esc(c)}" ${estado.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join(''));
  });

  let pedido = 0;
  async function carregar() {
    const meu = ++pedido;
    resultado.innerHTML = htmlCarregando();
    const hoje = hojeISO();

    let q = supabase.from('campanhas')
      .select('id, titulo, categoria, status, data_inicio, data_fim, arquivada_em, imagem_url, imagens, '
        + 'filtro_tags, filtro_aniversariantes_mes, filtro_cadastro_de, filtro_cadastro_ate, campanha_envios(count)',
      { count: 'exact' })
      .order('data_inicio', { ascending: false })
      .order('criado_em', { ascending: false })
      .range(estado.pagina * POR_PAGINA, estado.pagina * POR_PAGINA + POR_PAGINA - 1);

    const termo = estado.busca.replace(/[%_,()*\\]/g, ' ').trim();
    if (termo) q = q.ilike('titulo', `%${termo}%`);
    if (estado.categoria) q = q.eq('categoria', estado.categoria);
    if (estado.ate) q = q.lte('data_inicio', estado.ate);

    // Período: a campanha precisa terminar depois de "de" (ou não ter data final).
    // Um único filtro "or" por consulta (o Supabase não combina dois).
    const de = estado.de || null;
    const fimAPartir = (d) => `data_fim.is.null,data_fim.gte.${d}`;
    switch (estado.situacao) {
      case 'ativa': {
        const minimo = de && de > hoje ? de : hoje;
        q = q.is('arquivada_em', null).eq('status', 'ativa').or(fimAPartir(minimo));
        break;
      }
      case 'encerrada':
        q = q.is('arquivada_em', null).or(de
          ? `and(status.eq.encerrada,or(${fimAPartir(de)})),and(status.eq.ativa,data_fim.lt.${hoje},data_fim.gte.${de})`
          : `status.eq.encerrada,and(status.eq.ativa,data_fim.lt.${hoje})`);
        break;
      default:
        if (estado.situacao === 'atuais') q = q.is('arquivada_em', null);
        if (estado.situacao === 'rascunho') q = q.is('arquivada_em', null).eq('status', 'rascunho');
        if (estado.situacao === 'arquivada') q = q.not('arquivada_em', 'is', null);
        if (de) q = q.or(fimAPartir(de));
    }

    const { data, error, count } = await q;
    if (meu !== pedido) return;
    if (error) {
      const falta = /categoria|data_inicio|arquivada_em/.test(error.message);
      mostrarErro(error, falta ? 'Falta rodar a atualização 05 no Supabase (veja as instruções).' : undefined);
      resultado.innerHTML = htmlVazio('Não foi possível carregar as campanhas.', '⚠️');
      return;
    }

    const temFiltro = termo || estado.categoria || estado.de || estado.ate || !['atuais', 'todas'].includes(estado.situacao);
    if (!data.length) {
      resultado.innerHTML = `<div class="card">${htmlVazio(temFiltro
        ? 'Nenhuma campanha encontrada com esses filtros.'
        : admin ? 'Nenhuma campanha ainda. Clique em “Nova campanha” para criar a primeira.'
          : 'Nenhuma campanha cadastrada ainda.', '📣')}</div>`;
      return;
    }

    const total = count ?? data.length;
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    resultado.innerHTML = `
      <p class="suave pequeno contagem-lista">${total} campanha(s)</p>
      <div class="grade-campanhas">
        ${data.map((c) => `
          <a class="camp-card" href="#/campanhas/${c.id}">
            ${htmlMiniatura(c)}
            <span class="camp-card-corpo">
              <span class="camp-card-topo">
                <span class="badge badge-azul">${esc(c.categoria || 'Personalizada')}</span>
                ${badgeSituacao(c)}
              </span>
              <strong class="camp-card-titulo">${esc(c.titulo)}</strong>
              <span class="item-sub">📅 ${esc(textoPeriodo(c))}</span>
              <span class="item-sub">👥 ${esc(descreverPublico(c))}</span>
              <span class="item-sub">📝 ${c.campanha_envios?.[0]?.count ?? 0} cliente(s) com envio registrado</span>
            </span>
          </a>`).join('')}
      </div>
      ${paginas > 1 ? `
        <div class="paginacao">
          <button type="button" class="btn btn-sec btn-pequeno" data-pag="-1" ${estado.pagina === 0 ? 'disabled' : ''}>← Anterior</button>
          <span class="suave pequeno">Página ${estado.pagina + 1} de ${paginas}</span>
          <button type="button" class="btn btn-sec btn-pequeno" data-pag="1" ${estado.pagina >= paginas - 1 ? 'disabled' : ''}>Próxima →</button>
        </div>` : ''}`;

    resultado.querySelectorAll('[data-pag]').forEach((b) => b.addEventListener('click', () => {
      estado.pagina = Math.max(0, estado.pagina + Number(b.dataset.pag));
      carregar();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  const aoMudar = () => { estado.pagina = 0; carregar(); };
  $('[data-f="busca"]').addEventListener('input', debounce((e) => { estado.busca = e.target.value; aoMudar(); }, 300));
  ['categoria', 'situacao', 'de', 'ate'].forEach((k) => {
    $(`[data-f="${k}"]`).addEventListener('change', (e) => { estado[k] = e.target.value; aoMudar(); });
  });
  $('[data-limpar]').addEventListener('click', () => {
    Object.assign(estado, { busca: '', categoria: '', situacao: 'atuais', de: '', ate: '', pagina: 0 });
    render(el);
  });

  await carregar();
}
