// =====================================================================
// Montagem das mensagens de WhatsApp a partir dos modelos
// =====================================================================
import { obterConfig, textoModeloPadrao } from './store.js';
import { formatarData, preencherTemplate, primeiroNome } from './utils.js';

/** Variáveis comuns a todas as mensagens */
export async function variaveisBase(nomeCliente = '') {
  const cfg = await obterConfig();
  return {
    nome: primeiroNome(nomeCliente),
    farmacia: cfg.nome_farmacia,
    telefone_farmacia: cfg.telefone_farmacia,
    endereco: cfg.endereco,
    horario: cfg.horario_funcionamento,
  };
}

/** Mensagem de lembrete. item precisa de cliente_nome/nome, medicamento e proximo_fim */
export async function mensagemLembrete(item, texto = null) {
  const modelo = texto ?? await textoModeloPadrao('lembrete');
  const vars = await variaveisBase(item.cliente_nome ?? item.nome);
  return preencherTemplate(modelo, {
    ...vars,
    medicamento: item.medicamento ?? '',
    data_fim: formatarData(item.proximo_fim),
  });
}

/** Mensagem de um tipo (aniversario, boas_vindas) para um cliente */
export async function mensagemPorTipo(tipo, cliente) {
  const modelo = await textoModeloPadrao(tipo);
  return preencherTemplate(modelo, await variaveisBase(cliente.nome));
}

/** Mensagem livre (campanha) para um cliente */
export async function mensagemLivre(texto, cliente, extra = {}) {
  return preencherTemplate(texto, { ...(await variaveisBase(cliente?.nome ?? '')), ...extra });
}

/** Exemplo para pré-visualização */
export async function previaMensagem(texto) {
  const vars = await variaveisBase('Maria Silva');
  return preencherTemplate(texto, {
    ...vars,
    medicamento: 'Losartana 50mg',
    data_fim: formatarData(new Date(Date.now() + 5 * 86400000).toISOString()),
  });
}
