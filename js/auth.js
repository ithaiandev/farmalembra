// =====================================================================
// Login, sessão e perfil do usuário
// =====================================================================
import { supabase } from './supabase.js';

/** Usuário logado e seu perfil (nome, papel, ativo) */
export const sessao = { user: null, perfil: null };

export const ehAdmin = () => sessao.perfil?.papel === 'admin' && sessao.perfil?.ativo;

export async function entrar(email, senha) {
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
}

export async function sair() {
  await supabase.auth.signOut();
  location.replace('index.html');
}

/** Envia o e-mail de recuperação; o link volta para a tela de login */
export async function recuperarSenha(email) {
  const voltarPara = new URL('index.html', location.href).href;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: voltarPara });
  if (error) throw error;
}

export async function definirNovaSenha(senha) {
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) throw error;
}

/**
 * Usada no app.html: garante que há sessão e que o usuário está ATIVO.
 * Se não, volta para o login.
 */
export async function exigirLogin() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace('index.html');
    return false;
  }
  sessao.user = session.user;

  const { data: perfil, error } = await supabase
    .from('perfis').select('*').eq('id', session.user.id).maybeSingle();

  if (error || !perfil || !perfil.ativo) {
    await supabase.auth.signOut();
    location.replace('index.html?motivo=' + (error ? 'erro' : 'inativo'));
    return false;
  }
  sessao.perfil = perfil;

  // Se a sessão terminar (logout em outra aba, senha trocada...), volta ao login
  supabase.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') location.replace('index.html');
  });
  return true;
}
