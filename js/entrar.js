// =====================================================================
// Tela de login (index.html): entrar, recuperar senha e definir nova senha
// =====================================================================

import { supabase, configurado } from './supabase.js';
import { entrar, recuperarSenha, definirNovaSenha } from './auth.js';
import { toast, comBotaoOcupado } from './ui.js';

const $ = (s) => document.querySelector(s);
const aviso = $('[data-aviso]');

function mostrar(tela) {
  document.querySelectorAll('[data-tela]').forEach((f) => f.classList.toggle('oculto', f.dataset.tela !== tela));
  $(`[data-tela="${tela}"] input`)?.focus();
}
function avisar(texto, tipo = '') {
  aviso.className = `aviso ${tipo}`;
  aviso.textContent = texto;
}
document.querySelectorAll('[data-ir]').forEach((a) =>
  a.addEventListener('click', (e) => { e.preventDefault(); aviso.className = 'aviso oculto'; mostrar(a.dataset.ir); }));

if (!configurado) {
  avisar('Sistema ainda não configurado: abra o arquivo js/config.js e coloque a URL e a anon key do Supabase (veja o README).');
}

const params = new URLSearchParams(location.search);
if (params.get('motivo') === 'inativo') avisar('Seu acesso está desativado ou ainda não foi liberado. Fale com o administrador.');
if (params.get('motivo') === 'erro') avisar('Não foi possível carregar seu perfil. Verifique se o SQL foi executado no Supabase.');

// Veio de um link de convite ou de recuperação de senha?
const hash = window.__hashInicial || '';
const precisaSenha = /type=(recovery|invite|signup)/.test(hash);
if (/error_description=/.test(hash)) {
  const msg = decodeURIComponent((hash.match(/error_description=([^&]+)/) || [])[1] || '').replace(/\+/g, ' ');
  avisar('O link não é mais válido: ' + msg + '. Peça um novo.');
}

let recuperando = false;
supabase.auth.onAuthStateChange((evento) => {
  if (evento === 'PASSWORD_RECOVERY') { recuperando = true; mostrar('nova-senha'); }
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user?.email) $('[data-email-oculto]').value = session.user.email;
if ((precisaSenha || recuperando) && session) mostrar('nova-senha');
else if (session && !params.get('motivo')) location.replace('app.html');

// Entrar
$('[data-tela="entrar"]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  if (!f.reportValidity()) return;
  await comBotaoOcupado(f.querySelector('button'), async () => {
    try {
      await entrar(f.email.value.trim(), f.senha.value);
      location.replace('app.html');
    } catch (erro) {
      avisar(/invalid/i.test(erro.message) ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar: ' + erro.message);
    }
  }, 'Entrando...');
});

// Recuperar
$('[data-tela="recuperar"]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  if (!f.reportValidity()) return;
  await comBotaoOcupado(f.querySelector('button'), async () => {
    try {
      await recuperarSenha(f.email.value.trim());
      avisar('Se o e-mail estiver cadastrado, você vai receber o link em alguns minutos. Confira também o spam.', 'ok');
      mostrar('entrar');
    } catch (erro) {
      avisar('Não foi possível enviar: ' + erro.message);
    }
  }, 'Enviando...');
});

// Nova senha
$('[data-tela="nova-senha"]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  if (!f.reportValidity()) return;
  if (f.senha.value !== f.senha2.value) return avisar('As senhas não são iguais.');
  await comBotaoOcupado(f.querySelector('button'), async () => {
    try {
      await definirNovaSenha(f.senha.value);
      toast('Senha salva!');
      history.replaceState(null, '', location.pathname);
      location.replace('app.html');
    } catch (erro) {
      avisar('Não foi possível salvar a senha: ' + erro.message);
    }
  }, 'Salvando...');
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
