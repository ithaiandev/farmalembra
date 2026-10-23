// =====================================================================
// Dados usados em várias telas (guardados em memória):
// configurações da farmácia e modelos de mensagem
// =====================================================================
import { supabase } from './supabase.js';
import { CONFIG } from './config.js';

let config = null;
let modelos = null;

/** Configurações da farmácia (tabela configuracoes, linha única) */
export async function obterConfig(forcar = false) {
  if (config && !forcar) return config;
  const { data, error } = await supabase.from('configuracoes').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  config = {
    nome_farmacia: CONFIG.NOME_FARMACIA,
    telefone_farmacia: CONFIG.TELEFONE_FARMACIA,
    endereco: CONFIG.CIDADE,
    horario_funcionamento: '',
    logo_url: '',
    dias_antecedencia: 5,
    dias_para_considerar_recompra: 10,
    modo_envio: 'manual',
    ...(data || {}),
  };
  return config;
}

/** Todos os modelos de mensagem */
export async function obterModelos(forcar = false) {
  if (modelos && !forcar) return modelos;
  const { data, error } = await supabase
    .from('modelos_mensagem').select('*').order('tipo').order('padrao', { ascending: false }).order('titulo');
  if (error) throw error;
  modelos = data || [];
  return modelos;
}

/** Texto do modelo padrão de um tipo (ou o primeiro daquele tipo) */
export async function textoModeloPadrao(tipo) {
  const lista = await obterModelos();
  const m = lista.find((x) => x.tipo === tipo && x.padrao) || lista.find((x) => x.tipo === tipo);
  return m?.texto ?? '';
}

export function limparCache() {
  config = null;
  modelos = null;
}
