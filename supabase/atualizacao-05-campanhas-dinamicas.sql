-- =====================================================================
--  FarmaLembra — Atualização 05: módulo de campanhas dinâmicas
--
--  - Campanhas com categoria, descrição, data inicial e final
--  - Status: rascunho / ativa / encerrada  (+ arquivar, duplicar)
--  - Consentimento SEPARADO para publicidade (LGPD)
--  - Registro interno de cada envio manual (quem, quando, para quem),
--    sem afirmar que a mensagem foi entregue
--  - Só o ADMINISTRADOR cria/edita campanhas; atendente consulta e envia
--
--  Cole tudo no SQL Editor do Supabase e clique em Run.
--  Pode rodar mais de uma vez. Não apaga nenhum dado.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) CONSENTIMENTO PARA PUBLICIDADE (separado do consentimento de lembretes)
-- ---------------------------------------------------------------------
-- Na primeira vez: quem já tinha autorizado WhatsApp continua recebendo
-- campanhas (o cadastro antigo dizia "lembretes e campanhas").
-- Para começar todos SEM autorização de publicidade, rode depois:
--   update public.clientes set consentimento_publicidade = false;
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clientes' and column_name = 'consentimento_publicidade'
  ) then
    alter table public.clientes add column consentimento_publicidade boolean not null default false;
    alter table public.clientes add column consentimento_publicidade_em timestamptz;
    update public.clientes
       set consentimento_publicidade = true,
           consentimento_publicidade_em = coalesce(consentimento_em, now())
     where consentimento_whatsapp;
  end if;
end $$;

create or replace function public.clientes_antes_salvar()
returns trigger
language plpgsql
as $$
begin
  new.telefone      := public.normalizar_telefone(new.telefone);
  new.nome          := trim(new.nome);
  new.atualizado_em := now();

  if tg_op = 'INSERT' then
    if new.consentimento_whatsapp then new.consentimento_em := coalesce(new.consentimento_em, now()); end if;
    if new.consentimento_publicidade then
      new.consentimento_publicidade_em := coalesce(new.consentimento_publicidade_em, now());
    end if;
    if new.opt_out then new.opt_out_em := coalesce(new.opt_out_em, now()); end if;
  else
    if new.consentimento_whatsapp and not old.consentimento_whatsapp then new.consentimento_em := now(); end if;
    if new.consentimento_publicidade and not old.consentimento_publicidade then
      new.consentimento_publicidade_em := now();
    end if;
    if new.opt_out and not old.opt_out then new.opt_out_em := now(); end if;
  end if;

  if not new.consentimento_whatsapp then new.consentimento_em := null; end if;
  if not new.consentimento_publicidade then new.consentimento_publicidade_em := null; end if;
  if not new.opt_out then new.opt_out_em := null; end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 2) CAMPANHAS: novos campos
-- ---------------------------------------------------------------------
alter table public.campanhas add column if not exists categoria           text not null default 'Personalizada';
alter table public.campanhas add column if not exists descricao           text;
alter table public.campanhas add column if not exists data_inicio         date;
alter table public.campanhas add column if not exists data_fim            date;
alter table public.campanhas add column if not exists filtro_cadastro_de  date;
alter table public.campanhas add column if not exists filtro_cadastro_ate date;
alter table public.campanhas add column if not exists arquivada_em        timestamptz;
alter table public.campanhas add column if not exists origem_id           uuid references public.campanhas(id) on delete set null;
alter table public.campanhas add column if not exists atualizado_em       timestamptz not null default now();
alter table public.campanhas add column if not exists atualizado_por      uuid references public.perfis(id) on delete set null;

-- Campanhas antigas: a data inicial passa a ser a antiga "data da promoção"
update public.campanhas
   set data_inicio = coalesce(data_envio, (criado_em at time zone 'America/Fortaleza')::date)
 where data_inicio is null;
alter table public.campanhas alter column data_inicio set default public.hoje();
alter table public.campanhas alter column data_inicio set not null;

-- Status novos: rascunho / ativa / encerrada
alter table public.campanhas drop constraint if exists campanhas_status_check;
update public.campanhas
   set status = case status when 'enviando' then 'ativa' when 'concluida' then 'encerrada' else status end
 where status in ('enviando', 'concluida');
alter table public.campanhas alter column status set default 'rascunho';
alter table public.campanhas add constraint campanhas_status_check
  check (status in ('rascunho', 'ativa', 'encerrada'));

-- Regras (NOT VALID = valem para o que for salvo daqui em diante,
-- sem travar a atualização por causa de campanhas antigas)
alter table public.campanhas drop constraint if exists campanhas_periodo_ok;
alter table public.campanhas add constraint campanhas_periodo_ok
  check (data_fim is null or data_fim >= data_inicio) not valid;

