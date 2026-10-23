// Importar clientes via CSV (nome, telefone, medicamento, ultima_compra)
import { supabase } from '../supabase.js';
import { toast, mostrarErro, comBotaoOcupado } from '../ui.js';
import {
  esc, lerCSV, lerData, normalizarTelefone, formatarTelefone, formatarData, baixarArquivo, hojeISO,
} from '../utils.js';

const MODELO_CSV = '﻿nome;telefone;medicamento;ultima_compra;duracao_dias;data_nascimento;consentimento\r\n'
  + 'Maria da Silva;(98) 9 9999-0001;Losartana 50mg;15/10/2026;30;10/05/1960;sim\r\n'
  + 'João Souza;98999990002;Metformina 850mg;01/10/2026;30;;nao\r\n';

export async function render(el) {
  el.innerHTML = `
    <a class="voltar" href="#/clientes">← Clientes</a>
    <div class="cabecalho"><h1>📥 Importar clientes (CSV)</h1></div>

    <div class="card">
      <p>Exporte a lista do seu sistema (ou monte no Excel) e salve como <strong>CSV</strong>. Colunas aceitas:</p>
      <ul>
        <li><strong>nome</strong> e <strong>telefone</strong> (obrigatórias)</li>
        <li>medicamento, ultima_compra (dd/mm/aaaa), duracao_dias (padrão 30)</li>
        <li>data_nascimento, consentimento (sim/não)</li>
      </ul>
      <p class="suave pequeno">Telefones repetidos não são duplicados: o medicamento é adicionado ao cliente que já existe.</p>
      <button class="btn btn-sec" data-modelo>⬇ Baixar planilha modelo</button>
      <label class="campo" style="margin-top:14px"><span>Arquivo CSV</span>
        <input type="file" accept=".csv,text/csv" data-arquivo></label>
      <label class="checkbox">
        <input type="checkbox" data-consent-todos>
        <span>Todos os clientes deste arquivo já autorizaram receber mensagens pelo WhatsApp
          <small>Só marque se for verdade (LGPD). Sem autorização, o cliente é importado mas não recebe lembretes.
          A coluna "consentimento" do arquivo, se existir, também vale.</small></span>
      </label>
    </div>
    <div data-previa></div>`;

  el.querySelector('[data-modelo]').addEventListener('click', () => baixarArquivo('modelo-importacao.csv', MODELO_CSV));

  el.querySelector('[data-arquivo]').addEventListener('change', async (e) => {
    const arq = e.target.files[0];
    if (!arq) return;
    let texto = await arq.text();
    // Excel brasileiro às vezes salva em Windows-1252 (acentos viram �)
    if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(await arq.arrayBuffer());
    previa(el, lerCSV(texto));
  });
}

function sim(v) {
  return /^(s|sim|x|1|true|yes)$/i.test(String(v ?? '').trim());
}

function previa(el, linhas) {
  const alvo = el.querySelector('[data-previa]');
  const validas = [];
  const invalidas = [];

  for (const [i, l] of linhas.entries()) {
    const telefone = normalizarTelefone(l.telefone || l.celular || l.whatsapp || l.fone);
    const nome = (l.nome || l.cliente || '').trim();
    const ultima = lerData(l.ultima_compra || l.data_compra || l.data) || (l.medicamento ? hojeISO() : null);
    if (!nome || !telefone) {
      invalidas.push({ linha: i + 2, motivo: !nome ? 'sem nome' : 'telefone inválido', ...l });
      continue;
    }
    validas.push({
      nome, telefone,
      medicamento: (l.medicamento || l.remedio || '').trim(),
      ultima_compra: ultima,
      duracao_dias: Math.min(365, Math.max(1, parseInt(l.duracao_dias || l.dias, 10) || 30)),
      data_nascimento: lerData(l.data_nascimento || l.nascimento),
      consentimento: sim(l.consentimento || l.autorizou),
    });
  }

  alvo.innerHTML = `
    <div class="card">
      <h2>Pré-visualização</h2>
      <p>✅ <strong>${validas.length}</strong> linha(s) válida(s)
        ${invalidas.length ? ` · ⚠️ <strong>${invalidas.length}</strong> com problema (serão ignoradas)` : ''}</p>
      ${invalidas.length ? `<details><summary>Ver linhas com problema</summary><ul>${invalidas.slice(0, 50).map((x) =>
        `<li>Linha ${x.linha}: ${esc(x.motivo)} — ${esc(x.nome || '')} ${esc(x.telefone || '')}</li>`).join('')}</ul></details>` : ''}
      <div class="tabela-wrap"><table>
        <thead><tr><th>Nome</th><th>Telefone</th><th>Medicamento</th><th>Última compra</th><th class="num">Dias</th><th>Autorizou</th></tr></thead>
        <tbody>${validas.slice(0, 30).map((v) => `<tr><td>${esc(v.nome)}</td><td>${esc(formatarTelefone(v.telefone))}</td>
          <td>${esc(v.medicamento || '—')}</td><td>${formatarData(v.ultima_compra)}</td><td class="num">${v.duracao_dias}</td>
          <td>${v.consentimento ? 'sim' : '—'}</td></tr>`).join('')}</tbody>
      </table></div>
      ${validas.length > 30 ? `<p class="suave pequeno">... e mais ${validas.length - 30}.</p>` : ''}
      <button class="btn btn-primario btn-grande" data-importar ${validas.length ? '' : 'disabled'} style="margin-top:12px">
        📥 Importar ${validas.length} linha(s)</button>
      <div data-resultado></div>
    </div>`;

  alvo.querySelector('[data-importar]').addEventListener('click', (e) =>
    comBotaoOcupado(e.currentTarget, () => importar(el, validas), 'Importando...'));
}

