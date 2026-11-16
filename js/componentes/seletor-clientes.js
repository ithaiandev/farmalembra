// =====================================================================
// Seletor de clientes com caixinhas (usado no cadastro da campanha e
// na janela de envio). Só lista/adiciona quem autorizou campanhas.
// =====================================================================
import { supabase } from '../supabase.js';
import { toast, mostrarErro, htmlVazio } from '../ui.js';
import { esc, debounce, formatarTelefone } from '../utils.js';

export const CAMPOS_CLIENTE = 'id, nome, telefone';
const MAX_NA_TELA = 300; // acima disso, pede para usar a busca (a seleção continua valendo)

/** Clientes por id que podem receber campanhas */
export async function buscarElegiveisPorIds(ids) {
  const lista = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('clientes').select(CAMPOS_CLIENTE)
      .in('id', ids.slice(i, i + 100))
      .eq('ativo', true).eq('consentimento_publicidade', true).eq('opt_out', false);
    if (error) throw error;
    lista.push(...data);
  }
  return lista;
}

/**
 * montarSeletor(area, {
 *   base,          // clientes do público (lista)
 *   extras,        // clientes adicionados à mão (fora do público)
 *   marcados,      // Set de ids marcados
 *   jaRegistrados, // Set de ids que já receberam (só mostra a etiqueta)
 *   textoVazio,    // mensagem quando não há ninguém
 *   aoMudar,       // chamado a cada mudança
 * })
 * Devolve { selecionados(), todos(), extras(), marcados, atualizarBase(novaBase) }
 */
