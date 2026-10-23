// =====================================================================
// Edge Function: enviar-lembretes  (FASE 2 — opcional, começa desligada)
//
// Envia os lembretes do dia pela API OFICIAL do WhatsApp (Meta Cloud API),
// usando um template aprovado. É chamada todo dia às 09:00 (Fortaleza)
// pelo pg_cron (ver schema.sql, parte 10).
//
// Segredos necessários (Supabase > Edge Functions > Secrets):
//   WHATSAPP_TOKEN    token permanente do app da Meta
//   PHONE_NUMBER_ID   ID do número cadastrado no WhatsApp Business
//   CRON_SECRET       senha que o pg_cron envia no cabeçalho x-cron-secret
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente.)
//
// Template na Meta (categoria "Utilidade"), corpo com 4 variáveis:
//   {{1}} = primeiro nome   {{2}} = nome da farmácia
//   {{3}} = medicamento     {{4}} = data em que acaba (dd/mm/aaaa)
//
// Publicar:  supabase functions deploy enviar-lembretes --no-verify-jwt
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("PHONE_NUMBER_ID") ?? "";
const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0";

type LembreteHoje = {
  medicamento_id: string;
  cliente_id: string;
  cliente_nome: string;
  telefone: string;
  medicamento: string;
  proximo_fim: string; // AAAA-MM-DD
};

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// "2026-10-21" -> "21/10/2026"
function dataBR(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function primeiroNome(nome: string) {
  const p = (nome || "").trim().split(/\s+/)[0] ?? "";
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function preencher(texto: string, vars: Record<string, string>) {
  return texto.replace(/\{(\w+)\}/g, (t, chave) => vars[chave] ?? t);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  // 1) Só aceita chamadas do pg_cron (com a senha certa)
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return resposta({ erro: "Não autorizado" }, 401);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 2) Confere se o modo API está ligado
  const { data: cfg, error: erroCfg } = await db
    .from("configuracoes").select("*").eq("id", 1).single();
  if (erroCfg) return resposta({ erro: erroCfg.message }, 500);
  if (cfg.modo_envio !== "api" || !cfg.whatsapp_api_ativo) {
    return resposta({ ok: true, ignorado: "Modo de envio manual — nada a fazer." });
  }
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    return resposta({ erro: "Faltam os segredos WHATSAPP_TOKEN / PHONE_NUMBER_ID." }, 500);
  }

  // Texto do modelo padrão (só para registrar no histórico o que foi enviado)
  const { data: modelo } = await db
    .from("modelos_mensagem").select("texto")
    .eq("tipo", "lembrete").eq("padrao", true).maybeSingle();

  // 3) Lembretes de hoje (a view já exclui quem não autorizou ou pediu SAIR)
  const { data: lista, error: erroLista } = await db
    .from("vw_lembretes_hoje")
    .select("medicamento_id, cliente_id, cliente_nome, telefone, medicamento, proximo_fim")
    .limit(500);
  if (erroLista) return resposta({ erro: erroLista.message }, 500);

  let enviados = 0;
  let falhas = 0;

  for (const item of (lista ?? []) as LembreteHoje[]) {
    const nome = primeiroNome(item.cliente_nome);
    const dataFim = dataBR(item.proximo_fim);

    const corpo = {
      messaging_product: "whatsapp",
      to: item.telefone,
      type: "template",
      template: {
        name: cfg.whatsapp_template_lembrete,
        language: { code: cfg.whatsapp_template_idioma || "pt_BR" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: nome },
            { type: "text", text: cfg.nome_farmacia },
            { type: "text", text: item.medicamento },
            { type: "text", text: dataFim },
          ],
        }],
      },
    };

    let erro: string | null = null;
    try {
      const r = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(corpo),
        },
      );
      if (!r.ok) erro = `HTTP ${r.status}: ${(await r.text()).slice(0, 500)}`;
    } catch (e) {
      erro = String(e).slice(0, 500);
    }

    const mensagem = modelo?.texto
      ? preencher(modelo.texto, {
        nome,
        medicamento: item.medicamento,
        data_fim: dataFim,
        farmacia: cfg.nome_farmacia,
        telefone_farmacia: cfg.telefone_farmacia,
        endereco: cfg.endereco,
        horario: cfg.horario_funcionamento,
      })
      : null;

    // 4) Registra o resultado (um lembrete por ciclo — upsert)
    const { error: erroGravar } = await db.from("lembretes").upsert({
      medicamento_continuo_id: item.medicamento_id,
      cliente_id: item.cliente_id,
      data_prevista: item.proximo_fim,
      canal: "api_whatsapp",
      status: erro ? "pendente" : "enviado",
      erro,
      mensagem_enviada: mensagem,
      enviado_em: erro ? null : new Date().toISOString(),
    }, { onConflict: "medicamento_continuo_id,data_prevista" });

    if (erro || erroGravar) falhas++;
    else enviados++;

    await esperar(300); // não sobrecarregar a API
  }

  return resposta({ ok: true, total: lista?.length ?? 0, enviados, falhas });
});