async function importar(el, linhas) {
  const consentTodos = el.querySelector('[data-consent-todos]').checked;
  const res = { novos: 0, existentes: 0, meds: 0, medsRepetidos: 0, erros: [] };

  try {
    // 1) Clientes que já existem (pelo telefone)
    const telefones = [...new Set(linhas.map((l) => l.telefone))];
    const idPorTel = new Map();
    for (let i = 0; i < telefones.length; i += 200) {
      const { data, error } = await supabase.from('clientes').select('id, telefone').in('telefone', telefones.slice(i, i + 200));
      if (error) throw error;
      data.forEach((c) => idPorTel.set(c.telefone, c.id));
    }
    res.existentes = idPorTel.size;

    // 2) Cria os clientes novos (um por telefone)
    const novos = [];
    const vistos = new Set(idPorTel.keys());
    for (const l of linhas) {
      if (vistos.has(l.telefone)) continue;
      vistos.add(l.telefone);
      novos.push({
        nome: l.nome, telefone: l.telefone, data_nascimento: l.data_nascimento,
        consentimento_whatsapp: consentTodos || l.consentimento,
      });
    }
    for (let i = 0; i < novos.length; i += 100) {
      const { data, error } = await supabase.from('clientes').insert(novos.slice(i, i + 100)).select('id, telefone');
      if (error) throw error;
      data.forEach((c) => idPorTel.set(c.telefone, c.id));
      res.novos += data.length;
    }

    // 3) Medicamentos (sem repetir o mesmo remédio no mesmo cliente)
    const ids = [...idPorTel.values()];
    const jaTem = new Set();
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase.from('medicamentos_continuos')
        .select('cliente_id, medicamento').in('cliente_id', ids.slice(i, i + 100));
      if (error) throw error;
      data.forEach((m) => jaTem.add(`${m.cliente_id}|${m.medicamento.trim().toUpperCase()}`));
    }
    const meds = [];
    for (const l of linhas) {
      if (!l.medicamento) continue;
      const cid = idPorTel.get(l.telefone);
      const chave = `${cid}|${l.medicamento.toUpperCase()}`;
      if (jaTem.has(chave)) { res.medsRepetidos++; continue; }
      jaTem.add(chave);
      meds.push({ cliente_id: cid, medicamento: l.medicamento, ultima_compra: l.ultima_compra, duracao_dias: l.duracao_dias });
    }
    for (let i = 0; i < meds.length; i += 100) {
      const { error } = await supabase.from('medicamentos_continuos').insert(meds.slice(i, i + 100));
      if (error) throw error;
      res.meds += Math.min(100, meds.length - i);
    }
  } catch (e) {
    mostrarErro(e, 'A importação parou no meio. O que foi importado até aqui ficou salvo.');
    res.erros.push(e.message);
  }

  el.querySelector('[data-resultado]').innerHTML = `
    <div class="aviso ${res.erros.length ? '' : 'ok'}" style="margin-top:12px">
      <span>✅ ${res.novos} cliente(s) novo(s) · ${res.existentes} já existia(m) ·
        ${res.meds} medicamento(s) adicionado(s)${res.medsRepetidos ? ` · ${res.medsRepetidos} medicamento(s) repetido(s) ignorado(s)` : ''}
        ${res.erros.length ? `<br>⚠️ Erro: ${esc(res.erros[0])}` : ''}</span>
    </div>
    <a class="btn btn-sec" href="#/clientes">Ver clientes</a>`;
  if (!res.erros.length) toast('Importação concluída! ✅');
}
