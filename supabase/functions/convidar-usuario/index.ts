// =====================================================================
// Edge Function: convidar-usuario  (opcional)
//
// Permite que o ADMIN convide um atendente pela tela de Configurações.
// Convidar usuários exige a service_role key, que NUNCA pode ficar no
// site — por isso essa parte roda aqui, no servidor do Supabase.
//
// Publicar:  supabase functions deploy convidar-usuario
// (Sem publicar esta função, convide pelo painel do Supabase:
//  Authentication > Users > Invite user.)
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // 1) Quem está chamando?
  const authHeader = req.headers.get("Authorization") ?? "";
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await comoUsuario.auth.getUser();
  if (!user) return resposta({ erro: "Faça login novamente." }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 2) Precisa ser admin ativo
  const { data: perfil } = await admin
    .from("perfis").select("papel, ativo").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.ativo || perfil.papel !== "admin") {
    return resposta({ erro: "Apenas o administrador pode convidar usuários." }, 403);
  }

  // 3) Envia o convite por e-mail
  const { email, nome, redirectTo } = await req.json().catch(() => ({}));
  if (!email || !String(email).includes("@")) {
    return resposta({ erro: "Informe um e-mail válido." }, 400);
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(String(email).trim(), {
    data: { nome: nome ?? "" },
    redirectTo,
  });
  if (error) return resposta({ erro: error.message }, 400);

  return resposta({ ok: true });
});
