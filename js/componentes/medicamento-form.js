// =====================================================================
// Formulário de medicamento contínuo (modal) + registro de recompra
// =====================================================================
import { supabase } from '../supabase.js';
import { obterConfig } from '../store.js';
import { abrirModal, toast, mostrarErro, comBotaoOcupado } from '../ui.js';
import { esc, hojeISO, somarDias, formatarData, lerFormulario } from '../utils.js';

let sugestoes = null;

/** Nomes de medicamentos já cadastrados (para autocompletar) */
async function carregarSugestoes() {
  if (sugestoes) return sugestoes;
  const { data } = await supabase.from('medicamentos_continuos').select('medicamento').limit(1000);
  const vistos = new Map();
  (data || []).forEach(({ medicamento }) => {
    const k = medicamento.trim().toUpperCase();
    if (!vistos.has(k)) vistos.set(k, medicamento.trim());
  });
  sugestoes = [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return sugestoes;
}

/** HTML dos campos (usado no modal e no fluxo de balcão) */
export function htmlCamposMedicamento(med = {}) {
  return `
    <label class="campo">
      <span>Medicamento *</span>
      <input name="medicamento" required list="lista-sugestoes-med" autocomplete="off"
             placeholder="Ex.: Losartana" value="${esc(med.medicamento)}">
      <datalist id="lista-sugestoes-med"></datalist>
    </label>
    <label class="campo">
      <span>Apresentação / dosagem</span>
      <input name="apresentacao" placeholder="Ex.: 50mg, 30 comprimidos" value="${esc(med.apresentacao)}">
    </label>

    <details class="ajudante" ${med.id ? '' : 'open'}>
      <summary>🧮 Calcular quantos dias dura</summary>
      <div class="linha-ajudante">
        <label class="campo"><span>Comprimidos na caixa</span>
          <input type="number" min="1" inputmode="numeric" data-cp-caixa placeholder="30"></label>
        <span class="op">÷</span>
        <label class="campo"><span>Por dia</span>
          <input type="number" min="0.25" step="0.25" inputmode="decimal" data-cp-dia placeholder="1"></label>
        <span class="op">=</span>
        <strong data-cp-resultado>— dias</strong>
      </div>
    </details>

    <div class="grade-2">
      <label class="campo">
        <span>Uma caixa dura (dias) *</span>
        <input type="number" name="duracao_dias" min="1" max="365" required inputmode="numeric"
               value="${esc(med.duracao_dias ?? 30)}">
      </label>
      <label class="campo">
        <span>Caixas compradas *</span>
        <input type="number" name="quantidade_caixas" min="1" max="50" required inputmode="numeric"
               value="${esc(med.quantidade_caixas ?? 1)}">
      </label>
    </div>
    <label class="campo">
      <span>Data da compra *</span>
      <input type="date" name="ultima_compra" required value="${esc(med.ultima_compra ?? hojeISO())}" max="${hojeISO()}">
    </label>
    <p class="previa-datas" data-previa></p>
    <label class="campo">
      <span>Observações</span>
      <input name="observacoes" placeholder="Opcional" value="${esc(med.observacoes)}">
    </label>`;
}

/** Liga o ajudante, a prévia de datas e o autocompletar dentro de um elemento */
export async function ligarCamposMedicamento(raiz) {
  const cfg = await obterConfig();
  const $ = (s) => raiz.querySelector(s);
  const duracao = $('[name=duracao_dias]');
  const caixas = $('[name=quantidade_caixas]');
  const data = $('[name=ultima_compra]');
  const previa = $('[data-previa]');

  const atualizarPrevia = () => {
    const d = Number(duracao.value), q = Number(caixas.value);
    if (!data.value || !d || !q) { previa.textContent = ''; return; }
    const fim = somarDias(data.value, d * q);
    const lembrete = somarDias(fim, -cfg.dias_antecedencia);
    previa.innerHTML = `📅 Vai acabar em <strong>${formatarData(fim)}</strong> ·
      lembrete em <strong>${formatarData(lembrete)}</strong> (${cfg.dias_antecedencia} dias antes)`;
  };

  const calcular = () => {
    const porCaixa = Number($('[data-cp-caixa]').value);
    const porDia = Number($('[data-cp-dia]').value);
    const res = $('[data-cp-resultado]');
    if (porCaixa > 0 && porDia > 0) {
      const dias = Math.max(1, Math.floor(porCaixa / porDia));
      res.textContent = `${dias} dias`;
      duracao.value = dias;
      atualizarPrevia();
    } else {
      res.textContent = '— dias';
    }
  };
  $('[data-cp-caixa]').addEventListener('input', calcular);
  $('[data-cp-dia]').addEventListener('input', calcular);
  [duracao, caixas, data].forEach((el) => el.addEventListener('input', atualizarPrevia));
  atualizarPrevia();

  carregarSugestoes().then((lista) => {
    $('#lista-sugestoes-med').innerHTML = lista.map((n) => `<option value="${esc(n)}">`).join('');
  }).catch(() => {});
}

/** Converte os dados do formulário para o formato da tabela */
export function dadosMedicamento(form) {
  const d = lerFormulario(form);
  return {
    medicamento: d.medicamento,
    apresentacao: d.apresentacao || null,
    duracao_dias: Number(d.duracao_dias) || 30,
    quantidade_caixas: Number(d.quantidade_caixas) || 1,
    ultima_compra: d.ultima_compra || hojeISO(),
    observacoes: d.observacoes || null,
  };
}

/** Modal para adicionar/editar. Resolve com o medicamento salvo (ou undefined) */
export function abrirFormMedicamento({ clienteId, medicamento = null }) {
  const editando = Boolean(medicamento?.id);
  return abrirModal({
    titulo: editando ? 'Editar medicamento' : 'Adicionar medicamento',
    html: `
      <form data-form novalidate>
        ${htmlCamposMedicamento(medicamento || {})}
        <div class="acoes-modal">
          <button type="button" class="btn btn-sec" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Salvar</button>
        </div>
      </form>`,
    aoAbrir(dlg, fechar) {
      const form = dlg.querySelector('[data-form]');
      ligarCamposMedicamento(form);
      form.querySelector('[name=medicamento]').focus();
      dlg.querySelector('[data-cancelar]').addEventListener('click', () => fechar());

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        const dados = dadosMedicamento(form);
        await comBotaoOcupado(form.querySelector('[type=submit]'), async () => {
          const consulta = editando
            ? supabase.from('medicamentos_continuos').update(dados).eq('id', medicamento.id)
            : supabase.from('medicamentos_continuos').insert({ ...dados, cliente_id: clienteId });
          const { data, error } = await consulta.select().single();
          if (error) return mostrarErro(error);
          sugestoes = null;
          toast(editando ? 'Medicamento atualizado.' : 'Medicamento adicionado.');
          fechar(data);
        }, 'Salvando...');
      });
    },
  });
}

