-- =====================================================================
--  FarmaLembra — Atualização 04: reforço de segurança
--
--  Cole tudo no SQL Editor e Run. Pode rodar mais de uma vez.
--  Não apaga nenhum dado e não muda os usuários que já existem.
-- =====================================================================

-- 1) Usuário novo só entra ATIVO se foi CONVIDADO (pela tela Configurações
--    ou por Authentication > Users > Invite user). O primeiro usuário do
--    sistema continua virando admin ativo.
--    Proteção extra: se um dia o "cadastro aberto" do Supabase for ligado por
--    engano, quem se cadastrar sozinho NÃO vê os dados dos clientes até o
--    admin reativar em Configurações > Usuários.
create or replace function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_tem_admin boolean := exists (select 1 from public.perfis where papel = 'admin');
begin
  insert into public.perfis (id, nome, email, papel, ativo)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''), split_part(new.email, '@', 1)),
    new.email,
    case when v_tem_admin then 'atendente' else 'admin' end,
    (not v_tem_admin) or new.invited_at is not null
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- 2) Funções e tabelas criadas NO FUTURO não ficam abertas para o visitante
--    sem login (o padrão do Postgres é liberar funções para todos).
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke all on tables from anon;

-- Fim ✅
