// =====================================================================
// Componentes de interface: toasts, confirmação, modal, carregando
// =====================================================================
import { esc, VARIAVEIS } from './utils.js';

// ---------------------------------------------------------------------
// Botões que inserem {variáveis} num <textarea>
// ---------------------------------------------------------------------
export function htmlBotoesVariaveis(chaves = null) {
  const lista = chaves ? VARIAVEIS.filter((v) => chaves.includes(v.chave)) : VARIAVEIS;
  return `<div class="variaveis" data-variaveis>${lista.map((v) =>
    `<button type="button" data-var="${esc(v.chave)}" title="${esc(v.desc)}">${esc(v.chave)}</button>`).join('')}</div>`;
}

export function ligarBotoesVariaveis(raiz, textarea, aoMudar) {
  raiz.querySelector('[data-variaveis]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-var]');
    if (!b) return;
    const ini = textarea.selectionStart ?? textarea.value.length;
    const fim = textarea.selectionEnd ?? ini;
    textarea.setRangeText(b.dataset.var, ini, fim, 'end');
    textarea.focus();
    aoMudar?.();
  });
}

// ---------------------------------------------------------------------
// Toasts (avisos rápidos no canto da tela)
// ---------------------------------------------------------------------
export function toast(mensagem, tipo = 'ok', ms = 3500) {
  let area = document.getElementById('toasts');
  if (!area) {
    area = document.createElement('div');
    area.id = 'toasts';
    document.body.appendChild(area);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.textContent = mensagem;
  area.appendChild(el);
  setTimeout(() => el.classList.add('saindo'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

/** Mostra um erro do Supabase em português */
export function mostrarErro(erro, padrao = 'Não foi possível concluir. Tente de novo.') {
  console.error(erro);
  const msg = String(erro?.message ?? erro ?? '');
  const codigo = erro?.code;
  let texto = padrao;
  if (codigo === '23505') texto = 'Esse registro já existe (dado repetido).';
  else if (codigo === '42501' || /row-level security|permission denied/i.test(msg)) texto = 'Você não tem permissão para isso.';
  else if (codigo === 'P0001' && msg) texto = msg;
  else if (codigo === '23514') texto = 'Algum dado está fora do formato esperado. Confira os campos.';
  else if (/Failed to fetch|NetworkError|network/i.test(msg)) texto = 'Sem conexão com a internet. Tente de novo.';
  else if (/JWT|session|token/i.test(msg)) texto = 'Sua sessão expirou. Entre novamente.';
  toast(texto, 'erro', 5000);
}

// ---------------------------------------------------------------------
// Modal genérico (usa <dialog>)
// ---------------------------------------------------------------------
/**
 * abrirModal({ titulo, html, largura, aoAbrir(el, fechar) })
 * Devolve uma Promise que resolve com o valor passado a fechar(valor).
 */
export function abrirModal({ titulo, html, largura = '', aoAbrir }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `modal ${largura}`;
    dlg.innerHTML = `
      <div class="modal-topo">
        <h2>${esc(titulo)}</h2>
        <button type="button" class="btn-icone" data-fechar aria-label="Fechar">✕</button>
      </div>
      <div class="modal-corpo">${html}</div>`;
    document.body.appendChild(dlg);

    // Responde na hora do clique (não depende do evento "close", que pode atrasar).
    // O "close" ainda cobre o caso da tecla Esc / botão voltar.
    let terminou = false;
    const terminar = (v) => {
      if (terminou) return;
      terminou = true;
      dlg.remove();
      resolve(v);
    };
    const fechar = (v) => {
      if (dlg.open) dlg.close();
      terminar(v);
    };
    dlg.addEventListener('close', () => terminar(undefined));
    dlg.querySelector('[data-fechar]').addEventListener('click', () => fechar(undefined));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) fechar(undefined); });

    dlg.showModal();
    aoAbrir?.(dlg, fechar);
  });
}

/** Caixa de confirmação. Resolve true/false. */
export function confirmar({ titulo = 'Confirmar', mensagem = 'Tem certeza?', botao = 'Confirmar', perigo = false } = {}) {
  return abrirModal({
    titulo,
    html: `
      <p class="confirmar-texto">${esc(mensagem)}</p>
      <div class="acoes-modal">
        <button type="button" class="btn btn-sec" data-nao>Voltar</button>
        <button type="button" class="btn ${perigo ? 'btn-perigo' : 'btn-primario'}" data-sim>${esc(botao)}</button>
      </div>`,
    aoAbrir(el, fechar) {
      el.querySelector('[data-nao]').addEventListener('click', () => fechar(false));
      el.querySelector('[data-sim]').addEventListener('click', () => fechar(true));
      el.querySelector('[data-sim]').focus();
    },
  }).then((v) => v === true);
}

// ---------------------------------------------------------------------
// Estados de carregamento / vazio
// ---------------------------------------------------------------------
export const htmlCarregando = (texto = 'Carregando...') =>
  `<div class="carregando"><span class="spinner" aria-hidden="true"></span>${esc(texto)}</div>`;

export const htmlVazio = (texto, icone = '📭') =>
  `<div class="vazio"><div class="vazio-icone" aria-hidden="true">${icone}</div><p>${esc(texto)}</p></div>`;

/** Desativa um botão enquanto a ação roda, com "Salvando..." */
export async function comBotaoOcupado(botao, fn, texto = 'Aguarde...') {
  const original = botao.innerHTML;
  botao.disabled = true;
  botao.innerHTML = `<span class="spinner pequeno" aria-hidden="true"></span> ${esc(texto)}`;
  try {
    return await fn();
  } finally {
    botao.disabled = false;
    botao.innerHTML = original;
  }
}

// ---------------------------------------------------------------------
// Etiquetas de status
// ---------------------------------------------------------------------
const STATUS = {
  pendente: ['Pendente', 'amarelo'],
  enviado: ['Enviado', 'azul'],
  recomprou: ['Recomprou ✓', 'verde'],
  sem_retorno: ['Sem retorno', 'cinza'],
  cancelado: ['Cancelado', 'cinza'],
  rascunho: ['Rascunho', 'cinza'],
  enviando: ['Enviando', 'amarelo'],
  concluida: ['Concluída', 'verde'],
  pulado: ['Pulado', 'cinza'],
  erro: ['Erro', 'vermelho'],
};

export function badgeStatus(status) {
  const [texto, cor] = STATUS[status] ?? [status ?? '—', 'cinza'];
  return `<span class="badge badge-${cor}">${esc(texto)}</span>`;
}

export function badgeConsentimento(cliente) {
  if (cliente.opt_out) return '<span class="badge badge-vermelho" title="Pediu para não receber mensagens">🚫 Não enviar</span>';
  if (!cliente.consentimento_whatsapp) return '<span class="badge badge-amarelo" title="Sem autorização LGPD">Sem autorização</span>';
  return '<span class="badge badge-verde" title="Autorizou receber mensagens">WhatsApp ✓</span>';
}

export function htmlTags(tags = []) {
  return (tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ');
}
