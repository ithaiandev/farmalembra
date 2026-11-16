// =====================================================================
// Sistema (app.html): confere o login, monta o menu e inicia as telas
// =====================================================================

import { exigirLogin, sessao, ehAdmin, sair } from './auth.js';
import { iniciarRouter } from './router.js';
import { obterConfig } from './store.js';
import { esc } from './utils.js';

// Modo escuro
document.querySelector('[data-tema]').addEventListener('click', () => {
  const raiz = document.documentElement;
  const escuro = raiz.dataset.tema !== 'escuro';
  if (escuro) raiz.dataset.tema = 'escuro'; else delete raiz.dataset.tema;
  try { localStorage.setItem('tema', escuro ? 'escuro' : 'claro'); } catch (e) {}
});

document.querySelectorAll('[data-sair]').forEach((b) => b.addEventListener('click', sair));

if (await exigirLogin()) {
  const nome = sessao.perfil.nome || sessao.user.email;
  document.querySelector('[data-usuario]').innerHTML =
    `<strong>${esc(nome)}</strong><small>${ehAdmin() ? 'Administrador' : 'Atendente'}</small>`;
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

  iniciarRouter(document.getElementById('conteudo'));
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
