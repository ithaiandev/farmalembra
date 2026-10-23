// =====================================================================
// "Modo fila" de envio pelo WhatsApp
// Mostra um cliente por vez: Enviar → WhatsApp → volta → próximo.
// Usado nos lembretes e nas campanhas.
//
// Sobre imagens: o link wa.me só leva TEXTO. Para a foto ir junto:
//  - celular: botão "Enviar com a imagem" abre o menu Compartilhar
//    (imagem + texto) e a pessoa escolhe WhatsApp e o contato;
//  - computador: "Copiar imagem" e colar (Ctrl+V) na conversa.
// =====================================================================
import { abrirModal, toast, mostrarErro } from './ui.js';
import { esc, formatarTelefone, linkWhatsApp } from './utils.js';
import { podeCompartilharArquivo, copiarImagem } from './imagens.js';

/**
 * abrirFila({
 *   titulo,
 *   itens,                       // lista de qualquer coisa
 *   montar: async (item) => ({ nome, detalhe, telefone, mensagem }),
 *   aoEnviar: async (item, mensagem) => {},   // grava no banco
 *   extras: [{ rotulo, classe, acao: async (item) => {} }],  // ex.: "Cliente recomprou"
 *   jaEnviados = 0, total = itens.length,     // para o progresso "12/80"
 *   arquivo = null,      // imagem (File) para enviar junto
 *   linkImagem = null,   // link público da imagem (usado só quando a foto não vai como arquivo)
 * })
 * Resolve com { enviados, pulados, outros } quando a fila fecha.
 */
export function abrirFila({
  titulo, itens, montar, aoEnviar, extras = [], jaEnviados = 0, total = null, arquivo = null, linkImagem = null,
}) {
  const fila = [...itens];
  const totalGeral = total ?? fila.length + jaEnviados;
  const placar = { enviados: 0, pulados: 0, outros: 0 };
  const temImagem = Boolean(arquivo);
  const podeCompartilhar = temImagem && podeCompartilharArquivo(arquivo);
  const ehCelular = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  // O link só entra no texto se a foto não puder ir como arquivo (ainda não carregou)
  const anexarLink = Boolean(linkImagem) && !temImagem;
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

      const registrarEnvio = async (msg) => {
        try {
          await aoEnviar(atual, msg);
          placar.enviados++;
        } catch (erro) {
          mostrarErro(erro, 'A mensagem foi aberta, mas não consegui registrar o envio.');
        }
        proximo();
      };

      const htmlBotoes = () => {
        if (!temImagem) {
          return '<button type="button" class="btn btn-whats btn-grande" data-enviar>💬 Enviar no WhatsApp</button>';
        }
        let h = '';
        if (podeCompartilhar) {
          h += `
            <button type="button" class="btn btn-whats btn-grande" data-compartilhar>📷 Enviar com a imagem</button>
            <small class="suave">Abre o menu Compartilhar: escolha <strong>WhatsApp</strong> e procure
              <strong>${esc(dadosAtuais.nome)}</strong>.</small>`;
        }
        if (!ehCelular || !podeCompartilhar) {
          h += `
            <div class="aviso info">🖥️ <span>No computador (WhatsApp Web): <strong>1)</strong> <em>Copiar imagem</em>
              <strong>2)</strong> <em>${podeCompartilhar ? 'Abrir conversa' : 'Enviar no WhatsApp'}</em>
              <strong>3)</strong> na conversa, aperte <strong>Ctrl+V</strong> para colar a imagem e envie.</span></div>
            <button type="button" class="btn btn-sec" data-copiar-imagem>📋 Copiar imagem</button>`;
        }
        h += podeCompartilhar
          ? '<button type="button" class="btn btn-sec" data-enviar>💬 Abrir conversa (só o texto)</button>'
          : '<button type="button" class="btn btn-whats btn-grande" data-enviar>💬 Enviar no WhatsApp</button>';
        return h;
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
            ${htmlBotoes()}
            <div class="fila-secundarios">
              ${extras.map((x, i) => `<button type="button" class="btn ${x.classe || 'btn-sec'}" data-extra="${i}">${esc(x.rotulo)}</button>`).join('')}
              <button type="button" class="btn btn-sec" data-pular>Pular ⏭</button>
            </div>
          </div>`;

        const texto = () => area.querySelector('[data-msg]').value.trim();

        // IMPORTANTE: window.open / navigator.share precisam acontecer direto
        // no clique, senão o navegador bloqueia.
        area.querySelector('[data-enviar]').addEventListener('click', (e) => {
          const msg = texto();
          const comLink = anexarLink ? `${msg}\n\n${linkImagem}` : msg;
          window.open(linkWhatsApp(dadosAtuais.telefone, comLink), '_blank', 'noopener');
          e.currentTarget.disabled = true;
          registrarEnvio(comLink);
        });

        area.querySelector('[data-compartilhar]')?.addEventListener('click', async (e) => {
          const botao = e.currentTarget;
          const msg = texto();
          botao.disabled = true;
          try {
            await navigator.share({ files: [arquivo], text: msg });
          } catch (erro) {
            botao.disabled = false;
            if (erro?.name !== 'AbortError') mostrarErro(erro, 'Não foi possível abrir o compartilhamento.');
            return; // cancelou: continua no mesmo cliente
          }
          registrarEnvio(msg);
        });

        area.querySelector('[data-copiar-imagem]')?.addEventListener('click', async () => {
          try {
            await copiarImagem(arquivo);
            toast('Imagem copiada! Agora clique em "Enviar no WhatsApp" e cole com Ctrl+V.');
          } catch (erro) {
            mostrarErro(erro, erro?.message || 'Não foi possível copiar a imagem.');
          }
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
