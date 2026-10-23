// Modelos de mensagem: editar textos com pré-visualização
import { supabase } from '../supabase.js';
import { ehAdmin } from '../auth.js';
import { recarregar } from '../router.js';
import {
  abrirModal, toast, mostrarErro, confirmar, comBotaoOcupado, htmlVazio,
  htmlBotoesVariaveis, ligarBotoesVariaveis,
} from '../ui.js';
import { esc, lerFormulario } from '../utils.js';
import { obterModelos } from '../store.js';
import { previaMensagem } from '../mensagens.js';

const TIPOS = {
  lembrete: '🔔 Lembrete de recompra',
  aniversario: '🎂 Aniversário',
  boas_vindas: '👋 Boas-vindas',
  campanha: '📣 Campanha / evento',
};

export async function render(el) {
  const modelos = await obterModelos(true);

  el.innerHTML = `
    <div class="cabecalho">
      <h1>📝 Modelos de mensagem</h1>
      <div class="acoes"><button class="btn btn-primario" data-novo>➕ Novo modelo</button></div>
    </div>
    <div class="aviso info">O modelo marcado como <strong>padrão</strong> é o usado automaticamente.
      Todas as mensagens devem terminar com a opção de responder <strong>SAIR</strong>.</div>
    ${Object.entries(TIPOS).map(([tipo, nome]) => {
      const lista = modelos.filter((m) => m.tipo === tipo);
      return `<div class="card"><h2>${nome}</h2>
        ${lista.length ? `<ul class="lista">${lista.map((m) => `
          <li class="item">
            <div class="item-principal">
              <div class="item-titulo">${esc(m.titulo)} ${m.padrao ? '<span class="badge badge-verde">Padrão</span>' : ''}</div>
              <div class="item-sub" style="white-space:pre-wrap">${esc(m.texto.length > 160 ? m.texto.slice(0, 160) + '…' : m.texto)}</div>
            </div>
            <div class="item-acoes"><button class="btn btn-sec btn-pequeno" data-editar="${m.id}">✏️ Editar</button></div>
          </li>`).join('')}</ul>` : htmlVazio('Nenhum modelo deste tipo.', '📝')}
      </div>`;
    }).join('')}`;

  el.querySelector('[data-novo]').addEventListener('click', () => editar({ tipo: 'campanha', titulo: '', texto: '', padrao: false }));
  el.querySelectorAll('[data-editar]').forEach((b) =>
    b.addEventListener('click', () => editar(modelos.find((m) => m.id === b.dataset.editar))));
}

async function editar(modelo) {
  const novo = !modelo.id;
  const salvo = await abrirModal({
    titulo: novo ? 'Novo modelo' : 'Editar modelo',
    largura: 'modal-largo',
    html: `
      <form data-form novalidate>
        <div class="grade-2">
          <label class="campo"><span>Tipo</span>
            <select name="tipo">${Object.entries(TIPOS).map(([t, n]) =>
              `<option value="${t}" ${t === modelo.tipo ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="campo"><span>Título *</span>
            <input name="titulo" required value="${esc(modelo.titulo)}"></label>
        </div>
        <label class="campo"><span>Texto *</span>
          <textarea name="texto" rows="7" required>${esc(modelo.texto)}</textarea></label>
        ${htmlBotoesVariaveis()}
        <label class="checkbox"><input type="checkbox" name="padrao" ${modelo.padrao ? 'checked' : ''}>
          <span>Usar como padrão deste tipo</span></label>
        <div class="previa-whats"><div class="balao" data-previa></div></div>
        <div class="acoes-modal" style="margin-top:14px">
          ${!novo && ehAdmin() ? '<button type="button" class="btn btn-link" data-excluir>🗑️ Excluir</button>' : ''}
          <button type="button" class="btn btn-sec" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Salvar</button>
        </div>
      </form>`,
    aoAbrir(dlg, fechar) {
      const form = dlg.querySelector('[data-form]');
      const previa = async () => { dlg.querySelector('[data-previa]').textContent = await previaMensagem(form.texto.value); };
      ligarBotoesVariaveis(form, form.texto, previa);
      form.texto.addEventListener('input', previa);
      previa();
      dlg.querySelector('[data-cancelar]').addEventListener('click', () => fechar());

      dlg.querySelector('[data-excluir]')?.addEventListener('click', async () => {
        if (!(await confirmar({ titulo: 'Excluir modelo', mensagem: `Excluir "${modelo.titulo}"?`, botao: 'Excluir', perigo: true }))) return;
        const { error } = await supabase.from('modelos_mensagem').delete().eq('id', modelo.id);
        if (error) return mostrarErro(error);
        toast('Modelo excluído.');
        fechar(true);
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = lerFormulario(form);
        if (!d.titulo || !d.texto) return toast('Preencha título e texto.', 'erro');
        const dados = { tipo: d.tipo, titulo: d.titulo, texto: d.texto, padrao: form.padrao.checked };
        await comBotaoOcupado(form.querySelector('[type=submit]'), async () => {
          // Só pode haver um padrão por tipo: desmarca os outros antes
          if (dados.padrao) {
            let q = supabase.from('modelos_mensagem').update({ padrao: false }).eq('tipo', dados.tipo).eq('padrao', true);
            if (!novo) q = q.neq('id', modelo.id);
            const { error } = await q;
            if (error) return mostrarErro(error);
          }
          const { error } = novo
            ? await supabase.from('modelos_mensagem').insert(dados)
            : await supabase.from('modelos_mensagem').update(dados).eq('id', modelo.id);
          if (error) return mostrarErro(error);
          toast('Modelo salvo.');
          fechar(true);
        }, 'Salvando...');
      });
    },
  });
  if (salvo) {
    await obterModelos(true);
    recarregar();
  }
}
