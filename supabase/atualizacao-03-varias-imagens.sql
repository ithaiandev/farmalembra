-- =====================================================================
--  FarmaLembra — Atualização 03: várias imagens por campanha
--
--  Cole tudo no SQL Editor e Run. Pode rodar mais de uma vez.
--  Não apaga nenhum dado.
-- =====================================================================

-- 1) Lista de imagens da campanha (a coluna antiga imagem_url continua = 1ª imagem)
alter table public.campanhas add column if not exists imagens text[] not null default '{}';

-- Como as imagens vão para o cliente: true = link no fim da mensagem; false = anexo manual
alter table public.campanhas add column if not exists imagens_por_link boolean not null default true;

-- Campanhas antigas que tinham 1 imagem passam a tê-la na lista
update public.campanhas
   set imagens = array[imagem_url]
 where imagem_url is not null and cardinality(imagens) = 0;

-- 2) Página pública de fotos da promoção (link enviado no WhatsApp).
--    Devolve SÓ as imagens da campanha pedida (pelo código dela), mais nada.
create or replace function public.imagens_campanha(p_id uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object('imagens', imagens)
  from public.campanhas
  where id = p_id
$$;

revoke execute on function public.imagens_campanha(uuid) from public;
grant execute on function public.imagens_campanha(uuid) to anon, authenticated;

-- Fim ✅
