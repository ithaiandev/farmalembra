// Lista de campanhas
import { supabase } from '../supabase.js';
import { mostrarErro, htmlVazio, badgeStatus } from '../ui.js';
import { esc, formatarData } from '../utils.js';

export async function render(el) {
  const { data, error } = await supabase.from('campanhas')
    .select('*, campanha_envios(count)')
    .order('criado_em', { ascending: false });
  if (error) {
    mostrarErro(error);
    el.innerHTML = htmlVazio('Não foi possível carregar as campanhas.', '⚠️');
    return;
  }

  el.innerHTML = `
    <div class="cabecalho">
      <h1>📣 Campanhas</h1>
      <div class="acoes"><a href="#/campanhas/nova" class="btn btn-primario">➕ Nova campanha</a></div>
    </div>
    <div class="aviso">⚖️ Promova produtos como fraldas, dermocosméticos e eventos. Evite anunciar medicamentos de prescrição.</div>
    <div class="card">
      ${data.length ? `<ul class="lista">${data.map((c) => {
        const publico = c.filtro_aniversariantes_mes ? 'Aniversariantes do mês'
          : c.filtro_tags?.length ? `Tags: ${c.filtro_tags.join(', ')}` : 'Todos os clientes';
        return `
        <li class="item">
          <a class="item-link" href="#/campanhas/${c.id}">
            <div class="item-principal">
              <div class="item-titulo">${esc(c.titulo)}</div>
              <div class="item-sub">${formatarData(c.data_envio)} · ${esc(publico)} · ${c.campanha_envios?.[0]?.count ?? 0} enviada(s)</div>
            </div>
            ${badgeStatus(c.status)}
          </a>
        </li>`;
      }).join('')}</ul>` : htmlVazio('Nenhuma campanha ainda. Crie a primeira — ex.: Sexta-feira da Fralda!', '📣')}
    </div>`;
}
