-- =====================================================================
--  FarmaLembra — lembretes de medicamentos de uso contínuo
--  Esquema completo do banco de dados (Supabase / Postgres)
--  (o mesmo arquivo serve para qualquer farmácia: o nome dela é
--   preenchido depois, na tela Configurações do sistema)
--
--  COMO USAR: copie TODO este arquivo, cole no "SQL Editor" do Supabase
--  e clique em "Run". Pode rodar de novo depois sem perder dados.
--
--  Fuso horário do sistema: America/Fortaleza
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. EXTENSÕES
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto;                        -- gen_random_uuid()
create extension if not exists pg_cron with schema pg_catalog;  -- tarefas agendadas
create extension if not exists pg_net  with schema extensions;  -- chamadas HTTP (envio automático)


-- ---------------------------------------------------------------------
-- 1. FUNÇÕES BÁSICAS
-- ---------------------------------------------------------------------

-- Data de "hoje" no fuso de Fortaleza (o servidor do Supabase usa UTC).
create or replace function public.hoje()
returns date
language sql stable
as $$ select (now() at time zone 'America/Fortaleza')::date $$;

-- Normaliza telefone para o formato E.164 sem o "+": 5598999999999.
-- Aceita "(98) 9 9999-9999", "98999999999", "+55 98 99999-9999" etc.
-- Números só com 8 ou 9 dígitos recebem o DDD 98.
create or replace function public.normalizar_telefone(p text)
returns text
language plpgsql immutable
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  d := regexp_replace(d, '^0+', '');                 -- tira zeros do início (ex.: 098...)
  if length(d) in (12, 13) and d like '55%' then
    return d;
  elsif length(d) in (10, 11) then
    return '55' || d;
  elsif length(d) in (8, 9) then
    return '5598' || d;
  end if;
  return d;                                           -- inválido: a constraint vai recusar
end $$;


-- ---------------------------------------------------------------------
-- 2. TABELAS
-- ---------------------------------------------------------------------

