// =====================================================================
// Roda antes de tudo, no <head> de todas as páginas (script comum, não módulo).
// Fica num arquivo (e não dentro do HTML) para a política de segurança (CSP)
// poder bloquear qualquer script escrito direto na página.
// =====================================================================

// Não deixa o site ser aberto dentro de outro site (proteção contra "clickjacking")
if (window.top !== window.self) {
  try { window.top.location.replace(window.location.href); } catch (e) { document.documentElement.style.display = 'none'; }
}

// Guarda o endereço antes do Supabase limpar (links de convite / recuperar senha)
window.__hashInicial = location.hash;

// Modo escuro é o padrão; o claro só se a pessoa escolheu (botão da lua)
try {
  const t = localStorage.getItem('tema');
  if (t !== 'claro') {
    document.documentElement.dataset.tema = 'escuro';
  }
} catch (e) { document.documentElement.dataset.tema = 'escuro'; }
