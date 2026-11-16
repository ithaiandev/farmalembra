// Painel inicial: números do dia, ações rápidas e aniversariantes
import { supabase } from '../supabase.js';
import { sessao, ehAdmin } from '../auth.js';
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

  const hora = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Fortaleza' }).format(new Date()));
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const ico = (id) => `<span class="numero-ico"><svg class="ico"><use href="#i-${id}"/></svg></span>`;

  el.innerHTML = `
    <section class="hero">
      <div class="hero-texto">
        <span class="hero-saudacao">${saudacao}, ${esc(primeiroNome(sessao.perfil.nome) || 'equipe')} 👋 · ${formatarData(hojeISO())}</span>
        <h1>Vamos cuidar bem<br>dos nossos clientes hoje.</h1>
        <p>Veja o que precisa de atenção na farmácia.</p>
        <div class="hero-acoes">
          <a href="#/lembretes?fila=1" class="btn btn-whats">Enviar lembretes de hoje (${r.hoje})</a>
          <a href="#/balcao" class="btn btn-primario">Registrar compra</a>
          <a href="#/clientes/novo" class="btn btn-sec">＋ Novo cliente</a>
          ${ehAdmin() ? '<a href="#/campanhas/nova" class="btn btn-sec">＋ Nova campanha</a>' : '<a href="#/campanhas" class="btn btn-sec">Campanhas</a>'}
        </div>
      </div>
      <svg class="hero-arte" viewBox="0 0 260 190" aria-hidden="true">
        <defs>
          <linearGradient id="hv1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4b5fd" stop-opacity=".95"/><stop offset="1" stop-color="#3b82f6" stop-opacity=".55"/></linearGradient>
          <linearGradient id="hv2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
          <filter id="hbr" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
        </defs>
        <ellipse cx="135" cy="100" rx="80" ry="58" fill="#8b5cf6" opacity=".45" filter="url(#hbr)"/>
        <path d="M-10 150 C 60 110, 120 175, 270 95" stroke="#a78bfa" stroke-opacity=".35" stroke-width="2" fill="none"/>
        <path d="M-10 165 C 70 125, 140 185, 270 115" stroke="#60a5fa" stroke-opacity=".3" stroke-width="2" fill="none"/>
        <g transform="rotate(-12 135 95)">
          <path d="M112 35h46a8 8 0 0 1 8 8v30h30a8 8 0 0 1 8 8v28a8 8 0 0 1-8 8h-30v30a8 8 0 0 1-8 8h-46a8 8 0 0 1-8-8v-30H74a8 8 0 0 1-8-8V81a8 8 0 0 1 8-8h30V43a8 8 0 0 1 8-8z"
            fill="url(#hv1)" stroke="#e9e5ff" stroke-opacity=".7" stroke-width="1.5"/>
          <path d="M112 35h46a8 8 0 0 1 8 8v30h30a8 8 0 0 1 8 8v6H66v-6a8 8 0 0 1 8-8h30V43a8 8 0 0 1 8-8z" fill="url(#hv2)"/>
        </g>
        <circle cx="214" cy="40" r="16" fill="#3b82f6" opacity=".85"/>
        <path d="M207 40l5 5 9-10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <blockquote class="hero-frase">“Cliente lembrado é cliente que volta.”</blockquote>
    </section>

    <div class="grade-cards painel-numeros">
      <a class="numero" href="#/lembretes">${ico('lembretes')}
        <span class="valor">${r.hoje}</span><span class="rotulo">Lembretes para hoje</span></a>
      <a class="numero vermelho" href="#/lembretes?aba=atrasados">${ico('alerta')}
        <span class="valor">${r.atrasados}</span><span class="rotulo">Atrasados (remédio acabou)</span></a>
      <a class="numero amarelo" href="#/lembretes?aba=proximos">${ico('calendario')}
        <span class="valor">${r.proximos_7_dias}</span><span class="rotulo">Próximos 7 dias</span></a>
      <a class="numero roxo" href="#/clientes">${ico('clientes')}
        <span class="valor">${r.clientes_ativos}</span><span class="rotulo">Clientes ativos</span></a>
      <a class="numero rosa" href="#aniversariantes">${ico('presente')}
        <span class="valor">${r.aniversariantes_mes}</span><span class="rotulo">Aniversariantes do mês</span></a>
      <a class="numero verde" href="#/relatorios">${ico('tendencia')}
        <span class="valor">${taxa === null ? '—' : taxa + '%'}</span>
        <span class="rotulo">Retorno dos lembretes no mês${r.enviados_mes ? ` (${r.recompras_mes} de ${r.enviados_mes})` : ''}</span></a>
    </div>

    <div class="grade-dupla" style="margin-top:16px">
    <div class="card" id="aniversariantes">
      <h2>🎂 Aniversariantes de hoje</h2>
      <ul class="lista" data-hoje></ul>
    </div>

    <div class="card">
      <h2>📅 Aniversariantes do mês</h2>
      <ul class="lista" data-mes></ul>
    </div>
    </div>`;

  const itemAniv = (a, comBotao) => `
    <li class="item">
      <div class="avatar">${esc(a.nome.charAt(0).toUpperCase())}</div>
      <div class="item-principal">
        <div class="item-titulo"><a href="#/clientes/${a.id}">${esc(a.nome)}</a></div>
        <div class="item-sub">Dia ${a.dia} · ${a.idade} anos · ${esc(formatarTelefone(a.telefone))}</div>
      </div>
      ${comBotao ? (a.pode_receber
        ? `<button class="btn btn-whats btn-pequeno" data-parabens="${a.id}">Dar parabéns</button>`
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
