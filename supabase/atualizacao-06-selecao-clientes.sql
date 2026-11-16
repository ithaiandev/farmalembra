-- =====================================================================
--  FarmaLembra — Atualização 06: escolher os clientes já no cadastro da campanha
--
--  publico_manual = true  -> a campanha vai só para os clientes escolhidos
--                            um a um (lista clientes_incluidos)
--  publico_manual = false -> vai para o público do filtro, tirando os
--                            desmarcados (clientes_excluidos) e somando os
--                            adicionados à mão (clientes_incluidos)
--
--  Precisa da atualização 05. Cole no SQL Editor e clique em Run.
--  Pode rodar mais de uma vez. Não apaga nenhum dado.
-- =====================================================================

alter table public.campanhas add column if not exists publico_manual boolean not null default false;

-- Fim ✅
