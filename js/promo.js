// =====================================================================
// Página pública de fotos da promoção (promo.html) — sem login, sem dados de clientes
// =====================================================================

import { supabase } from './supabase.js';
import { dadosPublicosFarmacia } from './store.js';
import { esc, linkWhatsApp, normalizarTelefone } from './utils.js';

const $ = (s) => document.querySelector(s);
const id = new URLSearchParams(location.search).get('c') || '';
const fotos = $('[data-fotos]');

// Nome, endereço e telefone da farmácia
dadosPublicosFarmacia().then((f) => {
  if (!f) return;
  if (f.nome) {
    $('[data-nome]').textContent = f.nome;
    document.title = `Promoção · ${f.nome}`;
  }
  if (f.endereco) $('[data-endereco]').textContent = `📍 ${f.endereco}`;
  const tel = normalizarTelefone(f.telefone || '');
  if (tel) {
    const b = $('[data-whats]');
    b.href = linkWhatsApp(tel, 'Olá! Vi as fotos da promoção e quero saber mais. 😊');
    b.classList.remove('oculto');
  }
  $('[data-info]').classList.remove('oculto');
});

// Fotos da campanha
const valido = /^[0-9a-f-]{36}$/i.test(id);
const { data, error } = valido
  ? await supabase.rpc('imagens_campanha', { p_id: id })
  : { data: null, error: null };
const lista = (data?.imagens || []).filter((u) => /^https?:\/\//.test(u)); // só links de verdade

if (error || !lista.length) {
  fotos.innerHTML = `<div class="vazio"><div class="vazio-icone">🖼️</div>
    <p>${valido && !error ? 'Esta promoção não tem fotos.' : 'Promoção não encontrada ou já encerrada.'}</p></div>`;
} else {
  fotos.innerHTML = lista.map((u, i) =>
    `<img src="${esc(u)}" alt="Foto ${i + 1} da promoção" loading="${i ? 'lazy' : 'eager'}">`).join('');
}
