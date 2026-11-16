// =====================================================================
// "Enviar pelo WhatsApp" — envio MANUAL de campanha (sem API)
//
//  1. Selecionar clientes (só quem autorizou campanhas)
//  2. Ver a mensagem e copiar o texto
//  3. Abrir o WhatsApp de cada cliente com a mensagem pronta
//     (ou usar a lista de transmissão do WhatsApp Business)
//
//  O sistema registra a data, a campanha, os clientes selecionados e
//  quando o WhatsApp foi aberto para cada um. Ele NÃO afirma que a
//  mensagem foi enviada ou entregue — isso só o WhatsApp sabe.
// =====================================================================
import { supabase } from './supabase.js';
import { abrirModal, confirmar, toast, mostrarErro, htmlCarregando, htmlVazio, comBotaoOcupado } from './ui.js';
import { esc, debounce, formatarTelefone, hojeISO, baixarArquivo, gerarVCard } from './utils.js';
import { abrirFila } from './fila.js';
import {
  parametrosPublico, mensagemParaCliente, mensagemParaTodos, copiarTexto, rodapeImagens, imagensDe,
} from './campanhas-comum.js';

const CAMPOS = 'id, nome, telefone';
const LIMITE_TRANSMISSAO = 256; // máximo de contatos por lista de transmissão no WhatsApp

async function carregarPublico(camp) {
  const { data, error } = await supabase.rpc('clientes_publico', parametrosPublico(camp)).select(CAMPOS);
  if (error) throw error;
  return data || [];
}

/** Clientes que já têm envio registrado nesta campanha */
async function carregarJaRegistrados(campanhaId) {
  const ids = new Set();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('campanha_envios').select('cliente_id')
      .eq('campanha_id', campanhaId).eq('status', 'enviado').range(de, de + 999);
    if (error) throw error;
    data.forEach((r) => ids.add(r.cliente_id));
    if (data.length < 1000) break;
  }
  return ids;
}

/** Cria o registro do envio e a lista de clientes selecionados */
async function criarRegistro(camp, canal, clientes) {
  const { data: disparo, error } = await supabase.from('campanha_disparos').insert({
    campanha_id: camp.id,
    canal,
    mensagem: String(camp.mensagem) + rodapeImagens(camp),
    total_selecionados: clientes.length,
  }).select('id').single();
  if (error) throw error;

  for (let i = 0; i < clientes.length; i += 500) {
    const { error: e2 } = await supabase.from('campanha_disparo_clientes').insert(
      clientes.slice(i, i + 500).map((c) => ({ disparo_id: disparo.id, cliente_id: c.id })),
    );
    if (e2) throw e2;
  }
  return disparo.id;
}

/**
 * Abre a janela de envio. Resolve quando termina (true = algo foi registrado).
 */
export async function abrirEnvioCampanha(camp) {
  const escolha = await abrirModal({
    titulo: `Enviar pelo WhatsApp — ${camp.titulo}`,
    largura: 'modal-largo',
    html: `<div data-envio>${htmlCarregando('Carregando clientes...')}</div>`,
    aoAbrir: (dlg, fechar) => montarJanela(dlg.querySelector('[data-envio]'), camp, fechar),
  });
  if (!escolha) return false;

  // ---- Um por um: abre o WhatsApp de cada cliente --------------------------
  if (escolha.acao === 'individual') {
    let disparoId;
    try {
      disparoId = await criarRegistro(camp, 'individual', escolha.lista);
    } catch (erro) {
      mostrarErro(erro, 'Não foi possível registrar o envio.');
      return false;
    }
    await abrirFila({
      titulo: camp.titulo,
      itens: escolha.lista,
      rotuloFeitos: 'WhatsApp abertos',
      montar: async (c) => ({ nome: c.nome, telefone: c.telefone, mensagem: await mensagemParaCliente(camp, c) }),
      aoEnviar: async (c) => {
        const { error } = await supabase.from('campanha_disparo_clientes')
          .update({ whatsapp_aberto_em: new Date().toISOString() })
          .eq('disparo_id', disparoId).eq('cliente_id', c.id);
        if (error) throw error;
      },
    });
    toast('Registro salvo. Confira no WhatsApp se todas as mensagens foram enviadas.', 'ok', 5000);
    return true;
  }

  return escolha.acao === 'transmissao';
}

