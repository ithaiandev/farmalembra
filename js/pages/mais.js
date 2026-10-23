// Menu "Mais" (celular)
import { ehAdmin, sair, sessao } from '../auth.js';
import { esc } from '../utils.js';

export async function render(el) {
  el.innerHTML = `
    <div class="cabecalho"><h1>☰ Mais opções</h1></div>
    <div class="card mais-lista">
      <a href="#/campanhas"><span class="ic">📣</span>Campanhas</a>
      <a href="#/modelos"><span class="ic">📝</span>Modelos de mensagem</a>
      <a href="#/relatorios"><span class="ic">📊</span>Relatórios</a>
      ${ehAdmin() ? `
        <a href="#/configuracoes"><span class="ic">⚙️</span>Configurações e usuários</a>
        <a href="#/importar"><span class="ic">📥</span>Importar clientes (CSV)</a>` : ''}
      <a href="privacidade.html" target="_blank" rel="noopener"><span class="ic">🔒</span>Política de Privacidade</a>
    </div>
    <div class="card">
      <p class="suave">Conectado como <strong>${esc(sessao.perfil.nome || sessao.user.email)}</strong>
        (${ehAdmin() ? 'administrador' : 'atendente'})</p>
      <button class="btn btn-sec btn-bloco" data-sair>🚪 Sair</button>
    </div>
    <p class="centro suave pequeno">💡 Para instalar no celular: no Chrome, toque em ⋮ → "Adicionar à tela inicial".</p>`;
  el.querySelector('[data-sair]').addEventListener('click', sair);
}
