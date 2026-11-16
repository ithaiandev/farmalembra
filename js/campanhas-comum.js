// =====================================================================
// Campanhas: regras e textos usados na lista, no formulário,
// na página de detalhes e na janela de envio.
// =====================================================================
import { esc, formatarData, hojeISO } from './utils.js';
import { mensagemLivre } from './mensagens.js';

/** Sugestões de categoria (o admin pode digitar qualquer outra) */
export const CATEGORIAS_SUGERIDAS = [
  'Data comemorativa', 'Conscientização em saúde', 'Promoção', 'Evento na loja',
  'Lançamento', 'Aniversário da farmácia', 'Institucional', 'Personalizada',
];

/**
 * Pontos de partida prontos. Só preenchem o formulário — o admin
 * pode mudar tudo e criar campanhas que não estão aqui.
 * Mensagens discretas: sem nome de medicamento, sem diagnóstico.
 */
export const SUGESTOES = [
  {
    titulo: 'Outubro Rosa', categoria: 'Conscientização em saúde', mes: 10,
    mensagem: 'Oi, {nome}! 🎀 Em outubro a {farmacia} apoia o *Outubro Rosa*: cuidar de você é um gesto de amor. '
      + 'Passe aqui e confira nossas novidades em cuidado e bem-estar. {endereco}, {horario}. '
      + 'Para não receber mais mensagens, responda SAIR.',
  },
  {
    titulo: 'Novembro Azul', categoria: 'Conscientização em saúde', mes: 11,
    mensagem: 'Oi, {nome}! 💙 Novembro é mês de lembrar que cuidar da saúde também é coisa de homem. '
      + 'A {farmacia} apoia o *Novembro Azul*! Venha nos visitar: {endereco}, {horario}. '
      + 'Para não receber mais mensagens, responda SAIR.',
  },
  {
    titulo: 'Dia das Mães', categoria: 'Data comemorativa', mes: 5,
    mensagem: 'Oi, {nome}! 💐 O *Dia das Mães* está chegando e a {farmacia} separou opções especiais de presentes, '
      + 'perfumaria e cuidados. Venha conferir: {endereco}, {horario}. Para não receber mais mensagens, responda SAIR.',
  },
  {
    titulo: 'Dia dos Pais', categoria: 'Data comemorativa', mes: 8,
    mensagem: 'Oi, {nome}! 👔 *Dia dos Pais* na {farmacia}: presentes e cuidados para quem cuida da gente. '
      + 'Estamos em {endereco}, {horario}. Para não receber mais mensagens, responda SAIR.',
  },
  {
    titulo: 'Dia das Crianças', categoria: 'Data comemorativa', mes: 10,
    mensagem: 'Oi, {nome}! 🧸 *Dia das Crianças* na {farmacia}: novidades para os pequenos. '
      + 'Venha conferir: {endereco}, {horario}. Para não receber mais mensagens, responda SAIR.',
  },
  {
    titulo: 'Natal', categoria: 'Data comemorativa', mes: 12,
    mensagem: 'Oi, {nome}! 🎄 A equipe da {farmacia} deseja um *Feliz Natal* para você e sua família. '
      + 'Conte sempre com a gente: {endereco}, {horario}. Para não receber mais mensagens, responda SAIR.',
  },
  {
    titulo: 'Ano-Novo', categoria: 'Data comemorativa', mes: 12,
    mensagem: 'Oi, {nome}! ✨ A {farmacia} deseja um *Feliz Ano-Novo*, com muita saúde e alegria. '
      + 'Obrigado pela confiança! Para não receber mais mensagens, responda SAIR.',
  },
  {
    titulo: 'Aniversário da farmácia', categoria: 'Aniversário da farmácia', mes: null,
    mensagem: 'Oi, {nome}! 🎉 A {farmacia} está fazendo aniversário e quem ganha presente é você! '
      + 'Venha comemorar com a gente: {endereco}, {horario}. Para não receber mais mensagens, responda SAIR.',
  },
  {
    titulo: 'Sexta-feira da Fralda', categoria: 'Promoção', mes: null,
    mensagem: 'Oi, {nome}! 👶 Hoje é *Sexta-feira da Fralda* na {farmacia}! Fraldas, lenços e cuidados para o bebê '
      + 'com condições especiais. Venha conferir: {endereco}, {horario}. Para não receber mais mensagens, responda SAIR.',
  },
];

/**
 * Situação que aparece para o usuário (calculada):
 *   arquivada > rascunho > encerrada (status ou data final passou) > agendada > ativa
 */
export function situacao(c, hoje = hojeISO()) {
  if (c.arquivada_em) return 'arquivada';
  if (c.status === 'rascunho') return 'rascunho';
  if (c.status === 'encerrada' || (c.data_fim && c.data_fim < hoje)) return 'encerrada';
  if (c.data_inicio && c.data_inicio > hoje) return 'agendada';
  return 'ativa';
}

const SITUACOES = {
  ativa: ['Ativa', 'verde'],
  agendada: ['Agendada', 'azul'],
  rascunho: ['Rascunho', 'cinza'],
  encerrada: ['Encerrada', 'amarelo'],
  arquivada: ['Arquivada', 'cinza'],
};