alter table public.campanhas drop constraint if exists campanhas_cadastro_ok;
alter table public.campanhas add constraint campanhas_cadastro_ok
  check (filtro_cadastro_de is null or filtro_cadastro_ate is null or filtro_cadastro_ate >= filtro_cadastro_de) not valid;

alter table public.campanhas drop constraint if exists campanhas_categoria_ok;
alter table public.campanhas add constraint campanhas_categoria_ok
  check (length(trim(categoria)) between 1 and 60) not valid;

alter table public.campanhas drop constraint if exists campanhas_tamanhos_ok;
alter table public.campanhas add constraint campanhas_tamanhos_ok
  check (length(titulo) <= 150 and length(mensagem) <= 4000 and length(coalesce(descricao, '')) <= 2000) not valid;

-- Campanha ativa ou encerrada precisa ter mensagem (rascunho pode ficar sem)
alter table public.campanhas drop constraint if exists campanhas_ativa_tem_mensagem;
alter table public.campanhas add constraint campanhas_ativa_tem_mensagem
  check (status = 'rascunho' or length(trim(mensagem)) > 0) not valid;

create index if not exists campanhas_criado_idx    on public.campanhas (criado_em desc);
create index if not exists campanhas_periodo_idx   on public.campanhas (data_inicio desc, data_fim);
create index if not exists campanhas_categoria_idx on public.campanhas (categoria);
create index if not exists campanhas_status_idx    on public.campanhas (status) where arquivada_em is null;

-- Antes de salvar: limpa textos, carimba quem alterou, mantém data_envio = data_inicio
create or replace function public.campanhas_antes_salvar()
returns trigger
language plpgsql
as $$
begin
  new.titulo         := trim(new.titulo);
  new.categoria      := coalesce(nullif(trim(new.categoria), ''), 'Personalizada');
  new.descricao      := nullif(trim(coalesce(new.descricao, '')), '');
  new.data_envio     := new.data_inicio;
  new.atualizado_em  := now();
  new.atualizado_por := auth.uid();
  if tg_op = 'INSERT' then
    new.criado_por := coalesce(auth.uid(), new.criado_por);
    new.criado_em  := now();
  else
    new.criado_por := old.criado_por;
    new.criado_em  := old.criado_em;
  end if;
  return new;
end $$;

drop trigger if exists campanhas_antes_salvar on public.campanhas;
create trigger campanhas_antes_salvar
  before insert or update on public.campanhas
  for each row execute function public.campanhas_antes_salvar();


-- ---------------------------------------------------------------------
-- 3) REGISTRO DOS ENVIOS MANUAIS
--    campanha_disparos         = cada vez que alguém clica em enviar
--    campanha_disparo_clientes = os clientes selecionados naquela vez
--    "whatsapp_aberto_em" = o sistema abriu o WhatsApp com a mensagem.
--    Isso NÃO garante que a mensagem foi enviada ou entregue.
-- ---------------------------------------------------------------------
create table if not exists public.campanha_disparos (
  id                 uuid primary key default gen_random_uuid(),
  campanha_id        uuid not null references public.campanhas(id) on delete cascade,
  canal              text not null check (canal in ('individual', 'transmissao')),
  mensagem           text not null check (length(mensagem) <= 5000),
  total_selecionados int  not null default 0 check (total_selecionados >= 0),
  criado_por         uuid default auth.uid() references public.perfis(id) on delete set null,
  criado_em          timestamptz not null default now()
);
create index if not exists campanha_disparos_campanha_idx on public.campanha_disparos (campanha_id, criado_em desc);

create table if not exists public.campanha_disparo_clientes (
  id                 uuid primary key default gen_random_uuid(),
  disparo_id         uuid not null references public.campanha_disparos(id) on delete cascade,
  cliente_id         uuid not null references public.clientes(id) on delete cascade,
  whatsapp_aberto_em timestamptz,
  constraint campanha_disparo_clientes_unico unique (disparo_id, cliente_id)
);
create index if not exists campanha_disparo_clientes_cliente_idx on public.campanha_disparo_clientes (cliente_id);

-- Só registra envio de campanha ATIVA, não arquivada e dentro do prazo
create or replace function public.campanha_disparos_antes_inserir()
returns trigger
language plpgsql
as $$
declare
  c record;
