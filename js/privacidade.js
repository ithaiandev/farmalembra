// =====================================================================
// Política de Privacidade (privacidade.html): preenche os dados da farmácia
// =====================================================================

// Nome, endereço e telefone vêm das Configurações do sistema (não precisa editar este arquivo)
import { dadosPublicosFarmacia } from './store.js';
const f = await dadosPublicosFarmacia();
if (f?.nome) {
  document.querySelectorAll('[data-nome]').forEach((el) => (el.textContent = f.nome));
  document.title = `Política de Privacidade · ${f.nome}`;
}
if (f?.endereco) document.querySelector('[data-endereco]').textContent = ` (${f.endereco})`;
if (f?.telefone) {
  document.querySelector('[data-telefone]').textContent = f.telefone;
  document.querySelector('[data-tem-telefone]').classList.remove('oculto');
}