export function badgeSituacao(c) {
  const [texto, cor] = SITUACOES[situacao(c)];
  return `<span class="badge badge-${cor}">${texto}</span>`;
}

/** Pode registrar envio? (o banco confere de novo) */
export function podeEnviar(c) {
  const s = situacao(c);
  return s === 'ativa' || s === 'agendada';
}

/** Motivo para não poder enviar (para mostrar ao usuário) */
export function motivoNaoEnviar(c) {
  switch (situacao(c)) {
    case 'rascunho': return 'Esta campanha é um rascunho. O administrador precisa ativá-la para liberar o envio.';
    case 'encerrada': return 'Esta campanha está encerrada. Para enviar de novo, o administrador pode reabri-la ou duplicá-la.';
    case 'arquivada': return 'Esta campanha está arquivada. O administrador pode desarquivá-la.';
    default: return '';
  }
}

export function textoPeriodo(c) {
  if (!c.data_inicio) return 'Sem data';
  if (!c.data_fim) return `A partir de ${formatarData(c.data_inicio)}`;
  if (c.data_fim === c.data_inicio) return formatarData(c.data_inicio);
  return `${formatarData(c.data_inicio)} a ${formatarData(c.data_fim)}`;
}

export function descreverPublico(c) {
  const partes = [];
  if (c.filtro_aniversariantes_mes) partes.push('Aniversariantes do mês');
  if (c.filtro_tags?.length) partes.push(`Grupos: ${c.filtro_tags.join(', ')}`);
  if (c.filtro_cadastro_de || c.filtro_cadastro_ate) {
    partes.push(c.filtro_cadastro_de && c.filtro_cadastro_ate
      ? `Cadastrados de ${formatarData(c.filtro_cadastro_de)} a ${formatarData(c.filtro_cadastro_ate)}`
      : c.filtro_cadastro_de ? `Cadastrados a partir de ${formatarData(c.filtro_cadastro_de)}`
        : `Cadastrados até ${formatarData(c.filtro_cadastro_ate)}`);
  }
  return partes.length ? partes.join(' · ') : 'Todos os clientes que autorizaram campanhas';
}

/** Parâmetros do filtro de público para a função clientes_publico do banco */
export function parametrosPublico(c) {
  return {
    p_tags: c.filtro_tags || [],
    p_aniversariantes: !!c.filtro_aniversariantes_mes,
    p_cadastro_de: c.filtro_cadastro_de || null,
    p_cadastro_ate: c.filtro_cadastro_ate || null,
  };
}

/** Imagens da campanha (lista nova ou a antiga, de uma imagem só) */
export function imagensDe(c) {
  return Array.isArray(c.imagens) && c.imagens.length ? [...c.imagens] : (c.imagem_url ? [c.imagem_url] : []);
}

/**
 * Link da página pública com as fotos da campanha (promo.html).
 * O "v" muda quando a 1ª foto muda: o WhatsApp guarda a prévia de cada link,
 * então um link novo faz ele buscar a foto (capa) atual em vez da antiga.
 */
const VERSAO_PREVIA = 3; // aumente se mudar o formato da capa (força o WhatsApp a ler de novo)

export function linkFotos(campanhaId, primeiraImagem = '') {
  const arquivo = String(primeiraImagem).split('/').pop().replace(/\.\w+$/, '');
  const v = arquivo ? VERSAO_PREVIA + arquivo.replace(/[^0-9a-z]/gi, '').slice(0, 8) : '';
  return new URL(`promo.html?c=${campanhaId || 'codigo-da-campanha'}${v ? `&v=${v}` : ''}`, location.href).href;
}

/** Aviso + link que vai no fim da mensagem (só no modo "por link") */
export function rodapeImagens(c, imagens = imagensDe(c)) {
  if (!imagens.length || c.imagens_por_link === false) return '';
  return `\n\n📸 Confira aqui:\n${linkFotos(c.id, imagens[0])}`;
}

/** Mensagem pronta para um cliente */
export async function mensagemParaCliente(c, cliente) {
  return (await mensagemLivre(c.mensagem, cliente)) + rodapeImagens(c);
}

/** Texto igual para todos (lista de transmissão / copiar), sem o {nome} */
export async function mensagemParaTodos(c) {
  const pronto = await mensagemLivre(String(c.mensagem ?? '').replace(/\{nome\}/g, ''), { nome: '' });
  return pronto
    .replace(/[ \t]*,[ \t]*([!?.])/g, '$1') // "Oi, !" -> "Oi!"
    .replace(/[ \t]+([!?,.])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim() + rodapeImagens(c);
}

/** Miniatura (ou ícone) para listas */
export function htmlMiniatura(c) {
  const img = imagensDe(c)[0];
  return img
    ? `<img class="camp-mini" src="${esc(img)}" alt="" loading="lazy">`
    : '<span class="camp-mini camp-mini-vazia" aria-hidden="true">📣</span>';
}

/** Copia texto para a área de transferência (com plano B para navegadores antigos) */
export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = texto;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand?.('copy');
    t.remove();
    return !!ok;
  }
}