begin
  select status, arquivada_em, data_fim into c from public.campanhas where id = new.campanha_id;
  if not found then
    raise exception 'Campanha não encontrada.' using errcode = 'P0001';
  end if;
  if c.arquivada_em is not null then
    raise exception 'Esta campanha está arquivada. Desarquive para enviar.' using errcode = 'P0001';
  end if;
  if c.status <> 'ativa' then
    raise exception 'Só é possível enviar campanhas ativas.' using errcode = 'P0001';
  end if;
  if c.data_fim is not null and c.data_fim < public.hoje() then
    raise exception 'Esta campanha já terminou (data final passou).' using errcode = 'P0001';
  end if;
  new.criado_por := auth.uid();
  new.criado_em  := now();
  return new;
end $$;

drop trigger if exists campanha_disparos_antes_inserir on public.campanha_disparos;
create trigger campanha_disparos_antes_inserir
  before insert on public.campanha_disparos
  for each row execute function public.campanha_disparos_antes_inserir();

-- Cliente só entra se estiver ativo, autorizou campanhas (publicidade) e não pediu SAIR
create or replace function public.campanha_disparo_clientes_antes_salvar()
returns trigger
language plpgsql
as $$
declare
  v_ok boolean;
begin
  if tg_op = 'INSERT' then
    select ativo and consentimento_publicidade and not opt_out into v_ok
    from public.clientes where id = new.cliente_id;
    if not coalesce(v_ok, false) then
      raise exception 'Cliente sem autorização para receber campanhas (ou pediu para não receber).'
        using errcode = 'P0001';
    end if;
    if new.whatsapp_aberto_em is not null then new.whatsapp_aberto_em := now(); end if;
  else
    if new.disparo_id <> old.disparo_id or new.cliente_id <> old.cliente_id then
      raise exception 'Registro de envio não pode ser alterado.' using errcode = 'P0001';
    end if;
    -- a data de abertura é sempre a do servidor e não volta atrás
    if old.whatsapp_aberto_em is not null then
      new.whatsapp_aberto_em := old.whatsapp_aberto_em;
    elsif new.whatsapp_aberto_em is not null then
      new.whatsapp_aberto_em := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists campanha_disparo_clientes_antes_salvar on public.campanha_disparo_clientes;
create trigger campanha_disparo_clientes_antes_salvar
  before insert or update on public.campanha_disparo_clientes
  for each row execute function public.campanha_disparo_clientes_antes_salvar();

-- Mantém o resumo por cliente (campanha_envios, usado na ficha do cliente):
--   lista de transmissão  -> ao registrar
--   um por um             -> quando o WhatsApp é aberto para aquele cliente
create or replace function public.campanha_disparo_clientes_apos_salvar()
returns trigger
language plpgsql
as $$
declare
  d record;
begin
  select campanha_id, canal into d from public.campanha_disparos where id = new.disparo_id;
  if (d.canal = 'transmissao' and tg_op = 'INSERT')
     or (d.canal = 'individual' and new.whatsapp_aberto_em is not null
         and (tg_op = 'INSERT' or old.whatsapp_aberto_em is null)) then
    insert into public.campanha_envios (campanha_id, cliente_id, status, enviado_em, enviado_por)
    values (d.campanha_id, new.cliente_id, 'enviado', now(), auth.uid())
    on conflict (campanha_id, cliente_id)
    do update set status = 'enviado', enviado_em = now(), enviado_por = auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists campanha_disparo_clientes_apos_salvar on public.campanha_disparo_clientes;
create trigger campanha_disparo_clientes_apos_salvar
  after insert or update on public.campanha_disparo_clientes
  for each row execute function public.campanha_disparo_clientes_apos_salvar();

-- O resumo antigo também passa a exigir autorização de publicidade
create or replace function public.campanha_envios_antes_salvar()
returns trigger
language plpgsql
as $$
declare
  v_ok boolean;
begin
  if new.status = 'enviado' then
    select consentimento_publicidade and not opt_out and ativo into v_ok
    from public.clientes where id = new.cliente_id;
    if not coalesce(v_ok, false) then
      raise exception 'Cliente sem autorização para receber campanhas (ou pediu para não receber).'
        using errcode = 'P0001';
    end if;
    new.enviado_em  := coalesce(new.enviado_em, now());
    new.enviado_por := coalesce(new.enviado_por, auth.uid());
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 4) PÚBLICO DA CAMPANHA (só quem autorizou campanhas e não pediu SAIR)
-- ---------------------------------------------------------------------
drop function if exists public.clientes_publico(text[], boolean);
create or replace function public.clientes_publico(
  p_tags            text[]  default '{}',
  p_aniversariantes boolean default false,
  p_cadastro_de     date    default null,
  p_cadastro_ate    date    default null
)
returns setof public.clientes
language sql stable security invoker set search_path = public
as $$
  select c.*
  from public.clientes c
  where c.ativo
    and c.consentimento_publicidade
    and not c.opt_out
    and (coalesce(cardinality(p_tags), 0) = 0 or c.tags && p_tags)
    and (not coalesce(p_aniversariantes, false)
         or (c.data_nascimento is not null
             and extract(month from c.data_nascimento) = extract(month from public.hoje())))
    and (p_cadastro_de  is null or (c.criado_em at time zone 'America/Fortaleza')::date >= p_cadastro_de)
    and (p_cadastro_ate is null or (c.criado_em at time zone 'America/Fortaleza')::date <= p_cadastro_ate)
  order by c.nome