-- 2.1 Perfis dos usuários do sistema (1 linha por login)
create table if not exists public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null default '',
  email      text,
  papel      text not null default 'atendente' check (papel in ('admin', 'atendente')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- 2.2 Configurações (sempre UMA linha, id = 1)
create table if not exists public.configuracoes (
  id                            smallint primary key default 1 check (id = 1),
  nome_farmacia                 text not null default 'Minha Farmácia',
  telefone_farmacia             text not null default '',
  endereco                      text not null default '',
  horario_funcionamento         text not null default '',
  logo_url                      text not null default '',
  dias_antecedencia             int  not null default 5  check (dias_antecedencia between 0 and 60),
  dias_para_considerar_recompra int  not null default 10 check (dias_para_considerar_recompra between 1 and 90),
  modo_envio                    text not null default 'manual' check (modo_envio in ('manual', 'api')),
  whatsapp_api_ativo            boolean not null default false,
  whatsapp_template_lembrete    text not null default 'lembrete_medicamento',
  whatsapp_template_idioma      text not null default 'pt_BR',
  atualizado_em                 timestamptz not null default now()
);
insert into public.configuracoes (id) values (1) on conflict (id) do nothing;

-- 2.3 Clientes
create table if not exists public.clientes (
  id                     uuid primary key default gen_random_uuid(),
  nome                   text not null check (length(trim(nome)) > 0),
  telefone               text not null unique check (telefone ~ '^55\d{10,11}$'),
  data_nascimento        date,
  cpf                    text,
  endereco               text,
  bairro                 text,
  observacoes            text,
  tags                   text[] not null default '{}',
  consentimento_whatsapp boolean not null default false,
  consentimento_em       timestamptz,
  opt_out                boolean not null default false,
  opt_out_em             timestamptz,
  ativo                  boolean not null default true,
  criado_por             uuid default auth.uid() references public.perfis(id) on delete set null,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
create index if not exists clientes_nome_idx on public.clientes (lower(nome));
create index if not exists clientes_tags_idx on public.clientes using gin (tags);

-- 2.4 Medicamentos de uso contínuo de cada cliente
create table if not exists public.medicamentos_continuos (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references public.clientes(id) on delete cascade,
  medicamento       text not null check (length(trim(medicamento)) > 0),
  apresentacao      text,
  duracao_dias      int  not null default 30 check (duracao_dias between 1 and 365),
  quantidade_caixas int  not null default 1  check (quantidade_caixas between 1 and 50),
  ultima_compra     date not null default public.hoje(),
  -- Dia em que o remédio acaba (calculado pelo banco)
  proximo_fim       date generated always as (ultima_compra + duracao_dias * quantidade_caixas) stored,
  -- Dia de mandar o lembrete = proximo_fim - dias_antecedencia (calculado por trigger,
  -- porque os dias de antecedência ficam na tabela configuracoes)
  data_lembrete     date,
  ativo             boolean not null default true,
  observacoes       text,
  criado_por        uuid default auth.uid() references public.perfis(id) on delete set null,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index if not exists med_cliente_idx  on public.medicamentos_continuos (cliente_id);
create index if not exists med_lembrete_idx on public.medicamentos_continuos (data_lembrete) where ativo;

-- 2.5 Histórico de compras / recompras
create table if not exists public.compras (
  id                      uuid primary key default gen_random_uuid(),
  medicamento_continuo_id uuid not null references public.medicamentos_continuos(id) on delete cascade,
  cliente_id              uuid not null references public.clientes(id) on delete cascade,
  data_compra             date not null default public.hoje(),
  quantidade_caixas       int  not null default 1 check (quantidade_caixas between 1 and 50),
  registrado_por          uuid default auth.uid() references public.perfis(id) on delete set null,
  criado_em               timestamptz not null default now()
);
create index if not exists compras_cliente_idx on public.compras (cliente_id, data_compra desc);
create index if not exists compras_med_idx     on public.compras (medicamento_continuo_id);

-- 2.6 Lembretes (um por ciclo de compra: medicamento + data em que acaba)
create table if not exists public.lembretes (
  id                      uuid primary key default gen_random_uuid(),
  medicamento_continuo_id uuid not null references public.medicamentos_continuos(id) on delete cascade,
  cliente_id              uuid not null references public.clientes(id) on delete cascade,
  data_prevista           date not null,   -- = proximo_fim do ciclo
  status                  text not null default 'pendente'
                          check (status in ('pendente', 'enviado', 'recomprou', 'sem_retorno', 'cancelado')),
  canal                   text not null default 'manual_wa_me' check (canal in ('manual_wa_me', 'api_whatsapp')),
  mensagem_enviada        text,
  enviado_em              timestamptz,
  enviado_por             uuid references public.perfis(id) on delete set null,
  erro                    text,
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now(),
  -- Evita lembrete duplicado para o mesmo ciclo
  constraint lembretes_um_por_ciclo unique (medicamento_continuo_id, data_prevista)
);
create index if not exists lembretes_cliente_idx on public.lembretes (cliente_id);
create index if not exists lembretes_status_idx  on public.lembretes (status, enviado_em);

-- 2.7 Campanhas
create table if not exists public.campanhas (
  id                        uuid primary key default gen_random_uuid(),
  titulo                    text not null check (length(trim(titulo)) > 0),
  mensagem                  text not null,
  imagem_url                text,
  filtro_tags               text[] not null default '{}',
  filtro_aniversariantes_mes boolean not null default false,
  data_envio                date default public.hoje(),
  status                    text not null default 'rascunho' check (status in ('rascunho', 'enviando', 'concluida')),
  imagens                   text[] not null default '{}',  -- links das imagens (imagem_url = 1ª)
  imagens_por_link          boolean not null default true, -- true: link na mensagem; false: anexo manual
  clientes_excluidos        uuid[] not null default '{}',  -- desmarcados à mão
  clientes_incluidos        uuid[] not null default '{}',  -- adicionados à mão
  criado_por                uuid default auth.uid() references public.perfis(id) on delete set null,
  criado_em                 timestamptz not null default now()
);

-- (para bancos criados antes dessas colunas existirem)
alter table public.campanhas add column if not exists clientes_excluidos uuid[] not null default '{}';
alter table public.campanhas add column if not exists clientes_incluidos uuid[] not null default '{}';
alter table public.campanhas add column if not exists imagens text[] not null default '{}';
alter table public.campanhas add column if not exists imagens_por_link boolean not null default true;

-- 2.8 Envios de cada campanha (um por cliente)
create table if not exists public.campanha_envios (
  id          uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas(id) on delete cascade,
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  status      text not null default 'enviado' check (status in ('enviado', 'pulado', 'erro')),
  enviado_em  timestamptz,
  enviado_por uuid references public.perfis(id) on delete set null,
  constraint campanha_envios_unico unique (campanha_id, cliente_id)
);
create index if not exists campanha_envios_cliente_idx on public.campanha_envios (cliente_id);

-- 2.9 Modelos de mensagem
create table if not exists public.modelos_mensagem (
  id        uuid primary key default gen_random_uuid(),
  tipo      text not null check (tipo in ('lembrete', 'campanha', 'aniversario', 'boas_vindas')),
  titulo    text not null,
  texto     text not null,
  padrao    boolean not null default false,
  criado_em timestamptz not null default now()
);
-- Só um modelo "padrão" por tipo
create unique index if not exists modelos_um_padrao_por_tipo
  on public.modelos_mensagem (tipo) where padrao;


-- ---------------------------------------------------------------------
-- 3. FUNÇÕES DE PERMISSÃO (usadas no RLS)
-- ---------------------------------------------------------------------
create or replace function public.eh_usuario_ativo()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.perfis where id = auth.uid() and ativo) $$;

create or replace function public.eh_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel = 'admin') $$;


-- ---------------------------------------------------------------------
-- 4. TRIGGERS
-- ---------------------------------------------------------------------

-- 4.1 Cria o perfil automaticamente quando um usuário é criado no Auth.
--     O PRIMEIRO usuário vira admin; os demais entram como atendente.
create or replace function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.perfis (id, nome, email, papel)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''), split_part(new.email, '@', 1)),
    new.email,
    case when exists (select 1 from public.perfis where papel = 'admin') then 'atendente' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();