export function montarSeletor(area, {
  base = [], extras = [], marcados = new Set(), jaRegistrados = new Set(),
  textoVazio = 'Nenhum cliente neste público.', aoMudar = () => {},
} = {}) {
  let lista = [...base];
  let maos = [...extras];

  area.innerHTML = `
    <div class="aviso ok seletor-contagem" data-contagem></div>
    <div class="barra-filtros">
      <label class="busca"><input type="search" data-busca placeholder="Procurar na lista" aria-label="Procurar cliente na lista"></label>
      <button type="button" class="btn btn-sec btn-pequeno" data-marcar>✓ Marcar todos</button>
      <button type="button" class="btn btn-sec btn-pequeno" data-desmarcar>Desmarcar todos</button>
      <button type="button" class="btn btn-sec btn-pequeno oculto" data-sem-repetidos>Desmarcar quem já recebeu</button>
    </div>
    <ul class="lista lista-contatos" data-contatos></ul>
    <details class="adicionar-contato">
      <summary class="btn btn-link" style="padding-left:0">＋ Adicionar cliente que não está na lista</summary>
      <label class="busca" style="display:block;margin-top:8px"><input type="search" data-busca-add
        placeholder="Nome ou telefone" aria-label="Procurar cliente para adicionar"></label>
      <ul class="lista" data-resultados-add></ul>
    </details>`;

  const $ = (s) => area.querySelector(s);
  const listaEl = $('[data-contatos]');
  const buscaEl = $('[data-busca]');

  const todos = () => {
    const ids = new Set(lista.map((c) => c.id));
    return [...lista, ...maos.filter((c) => !ids.has(c.id))].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  };
  const selecionados = () => todos().filter((c) => marcados.has(c.id));
  const visiveis = () => {
    const termo = buscaEl.value.trim().toLowerCase();
    const dig = termo.replace(/\D/g, '');
    return todos().filter((c) => !termo || c.nome.toLowerCase().includes(termo) || (dig.length >= 3 && c.telefone.includes(dig)));
  };

  const contar = () => {
    const sel = selecionados();
    const rep = sel.filter((c) => jaRegistrados.has(c.id)).length;
    $('[data-contagem]').innerHTML = `👥 <strong>${sel.length}</strong> de ${todos().length} cliente(s) selecionado(s)`
      + (rep ? ` · ${rep} já tem envio registrado nesta campanha` : '');
    $('[data-sem-repetidos]').classList.toggle('oculto', !jaRegistrados.size);
    aoMudar();
  };

  const desenhar = () => {
    const vis = visiveis();
    const mostrar = vis.slice(0, MAX_NA_TELA);
    listaEl.innerHTML = vis.length ? mostrar.map((c) => `
      <li class="item contato">
        <label class="contato-label">
          <input type="checkbox" data-id="${c.id}" ${marcados.has(c.id) ? 'checked' : ''}>
          <span class="item-principal">
            <span class="item-titulo">${esc(c.nome)}</span>
            <span class="item-sub">${esc(formatarTelefone(c.telefone))}
              ${maos.some((x) => x.id === c.id) && !lista.some((x) => x.id === c.id) ? ' <span class="badge badge-azul">adicionado</span>' : ''}
              ${jaRegistrados.has(c.id) ? ' <span class="badge badge-cinza">já recebeu</span>' : ''}</span>
          </span>
        </label>
      </li>`).join('')
      + (vis.length > MAX_NA_TELA
        ? `<li class="suave pequeno" style="padding:10px 0">Mostrando ${MAX_NA_TELA} de ${vis.length}. Use a busca para achar os outros — “Marcar/Desmarcar todos” vale para todos da busca.</li>` : '')
      : `<li>${htmlVazio(buscaEl.value ? 'Ninguém encontrado com essa busca.' : textoVazio, '👥')}</li>`;
    contar();
  };

  listaEl.addEventListener('change', (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;
    if (e.target.checked) marcados.add(id); else marcados.delete(id);
    contar();
  });
  buscaEl.addEventListener('input', debounce(desenhar, 200));
  $('[data-marcar]').addEventListener('click', () => { visiveis().forEach((c) => marcados.add(c.id)); desenhar(); });
  $('[data-desmarcar]').addEventListener('click', () => { visiveis().forEach((c) => marcados.delete(c.id)); desenhar(); });
  $('[data-sem-repetidos]').addEventListener('click', () => { jaRegistrados.forEach((id) => marcados.delete(id)); desenhar(); });

  // Adicionar cliente de fora da lista (só quem autorizou campanhas)
  const resultadosAdd = $('[data-resultados-add]');
  $('[data-busca-add]').addEventListener('input', debounce(async (e) => {
    const termo = e.target.value.replace(/[%_,()*\\]/g, ' ').trim();
    if (termo.length < 2) { resultadosAdd.innerHTML = ''; return; }
    const dig = termo.replace(/\D/g, '');
    let q = supabase.from('clientes').select(CAMPOS_CLIENTE)
      .eq('ativo', true).eq('consentimento_publicidade', true).eq('opt_out', false)
      .order('nome').limit(10);
    q = dig.length >= 3 ? q.like('telefone', `%${dig}%`) : q.ilike('nome', `%${termo}%`);
    const { data, error } = await q;
    if (error) return mostrarErro(error);
    const novos = (data || []).filter((c) => !marcados.has(c.id));
    resultadosAdd.innerHTML = novos.length ? novos.map((c) => `
      <li class="item"><div class="item-principal"><div class="item-titulo">${esc(c.nome)}</div>
        <div class="item-sub">${esc(formatarTelefone(c.telefone))}</div></div>
        <button type="button" class="btn btn-primario btn-pequeno" data-add="${c.id}">＋ Adicionar</button></li>`).join('')
      : '<li class="suave pequeno" style="padding:8px 0">Nenhum cliente encontrado (ou já está selecionado). Quem não autorizou campanhas não aparece.</li>';
    resultadosAdd.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const c = novos.find((x) => x.id === b.dataset.add);
      if (!lista.some((x) => x.id === c.id) && !maos.some((x) => x.id === c.id)) maos.push(c);
      marcados.add(c.id);
      b.closest('li').remove();
      desenhar();
      toast(`${c.nome} adicionado(a).`);
    }));
  }, 300));

  desenhar();

  return {
    marcados,
    selecionados,
    todos,
    base: () => lista,
    extras: () => maos.filter((c) => !lista.some((x) => x.id === c.id)),
    atualizarBase(novaBase, { marcarNovos = true } = {}) {
      const antes = new Set(lista.map((c) => c.id));
      lista = [...novaBase];
      if (marcarNovos) lista.forEach((c) => { if (!antes.has(c.id)) marcados.add(c.id); });
      desenhar();
    },
  };
}
