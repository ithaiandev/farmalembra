// =====================================================================
// "Modo fila" de envio pelo WhatsApp (somente TEXTO)
// Mostra um cliente por vez: Enviar → abre o WhatsApp → volta → próximo.
// Usado nos lembretes e nas campanhas.
// (Imagem pronta junto com o texto só pela API oficial — "Enviar pelo sistema".)
// =====================================================================
import { abrirModal, toast, mostrarErro } from './ui.js';
import { esc, formatarTelefone, linkWhatsApp } from './utils.js';

/**
 * abrirFila({
 *   titulo,
 *   itens,                       // lista de qualquer coisa
 *   montar: async (item) => ({ nome, detalhe, telefone, mensagem }),
 *   aoEnviar: async (item, mensagem) => {},   // grava no banco
 *   extras: [{ rotulo, classe, acao: async (item) => {} }],  // ex.: "Cliente recomprou"
 *   jaEnviados = 0, total = itens.length,     // para o progresso "12/80"
 * })
 * Resolve com { enviados, pulados, outros } quando a fila fecha.
 */
export function abrirFila({ titulo, itens, montar, aoEnviar, extras = [], jaEnviados = 0, total = null }) {
  const fila = [...itens];
  const totalGeral = total ?? fila.length + jaEnviados;
  const placar = { enviados: 0, pulados: 0, outros: 0 };
  let atual = null;
  let dadosAtuais = null;

  return abrirModal({
    titulo,
    largura: 'modal-largo',
    html: '<div class="fila" data-fila></div>',
    aoAbrir(dlg, fechar) {
      const area = dlg.querySelector('[data-fila]');

      const desenharFim = () => {
        area.innerHTML = `
          <div class="fila-fim">
            <div class="vazio-icone">🎉</div>
            <h3>Fila concluída!</h3>
            <p>Enviados agora: <strong>${placar.enviados}</strong>
               · Pulados: <strong>${placar.pulados}</strong>
               ${placar.outros ? ` · Outras ações: <strong>${placar.outros}</strong>` : ''}</p>
            <button type="button" class="btn btn-primario btn-grande" data-ok>Fechar</button>
          </div>`;
        area.querySelector('[data-ok]').addEventListener('click', () => fechar(placar));
      };

      const proximo = async () => {
        atual = fila.shift();
        if (!atual) return desenharFim();
        area.innerHTML = '<div class="carregando"><span class="spinner"></span>Preparando...</div>';
        try {
          dadosAtuais = await montar(atual);
        } catch (e) {
          mostrarErro(e);
          placar.pulados++;
          return proximo();
        }
        const feitos = jaEnviados + placar.enviados;
        const pct = totalGeral ? Math.round((feitos / totalGeral) * 100) : 0;
        area.innerHTML = `
          <div class="fila-progresso">
            <div class="barra"><div class="barra-preenchida" style="width:${pct}%"></div></div>
            <span>${feitos}/${totalGeral} enviados · faltam ${fila.length + 1}</span>
          </div>
          <div class="fila-cliente">
            <div class="fila-nome">${esc(dadosAtuais.nome)}</div>
            ${dadosAtuais.detalhe ? `<div class="fila-detalhe">${dadosAtuais.detalhe}</div>` : ''}
            <div class="fila-tel">📱 ${esc(formatarTelefone(dadosAtuais.telefone))}</div>
          </div>
          <label class="campo">
            <span>Mensagem (pode ajustar antes de enviar)</span>
            <textarea rows="6" data-msg>${esc(dadosAtuais.mensagem)}</textarea>
          </label>
          <div class="fila-botoes">
            <button type="button" class="btn btn-whats btn-grande" data-enviar>💬 Enviar no WhatsApp</button>
            <div class="fila-secundarios">
              ${extras.map((x, i) => `<button type="button" class="btn ${x.classe || 'btn-sec'}" data-extra="${i}">${esc(x.rotulo)}</button>`).join('')}
              <button type="button" class="btn btn-sec" data-pular>Pular ⏭</button>
            </div>
          </div>`;

        // IMPORTANTE: window.open precisa acontecer direto no clique,
        // senão o navegador bloqueia a nova aba.
        area.querySelector('[data-enviar]').addEventListener('click', async (e) => {
          const msg = area.querySelector('[data-msg]').value.trim();
          window.open(linkWhatsApp(dadosAtuais.telefone, msg), '_blank', 'noopener');
          e.currentTarget.disabled = true;
          try {
            await aoEnviar(atual, msg);
            placar.enviados++;
          } catch (erro) {
            mostrarErro(erro, 'A mensagem foi aberta, mas não consegui registrar o envio.');
          }
          proximo();
        });

        area.querySelector('[data-pular]').addEventListener('click', () => {
          placar.pulados++;
          proximo();
        });

        area.querySelectorAll('[data-extra]').forEach((b) => {
          b.addEventListener('click', async () => {
            b.disabled = true;
            try {
              // acao() pode devolver false = "desisti" (fica no mesmo cliente)
              const feito = await extras[Number(b.dataset.extra)].acao(atual);
              if (feito === false) { b.disabled = false; return; }
              placar.outros++;
              proximo();
            } catch (erro) {
              mostrarErro(erro);
              b.disabled = false;
            }
          });
        });
      };

      if (!fila.length) {
        toast('Nada para enviar agora. 👍', 'info');
        return fechar(placar);
      }
      proximo();
    },
  }).then((r) => r ?? placar);
}