-- Usuários criados ANTES de rodar este SQL também ganham perfil
insert into public.perfis (id, nome, email)
select u.id, split_part(u.email, '@', 1), u.email
from auth.users u
on conflict (id) do nothing;

-- Se ainda não existe admin, o usuário mais antigo vira admin
update public.perfis set papel = 'admin'
where id = (select id from public.perfis order by criado_em limit 1)
  and not exists (select 1 from public.perfis where papel = 'admin');

-- 4.2 Impede ficar sem nenhum admin ativo
create or replace function public.proteger_ultimo_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.papel = 'admin' and old.ativo and (new.papel <> 'admin' or not new.ativo) then
    if not exists (select 1 from public.perfis
                   where papel = 'admin' and ativo and id <> old.id) then
      raise exception 'É preciso manter pelo menos um administrador ativo.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists perfis_proteger_admin on public.perfis;
create trigger perfis_proteger_admin
  before update on public.perfis
  for each row execute function public.proteger_ultimo_admin();

-- 4.3 Clientes: normaliza telefone e registra datas de consentimento / opt-out
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
    if new.opt_out then new.opt_out_em := coalesce(new.opt_out_em, now()); end if;
  else
    if new.consentimento_whatsapp and not old.consentimento_whatsapp then new.consentimento_em := now(); end if;
    if new.opt_out and not old.opt_out then new.opt_out_em := now(); end if;
  end if;

  if not new.consentimento_whatsapp then new.consentimento_em := null; end if;
  if not new.opt_out then new.opt_out_em := null; end if;
  return new;
end $$;

drop trigger if exists clientes_antes_salvar on public.clientes;
create trigger clientes_antes_salvar
  before insert or update on public.clientes
  for each row execute function public.clientes_antes_salvar();

-- 4.4 Medicamentos: calcula a data do lembrete
create or replace function public.medicamentos_antes_salvar()
returns trigger
language plpgsql
as $$
declare
  v_antecedencia int;
begin
  select dias_antecedencia into v_antecedencia from public.configuracoes where id = 1;
  -- (proximo_fim ainda não existe no BEFORE, então recalculamos aqui)
  new.data_lembrete := new.ultima_compra
                       + new.duracao_dias * new.quantidade_caixas
                       - coalesce(v_antecedencia, 5);
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists medicamentos_antes_salvar on public.medicamentos_continuos;
create trigger medicamentos_antes_salvar
  before insert or update on public.medicamentos_continuos
  for each row execute function public.medicamentos_antes_salvar();

-- 4.5 Ao cadastrar um medicamento, registra a primeira compra no histórico
create or replace function public.medicamentos_apos_inserir()
returns trigger
language plpgsql
as $$
begin
  insert into public.compras (medicamento_continuo_id, cliente_id, data_compra, quantidade_caixas, registrado_por)
  values (new.id, new.cliente_id, new.ultima_compra, new.quantidade_caixas, coalesce(auth.uid(), new.criado_por));
  return new;
end $$;

drop trigger if exists medicamentos_apos_inserir on public.medicamentos_continuos;
create trigger medicamentos_apos_inserir
  after insert on public.medicamentos_continuos
  for each row execute function public.medicamentos_apos_inserir();

