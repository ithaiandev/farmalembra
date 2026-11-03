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
  document.querySelector('[data-usuario]').innerHTML =
    `${esc(sessao.perfil.nome || sessao.user.email)}<br><small>${ehAdmin() ? 'Administrador' : 'Atendente'}</small>`;
  if (!ehAdmin()) document.querySelectorAll('[data-so-admin]').forEach((el) => el.remove());

  // Nome da farmácia aparece embaixo da marca (vem das Configurações)
  obterConfig().then((cfg) => {
    document.querySelector('[data-nome-farmacia]').textContent = cfg.nome_farmacia;
  }).catch(() => {});

  iniciarRouter(document.getElementById('conteudo'));
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
