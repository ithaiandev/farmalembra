// =====================================================================
// Rotas por hash:  app.html#/clientes/123?aba=compras
// Cada página é um módulo em js/pages/ com:  export async function render(el, { params, query })
// =====================================================================
import { ehAdmin } from './auth.js';
import { htmlCarregando, htmlVazio, mostrarErro } from './ui.js';

const ROTAS = [
  { padrao: '/painel', pagina: 'painel', titulo: 'Painel' },
  { padrao: '/balcao', pagina: 'balcao', titulo: 'Registrar compra' },
  { padrao: '/clientes', pagina: 'clientes', titulo: 'Clientes' },
  { padrao: '/clientes/novo', pagina: 'cliente-form', titulo: 'Novo cliente' },
  { padrao: '/clientes/:id/editar', pagina: 'cliente-form', titulo: 'Editar cliente' },
  { padrao: '/clientes/:id', pagina: 'cliente-ficha', titulo: 'Ficha do cliente' },
  { padrao: '/lembretes', pagina: 'lembretes', titulo: 'Lembretes' },
  { padrao: '/campanhas', pagina: 'campanhas', titulo: 'Campanhas' },
  { padrao: '/campanhas/nova', pagina: 'campanha', titulo: 'Nova campanha' },
  { padrao: '/campanhas/:id', pagina: 'campanha', titulo: 'Campanha' },
  { padrao: '/modelos', pagina: 'modelos', titulo: 'Modelos de mensagem' },
  { padrao: '/relatorios', pagina: 'relatorios', titulo: 'Relatórios' },
  { padrao: '/configuracoes', pagina: 'configuracoes', titulo: 'Configurações', admin: true },
  { padrao: '/importar', pagina: 'importar', titulo: 'Importar clientes', admin: true },
  { padrao: '/mais', pagina: 'mais', titulo: 'Mais opções' },
];

let container = null;
let contador = 0;

function casar(caminho) {
  const partes = caminho.split('/').filter(Boolean);
  for (const rota of ROTAS) {
    const p = rota.padrao.split('/').filter(Boolean);
    if (p.length !== partes.length) continue;
    const params = {};
    const ok = p.every((seg, i) => {
      if (seg.startsWith(':')) { params[seg.slice(1)] = decodeURIComponent(partes[i]); return true; }
      return seg === partes[i];
    });
    if (ok) return { rota, params };
  }
  return null;
}

async function renderizar() {
  const meu = ++contador;
  const hash = location.hash.replace(/^#/, '') || '/painel';
  const [caminho, busca = ''] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(busca));
  const achou = casar(caminho);

  // Destaca o item do menu
  const raiz = '/' + (caminho.split('/')[1] || 'painel');
  document.querySelectorAll('[data-rota]').forEach((a) => {
    a.classList.toggle('ativo', a.dataset.rota === raiz);
  });

  // Cada navegação ganha uma "folha" nova; se o usuário trocar de tela
  // antes de terminar de carregar, a folha antiga simplesmente é descartada.
  const folha = document.createElement('div');
  folha.className = 'pagina';
  container.replaceChildren(folha);
  window.scrollTo(0, 0);

  if (!achou) {
    folha.innerHTML = htmlVazio('Página não encontrada.', '🔎');
    return;
  }
  if (achou.rota.admin && !ehAdmin()) {
    folha.innerHTML = htmlVazio('Apenas o administrador pode acessar esta tela.', '🔒');
    return;
  }

  document.title = `${achou.rota.titulo} · FarmaLembra`;
  folha.innerHTML = htmlCarregando();
  try {
    const modulo = await import(`./pages/${achou.rota.pagina}.js`);
    if (meu !== contador) return;
    folha.innerHTML = '';
    await modulo.render(folha, { params: achou.params, query });
  } catch (e) {
    if (meu !== contador) return;
    mostrarErro(e, 'Erro ao abrir a tela.');
    folha.innerHTML = htmlVazio('Não foi possível carregar esta tela. Verifique a internet e tente de novo.', '⚠️');
  }
}

export function iniciarRouter(el) {
  container = el;
  window.addEventListener('hashchange', renderizar);
  renderizar();
}

/** Navega para uma rota, ex.: ir('/clientes/123') */
export function ir(caminho) {
  if (location.hash === '#' + caminho) renderizar();
  else location.hash = caminho;
}

/** Recarrega a tela atual */
export const recarregar = () => renderizar();
