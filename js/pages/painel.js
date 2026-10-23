// Painel inicial: números do dia, ações rápidas e aniversariantes
import { supabase } from '../supabase.js';
import { sessao } from '../auth.js';
import { mostrarErro, htmlVazio } from '../ui.js';
import { esc, hojeISO, formatarData, formatarTelefone, linkWhatsApp, primeiroNome } from '../utils.js';
import { mensagemPorTipo } from '../mensagens.js';

export async function render(el) {
  // Atualiza "sem retorno" antes de contar (o cron também faz isso todo dia)
  await supabase.rpc('atualizar_status_lembretes').then(() => {}, () => {});

  const [{ data: r, error }, { data: aniversariantes }] = await Promise.all([
    supabase.rpc('resumo_painel'),
    supabase.from('vw_aniversariantes_mes').select('*').order('dia'),
  ]);
  if (error) {
    mostrarErro(error, 'Não foi possível carregar o painel.');
    el.innerHTML = htmlVazio('Não foi possível carregar os números. Verifique se o SQL foi executado no Supabase.', '⚠️');
    return;
  }

  const taxa = r.enviados_mes ? Math.round((r.recompras_mes / r.enviados_mes) * 100) : null;
  const diaHoje = Number(hojeISO().slice(8, 10));
  const deHoje = (aniversariantes || []).filter((a) => a.dia === diaHoje);

  el.innerHTML = `
    <div class="cabecalho">
      <h1>Olá, ${esc(primeiroNome(sessao.perfil.nome) || 'equipe')}! 👋</h1>
      <span class="suave">${formatarData(hojeISO())}</span>
    </div>

    <div class="acoes-rapidas">
      <a href="#/lembretes?fila=1" class="btn btn-whats btn-grande">🔔 Enviar lembretes de hoje (${r.hoje})</a>
      <a href="#/balcao" class="btn btn-primario btn-grande">🛒 Registrar compra</a>
      <a href="#/clientes/novo" class="btn btn-sec btn-grande">➕ Novo cliente</a>
    </div>

    <div class="grade-cards">
      <a class="numero" href="#/lembretes">
        <span class="valor">${r.hoje}</span><span class="rotulo">Lembretes para hoje</span></a>
      <a class="numero vermelho" href="#/lembretes?aba=atrasados">
        <span class="valor">${r.atrasados}</span><span class="rotulo">Atrasados (remédio acabou)</span></a>
      <a class="numero amarelo" href="#/lembretes?aba=proximos">
        <span class="valor">${r.proximos_7_dias}</span><span class="rotulo">Próximos 7 dias</span></a>
      <a class="numero" href="#/clientes">
        <span class="valor">${r.clientes_ativos}</span><span class="rotulo">Clientes ativos</span></a>
      <a class="numero amarelo" href="#aniversariantes">
        <span class="valor">${r.aniversariantes_mes}</span><span class="rotulo">Aniversariantes do mês</span></a>
      <a class="numero verde" href="#/relatorios">
        <span class="valor">${taxa === null ? '—' : taxa + '%'}</span>
        <span class="rotulo">Retorno dos lembretes no mês${r.enviados_mes ? ` (${r.recompras_mes} de ${r.enviados_mes})` : ''}</span></a>
    </div>

    <div class="card" id="aniversariantes" style="margin-top:16px">
      <h2>🎂 Aniversariantes de hoje</h2>
      <ul class="lista" data-hoje></ul>
    </div>

    <div class="card">
      <h2>📅 Aniversariantes do mês</h2>
      <ul class="lista" data-mes></ul>
    </div>`;

  const itemAniv = (a, comBotao) => `
    <li class="item">
      <div class="avatar">${esc(a.nome.charAt(0).toUpperCase())}</div>
      <div class="item-principal">
        <div class="item-titulo"><a href="#/clientes/${a.id}">${esc(a.nome)}</a></div>
        <div class="item-sub">Dia ${a.dia} · ${a.idade} anos · ${esc(formatarTelefone(a.telefone))}</div>
      </div>
      ${comBotao ? (a.pode_receber
        ? `<button class="btn btn-whats btn-pequeno" data-parabens="${a.id}">🎉 Dar parabéns</button>`
        : '<span class="badge badge-amarelo">Sem autorização</span>') : ''}
    </li>`;

  el.querySelector('[data-hoje]').innerHTML = deHoje.length
    ? deHoje.map((a) => itemAniv(a, true)).join('')
    : `<li>${htmlVazio('Ninguém faz aniversário hoje.', '🎈')}</li>`;
  el.querySelector('[data-mes]').innerHTML = (aniversariantes || []).length
    ? aniversariantes.map((a) => itemAniv(a, a.dia === diaHoje)).join('')
    : `<li>${htmlVazio('Nenhum aniversariante com data de nascimento cadastrada neste mês.', '📅')}</li>`;

  // Parabéns: prepara a mensagem antes, para abrir o WhatsApp direto no clique
  const mensagens = {};
  for (const a of deHoje) mensagens[a.id] = await mensagemPorTipo('aniversario', a);
  el.querySelectorAll('[data-parabens]').forEach((b) => {
    const a = deHoje.find((x) => x.id === b.dataset.parabens);
    b.addEventListener('click', () => window.open(linkWhatsApp(a.telefone, mensagens[a.id]), '_blank', 'noopener'));
  });

  // Link "#aniversariantes" rola até a seção sem trocar de rota
  el.querySelector('a[href="#aniversariantes"]').addEventListener('click', (e) => {
    e.preventDefault();
    el.querySelector('#aniversariantes').scrollIntoView({ behavior: 'smooth' });
  });
}
