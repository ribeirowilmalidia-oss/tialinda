# Tia Linda Enxovais — E-commerce

Loja online em Node.js (Express + EJS) com banco MySQL (TiDB Cloud).
Setores: Cama, Mesa, Banho, Perfumaria & Cosméticos.

## Deploy no Render

1. **Criar banco de dados gratuito** em [TiDB Cloud Serverless](https://tidbcloud.com)
   - Crie um cluster Serverless (free)
   - Em "Connect", copie a **MySQL connection string**
   - Formato: `mysql://USUARIO:SENHA@HOST:4000/test?ssl={"rejectUnauthorized":true}`

2. **Conectar este repositório ao Render**
   - Acesse https://dashboard.render.com → **New +** → **Blueprint**
   - Selecione este repositório (`tialinda`)
   - O `render.yaml` é detectado automaticamente

3. **Configurar variáveis de ambiente** no painel do Render:
   - `DATABASE_URL` → cole a connection string do passo 1
   - `ADMIN_PASSWORD` → escolha uma senha segura
   - (já preenchidas) `PIX_KEY`, `PIX_NAME`, `PIX_CITY`

4. **Deploy automático** — o Render faz `npm install` + `node server.js`.
   - URL inicial: `https://tialinda.onrender.com`
   - Primeiro acesso cria as tabelas e popula com produtos exemplo.

5. **Domínio próprio** (`tialinda.com.br`)
   - No Render: **Settings** → **Custom Domains** → adicionar `tialinda.com.br` e `www.tialinda.com.br`
   - O Render mostra 2 registros DNS para colar no painel do Registro.br
   - HTTPS é gerado automaticamente em ~10 min

## Desenvolvimento local

```bash
npm install
# Sem DATABASE_URL → usa SQLite local (arquivo data.db)
npm start
# Site em http://localhost:3000
# Admin em http://localhost:3000/admin (senha: tialinda2026)
```

## Estrutura

| Caminho | Descrição |
|---|---|
| `server.js` | Express app principal (rotas, checkout, admin) |
| `db.js` | Adapter MySQL ↔ SQLite |
| `lib/payments.js` | Geração de PIX (BR Code/EMV) e boleto (FEBRABAN) |
| `views/` | Templates EJS |
| `public/` | CSS, imagens dos produtos |

## Categorias do site

- **Cama** — lençóis, mantas, edredons
- **Mesa** — toalhas, jogos
- **Banho** — toalhas, roupões, kits
- **Perfumaria** — essências, sabonetes
- **Cosméticos** — cuidados

## Contato

- WhatsApp: (13) 99655-4822
- E-mail: tialindasac@tialinda.com.br
- Site: https://tialinda.com.br
