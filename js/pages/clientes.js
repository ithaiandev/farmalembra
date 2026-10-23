// Lista de clientes: busca por nome/telefone, filtro por tag, paginação
import { supabase } from '../supabase.js';
import { ehAdmin } from '../auth.js';
import { mostrarErro, htmlCarregando, htmlVazio, badgeConsentimento, htmlTags } from '../ui.js';
import { esc, debounce, formatarTelefone, TAGS_PADRAO } from '../utils.js';

const POR_PAGINA = 20;

export async function render(el, { query }) {
  const estado = { busca: query.busca || '', tag: query.tag || '', situacao: '', pagina: 0 };

  el.innerHTML = `
    <div class="cabecalho">
      <h1>Clientes</h1>
      <div class="acoes">
        ${ehAdmin() ? '<a href="#/importar" class="btn btn-sec">📥 Importar CSV</a>' : ''}
        <a href="#/clientes/novo" class="btn btn-primario">➕ Novo cliente</a>
      </div>
    </div>
    <div class="barra-filtros">
      <label class="busca"><input type="search" placeholder="Buscar por nome ou telefone" data-busca
             aria-label="Buscar cliente" value="${esc(estado.busca)}"></label>
      <select data-tag aria-label="Filtrar por tag">
        <option value="">Todas as tags</option>
        ${TAGS_PADRAO.map((t) => `<option ${t === estado.tag ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
      <select data-situacao aria-label="Filtrar por situação">
        <option value="">Ativos</option>
        <option value="sem_consentimento">Sem autorização WhatsApp</option>
        <option value="opt_out">Pediram SAIR</option>
        <option value="inativos">Arquivados</option>
      </select>
    </div>
    <div class="card"><ul class="lista" data-lista></ul>
      <div class="paginacao" data-paginacao></div></div>`;

  const lista = el.querySelector('[data-lista]');
  const paginacao = el.querySelector('[data-paginacao]');

  async function carregar() {
    lista.innerHTML = `<li>${htmlCarregando()}</li>`;
    let q = supabase.from('clientes')
      .select('id, nome, telefone, tags, consentimento_whatsapp, opt_out, ativo', { count: 'exact' })
      .order('nome')
      .range(estado.pagina * POR_PAGINA, estado.pagina * POR_PAGINA + POR_PAGINA - 1);

    const termo = estado.busca.replace(/[,()%*]/g, ' ').trim();
    if (termo) {
      const digitos = termo.replace(/\D/g, '');
      q = digitos.length >= 3
        ? q.like('telefone', `%${digitos}%`)
        : q.ilike('nome', `%${termo}%`);
    }
    if (estado.tag) q = q.contains('tags', [estado.tag]);
    if (estado.situacao === 'inativos') q = q.eq('ativo', false);
    else q = q.eq('ativo', true);
    if (estado.situacao === 'sem_consentimento') q = q.eq('consentimento_whatsapp', false);
    if (estado.situacao === 'opt_out') q = q.eq('opt_out', true);

    const { data, count, error } = await q;
    if (error) {
      mostrarErro(error);
      lista.innerHTML = '';
      return;
    }

    lista.innerHTML = data.length ? data.map((c) => `
      <li class="item">
        <a class="item-link" href="#/clientes/${c.id}">
          <div class="avatar">${esc(c.nome.charAt(0).toUpperCase())}</div>
          <div class="item-principal">
            <div class="item-titulo">${esc(c.nome)}</div>
            <div class="item-sub">${esc(formatarTelefone(c.telefone))} ${htmlTags(c.tags)}</div>
          </div>
          ${badgeConsentimento(c)}
        </a>
      </li>`).join('')
      : `<li>${htmlVazio(termo ? 'Nenhum cliente encontrado.' : 'Nenhum cliente aqui ainda.', '👥')}</li>`;

    const total = count ?? 0;
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    paginacao.innerHTML = `
      <span class="suave pequeno">${total} cliente(s) · página ${estado.pagina + 1} de ${paginas}</span>
      <span>
        <button class="btn btn-sec btn-pequeno" data-ant ${estado.pagina === 0 ? 'disabled' : ''}>← Anterior</button>
        <button class="btn btn-sec btn-pequeno" data-prox ${estado.pagina + 1 >= paginas ? 'disabled' : ''}>Próxima →</button>
      </span>`;
    paginacao.querySelector('[data-ant]').addEventListener('click', () => { estado.pagina--; carregar(); });
    paginacao.querySelector('[data-prox]').addEventListener('click', () => { estado.pagina++; carregar(); });
  }

  el.querySelector('[data-busca]').addEventListener('input', debounce((e) => {
    estado.busca = e.target.value;
    estado.pagina = 0;
    carregar();
  }, 350));
  el.querySelector('[data-tag]').addEventListener('change', (e) => { estado.tag = e.target.value; estado.pagina = 0; carregar(); });
  el.querySelector('[data-situacao]').addEventListener('change', (e) => { estado.situacao = e.target.value; estado.pagina = 0; carregar(); });

  // Tags personalizadas já usadas também aparecem no filtro
  supabase.from('clientes').select('tags').neq('tags', '{}').limit(1000).then(({ data }) => {
    const extras = new Set((data || []).flatMap((c) => c.tags).filter((t) => !TAGS_PADRAO.includes(t)));
    const sel = el.querySelector('[data-tag]');
    [...extras].sort().forEach((t) => sel.insertAdjacentHTML('beforeend', `<option>${esc(t)}</option>`));
  });

  await carregar();
}
