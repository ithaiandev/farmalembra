// Configurações (somente admin): farmácia, lembretes, envio, usuários, backup
import { supabase } from '../supabase.js';
import { sessao } from '../auth.js';
import { recarregar } from '../router.js';
import { toast, mostrarErro, confirmar, comBotaoOcupado, abrirModal } from '../ui.js';
import { esc, lerFormulario, gerarCSV, baixarArquivo, hojeISO, formatarDataHora } from '../utils.js';
import { obterConfig, limparCache } from '../store.js';

export async function render(el) {
  const cfg = await obterConfig(true);
  const { data: perfis, error } = await supabase.from('perfis').select('*').order('criado_em');
  if (error) mostrarErro(error);

  el.innerHTML = `
    <div class="cabecalho"><h1>⚙️ Configurações</h1></div>

    <form class="card" data-form-cfg novalidate>
      <h2>🏪 Dados da farmácia</h2>
      <p class="suave pequeno">Aparecem nas mensagens, no topo do sistema, na tela de login e na Política de Privacidade.</p>
      <label class="campo"><span>Nome da farmácia</span><input name="nome_farmacia" required value="${esc(cfg.nome_farmacia)}"></label>
      <div class="grade-2">
        <label class="campo"><span>Telefone</span><input name="telefone_farmacia" value="${esc(cfg.telefone_farmacia)}" placeholder="(98) 9 9999-9999"></label>
        <label class="campo"><span>Horário de funcionamento</span><input name="horario_funcionamento" value="${esc(cfg.horario_funcionamento)}" placeholder="seg. a sáb., 7h às 21h"></label>
      </div>
      <label class="campo"><span>Endereço</span><input name="endereco" value="${esc(cfg.endereco)}"></label>

      <h2 style="margin-top:10px">🔔 Lembretes</h2>
      <div class="grade-2">
        <label class="campo"><span>Avisar quantos dias antes de acabar</span>
          <input type="number" name="dias_antecedencia" min="0" max="60" value="${cfg.dias_antecedencia}"></label>
        <label class="campo"><span>Prazo para contar como recompra (dias)</span>
          <input type="number" name="dias_para_considerar_recompra" min="1" max="90" value="${cfg.dias_para_considerar_recompra}"></label>
      </div>

      <h2 style="margin-top:10px">💬 Modo de envio</h2>
      <label class="checkbox"><input type="radio" name="modo_envio" value="manual" ${cfg.modo_envio !== 'api' ? 'checked' : ''}>
        <span>Manual (botões do WhatsApp) <small>Grátis. A atendente clica e envia pelo WhatsApp da farmácia.</small></span></label>
      <label class="checkbox"><input type="radio" name="modo_envio" value="api" ${cfg.modo_envio === 'api' ? 'checked' : ''}>
        <span>Automático (API oficial do WhatsApp) <small>Envia sozinho às 09:00. Precisa configurar a Meta antes (README, parte 9). O modo manual continua funcionando.</small></span></label>
      <label class="checkbox"><input type="checkbox" name="whatsapp_api_ativo" ${cfg.whatsapp_api_ativo ? 'checked' : ''}>
        <span>API do WhatsApp configurada e liberada <small>Só marque depois de testar. Sem isso, o envio automático não roda.</small></span></label>
      <div class="grade-2">
        <label class="campo"><span>Nome do template na Meta</span><input name="whatsapp_template_lembrete" value="${esc(cfg.whatsapp_template_lembrete)}"></label>
        <label class="campo"><span>Idioma do template</span><input name="whatsapp_template_idioma" value="${esc(cfg.whatsapp_template_idioma)}"></label>
      </div>
      <button class="btn btn-primario btn-grande">💾 Salvar configurações</button>
    </form>

    <div class="card">
      <h2>👥 Usuários</h2>
      <ul class="lista">${(perfis || []).map((p) => `
        <li class="item" data-perfil="${p.id}">
          <div class="item-principal">
            <div class="item-titulo">${esc(p.nome || p.email)} ${p.id === sessao.user.id ? '<span class="badge badge-azul">você</span>' : ''}
              <button type="button" class="btn btn-link btn-pequeno" data-renomear title="Mudar o nome que aparece no sistema">✏️ nome</button></div>
            <div class="item-sub">${esc(p.email)} · desde ${formatarDataHora(p.criado_em)}</div>
          </div>
          <div class="item-acoes">
            <select data-papel aria-label="Papel" ${p.id === sessao.user.id ? 'disabled' : ''} style="width:auto;min-height:38px">
              <option value="atendente" ${p.papel === 'atendente' ? 'selected' : ''}>Atendente</option>
              <option value="admin" ${p.papel === 'admin' ? 'selected' : ''}>Administrador</option>
            </select>
            ${p.id === sessao.user.id ? '' : `<button class="btn ${p.ativo ? 'btn-sec' : 'btn-verde'} btn-pequeno" data-ativo>
              ${p.ativo ? '⛔ Desativar' : '✅ Reativar'}</button>`}
          </div>
        </li>`).join('')}</ul>

      <form data-form-convite novalidate style="margin-top:16px">
        <h3>Convidar atendente</h3>
        <div class="grade-2">
          <label class="campo"><span>Nome</span><input name="nome" required></label>
          <label class="campo"><span>E-mail</span><input name="email" type="email" required inputmode="email"></label>
        </div>
        <button class="btn btn-primario">✉️ Enviar convite</button>
        <p class="suave pequeno" style="margin-top:8px">A pessoa recebe um e-mail para criar a senha. Se o convite não funcionar,
          convide pelo painel do Supabase: <em>Authentication → Users → Invite user</em> (ela entra como atendente).</p>
      </form>
    </div>

    <div class="card">
      <h2>💾 Backup</h2>
      <p>Baixa todos os dados em arquivos CSV (abrem no Excel). Guarde em local seguro: contém dados de saúde (LGPD).</p>
      <button class="btn btn-sec btn-grande" data-backup>⬇ Exportar todos os dados</button>
      <a class="btn btn-sec btn-grande" href="#/importar">📥 Importar clientes (CSV)</a>
    </div>`;

  // Salvar configurações
  const fCfg = el.querySelector('[data-form-cfg]');
  fCfg.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = lerFormulario(fCfg);
    if (!d.nome_farmacia) return toast('Informe o nome da farmácia.', 'erro');
    const dados = {
      nome_farmacia: d.nome_farmacia,
      telefone_farmacia: d.telefone_farmacia,
      endereco: d.endereco,
      horario_funcionamento: d.horario_funcionamento,
      dias_antecedencia: Number(d.dias_antecedencia),
      dias_para_considerar_recompra: Number(d.dias_para_considerar_recompra),
      modo_envio: d.modo_envio,
      whatsapp_api_ativo: fCfg.whatsapp_api_ativo.checked,
      whatsapp_template_lembrete: d.whatsapp_template_lembrete || 'lembrete_medicamento',
      whatsapp_template_idioma: d.whatsapp_template_idioma || 'pt_BR',
    };
    await comBotaoOcupado(fCfg.querySelector('button'), async () => {
      const { error: erro } = await supabase.from('configuracoes').update(dados).eq('id', 1);
      if (erro) return mostrarErro(erro);
      limparCache();
      toast('Configurações salvas.' + (dados.dias_antecedencia !== cfg.dias_antecedencia ? ' Datas dos lembretes recalculadas.' : ''));
      const subtitulo = document.querySelector('[data-nome-farmacia]');
      if (subtitulo) subtitulo.textContent = dados.nome_farmacia;
      recarregar();
    }, 'Salvando...');
  });

  // Usuários: papel e ativo
  el.querySelectorAll('[data-perfil]').forEach((li) => {
    const p = perfis.find((x) => x.id === li.dataset.perfil);
    li.querySelector('[data-papel]').addEventListener('change', async (e) => {
      const { error: erro } = await supabase.from('perfis').update({ papel: e.target.value }).eq('id', p.id);
      if (erro) { mostrarErro(erro); e.target.value = p.papel; return; }
      toast('Papel atualizado.');
      p.papel = e.target.value;
    });
    li.querySelector('[data-renomear]').addEventListener('click', async () => {
      const novo = await abrirModal({
        titulo: 'Nome do usuário',
        html: `
          <form data-form novalidate>
            <label class="campo"><span>Nome que aparece no sistema</span>
              <input name="nome" required maxlength="60" value="${esc(p.nome)}" autocomplete="name"></label>
            <div class="acoes-modal">
              <button type="button" class="btn btn-sec" data-cancelar>Cancelar</button>
              <button type="submit" class="btn btn-primario">Salvar</button>
            </div>
          </form>`,
        aoAbrir(dlg, fechar) {
          const f = dlg.querySelector('[data-form]');
          f.nome.select();
          dlg.querySelector('[data-cancelar]').addEventListener('click', () => fechar());
          f.addEventListener('submit', (e) => {
            e.preventDefault();
            const nome = f.nome.value.trim();
            if (!nome) return toast('Digite um nome.', 'erro');
            fechar(nome);
          });
        },
      });
      if (!novo || novo === p.nome) return;
      const { error: erro } = await supabase.from('perfis').update({ nome: novo }).eq('id', p.id);
      if (erro) return mostrarErro(erro);
      toast('Nome atualizado.');
      if (p.id === sessao.user.id) {
        sessao.perfil.nome = novo;
        const topo = document.querySelector('[data-usuario]');
        if (topo) topo.innerHTML = `${esc(novo)}<br><small>Administrador</small>`;
      }
      recarregar();
    });

    li.querySelector('[data-ativo]')?.addEventListener('click', async () => {
      if (p.ativo && !(await confirmar({
        titulo: 'Desativar usuário', mensagem: `${p.nome || p.email} não vai mais conseguir acessar o sistema.`,
        botao: 'Desativar', perigo: true,
      }))) return;
      const { error: erro } = await supabase.from('perfis').update({ ativo: !p.ativo }).eq('id', p.id);
      if (erro) return mostrarErro(erro);
      toast(p.ativo ? 'Usuário desativado.' : 'Usuário reativado.');
      recarregar();
    });
  });

  // Convite (Edge Function convidar-usuario)
  const fConv = el.querySelector('[data-form-convite]');
  fConv.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fConv.reportValidity()) return;
    const d = lerFormulario(fConv);
    await comBotaoOcupado(fConv.querySelector('button'), async () => {
      const { data, error: erro } = await supabase.functions.invoke('convidar-usuario', {
        body: { email: d.email, nome: d.nome, redirectTo: new URL('index.html', location.href).href },
      });
      if (erro || data?.erro) {
        let msg = data?.erro;
        try { msg = msg || (await erro.context?.json())?.erro; } catch (_) { /* sem corpo */ }
        toast(msg || 'Não consegui enviar. A função "convidar-usuario" foi publicada? Use o painel do Supabase como alternativa.', 'erro', 7000);
        return;
      }
      toast(`Convite enviado para ${d.email}! ✉️`);
      fConv.reset();
      setTimeout(recarregar, 1500);
    }, 'Enviando...');
  });

  // Backup
  el.querySelector('[data-backup]').addEventListener('click', (e) => comBotaoOcupado(e.currentTarget, backup, 'Exportando...'));
}

/** Busca todas as linhas de uma tabela (de 1000 em 1000) */
async function buscarTudo(tabela) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from(tabela).select('*').range(de, de + 999);
    if (error) throw error;
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}

async function backup() {
  const tabelas = ['clientes', 'medicamentos_continuos', 'compras', 'lembretes', 'campanhas', 'campanha_envios', 'modelos_mensagem'];
  try {
    for (const t of tabelas) {
      const linhas = await buscarTudo(t);
      if (!linhas.length) continue;
      const colunas = Object.keys(linhas[0]).map((k) => ({
        chave: k, titulo: k, formatar: (v) => (Array.isArray(v) ? v.join(', ') : v),
      }));
      baixarArquivo(`backup-${t}-${hojeISO()}.csv`, gerarCSV(linhas, colunas));
      await new Promise((r) => setTimeout(r, 400)); // o navegador baixa um por vez
    }
    toast('Backup exportado! Confira a pasta Downloads.');
  } catch (e) {
    mostrarErro(e, 'Não foi possível exportar.');
  }
}