function montarJanela(area, camp, fechar) {
  const temImagensManuais = imagensDe(camp).length && camp.imagens_por_link === false;

  Promise.all([carregarPublico(camp), carregarJaRegistrados(camp.id), mensagemParaTodos(camp)])
    .then(([publico, jaRegistrados, textoTodos]) => desenhar(publico, jaRegistrados, textoTodos))
    .catch((erro) => {
      mostrarErro(erro, 'Não foi possível carregar os clientes.');
      area.innerHTML = htmlVazio('Não foi possível carregar os clientes. Tente de novo.', '⚠️');
    });

  function desenhar(publico, jaRegistrados, textoTodos) {
    let extras = [];
    // Quem já tem envio registrado começa desmarcado (evita mandar duas vezes)
    const marcados = new Set(publico.filter((c) => !jaRegistrados.has(c.id)).map((c) => c.id));

    area.innerHTML = `
      <div class="aviso info">ℹ️ <span><strong>Envio manual.</strong> O sistema abre o WhatsApp com a mensagem pronta e você
        toca em enviar. Fica registrado quem foi selecionado e quando o WhatsApp foi aberto — o sistema
        <strong>não consegue confirmar</strong> se a mensagem foi enviada ou entregue.</span></div>

      <div class="passo"><b>1</b> Selecione os clientes</div>
      <div class="aviso ok" data-contagem></div>
      <div class="barra-filtros">
        <label class="busca"><input type="search" data-busca placeholder="Procurar na lista" aria-label="Procurar cliente na lista"></label>
        <button type="button" class="btn btn-sec btn-pequeno" data-marcar>✓ Marcar todos</button>
        <button type="button" class="btn btn-sec btn-pequeno" data-desmarcar>Desmarcar todos</button>
        ${jaRegistrados.size ? '<button type="button" class="btn btn-sec btn-pequeno" data-sem-repetidos>Desmarcar quem já recebeu</button>' : ''}
      </div>
      <ul class="lista lista-contatos" data-contatos></ul>
      <details class="adicionar-contato">
        <summary class="btn btn-link" style="padding-left:0">➕ Adicionar cliente que não está no público</summary>
        <label class="busca" style="display:block;margin-top:8px"><input type="search" data-busca-add
          placeholder="Nome ou telefone" aria-label="Procurar cliente para adicionar"></label>
        <ul class="lista" data-resultados-add></ul>
      </details>
      <p class="suave pequeno" style="margin:8px 0 0">🔒 Só aparecem clientes ativos que autorizaram receber campanhas e não pediram para sair.</p>

      <hr class="separador">
      <div class="passo"><b>2</b> Confira a mensagem</div>
      <div class="previa-whats"><div class="balao" data-previa></div></div>
      <div class="item-acoes" style="margin-top:10px">
        <button type="button" class="btn btn-sec" data-copiar>📋 Copiar texto</button>
      </div>
      ${temImagensManuais ? '<p class="suave pequeno" style="margin-top:6px">🖼️ Esta campanha usa imagens anexadas à mão: baixe-as na página da campanha e anexe no WhatsApp (📎).</p>' : ''}

      <hr class="separador">
      <div class="passo"><b>3</b> Envie</div>
      <button type="button" class="btn btn-whats btn-grande btn-bloco" data-individual>💬 Abrir WhatsApp um por um</button>
      <p class="suave pequeno" style="margin-top:6px">Abre a conversa de cada cliente com a mensagem e o nome dele. Pode parar e continuar depois.</p>

      <details class="transmissao">
        <summary>📢 Prefiro usar a lista de transmissão do WhatsApp Business</summary>
        <ol class="passos">
          <li><button type="button" class="btn btn-sec btn-pequeno" data-vcf>⬇ Baixar contatos selecionados</button>
            <small>No celular da farmácia, abra o arquivo para salvar os contatos (aparecem com “(cliente)” no nome).</small></li>
          <li>No WhatsApp Business: <strong>⋮ → Nova transmissão</strong>, marque os contatos.
            <small>Até ${LIMITE_TRANSMISSAO} contatos por lista. Só recebe quem tem o número da farmácia salvo.</small></li>
          <li><button type="button" class="btn btn-sec btn-pequeno" data-copiar>📋 Copiar texto</button>
            <small>Cole na lista de transmissão (vai sem o nome do cliente).</small></li>
          <li><button type="button" class="btn btn-primario btn-pequeno" data-transmissao>Registrar envio pela lista</button>
            <small>Guarda no histórico quem foi selecionado e quando.</small></li>
        </ol>
      </details>`;

    const $ = (s) => area.querySelector(s);
    const listaEl = $('[data-contatos]');
    const buscaEl = $('[data-busca]');

    const todos = () => {
      const ids = new Set(publico.map((c) => c.id));
      return [...publico, ...extras.filter((c) => !ids.has(c.id))].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    };
    const selecionados = () => todos().filter((c) => marcados.has(c.id));
    const visiveis = () => {
      const termo = buscaEl.value.trim().toLowerCase();
      const dig = termo.replace(/\D/g, '');
      return todos().filter((c) => !termo || c.nome.toLowerCase().includes(termo) || (dig.length >= 3 && c.telefone.includes(dig)));
    };

    const atualizarContagem = () => {
      const sel = selecionados();
      const repetidos = sel.filter((c) => jaRegistrados.has(c.id)).length;
      $('[data-contagem]').innerHTML = `👥 <strong>${sel.length}</strong> de ${todos().length} cliente(s) selecionado(s)`
        + (repetidos ? ` · ${repetidos} já tem envio registrado nesta campanha` : '')
        + (sel.length > LIMITE_TRANSMISSAO ? `<br>⚠️ Mais de ${LIMITE_TRANSMISSAO}: na lista de transmissão, divida em mais de uma.` : '');
      $('[data-individual]').textContent = `💬 Abrir WhatsApp um por um (${sel.length})`;
      $('[data-individual]').disabled = !sel.length;
      $('[data-transmissao]').disabled = !sel.length;
    };

    const desenharLista = () => {
      const lista = visiveis();
      listaEl.innerHTML = lista.length ? lista.map((c) => `
        <li class="item contato">
          <label class="contato-label">
            <input type="checkbox" data-id="${c.id}" ${marcados.has(c.id) ? 'checked' : ''}>
            <span class="item-principal">
              <span class="item-titulo">${esc(c.nome)}</span>
              <span class="item-sub">${esc(formatarTelefone(c.telefone))}
                ${extras.some((x) => x.id === c.id) ? ' <span class="badge badge-azul">adicionado</span>' : ''}
                ${jaRegistrados.has(c.id) ? ' <span class="badge badge-cinza">já recebeu</span>' : ''}</span>
            </span>
          </label>
        </li>`).join('')
        : `<li>${htmlVazio(buscaEl.value ? 'Ninguém encontrado com essa busca.' : 'Nenhum cliente neste público.', '👥')}</li>`;
      atualizarContagem();
    };

    listaEl.addEventListener('change', (e) => {
      const id = e.target.dataset?.id;
      if (!id) return;
      if (e.target.checked) marcados.add(id); else marcados.delete(id);
      atualizarContagem();
    });
    buscaEl.addEventListener('input', debounce(desenharLista, 200));
    $('[data-marcar]').addEventListener('click', () => { visiveis().forEach((c) => marcados.add(c.id)); desenharLista(); });
    $('[data-desmarcar]').addEventListener('click', () => { visiveis().forEach((c) => marcados.delete(c.id)); desenharLista(); });
    $('[data-sem-repetidos]')?.addEventListener('click', () => { jaRegistrados.forEach((id) => marcados.delete(id)); desenharLista(); });

    // Adicionar cliente de fora do público (só quem autorizou campanhas)
    const resultadosAdd = $('[data-resultados-add]');
    $('[data-busca-add]').addEventListener('input', debounce(async (e) => {
      const termo = e.target.value.replace(/[%_,()*\\]/g, ' ').trim();
      if (termo.length < 2) { resultadosAdd.innerHTML = ''; return; }
      const dig = termo.replace(/\D/g, '');
      let q = supabase.from('clientes').select(CAMPOS)
        .eq('ativo', true).eq('consentimento_publicidade', true).eq('opt_out', false)
        .order('nome').limit(10);
      q = dig.length >= 3 ? q.like('telefone', `%${dig}%`) : q.ilike('nome', `%${termo}%`);
      const { data, error } = await q;
      if (error) return mostrarErro(error);
      const ja = new Set(todos().map((c) => c.id));
      const novos = (data || []).filter((c) => !ja.has(c.id) || !marcados.has(c.id));
      resultadosAdd.innerHTML = novos.length ? novos.map((c) => `
        <li class="item"><div class="item-principal"><div class="item-titulo">${esc(c.nome)}</div>
          <div class="item-sub">${esc(formatarTelefone(c.telefone))}</div></div>
          <button type="button" class="btn btn-primario btn-pequeno" data-add="${c.id}">＋ Adicionar</button></li>`).join('')
        : '<li class="suave pequeno" style="padding:8px 0">Nenhum cliente encontrado (ou já está selecionado). Quem não autorizou campanhas não aparece.</li>';
      resultadosAdd.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
        const c = novos.find((x) => x.id === b.dataset.add);
        if (!publico.some((x) => x.id === c.id) && !extras.some((x) => x.id === c.id)) extras.push(c);
        marcados.add(c.id);
        b.closest('li').remove();
        desenharLista();
        toast(`${c.nome} adicionado(a).`);
      }));
    }, 300));

    // Prévia: com o nome do 1º selecionado (ou um exemplo)
    const atualizarPrevia = async () => {
      const exemplo = selecionados()[0] || { nome: 'Maria Silva' };
      $('[data-previa]').textContent = await mensagemParaCliente(camp, exemplo);
    };

    area.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
      toast(await copiarTexto(textoTodos)
        ? 'Texto copiado (sem o nome do cliente). Cole no WhatsApp.'
        : 'Não consegui copiar. Selecione o texto da prévia e copie.', 'ok');
    }));

    $('[data-vcf]').addEventListener('click', () => {
      const sel = selecionados();
      if (!sel.length) return toast('Nenhum cliente selecionado.', 'erro');
      baixarArquivo(`contatos-campanha-${hojeISO()}.vcf`, gerarVCard(sel), 'text/vcard;charset=utf-8');
      toast(`${sel.length} contato(s) baixado(s).`);
    });

    $('[data-individual]').addEventListener('click', async () => {
      const sel = selecionados();
      if (!sel.length) return toast('Selecione pelo menos um cliente.', 'erro');
      const ok = await confirmar({
        titulo: 'Abrir WhatsApp um por um',
        mensagem: `Vamos abrir o WhatsApp de ${sel.length} cliente(s), um de cada vez, com a mensagem pronta. `
          + 'Você toca em enviar em cada conversa. Pode parar quando quiser.',
        botao: 'Começar',
      });
      if (ok) fechar({ acao: 'individual', lista: sel });
    });

    $('[data-transmissao]').addEventListener('click', async (e) => {
      const botao = e.currentTarget;
      const sel = selecionados();
      if (!sel.length) return toast('Selecione pelo menos um cliente.', 'erro');
      const ok = await confirmar({
        titulo: 'Registrar envio pela lista',
        mensagem: `Registrar que a campanha foi enviada pela lista de transmissão para ${sel.length} cliente(s) selecionado(s)? `
          + 'Fica no histórico com a data de hoje e o seu nome.',
        botao: 'Registrar',
      });
      if (!ok) return;
      await comBotaoOcupado(botao, async () => {
        try {
          await criarRegistro(camp, 'transmissao', sel);
          toast('Envio pela lista registrado. ✅');
          fechar({ acao: 'transmissao' });
        } catch (erro) {
          mostrarErro(erro, 'Não foi possível registrar o envio.');
        }
      }, 'Registrando...');
    });

    desenharLista();
    atualizarPrevia();
    listaEl.addEventListener('change', debounce(atualizarPrevia, 300));
  }
}
