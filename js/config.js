// =====================================================================
// CONFIGURAÇÃO DO SITE — único arquivo que muda de uma farmácia para outra.
//
// SUPABASE_URL e SUPABASE_ANON_KEY ficam em:
//   Supabase > Project Settings > API (ou "Data API" / "API Keys")
//
// ATENÇÃO: use a chave "anon" / "publishable".
// NUNCA coloque aqui a "service_role" / "secret" key!
//
// Nome, telefone, endereço e horário da farmácia NÃO ficam aqui:
// são preenchidos dentro do sistema, em Configurações.
// =====================================================================

export const CONFIG = {
  SUPABASE_URL: 'https://hydqyhahyopiykcvgcvf.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_9qxDnLr0kfKXYspEZmoHLQ_tp6y5T2Q',

  // DDD usado quando o telefone é digitado sem DDD
  DDD_PADRAO: '98',
};

// Nome do sistema (marca do produto — igual para todas as farmácias)
export const SISTEMA = 'FarmaLembra';