/** Registra uma recompra (data de hoje). O banco atualiza o ciclo e os lembretes. */
export async function registrarRecompra(medicamentoId, quantidade = 1, data = hojeISO()) {
  const { error } = await supabase.from('compras').insert({
    medicamento_continuo_id: medicamentoId,
    quantidade_caixas: Number(quantidade) || 1,
    data_compra: data,
  });
  if (error) throw error;
}

/** Pergunta a quantidade de caixas e registra a recompra. Resolve true se salvou. */
export function abrirRecompra(med) {
  return abrirModal({
    titulo: 'Registrar recompra',
    html: `
      <form data-form>
        <p><strong>${esc(med.medicamento)}</strong> ${med.apresentacao ? `· ${esc(med.apresentacao)}` : ''}</p>
        <div class="grade-2">
          <label class="campo"><span>Caixas</span>
            <input type="number" name="qtd" min="1" max="50" value="${esc(med.quantidade_caixas ?? 1)}" inputmode="numeric" required></label>
          <label class="campo"><span>Data</span>
            <input type="date" name="data" value="${hojeISO()}" max="${hojeISO()}" required></label>
        </div>
        <div class="acoes-modal">
          <button type="button" class="btn btn-sec" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-verde btn-grande">✓ Registrar</button>
        </div>
      </form>`,
    aoAbrir(dlg, fechar) {
      const form = dlg.querySelector('[data-form]');
      dlg.querySelector('[data-cancelar]').addEventListener('click', () => fechar(false));
      form.querySelector('[type=submit]').focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const { qtd, data } = lerFormulario(form);
        await comBotaoOcupado(form.querySelector('[type=submit]'), async () => {
          try {
            await registrarRecompra(med.id ?? med.medicamento_id, qtd, data);
            toast('Recompra registrada! Novo ciclo iniciado. ✅');
            fechar(true);
          } catch (erro) {
            mostrarErro(erro);
          }
        }, 'Salvando...');
      });
    },
  }).then((v) => v === true);
}