$$;


-- ---------------------------------------------------------------------
-- 5) SEGURANÇA (RLS)
-- ---------------------------------------------------------------------
-- Campanhas: todos os usuários ativos consultam; só o admin cria, edita e exclui
alter table public.campanhas enable row level security;
drop policy if exists campanhas_ler       on public.campanhas;
drop policy if exists campanhas_inserir   on public.campanhas;
drop policy if exists campanhas_atualizar on public.campanhas;
drop policy if exists campanhas_excluir   on public.campanhas;
create policy campanhas_ler on public.campanhas
  for select to authenticated using (public.eh_usuario_ativo());
create policy campanhas_inserir on public.campanhas
  for insert to authenticated with check (public.eh_admin());
create policy campanhas_atualizar on public.campanhas
  for update to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy campanhas_excluir on public.campanhas
  for delete to authenticated using (public.eh_admin());

-- Registros de envio: qualquer usuário ativo registra; ninguém altera; só o admin exclui
alter table public.campanha_disparos enable row level security;
drop policy if exists campanha_disparos_ler     on public.campanha_disparos;
drop policy if exists campanha_disparos_inserir on public.campanha_disparos;
drop policy if exists campanha_disparos_excluir on public.campanha_disparos;
create policy campanha_disparos_ler on public.campanha_disparos
  for select to authenticated using (public.eh_usuario_ativo());
create policy campanha_disparos_inserir on public.campanha_disparos
  for insert to authenticated with check (public.eh_usuario_ativo());
create policy campanha_disparos_excluir on public.campanha_disparos
  for delete to authenticated using (public.eh_admin());

-- Clientes de cada registro: quem criou o registro inclui e marca "WhatsApp aberto"
alter table public.campanha_disparo_clientes enable row level security;
drop policy if exists campanha_disparo_clientes_ler       on public.campanha_disparo_clientes;
drop policy if exists campanha_disparo_clientes_inserir   on public.campanha_disparo_clientes;
drop policy if exists campanha_disparo_clientes_atualizar on public.campanha_disparo_clientes;
drop policy if exists campanha_disparo_clientes_excluir   on public.campanha_disparo_clientes;
create policy campanha_disparo_clientes_ler on public.campanha_disparo_clientes
  for select to authenticated using (public.eh_usuario_ativo());
create policy campanha_disparo_clientes_inserir on public.campanha_disparo_clientes
  for insert to authenticated with check (
    public.eh_usuario_ativo()
    and exists (select 1 from public.campanha_disparos d where d.id = disparo_id and d.criado_por = auth.uid()));
create policy campanha_disparo_clientes_atualizar on public.campanha_disparo_clientes
  for update to authenticated
  using (public.eh_usuario_ativo()
    and exists (select 1 from public.campanha_disparos d where d.id = disparo_id and d.criado_por = auth.uid()))
  with check (public.eh_usuario_ativo()
    and exists (select 1 from public.campanha_disparos d where d.id = disparo_id and d.criado_por = auth.uid()));
create policy campanha_disparo_clientes_excluir on public.campanha_disparo_clientes
  for delete to authenticated using (public.eh_admin());

-- Permissões (visitante sem login não acessa nada)
revoke all on public.campanha_disparos, public.campanha_disparo_clientes from anon;
grant select, insert, delete on public.campanha_disparos to authenticated;
grant select, insert, update, delete on public.campanha_disparo_clientes to authenticated;

revoke execute on function public.clientes_publico(text[], boolean, date, date) from public, anon;
grant execute on function public.clientes_publico(text[], boolean, date, date) to authenticated;

-- Imagens das campanhas: só o admin envia, troca ou apaga
drop policy if exists campanhas_imagens_enviar on storage.objects;
create policy campanhas_imagens_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'campanhas' and public.eh_admin());

drop policy if exists campanhas_imagens_apagar on storage.objects;
create policy campanhas_imagens_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'campanhas' and public.eh_admin());

drop policy if exists campanhas_imagens_atualizar on storage.objects;
create policy campanhas_imagens_atualizar on storage.objects
  for update to authenticated
  using (bucket_id = 'campanhas' and public.eh_admin())
  with check (bucket_id = 'campanhas' and public.eh_admin());

-- Fim ✅
