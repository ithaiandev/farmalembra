// =====================================================================
// Sistema (app.html): confere o login, monta o menu e inicia as telas
// =====================================================================

import { exigirLogin, sessao, ehAdmin, sair } from './auth.js';
import { iniciarRouter, ir } from './router.js';
import { obterConfig } from './store.js';
import { supabase } from './supabase.js';
import { esc } from './utils.js';

// Modo escuro (padrão) / claro
document.querySelector('[data-alternar-tema]').addEventListener('click', () => {
  const raiz = document.documentElement;
  const escuro = raiz.dataset.tema !== 'escuro';
  if (escuro) raiz.dataset.tema = 'escuro'; else delete raiz.dataset.tema;
  try { localStorage.setItem('tema', escuro ? 'escuro' : 'claro'); } catch (e) {}
});

document.querySelectorAll('[data-sair]').forEach((b) => b.addEventListener('click', sair));

// Busca do topo: procura o cliente pelo nome ou telefone
const busca = document.querySelector('[data-busca-global]');
busca?.addEventListener('submit', (e) => {
  e.preventDefault();
  const termo = busca.q.value.trim();
  if (!termo) return;
  ir(`/clientes?busca=${encodeURIComponent(termo)}`);
  busca.q.blur();
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && busca && getComputedStyle(busca).display !== 'none') {
    e.preventDefault();
    busca.q.focus();
    busca.q.select();
  }
});

/** Sino do topo: acende quando há lembretes para hoje (consulta no máximo 1x por minuto) */
let ultimoSino = 0;
async function atualizarSino() {
  if (Date.now() - ultimoSino < 60000) return;
  ultimoSino = Date.now();
  const { data } = await supabase.rpc('resumo_painel');
  const n = Number(data?.hoje || 0);
  const sino = document.querySelector('[data-sino]');
  document.querySelector('[data-sino-ponto]')?.classList.toggle('oculto', !n);
  if (sino) sino.title = n ? `${n} lembrete(s) para hoje` : 'Nenhum lembrete para hoje';
}

if (await exigirLogin()) {
  const nome = sessao.perfil.nome || sessao.user.email;
  const papel = ehAdmin() ? 'Administrador' : 'Atendente';
  document.querySelector('[data-usuario]').innerHTML = `<strong>${esc(nome)}</strong><small>${papel}</small>`;
  const topo = document.querySelector('[data-usuario-topo]');
  if (topo) topo.innerHTML = `<strong>${esc(nome)}</strong><small>${papel}</small>`;
  document.querySelectorAll('[data-avatar]').forEach((el) => {
    el.textContent = String(nome).trim().charAt(0).toUpperCase();
    el.title = nome;
  });
  if (!ehAdmin()) document.querySelectorAll('[data-so-admin]').forEach((el) => el.remove());

  // Nome da farmácia aparece como marca no menu (vem das Configurações)
  obterConfig().then((cfg) => {
    if (!cfg.nome_farmacia || ['Minha Farmácia', 'a farmácia'].includes(cfg.nome_farmacia)) return;
    document.querySelectorAll('[data-nome-farmacia]').forEach((el) => { el.textContent = cfg.nome_farmacia; });
  }).catch(() => {});

  atualizarSino().catch(() => {});
  window.addEventListener('hashchange', () => atualizarSino().catch(() => {}));

  iniciarRouter(document.getElementById('conteudo'));
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
