# FarmaLembra — Farmamax 💊

Sistema de **lembretes de medicamentos de uso contínuo** e **campanhas pelo WhatsApp** da
Farmamax (Paulino Neves – MA). Funciona no celular e no computador, direto pelo navegador.

- Cadastra clientes e os remédios que eles usam todo mês.
- Calcula quando o remédio vai acabar e mostra a lista de quem lembrar **5 dias antes** (configurável).
- Envia a mensagem pelo WhatsApp com um clique (link `wa.me`, grátis).
- Campanhas (Cesta da Fralda, eventos, aniversários), relatórios e backup.
- Opcional: envio **automático** pela API oficial do WhatsApp (já vem pronto, mas desligado).

---

## Sumário

1. [O que tem em cada pasta](#1-o-que-tem-em-cada-pasta)
2. [Criar o projeto no Supabase](#2-criar-o-projeto-no-supabase)
3. [Rodar o SQL (criar o banco)](#3-rodar-o-sql-criar-o-banco)
4. [Ajustar o login no Supabase](#4-ajustar-o-login-no-supabase)
5. [Criar o primeiro usuário (admin)](#5-criar-o-primeiro-usuário-admin)
6. [Configurar o `js/config.js`](#6-configurar-o-jsconfigjs)
7. [Testar no seu computador](#7-testar-no-seu-computador)
8. [Publicar o site de graça](#8-publicar-o-site-de-graça)
9. [Convidar atendentes](#9-convidar-atendentes)
10. [Testar o fluxo completo](#10-testar-o-fluxo-completo)
11. [(Opcional) Envio automático pela API oficial do WhatsApp](#11-opcional-envio-automático-pela-api-oficial-do-whatsapp)
12. [LGPD e Anvisa — cuidados](#12-lgpd-e-anvisa--cuidados)
13. [Problemas comuns](#13-problemas-comuns)

---

## 1. O que tem em cada pasta

```
index.html            tela de login (e "esqueci minha senha")
app.html              o sistema (painel, clientes, lembretes...)
privacidade.html      Política de Privacidade (pode mostrar ao cliente)
css/style.css         visual (cores, botões, modo escuro)
js/config.js          ⚠️ ÚNICO arquivo que você precisa editar
js/...                código do sistema (um arquivo por tela em js/pages/)
img/                  logo e ícones
manifest.json, sw.js  permitem "instalar" no celular
supabase/schema.sql   o banco de dados completo (colar no Supabase)
supabase/functions/   funções do servidor (convite de usuário e envio automático)
```

---

## 2. Criar o projeto no Supabase

1. Entre em <https://supabase.com> e faça login (pode usar a conta do GitHub).
2. Clique em **New project**.
3. Preencha:
   - **Name:** `farmalembra`
   - **Database Password:** crie uma senha forte e **guarde** (não vai ao site).
   - **Region:** `South America (São Paulo)`.
4. Clique em **Create new project** e espere uns 2 minutos.

> Use um projeto **separado** do da Barraca. Cada sistema no seu próprio projeto.

---

## 3. Rodar o SQL (criar o banco)

1. No menu da esquerda, abra **SQL Editor** → **New query**.
2. Abra o arquivo `supabase/schema.sql` no VS Code, selecione **tudo** (Ctrl+A), copie (Ctrl+C).
3. Cole no SQL Editor (Ctrl+V) e clique em **Run**.
4. Deve aparecer **Success**. Pronto: tabelas, regras de segurança, modelos de mensagem e
   tarefas agendadas foram criados.

> Pode rodar o arquivo de novo depois (por exemplo, numa atualização). Ele não apaga dados.

---

## 4. Ajustar o login no Supabase

Em **Authentication**:

1. **Sign In / Providers** (ou *Providers → Email*): **desligue** "Allow new users to sign up".
   Assim ninguém de fora cria conta; só você convida.
2. **URL Configuration:**
   - **Site URL:** o endereço do site publicado (passo 8), ex.: `https://farmamax.netlify.app`.
     Enquanto não publicar, use `http://127.0.0.1:5500`.
   - **Redirect URLs:** adicione os dois:
     - `http://127.0.0.1:5500/**`
     - `https://SEU-SITE/**` (o endereço publicado)

Isso faz os links de "esqueci minha senha" e de convite abrirem o seu site.

---

## 5. Criar o primeiro usuário (admin)

1. **Authentication → Users → Add user → Create new user**.
2. Coloque seu e-mail e uma senha, marque **Auto Confirm User** e clique em **Create user**.
3. Pronto: **o primeiro usuário vira administrador automaticamente.**

Para conferir (ou promover outra pessoa), rode no SQL Editor:

```sql
select nome, email, papel, ativo from perfis;

-- promover alguém a admin:
update perfis set papel = 'admin' where email = 'email@exemplo.com';
```

---

## 6. Configurar o `js/config.js`

1. No Supabase, abra **Project Settings → API** (em alguns painéis: **Data API** e **API Keys**).
2. Copie:
   - **Project URL** → ex.: `https://abcdxyz.supabase.co`
   - **anon public** key (ou **Publishable key**) → um texto longo.
3. Abra `js/config.js` e substitua:

```js
SUPABASE_URL: 'https://abcdxyz.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...sua-anon-key...',
NOME_FARMACIA: 'Farmamax',
TELEFONE_FARMACIA: '(98) 9 XXXX-XXXX',
```

> ⚠️ **Nunca** coloque a chave **service_role** / **secret** nesse arquivo. Ela dá acesso total
> ao banco. A anon key pode ficar no site porque o banco só libera dados para quem fez login
> (Row Level Security).

---

## 7. Testar no seu computador

1. Abra a pasta do projeto no VS Code.
2. Clique com o botão direito em `index.html` → **Open with Live Server**.
3. Entre com o e-mail e a senha do passo 5.
4. Vá em **Configurações** (menu ☰ Mais no celular) e preencha telefone, endereço e horário da
   farmácia — eles aparecem nas mensagens.

> Abrir o arquivo com dois cliques (`file://`) **não funciona**. Use o Live Server.

---

## 8. Publicar o site de graça

### Opção A — Netlify Drop (mais fácil)

1. Entre em <https://app.netlify.com/drop> (crie conta grátis).
2. Arraste a **pasta inteira** do projeto para a página.
3. Em segundos aparece o link (ex.: `https://nome-aleatorio.netlify.app`).
   Em **Site configuration → Change site name** você pode trocar para `farmamax`.
4. Volte ao passo 4 e coloque esse endereço em **Site URL** e **Redirect URLs**.

Para atualizar depois: **Deploys → arraste a pasta de novo**.

### Opção B — GitHub Pages

1. Crie um repositório novo no GitHub (ex.: `farmalembra`), **público**.
2. **Add file → Upload files** e envie todos os arquivos e pastas do projeto.
3. **Settings → Pages → Branch: main → / (root) → Save**.
4. O endereço será `https://SEU-USUARIO.github.io/farmalembra/`.
5. Volte ao passo 4 e cadastre esse endereço no Supabase.

> Importante: esta pasta está dentro da pasta do seu usuário do Windows, que também é um
> repositório git. Se for usar git pelo VS Code, rode `git init` **dentro desta pasta** antes,
> para ela ter o próprio repositório.

### Instalar no celular

Abra o site no Chrome do celular → menu **⋮** → **Adicionar à tela inicial**. Vira um app.

---

## 9. Convidar atendentes

**Jeito simples (sempre funciona):** Supabase → **Authentication → Users → Invite user** →
e-mail da atendente. Ela recebe um e-mail, clica, cria a senha e entra como **atendente**.

**Pelo próprio sistema (opcional):** publique a função `convidar-usuario`:

1. Supabase → **Edge Functions → Deploy a new function → Via Editor**.
2. Nome: `convidar-usuario`. Apague o código de exemplo e cole o conteúdo de
   `supabase/functions/convidar-usuario/index.ts`. Clique em **Deploy**.
3. Pronto: em **Configurações → Convidar atendente** o convite sai pelo sistema.

Para tirar o acesso de alguém: **Configurações → Usuários → Desativar**.

| O que pode | Atendente | Admin |
|---|---|---|
| Cadastrar/editar clientes, compras e medicamentos | ✅ | ✅ |
| Enviar lembretes e campanhas | ✅ | ✅ |
| Excluir dados, exportar CSV/backup, importar | — | ✅ |
| Configurações e usuários | — | ✅ |

---

## 10. Testar o fluxo completo

Use o **seu próprio WhatsApp** como cliente de teste.

1. **Cadastrar cliente:** Painel → **➕ Novo cliente**. Nome, seu número, marque
   **"Cliente autorizou receber mensagens"** → **Salvar e adicionar medicamento**.
2. **Registrar a compra:** no medicamento, coloque **Losartana**, "Uma caixa dura" = **30**,
   e mude a **Data da compra para 26 dias atrás**. Repare na linha azul: "Vai acabar em ... ·
   lembrete em ..." (o lembrete cai hoje, pois faltam 4 dias e o aviso é 5 dias antes).
   Salvar.
3. **Ver o lembrete aparecer:** vá em **Lembretes → Hoje**. Seu cliente está lá.
   (No Painel, o card "Lembretes para hoje" também conta.)
4. **Enviar:** clique em **💬 Enviar no WhatsApp**. Abre o WhatsApp com a mensagem pronta → envie.
   O lembrete sai da lista e vai para **Histórico** como **Enviado**.
5. **Recompra:** na ficha do cliente, clique **✓ Recomprou hoje**. O ciclo recomeça
   (acaba daqui a 30 dias) e o lembrete vira **Recomprou ✓** — isso entra na taxa de retorno
   do Painel e nos Relatórios.
6. **Fluxo de balcão:** menu **🛒 Compra** → digite o telefone → o sistema acha o cliente →
   **✓ Comprou hoje**. Leva menos de 30 segundos.
7. **Modo fila:** com vários lembretes no dia, use **▶ Modo fila**: envia um, volta para o
   navegador, e o próximo já está na tela.

---

## 11. (Opcional) Envio automático pela API oficial do WhatsApp

O modo manual (`wa.me`) é grátis e continua funcionando sempre. O automático envia sozinho
às **09:00 (horário de Fortaleza)**, mas exige conta na Meta, **CNPJ** e tem **custo por mensagem**
(veja a tabela de preços da Meta para o Brasil). Só use a API **oficial**: bibliotecas
"não oficiais" de WhatsApp podem fazer o número ser **banido**.

### 11.1 Na Meta

1. Em <https://business.facebook.com> crie/verifique o **Portfólio empresarial** da farmácia (CNPJ).
2. Em <https://developers.facebook.com> → **Meus apps → Criar app** → tipo **Empresa** →
   adicione o produto **WhatsApp**.
3. Em **WhatsApp → Configuração da API**, adicione o número da farmácia.
   ⚠️ Um número usado na API pode deixar de funcionar no aplicativo WhatsApp Business comum
   (a Meta tem a opção de "coexistência" em alguns casos). Se quiser segurança, use um
   **número separado** para a API.
4. Anote o **ID do número de telefone** (Phone Number ID).
5. Crie um **token permanente**: Configurações do negócio → **Usuários do sistema** → criar
   (Admin) → **Gerar token** para o app, com as permissões `whatsapp_business_messaging` e
   `whatsapp_business_management`.
6. No **WhatsApp Manager → Modelos de mensagem → Criar modelo**:
   - **Categoria:** Utilidade · **Nome:** `lembrete_medicamento` · **Idioma:** Português (BR)
   - **Corpo** (as 4 variáveis precisam estar nesta ordem):
     ```
     Olá, {{1}}! Aqui é da {{2}}. Seu medicamento de uso contínuo ({{3}}) deve estar acabando por volta de {{4}}. Já podemos separar para você! Passe aqui ou responda esta mensagem. Para não receber mais lembretes, responda SAIR.
     ```
   - {{1}} nome · {{2}} farmácia · {{3}} medicamento · {{4}} data.
   - Campanhas, se um dia quiser automatizar, usam categoria **Marketing** (mais caras).
7. Espere a aprovação (minutos a 1 dia).

### 11.2 No Supabase

1. **Edge Functions → Deploy a new function → Via Editor**, nome `enviar-lembretes`, cole o
   conteúdo de `supabase/functions/enviar-lembretes/index.ts` e faça **Deploy**.
   Depois, nos detalhes da função, **desligue "Verify JWT"** (Enforce JWT verification).
2. **Edge Functions → Secrets** (ou *Project Settings → Edge Functions*), adicione:
   - `WHATSAPP_TOKEN` = o token permanente
   - `PHONE_NUMBER_ID` = o ID do número
   - `CRON_SECRET` = uma senha longa inventada por você (ex.: 40 letras e números aleatórios)
3. No **SQL Editor**, rode (trocando os valores):
   ```sql
   select vault.create_secret('https://SEU-PROJETO.supabase.co', 'farmalembra_url');
   select vault.create_secret('A-MESMA-SENHA-DO-CRON_SECRET', 'farmalembra_cron_secret');
   ```
4. No sistema, **Configurações → Modo de envio → Automático** e marque
   **"API do WhatsApp configurada e liberada"**. Salve.

**Testar agora (sem esperar as 09:00):** cadastre seu número como cliente com um lembrete para
hoje e rode no SQL Editor:
```sql
select public.disparar_envio_automatico();
-- depois de alguns segundos, veja a resposta:
select status_code, content from net._http_response order by created desc limit 1;
```
O resultado também aparece em **Lembretes → Histórico** ("automático"). Se der erro, o lembrete
fica **Pendente** com a mensagem de erro e é tentado de novo no dia seguinte.

**Desligar:** volte o modo para **Manual**. Nada é enviado automaticamente.

Respostas "SAIR": a atendente abre a ficha do cliente e clica
**"Cliente pediu para não receber mensagens"**.

---

## 12. LGPD e Anvisa — cuidados

- Medicamento é **dado sensível de saúde**. Só envie mensagens para quem **autorizou**
  (a caixa de autorização registra a data). O banco **recusa** registrar envio para quem não
  autorizou ou pediu SAIR.
- Toda mensagem termina com "responda **SAIR**". Respeite sempre.
- Se o cliente pedir para apagar os dados: ficha → **Excluir cliente e todos os dados** (admin).
- Mostre a **Política de Privacidade** (`privacidade.html`) quando o cliente perguntar.
- Se preferir mais discrição (ex.: celular compartilhado na família), tire o `{medicamento}`
  do modelo de lembrete em **Modelos de mensagem**.
- **Anvisa:** em campanhas, promova fraldas, dermocosméticos, eventos. **Não anuncie
  medicamentos de prescrição (tarja).**
- Os arquivos de backup contêm dados de saúde: guarde em local seguro.

---

## 13. Problemas comuns

| Problema | Solução |
|---|---|
| Tela de login diz "Sistema ainda não configurado" | Preencha `js/config.js` (passo 6). |
| "Seu acesso está desativado" | O admin precisa reativar em Configurações → Usuários. Ou o SQL não foi rodado. |
| Painel não carrega os números | Rode o `schema.sql` de novo no SQL Editor e recarregue. |
| Link de "esqueci a senha" abre página errada | Ajuste Site URL / Redirect URLs (passo 4). |
| O WhatsApp não abre ao clicar | O navegador bloqueou a nova aba: permita pop-ups para o site. |
| Lembrete não aparece em "Hoje" | Confira: cliente com autorização, sem SAIR, medicamento ativo e data do lembrete já chegou. |
| Mudou algo e o celular mostra a versão antiga | Feche e abra o app de novo (ou recarregue a página). |

### Regras de cálculo (para referência)

- **Acaba em** = data da compra + (dias que uma caixa dura × caixas).
- **Lembrete em** = acaba em − dias de antecedência (Configurações, padrão 5).
- Lembrete **Recomprou** = cliente comprou até X dias depois do lembrete (padrão 10).
  Passou do prazo sem compra → **Sem retorno** (atualizado todo dia à meia-noite).
- Um lembrete por ciclo de compra: não há como mandar o mesmo lembrete duas vezes sem querer.
- "Hoje" ignora remédios que acabaram há mais de 30 dias; "Atrasados" mostra os últimos 60 dias;
  quem está há mais de 60 dias sem comprar aparece em **Relatórios → Clientes sumidos**.