-- 4.6 Se mudar os "dias de antecedência", recalcula todos os lembretes
create or replace function public.configuracoes_apos_atualizar()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.dias_antecedencia is distinct from old.dias_antecedencia then
    -- o trigger 4.4 recalcula data_lembrete de cada linha
    update public.medicamentos_continuos set atualizado_em = now();
  end if;
  return new;
end $$;

create or replace function public.configuracoes_antes_atualizar()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists configuracoes_antes_atualizar on public.configuracoes;
create trigger configuracoes_antes_atualizar
  before update on public.configuracoes
  for each row execute function public.configuracoes_antes_atualizar();

drop trigger if exists configuracoes_apos_atualizar on public.configuracoes;
create trigger configuracoes_apos_atualizar
  after update on public.configuracoes
  for each row execute function public.configuracoes_apos_atualizar();

-- 4.7 Compras: preenche o cliente e atualiza o medicamento e os lembretes
create or replace function public.compras_antes_inserir()
returns trigger
language plpgsql
as $$
begin
  select cliente_id into new.cliente_id
  from public.medicamentos_continuos where id = new.medicamento_continuo_id;
  return new;
end $$;

drop trigger if exists compras_antes_inserir on public.compras;
create trigger compras_antes_inserir
  before insert on public.compras
  for each row execute function public.compras_antes_inserir();

create or replace function public.compras_apos_inserir()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_prazo int;
begin
  select dias_para_considerar_recompra into v_prazo from public.configuracoes where id = 1;
  v_prazo := coalesce(v_prazo, 10);

  -- Começa um novo ciclo a partir desta compra
  update public.medicamentos_continuos m
     set ultima_compra     = new.data_compra,
         quantidade_caixas = new.quantidade_caixas,
         ativo             = true
   where m.id = new.medicamento_continuo_id
     and (m.ultima_compra < new.data_compra
          or (m.ultima_compra = new.data_compra and m.quantidade_caixas <> new.quantidade_caixas));

  -- Lembretes enviados: recomprou dentro do prazo? (senão: sem retorno)
  update public.lembretes l
     set status = case
                    when new.data_compra <= (l.enviado_em at time zone 'America/Fortaleza')::date + v_prazo
                    then 'recomprou' else 'sem_retorno'
                  end,
         atualizado_em = now()
   where l.medicamento_continuo_id = new.medicamento_continuo_id
     and l.status = 'enviado'
     and new.data_compra >= (l.enviado_em at time zone 'America/Fortaleza')::date;

  -- Lembretes que ficaram pendentes (ex.: erro na API) perdem o sentido
  update public.lembretes l
     set status = 'cancelado', atualizado_em = now()
   where l.medicamento_continuo_id = new.medicamento_continuo_id
     and l.status = 'pendente';

  return new;
end $$;

drop trigger if exists compras_apos_inserir on public.compras;
create trigger compras_apos_inserir
  after insert on public.compras
  for each row execute function public.compras_apos_inserir();

-- 4.8 Lembretes: só marca "enviado" se o cliente autorizou e não pediu SAIR
create or replace function public.lembretes_antes_salvar()
returns trigger
language plpgsql
as $$
declare
  v_ok boolean;
begin
  if new.cliente_id is null then
    select cliente_id into new.cliente_id
    from public.medicamentos_continuos where id = new.medicamento_continuo_id;
  end if;

  if new.status = 'enviado'
     and (tg_op = 'INSERT' or old.status <> 'enviado' or new.enviado_em is distinct from old.enviado_em) then
    select consentimento_whatsapp and not opt_out into v_ok
    from public.clientes where id = new.cliente_id;
    if not coalesce(v_ok, false) then
      raise exception 'Cliente sem consentimento para WhatsApp ou pediu para não receber mensagens.'
        using errcode = 'P0001';
    end if;
    new.enviado_em  := coalesce(new.enviado_em, now());
    new.enviado_por := coalesce(new.enviado_por, auth.uid());
  end if;

  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists lembretes_antes_salvar on public.lembretes;
create trigger lembretes_antes_salvar
  before insert or update on public.lembretes
  for each row execute function public.lembretes_antes_salvar();

-- 4.9 Envios de campanha: mesma regra de consentimento
create or replace function public.campanha_envios_antes_salvar()
returns trigger
language plpgsql
as $$
declare
  v_ok boolean;
