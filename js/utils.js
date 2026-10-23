// =====================================================================
// Utilidades: datas, telefone, CPF, templates, CSV, HTML seguro
// =====================================================================
import { CONFIG } from './config.js';

export const FUSO = 'America/Fortaleza';

export const TAGS_PADRAO = ['bebê', 'idoso', 'gestante', 'fidelidade', 'hipertenso', 'diabético'];

// ---------------------------------------------------------------------
// HTML seguro (sempre use esc() ao colocar dados do banco no HTML)
// ---------------------------------------------------------------------
export function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------------
// Datas (sempre no fuso de Fortaleza). Internamente: 'AAAA-MM-DD'.
// ---------------------------------------------------------------------
const fmtISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Data de hoje em Fortaleza: 'AAAA-MM-DD' */
export function hojeISO() {
  return fmtISO.format(new Date());
}

/** Soma (ou subtrai) dias de uma data 'AAAA-MM-DD' */
export function somarDias(iso, dias) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + Number(dias)));
  return dt.toISOString().slice(0, 10);
}

/** Diferença em dias (b - a) */
export function diasEntre(isoA, isoB) {
  const a = Date.parse(isoA.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(isoB.slice(0, 10) + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/** 'AAAA-MM-DD' -> 'dd/mm/aaaa' */
export function formatarData(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** Timestamp -> 'dd/mm/aaaa hh:mm' em Fortaleza */
export function formatarDataHora(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(ts));
}

/** Aceita 'dd/mm/aaaa', 'dd/mm/aa' ou 'AAAA-MM-DD'. Devolve 'AAAA-MM-DD' ou null */
export function lerData(texto) {
  const t = String(texto ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    let ano = Number(m[3]);
    if (ano < 100) ano += ano > 50 ? 1900 : 2000;
    const iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const dt = new Date(iso + 'T00:00:00Z');
    if (!isNaN(dt) && dt.toISOString().slice(0, 10) === iso) return iso;
  }
  return null;
}

/** "há 3 dias", "hoje", "em 5 dias" */
export function relativo(iso) {
  if (!iso) return '';
  const n = diasEntre(hojeISO(), iso);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}

export const NOMES_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ---------------------------------------------------------------------
// Telefone. No banco: E.164 sem "+", ex.: 5598999999999
// ---------------------------------------------------------------------

/** Qualquer formato -> '55DDNNNNNNNNN' ou null se inválido */
export function normalizarTelefone(valor, ddd = CONFIG.DDD_PADRAO) {
  let d = String(valor ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  if (d.length === 8 || d.length === 9) return '55' + ddd + d;
  return null;
}

/** '5598999999999' -> '(98) 9 9999-9999' */
export function formatarTelefone(valor) {
  if (!valor) return '';
  let d = String(valor).replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return mascararDigitosTelefone(d);
}

function mascararDigitosTelefone(d) {
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  if (d.length === 11) return `(${ddd}) ${resto[0]} ${resto.slice(1, 5)}-${resto.slice(5)}`;
  if (resto.length > 4) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`;
  return `(${ddd}) ${resto}`;
}

/** Liga a máscara (98) 9 9999-9999 num <input> */
export function aplicarMascaraTelefone(input, comDDDPadrao = true) {
  if (comDDDPadrao && !input.value) input.value = `(${CONFIG.DDD_PADRAO}) `;
  input.setAttribute('inputmode', 'tel');
  input.setAttribute('autocomplete', 'tel');
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '');
    input.value = mascararDigitosTelefone(d);
  });
}

// ---------------------------------------------------------------------
// CPF
// ---------------------------------------------------------------------
export function aplicarMascaraCPF(input) {
  input.setAttribute('inputmode', 'numeric');
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '').slice(0, 11);
    input.value = d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2');
  });
}

// ---------------------------------------------------------------------
// Mensagens / templates
// ---------------------------------------------------------------------

/** "MARIA DA SILVA" -> "Maria" */
export function primeiroNome(nome) {
  const p = String(nome ?? '').trim().split(/\s+/)[0] || '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

/** Troca {variavel} pelo valor. Variáveis desconhecidas ficam como estão. */
export function preencherTemplate(texto, vars) {
  return String(texto ?? '').replace(/\{(\w+)\}/g, (trecho, chave) =>
    vars[chave] !== undefined && vars[chave] !== null ? String(vars[chave]) : trecho);
}

export const VARIAVEIS = [
  { chave: '{nome}', desc: 'primeiro nome do cliente' },
  { chave: '{medicamento}', desc: 'nome do medicamento' },
  { chave: '{data_fim}', desc: 'data em que o remédio acaba' },
  { chave: '{farmacia}', desc: 'nome da farmácia' },
  { chave: '{telefone_farmacia}', desc: 'telefone da farmácia' },
  { chave: '{endereco}', desc: 'endereço da farmácia' },
  { chave: '{horario}', desc: 'horário de funcionamento' },
];

/** Link do WhatsApp com a mensagem pronta */
export function linkWhatsApp(telefone, texto = '') {
  const tel = String(telefone ?? '').replace(/\D/g, '');
  return `https://wa.me/${tel}` + (texto ? `?text=${encodeURIComponent(texto)}` : '');
}

// ---------------------------------------------------------------------
// CSV (separador ";" + BOM, abre certinho no Excel em português)
// ---------------------------------------------------------------------
export function gerarCSV(linhas, colunas) {
  // colunas: [{ chave, titulo, formatar? }]
  const celula = (v) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cab = colunas.map((c) => celula(c.titulo)).join(';');
  const corpo = linhas.map((l) =>
    colunas.map((c) => celula(c.formatar ? c.formatar(l[c.chave], l) : l[c.chave])).join(';'));
  return '﻿' + [cab, ...corpo].join('\r\n');
}

export function baixarArquivo(nome, conteudo, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Lê um CSV (detecta ; , ou TAB). Devolve array de objetos com cabeçalhos em minúsculas. */
export function lerCSV(texto) {
  texto = texto.replace(/^﻿/, '');
  const primeira = texto.split(/\r?\n/)[0] || '';
  const sep = [';', ',', '\t'].sort((a, b) => primeira.split(b).length - primeira.split(a).length)[0];

  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((v) => v.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((v) => v.trim() !== '')) linhas.push(linha);

  if (!linhas.length) return [];
  const cab = linhas[0].map((h) => semAcento(h.trim().toLowerCase()).replace(/\s+/g, '_'));
  return linhas.slice(1).map((l) => Object.fromEntries(cab.map((h, i) => [h, (l[i] ?? '').trim()])));
}

export function semAcento(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Lê os parâmetros de um formulário como objeto (strings aparadas) */
export function lerFormulario(form) {
  const dados = {};
  for (const [k, v] of new FormData(form).entries()) dados[k] = typeof v === 'string' ? v.trim() : v;
  return dados;
}
