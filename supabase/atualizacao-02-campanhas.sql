-- =====================================================================
--  FarmaLembra — Atualização 02: campanhas com imagem e escolha de contatos
--
--  Para quem JÁ rodou o schema.sql antes. Cole tudo no SQL Editor e Run.
--  Pode rodar mais de uma vez sem problema. Não apaga nenhum dado.
-- =====================================================================

-- 1) Contatos tirados / adicionados à mão em cada campanha
alter table public.campanhas add column if not exists clientes_excluidos uuid[] not null default '{}';
alter table public.campanhas add column if not exists clientes_incluidos uuid[] not null default '{}';

-- 2) Pasta para as imagens das campanhas (Supabase Storage)
--    "public" = a imagem abre por link (precisa, para o WhatsApp mostrar).
--    Por isso: use só imagens de produtos/eventos, nunca receitas ou fotos de clientes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campanhas', 'campanhas', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Só usuários logados e ativos do sistema podem enviar ou apagar imagens
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

-- 3) Nome correto da campanha de fraldas (se ainda estiver com o nome antigo)
update public.modelos_mensagem
   set titulo = 'Sexta-feira da Fralda',
       texto  = 'Oi, {nome}! 👶 Hoje é *Sexta-feira da Fralda* na {farmacia}! Fraldas, lenços e cuidados para o bebê com condições especiais. Venha conferir: {endereco}, {horario}. Para não receber mais mensagens, responda SAIR.'
 where tipo = 'campanha' and titulo = 'Cesta da Fralda / Evento';

-- Fim ✅