begin
  if new.status = 'enviado' then
    select consentimento_whatsapp and not opt_out and ativo into v_ok
    from public.clientes where id = new.cliente_id;
    if not coalesce(v_ok, false) then
      raise exception 'Cliente sem consentimento para WhatsApp ou pediu para não receber mensagens.'
        using errcode = 'P0001';
    end if;
    new.enviado_em  := coalesce(new.enviado_em, now());
    new.enviado_por := coalesce(new.enviado_por, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists campanha_envios_antes_salvar on public.campanha_envios;
create trigger campanha_envios_antes_salvar
  before insert or update on public.campanha_envios
  for each row execute function public.campanha_envios_antes_salvar();


-- ---------------------------------------------------------------------
-- 5. VIEWS  (security_invoker = respeitam o RLS de quem consulta)
-- ---------------------------------------------------------------------

-- Base: ciclo atual de cada medicamento ativo, com o lembrete desse ciclo
create or replace view public.vw_ciclos with (security_invoker = true) as
select
  m.id                 as medicamento_id,
  m.cliente_id,
  c.nome               as cliente_nome,
  c.telefone,
  c.tags,
  (c.consentimento_whatsapp and not c.opt_out) as pode_receber,
  m.medicamento,
  m.apresentacao,
  m.duracao_dias,
  m.quantidade_caixas,
  m.ultima_compra,
  m.proximo_fim,
  m.data_lembrete,
  (m.proximo_fim - public.hoje()) as dias_restantes,
  l.id                 as lembrete_id,
  l.status             as lembrete_status,
  l.enviado_em,
  l.erro               as lembrete_erro
from public.medicamentos_continuos m
join public.clientes c on c.id = m.cliente_id
left join public.lembretes l
       on l.medicamento_continuo_id = m.id and l.data_prevista = m.proximo_fim
where m.ativo and c.ativo;

-- Lembretes para enviar hoje: chegou a data, ainda não enviado neste ciclo,
-- cliente autorizou e não pediu SAIR. (Ignora remédios que acabaram há mais
-- de 30 dias — esses aparecem em "Atrasados" / "Clientes sumidos".)
create or replace view public.vw_lembretes_hoje with (security_invoker = true) as
select *
from public.vw_ciclos
where data_lembrete <= public.hoje()
  and proximo_fim  >= public.hoje() - 30
  and pode_receber
  and (lembrete_status is null or lembrete_status = 'pendente');

-- Lembretes que vencem nos próximos 7 dias
create or replace view public.vw_proximos_7_dias with (security_invoker = true) as
select *
from public.vw_ciclos
where data_lembrete >  public.hoje()
  and data_lembrete <= public.hoje() + 7;

-- Atrasados: o remédio já acabou (últimos 60 dias) e o cliente não recomprou
create or replace view public.vw_atrasados with (security_invoker = true) as
select *
from public.vw_ciclos
where proximo_fim <  public.hoje()
  and proximo_fim >= public.hoje() - 60;

-- Aniversariantes do mês
create or replace view public.vw_aniversariantes_mes with (security_invoker = true) as
select
  c.id,
  c.nome,
  c.telefone,
  c.data_nascimento,
  c.tags,
  (c.consentimento_whatsapp and not c.opt_out) as pode_receber,
  extract(day from c.data_nascimento)::int as dia,
  (extract(year from public.hoje()) - extract(year from c.data_nascimento))::int as idade
from public.clientes c
where c.ativo
  and c.data_nascimento is not null
  and extract(month from c.data_nascimento) = extract(month from public.hoje());

-- Clientes sumidos: sem nenhuma compra há mais de 60 dias
create or replace view public.vw_clientes_sumidos with (security_invoker = true) as
select
  c.id,
  c.nome,
  c.telefone,
  (c.consentimento_whatsapp and not c.opt_out) as pode_receber,
  max(co.data_compra) as ultima_compra,
  (public.hoje() - max(co.data_compra)) as dias_sem_comprar
from public.clientes c
join public.compras co on co.cliente_id = c.id
where c.ativo
group by c.id
having max(co.data_compra) < public.hoje() - 60;


-- ---------------------------------------------------------------------
-- 6. FUNÇÕES CHAMADAS PELO SITE (RPC)
-- ---------------------------------------------------------------------

-- Marca o lembrete do ciclo atual de um medicamento (enviado, cancelado...)
create or replace function public.marcar_lembrete(
  p_medicamento_id uuid,
  p_status         text,
  p_mensagem       text default null,
  p_canal          text default 'manual_wa_me'
)
returns public.lembretes
language plpgsql security invoker set search_path = public
as $$
declare
  v_med public.medicamentos_continuos;
  v_l   public.lembretes;
begin
  select * into v_med from public.medicamentos_continuos where id = p_medicamento_id;
  if not found then
    raise exception 'Medicamento não encontrado.';
  end if;

  insert into public.lembretes as l
    (medicamento_continuo_id, cliente_id, data_prevista, status, canal, mensagem_enviada, enviado_em, enviado_por)
  values
    (v_med.id, v_med.cliente_id, v_med.proximo_fim, p_status, p_canal, p_mensagem,
     case when p_status = 'enviado' then now() end,
     case when p_status = 'enviado' then auth.uid() end)
  on conflict (medicamento_continuo_id, data_prevista) do update set
    status           = excluded.status,
    canal            = excluded.canal,
    mensagem_enviada = coalesce(excluded.mensagem_enviada, l.mensagem_enviada),
    enviado_em       = coalesce(excluded.enviado_em, l.enviado_em),
    enviado_por      = coalesce(excluded.enviado_por, l.enviado_por),
    erro             = null
  returning * into v_l;

  return v_l;
end $$;

-- Nome, telefone e endereço da farmácia para a tela de login e a Política de
-- Privacidade (que abrem SEM login). Só informação pública — nada de clientes.
create or replace function public.dados_publicos_farmacia()
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object('nome', nome_farmacia, 'telefone', telefone_farmacia, 'endereco', endereco)
  from public.configuracoes where id = 1
$$;

-- Página pública de fotos da promoção (link enviado no WhatsApp):
-- devolve SÓ as imagens da campanha pedida, mais nada.
create or replace function public.imagens_campanha(p_id uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object('imagens', imagens)
  from public.campanhas
  where id = p_id
$$;

-- Marca como "sem_retorno" os lembretes enviados há mais de X dias sem recompra.
-- Roda todo dia pelo pg_cron e também quando o painel é aberto.
create or replace function public.atualizar_status_lembretes()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_qtd int;
begin
  if auth.uid() is not null and not public.eh_usuario_ativo() then
    return 0;
  end if;

  update public.lembretes l
     set status = 'sem_retorno', atualizado_em = now()
    from public.configuracoes c
   where c.id = 1
     and l.status = 'enviado'
     and (l.enviado_em at time zone 'America/Fortaleza')::date + c.dias_para_considerar_recompra < public.hoje();

  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

-- Números do painel inicial, numa chamada só
create or replace function public.resumo_painel()
returns json
language sql stable security invoker set search_path = public
as $$
  with mes as (
    select status from public.lembretes
    where enviado_em is not null
      and date_trunc('month', enviado_em at time zone 'America/Fortaleza')
          = date_trunc('month', public.hoje()::timestamp)
  )
  select json_build_object(
    'hoje',                (select count(*) from public.vw_lembretes_hoje),
    'atrasados',           (select count(*) from public.vw_atrasados),
    'proximos_7_dias',     (select count(*) from public.vw_proximos_7_dias),
    'clientes_ativos',     (select count(*) from public.clientes where ativo),
    'aniversariantes_mes', (select count(*) from public.vw_aniversariantes_mes),
    'enviados_mes',        (select count(*) from mes where status in ('enviado', 'recomprou', 'sem_retorno')),
    'recompras_mes',       (select count(*) from mes where status = 'recomprou')
  )
$$;

-- Público de uma campanha (só quem autorizou e não pediu SAIR)
create or replace function public.clientes_publico(
  p_tags            text[]  default '{}',
  p_aniversariantes boolean default false
)
returns setof public.clientes
language sql stable security invoker set search_path = public
as $$
  select c.*
  from public.clientes c
  where c.ativo
    and c.consentimento_whatsapp
    and not c.opt_out
    and (coalesce(cardinality(p_tags), 0) = 0 or c.tags && p_tags)
    and (not coalesce(p_aniversariantes, false)
         or (c.data_nascimento is not null
             and extract(month from c.data_nascimento) = extract(month from public.hoje())))
  order by c.nome
$$;

-- Relatório: lembretes enviados x recompras por mês
create or replace function public.relatorio_mensal(p_meses int default 6)
returns table (mes date, enviados int, recompras int, sem_retorno int, aguardando int)
language sql stable security invoker set search_path = public
as $$
  with meses as (
    select generate_series(
             date_trunc('month', public.hoje()::timestamp) - make_interval(months => p_meses - 1),
             date_trunc('month', public.hoje()::timestamp),
             interval '1 month')::date as mes
  )
  select
    m.mes,
    count(l.id) filter (where l.status in ('enviado', 'recomprou', 'sem_retorno'))::int,
    count(l.id) filter (where l.status = 'recomprou')::int,
    count(l.id) filter (where l.status = 'sem_retorno')::int,
    count(l.id) filter (where l.status = 'enviado')::int
  from meses m
  left join public.lembretes l
    on l.enviado_em is not null
   and date_trunc('month', l.enviado_em at time zone 'America/Fortaleza')::date = m.mes
  group by m.mes
  order by m.mes
$$;

-- Relatório: clientes que mais compram
create or replace function public.relatorio_top_clientes(p_limite int default 10, p_dias int default 365)
returns table (cliente_id uuid, nome text, telefone text, total_compras int, ultima_compra date)
language sql stable security invoker set search_path = public
as $$
  select c.id, c.nome, c.telefone, count(co.id)::int, max(co.data_compra)
  from public.compras co
  join public.clientes c on c.id = co.cliente_id
  where co.data_compra >= public.hoje() - p_dias
  group by c.id
  order by count(co.id) desc, max(co.data_compra) desc
  limit p_limite
$$;

-- Relatório: medicamentos mais frequentes
create or replace function public.relatorio_top_medicamentos(p_limite int default 10)
returns table (medicamento text, clientes int, compras int)
language sql stable security invoker set search_path = public
as $$
  select
    min(m.medicamento),
    count(distinct m.cliente_id)::int,
    count(co.id)::int
  from public.medicamentos_continuos m
  left join public.compras co on co.medicamento_continuo_id = m.id
  group by upper(trim(m.medicamento))
  order by count(distinct m.cliente_id) desc, count(co.id) desc
  limit p_limite
$$;


-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY (RLS)
--    - Só usuários logados E ativos veem os dados.
--    - Atendente: cadastra, edita e envia.
--    - Admin: além disso, exclui, mexe em configurações e usuários.
-- ---------------------------------------------------------------------

-- 7.1 Perfis
alter table public.perfis enable row level security;
drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis
  for select to authenticated
  using (id = auth.uid() or public.eh_usuario_ativo());
drop policy if exists perfis_admin_atualiza on public.perfis;
create policy perfis_admin_atualiza on public.perfis
  for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- 7.2 Configurações
alter table public.configuracoes enable row level security;
drop policy if exists configuracoes_ler on public.configuracoes;
create policy configuracoes_ler on public.configuracoes
  for select to authenticated using (public.eh_usuario_ativo());
drop policy if exists configuracoes_admin_atualiza on public.configuracoes;
create policy configuracoes_admin_atualiza on public.configuracoes
  for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- 7.3 Demais tabelas (mesmo padrão)
do $$
declare
  t text;
begin
  foreach t in array array[
    'clientes', 'medicamentos_continuos', 'compras', 'lembretes',
    'campanhas', 'campanha_envios', 'modelos_mensagem'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.eh_usuario_ativo())',
                   t || '_ler', t);

    execute format('drop policy if exists %I on public.%I', t || '_inserir', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.eh_usuario_ativo())',
                   t || '_inserir', t);

    -- Compras: só o admin corrige; nas outras, qualquer usuário ativo edita
    execute format('drop policy if exists %I on public.%I', t || '_atualizar', t);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                   t || '_atualizar', t,
                   case when t = 'compras' then 'public.eh_admin()' else 'public.eh_usuario_ativo()' end,
                   case when t = 'compras' then 'public.eh_admin()' else 'public.eh_usuario_ativo()' end);

    execute format('drop policy if exists %I on public.%I', t || '_excluir', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.eh_admin())',
                   t || '_excluir', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 8. PERMISSÕES (anon = visitante sem login não acessa nada)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.hoje(),
  public.normalizar_telefone(text),
  public.eh_usuario_ativo(),
  public.eh_admin(),
  public.marcar_lembrete(uuid, text, text, text),
  public.atualizar_status_lembretes(),
  public.resumo_painel(),
  public.clientes_publico(text[], boolean),
  public.relatorio_mensal(int),
  public.relatorio_top_clientes(int, int),
  public.relatorio_top_medicamentos(int)
