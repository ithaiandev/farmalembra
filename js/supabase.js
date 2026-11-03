// Cliente do Supabase (um só para o site todo).
// Versão FIXA da biblioteca: assim uma versão nova (ou adulterada) não entra
// no site sem você saber. Para atualizar, troque o número e teste.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { CONFIG } from './config.js';

export const configurado =
  CONFIG.SUPABASE_URL.startsWith('https://') &&
  !CONFIG.SUPABASE_URL.includes('SEU-PROJETO') &&
  !CONFIG.SUPABASE_ANON_KEY.includes('COLE-AQUI');

export const supabase = createClient(
  configurado ? CONFIG.SUPABASE_URL : 'https://exemplo.supabase.co',
  configurado ? CONFIG.SUPABASE_ANON_KEY : 'chave-nao-configurada',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
