// Relatórios: lembretes x recompras, top clientes, top medicamentos, sumidos + CSV
import { supabase } from '../supabase.js';
import { ehAdmin } from '../auth.js';
import { mostrarErro, htmlVazio } from '../ui.js';
import { esc, formatarData, formatarTelefone, gerarCSV, baixarArquivo, linkWhatsApp, hojeISO, NOMES_MESES } from '../utils.js';

const nomeMes = (iso) => {
  const [a, m] = iso.split('-');
  return `${NOMES_MESES[Number(m) - 1].slice(0, 3)}/${a.slice(2)}`;
};

export async function render(el) {
  const [mensal, clientes, meds, sumidos] = await Promise.all([
    supabase.rpc('relatorio_mensal', { p_meses: 6 }),
    supabase.rpc('relatorio_top_clientes', { p_limite: 15, p_dias: 365 }),
    supabase.rpc('relatorio_top_medicamentos', { p_limite: 15 }),
    supabase.from('vw_clientes_sumidos').select('*').order('dias_sem_comprar'),
  ]);
  const erro = mensal.error || clientes.error || meds.error || sumidos.error;
  if (erro) {
    mostrarErro(erro);
    el.innerHTML = htmlVazio('Não foi possível carregar os relatórios.', '⚠️');
    return;
  }

  const meses = mensal.data;
  const maior = Math.max(1, ...meses.map((m) => m.enviados));
  const tot = meses.reduce((a, m) => ({ env: a.env + m.enviados, rec: a.rec + m.recompras }), { env: 0, rec: 0 });

  el.innerHTML = `
    <div class="cabecalho"><h1>📊 Relatórios</h1></div>

    <div class="card">
      <h2>Lembretes enviados × recompras (6 meses)
        <span class="acoes"><button class="btn btn-sec btn-pequeno" data-csv="mensal">⬇ CSV</button></span></h2>
      <p class="suave">Total: ${tot.env} lembretes enviados, ${tot.rec} recompras
        ${tot.env ? `(<strong>${Math.round((tot.rec / tot.env) * 100)}%</strong> de retorno)` : ''}.</p>
      <div class="legenda" aria-hidden="true">
        <span><i style="background:var(--grafico-1)"></i>Enviados</span>
        <span><i style="background:var(--grafico-2)"></i>Recompraram</span>
      </div>
      <div class="barras" role="img" aria-label="Gráfico de lembretes enviados e recompras por mês. Os mesmos números estão na tabela abaixo.">
        ${meses.map((m) => `
          <div class="barra-linha" title="${nomeMes(m.mes)}: ${m.enviados} enviados, ${m.recompras} recompraram">
            <span>${nomeMes(m.mes)}</span>
            <div class="barra-pista">
              <div class="barra-valor"><i class="enviados" style="width:${(m.enviados / maior) * 85}%"></i><span>${m.enviados}</span></div>
              <div class="barra-valor"><i class="recompras" style="width:${(m.recompras / maior) * 85}%"></i><span>${m.recompras}</span></div>
            </div>
          </div>`).join('')}
      </div>
      <details style="margin-top:12px"><summary class="btn btn-link" style="padding-left:0">Ver tabela</summary>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Mês</th><th class="num">Enviados</th><th class="num">Recompraram</th><th class="num">Sem retorno</th><th class="num">Aguardando</th><th class="num">Retorno</th></tr></thead>
          <tbody>${meses.map((m) => `<tr><td>${nomeMes(m.mes)}</td><td class="num">${m.enviados}</td>
            <td class="num">${m.recompras}</td><td class="num">${m.sem_retorno}</td><td class="num">${m.aguardando}</td>
            <td class="num">${m.enviados ? Math.round((m.recompras / m.enviados) * 100) + '%' : '—'}</td></tr>`).join('')}</tbody>
        </table></div></details>
    </div>

    <div class="grade-dupla">
      <div class="card">
        <h2>🏆 Clientes que mais compram (12 meses)
          <span class="acoes"><button class="btn btn-sec btn-pequeno" data-csv="clientes">⬇ CSV</button></span></h2>
        ${clientes.data.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Cliente</th><th class="num">Compras</th><th>Última</th></tr></thead>
          <tbody>${clientes.data.map((c) => `<tr><td><a href="#/clientes/${c.cliente_id}">${esc(c.nome)}</a></td>
            <td class="num">${c.total_compras}</td><td>${formatarData(c.ultima_compra)}</td></tr>`).join('')}</tbody>
        </table></div>` : htmlVazio('Sem compras ainda.', '🏆')}
      </div>

      <div class="card">
        <h2>💊 Medicamentos mais frequentes
          <span class="acoes"><button class="btn btn-sec btn-pequeno" data-csv="medicamentos">⬇ CSV</button></span></h2>
        ${meds.data.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Medicamento</th><th class="num">Clientes</th><th class="num">Compras</th></tr></thead>
          <tbody>${meds.data.map((m) => `<tr><td>${esc(m.medicamento)}</td>
            <td class="num">${m.clientes}</td><td class="num">${m.compras}</td></tr>`).join('')}</tbody>
        </table></div>` : htmlVazio('Nenhum medicamento cadastrado.', '💊')}
      </div>
    </div>

    <div class="card">
      <h2>😢 Clientes sumidos (sem compra há mais de 60 dias)
        <span class="acoes"><button class="btn btn-sec btn-pequeno" data-csv="sumidos">⬇ CSV</button></span></h2>
      ${sumidos.data.length ? `<ul class="lista">${sumidos.data.map((s) => `
        <li class="item">
          <div class="item-principal">
            <div class="item-titulo"><a href="#/clientes/${s.id}">${esc(s.nome)}</a></div>
            <div class="item-sub">${esc(formatarTelefone(s.telefone))} · última compra ${formatarData(s.ultima_compra)} (${s.dias_sem_comprar} dias)</div>
          </div>
          ${s.pode_receber ? `<a class="btn btn-whats btn-pequeno" target="_blank" rel="noopener" href="${linkWhatsApp(s.telefone)}">💬 Conversar</a>`
            : '<span class="badge badge-amarelo">Sem autorização</span>'}
        </li>`).join('')}</ul>` : htmlVazio('Nenhum cliente sumido. Ótimo sinal! 🎉', '😊')}
    </div>`;

  // Exportação CSV
  const dia = hojeISO();
  const exportar = {
    mensal: () => baixarArquivo(`lembretes-por-mes-${dia}.csv`, gerarCSV(meses, [
      { chave: 'mes', titulo: 'Mês', formatar: (v) => nomeMes(v) },
      { chave: 'enviados', titulo: 'Enviados' },
      { chave: 'recompras', titulo: 'Recompraram' },
      { chave: 'sem_retorno', titulo: 'Sem retorno' },
      { chave: 'aguardando', titulo: 'Aguardando' },
    ])),
    clientes: () => baixarArquivo(`top-clientes-${dia}.csv`, gerarCSV(clientes.data, [
      { chave: 'nome', titulo: 'Cliente' },
      { chave: 'telefone', titulo: 'Telefone', formatar: formatarTelefone },
      { chave: 'total_compras', titulo: 'Compras' },
      { chave: 'ultima_compra', titulo: 'Última compra', formatar: formatarData },
    ])),
    medicamentos: () => baixarArquivo(`top-medicamentos-${dia}.csv`, gerarCSV(meds.data, [
      { chave: 'medicamento', titulo: 'Medicamento' },
      { chave: 'clientes', titulo: 'Clientes' },
      { chave: 'compras', titulo: 'Compras' },
    ])),
    sumidos: () => baixarArquivo(`clientes-sumidos-${dia}.csv`, gerarCSV(sumidos.data, [
      { chave: 'nome', titulo: 'Cliente' },
      { chave: 'telefone', titulo: 'Telefone', formatar: formatarTelefone },
      { chave: 'ultima_compra', titulo: 'Última compra', formatar: formatarData },
      { chave: 'dias_sem_comprar', titulo: 'Dias sem comprar' },
    ])),
  };
  // Exportar é só para o admin
  el.querySelectorAll('[data-csv]').forEach((b) => {
    if (!ehAdmin()) return b.remove();
    b.addEventListener('click', () => exportar[b.dataset.csv]());
  });
}