to authenticated;

-- Única coisa que o visitante sem login pode ler: nome/telefone/endereço da farmácia
grant execute on function public.dados_publicos_farmacia() to anon, authenticated;
grant execute on function public.imagens_campanha(uuid) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 9. MODELOS DE MENSAGEM PADRÃO
-- ---------------------------------------------------------------------
insert into public.modelos_mensagem (tipo, titulo, texto, padrao)
select v.tipo, v.titulo, v.texto, v.padrao
from (values
  ('lembrete', 'Lembrete de recompra',
   'Olá, {nome}! 😊 Aqui é da {farmacia}. Seu medicamento de uso contínuo ({medicamento}) deve estar acabando por volta de {data_fim}. Já podemos separar para você! Passe aqui ou responda esta mensagem. 💙 Para não receber mais lembretes, responda SAIR.',
   true),
  ('aniversario', 'Feliz aniversário',
   'Feliz aniversário, {nome}! 🎉 Toda a equipe da {farmacia} deseja um novo ano cheio de saúde, paz e alegria. Conte sempre com a gente! 💙 Para não receber mais mensagens, responda SAIR.',
   true),
  ('boas_vindas', 'Boas-vindas',
   'Olá, {nome}! 😊 Seja bem-vindo(a) à {farmacia}! A partir de agora vamos te avisar quando seu medicamento de uso contínuo estiver perto de acabar. Estamos em {endereco}, {horario}. Dúvidas? Chame aqui ou ligue {telefone_farmacia}. Para não receber mensagens, responda SAIR.',
   true),
  ('campanha', 'Sexta-feira da Fralda',
   'Oi, {nome}! 👶 Hoje é *Sexta-feira da Fralda* na {farmacia}! Fraldas, lenços e cuidados para o bebê com condições especiais. Venha conferir: {endereco}, {horario}. Para não receber mais mensagens, responda SAIR.',
   true)
) as v(tipo, titulo, texto, padrao)
-- Só cria o modelo se ainda não existir nenhum daquele tipo
-- (assim, rodar o arquivo de novo não duplica nem desfaz o que a farmácia editou)
where not exists (
  select 1 from public.modelos_mensagem mm where mm.tipo = v.tipo
);


