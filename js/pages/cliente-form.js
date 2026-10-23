// Cadastro e edição de cliente
import { supabase } from '../supabase.js';
import { ir } from '../router.js';
import { toast, mostrarErro, confirmar, comBotaoOcupado, htmlVazio } from '../ui.js';
import {
  esc, lerFormulario, normalizarTelefone, formatarTelefone, aplicarMascaraTelefone,
  aplicarMascaraCPF, TAGS_PADRAO,
} from '../utils.js';

/** Procura cliente pelo telefone (já normalizado) */
export async function buscarPorTelefone(telefone) {
  const { data } = await supabase.from('clientes').select('id, nome, telefone').eq('telefone', telefone).maybeSingle();
  return data;
}

/** Avisa que o telefone já existe e oferece abrir o cliente */
export async function avisarDuplicado(existente) {
  const abrir = await confirmar({
    titulo: 'Telefone já cadastrado',
    mensagem: `O telefone ${formatarTelefone(existente.telefone)} já pertence a ${existente.nome}. Deseja abrir a ficha desse cliente?`,
    botao: 'Abrir ficha',
  });
  if (abrir) ir(`/clientes/${existente.id}`);
}

export async function render(el, { params }) {
  const editando = Boolean(params.id);
  let c = { tags: [], consentimento_whatsapp: false };

  if (editando) {
    const { data, error } = await supabase.from('clientes').select('*').eq('id', params.id).maybeSingle();
    if (error || !data) {
      el.innerHTML = htmlVazio('Cliente não encontrado.', '🔎');
      return;
    }
    c = data;
  }

  const tagsExtras = (c.tags || []).filter((t) => !TAGS_PADRAO.includes(t));

  el.innerHTML = `
    <a class="voltar" href="${editando ? `#/clientes/${c.id}` : '#/clientes'}">← Voltar</a>
    <div class="cabecalho"><h1>${editando ? 'Editar cliente' : 'Novo cliente'}</h1></div>

    <form class="card" data-form novalidate>
      <label class="campo"><span>Nome completo *</span>
        <input name="nome" required autocomplete="off" autocapitalize="words" value="${esc(c.nome)}"></label>

      <label class="campo"><span>WhatsApp *</span>
        <input name="telefone" required value="${esc(formatarTelefone(c.telefone))}" placeholder="(98) 9 9999-9999">
        <small>DDD 98 já preenchido. Para outro DDD, apague e digite.</small></label>

      <label class="checkbox destaque">
        <input type="checkbox" name="consentimento_whatsapp" ${c.consentimento_whatsapp ? 'checked' : ''}>
        <span>Cliente autorizou receber mensagens pelo WhatsApp (LGPD)
          <small>Obrigatório para enviar lembretes e campanhas. Pergunte ao cliente antes de marcar.
          ${c.consentimento_em ? `Autorizado em ${new Date(c.consentimento_em).toLocaleDateString('pt-BR')}.` : ''}</small></span>
      </label>
      ${c.opt_out ? '<div class="aviso">🚫 Este cliente pediu para NÃO receber mensagens. Para voltar a enviar, use o botão na ficha do cliente.</div>' : ''}

      <div class="campo"><span>Tags</span>
        <div class="chips" data-tags>
          ${[...TAGS_PADRAO, ...tagsExtras].map((t) => `
            <button type="button" class="chip" data-tag="${esc(t)}" aria-pressed="${(c.tags || []).includes(t)}">${esc(t)}</button>`).join('')}
          <button type="button" class="chip" data-nova-tag>+ outra</button>
        </div>
      </div>

      <details ${editando ? 'open' : ''}>
        <summary class="btn btn-link" style="padding-left:0">Mais dados (opcional)</summary>
        <div class="grade-2">
          <label class="campo"><span>Data de nascimento</span>
            <input type="date" name="data_nascimento" value="${esc(c.data_nascimento)}"></label>
          <label class="campo"><span>CPF</span>
            <input name="cpf" value="${esc(c.cpf)}" placeholder="000.000.000-00"></label>
        </div>
        <label class="campo"><span>Endereço</span><input name="endereco" value="${esc(c.endereco)}"></label>
        <label class="campo"><span>Bairro</span><input name="bairro" value="${esc(c.bairro)}"></label>
        <label class="campo"><span>Observações</span><textarea name="observacoes" rows="3">${esc(c.observacoes)}</textarea></label>
      </details>

      <div class="acoes-modal">
        ${editando ? '' : '<button type="submit" class="btn btn-sec btn-grande" data-acao="ficha">Salvar</button>'}
        <button type="submit" class="btn btn-primario btn-grande" data-acao="${editando ? 'ficha' : 'medicamento'}">
          ${editando ? 'Salvar alterações' : 'Salvar e adicionar medicamento'}</button>
      </div>
    </form>`;

  const form = el.querySelector('[data-form]');
  const tel = form.querySelector('[name=telefone]');
  aplicarMascaraTelefone(tel);
  aplicarMascaraCPF(form.querySelector('[name=cpf]'));
  if (!editando) form.querySelector('[name=nome]').focus();

  // Tags
  const tagsBox = el.querySelector('[data-tags]');
  tagsBox.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (chip) chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') !== 'true');
  });
  el.querySelector('[data-nova-tag]').addEventListener('click', (e) => {
    const nome = (prompt('Nome da nova tag (ex.: "cardíaco"):') || '').trim().toLowerCase();
    if (!nome) return;
    if (tagsBox.querySelector(`[data-tag="${CSS.escape(nome)}"]`)) return;
    e.currentTarget.insertAdjacentHTML('beforebegin',
      `<button type="button" class="chip" data-tag="${esc(nome)}" aria-pressed="true">${esc(nome)}</button>`);
  });

  // Telefone repetido: avisa assim que sai do campo
  tel.addEventListener('blur', async () => {
    const n = normalizarTelefone(tel.value);
    if (!n || n === c.telefone) return;
    const existente = await buscarPorTelefone(n);
    if (existente) avisarDuplicado(existente);
  });

  let acao = 'ficha';
  form.querySelectorAll('[type=submit]').forEach((b) => b.addEventListener('click', () => { acao = b.dataset.acao; }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = lerFormulario(form);
    const telefone = normalizarTelefone(d.telefone);
    if (!d.nome) return toast('Informe o nome do cliente.', 'erro');
    if (!telefone) return toast('Telefone inválido. Use o formato (98) 9 9999-9999.', 'erro');

    const dados = {
      nome: d.nome,
      telefone,
      consentimento_whatsapp: form.consentimento_whatsapp.checked,
      tags: [...tagsBox.querySelectorAll('[data-tag][aria-pressed="true"]')].map((b) => b.dataset.tag),
      data_nascimento: d.data_nascimento || null,
      cpf: d.cpf || null,
      endereco: d.endereco || null,
      bairro: d.bairro || null,
      observacoes: d.observacoes || null,
    };

    const botao = e.submitter || form.querySelector('[type=submit]');
    await comBotaoOcupado(botao, async () => {
      const consulta = editando
        ? supabase.from('clientes').update(dados).eq('id', c.id)
        : supabase.from('clientes').insert(dados);
      const { data, error } = await consulta.select('id').single();

      if (error?.code === '23505') {
        const existente = await buscarPorTelefone(telefone);
        if (existente) return avisarDuplicado(existente);
      }
      if (error) return mostrarErro(error);

      toast(editando ? 'Cliente atualizado.' : 'Cliente cadastrado! ✅');
      if (editando) return ir(`/clientes/${data.id}`);
      const extras = [];
      if (acao === 'medicamento') extras.push('novoMed=1');
      if (dados.consentimento_whatsapp) extras.push('boasVindas=1');
      ir(`/clientes/${data.id}${extras.length ? '?' + extras.join('&') : ''}`);
    }, 'Salvando...');
  });
}