-- ---------------------------------------------------------------------
-- 10. TAREFAS AGENDADAS (pg_cron)
-- ---------------------------------------------------------------------

-- 10.1 Chama a Edge Function "enviar-lembretes" (fase 2 — API oficial).
--      Só faz algo se:
--        * configuracoes.modo_envio = 'api' e whatsapp_api_ativo = true; e
--        * os segredos "farmalembra_url" e "farmalembra_cron_secret" existirem
--          no Vault (ver README, parte 9).
--      Enquanto isso não for configurado, ela simplesmente não faz nada.
create or replace function public.disparar_envio_automatico()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  if not exists (select 1 from public.configuracoes
                 where id = 1 and modo_envio = 'api' and whatsapp_api_ativo) then
    return;
  end if;

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'farmalembra_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'farmalembra_cron_secret';
  if v_url is null or v_secret is null then
    raise notice 'Envio automático: segredos do Vault não configurados.';
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/functions/v1/enviar-lembretes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;

revoke execute on function public.disparar_envio_automatico() from public, anon, authenticated;

-- 10.2 Agendamentos (rodar de novo apenas atualiza)
--  * 00:05 de Fortaleza (03:05 UTC): marca lembretes "sem retorno"
--  * 09:00 de Fortaleza (12:00 UTC): envio automático (se ligado)
select cron.schedule('farmalembra-status-diario', '5 3 * * *',
                     $$ select public.atualizar_status_lembretes(); $$);
select cron.schedule('farmalembra-envio-automatico', '0 12 * * *',
                     $$ select public.disparar_envio_automatico(); $$);

-- ---------------------------------------------------------------------
-- 11. IMAGENS DAS CAMPANHAS (Supabase Storage)
--     Pasta pública (o WhatsApp precisa abrir o link da imagem).
--     Use só imagens de produtos/eventos — nunca receitas ou fotos de clientes.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campanhas', 'campanhas', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists campanhas_imagens_ver on storage.objects;
create policy campanhas_imagens_ver on storage.objects
  for select to authenticated
  using (bucket_id = 'campanhas' and public.eh_usuario_ativo());

drop policy if exists campanhas_imagens_enviar on storage.objects;
create policy campanhas_imagens_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'campanhas' and public.eh_usuario_ativo());

drop policy if exists campanhas_imagens_apagar on storage.objects;
create policy campanhas_imagens_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'campanhas' and public.eh_usuario_ativo());

-- Fim do arquivo ✅
