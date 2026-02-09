# Hidramais Disparo Ativo

Serviço webhook para processar eventos da VTEX, enriquecer dados quando necessário e disparar mensagens via Blip, com logs completos em Postgres (Prisma).

## Funcionalidades
1. Recebe webhook VTEX (`/webhook/vtex`).
2. Normaliza dados (nome, telefone, data).
3. Resolve template de mensagem por status.
4. Para `pedido_com_confirmacao_de_envio`, busca `trackingUrl` no OMS da VTEX caso não venha no webhook.
5. Envia campanha via Blip.
6. Salva logs completos no Postgres.

## Requisitos
1. Node.js 20+
2. Postgres

## Variáveis de ambiente
Crie um `.env` a partir do `.env.example` e preencha:

```
PORT=3000
BLIP_ENDPOINT=
BLIP_AUTH=
CAMPAIGN_NAME_PREFIX=Hidramais
FLOW_ID=
MASTERSTATE=
VTEX_BASE_URL=https://hidramais.vtexcommercestable.com.br
VTEX_APP_KEY=
VTEX_APP_TOKEN=
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public
```

## Instalação
```
npm install
```

## Banco de dados (Prisma)
1. Gerar client:
```
npx prisma generate
```

2. Criar tabelas:
```
npx prisma db push
```

Se preferir migrations formais:
```
npx prisma migrate dev --name init
```

## Rodar em desenvolvimento
```
npm run dev
```

## Build e produção
```
npm run build
npm start
```

## Docker
Build e run:
```
docker build -t hidramais-disparo-ativo .
docker run --env-file .env -p 3000:3000 hidramais-disparo-ativo
```

## Endpoint
`POST /webhook/vtex`

### Exemplo de payload
```
{
  "orderId": "1606420580989-01",
  "status": "ready-for-handling",
  "creationDate": "2026-01-27T18:14:13.7165141+00:00",
  "packageAttachment": {
    "packages": [
      { "trackingUrl": "https://transportadora.com/rastreio/123" }
    ]
  },
  "clientProfileData": {
    "firstName": "Renata",
    "lastName": "Costa",
    "email": "renata@email.com",
    "phone": "+55 (34) 99999-9999"
  }
}
```

## Template e parâmetros
O serviço envia `messageParams` com:
1. Nome
2. Número do pedido
3. Data da compra (`dd/MM/aaaa`)
4. `trackingUrl` (somente no template `pedido_com_confirmacao_de_envio`)

## Logs no banco
Tabela: `WebhookLog` (schema em `prisma/schema.prisma`), contendo:
1. Payload do webhook
2. Payload enviado ao Blip
3. Resposta do Blip
4. Payload do OMS VTEX (quando aplicável)
5. Erros e mensagens

## Observações
1. `trackingUrl` pode ser buscado no OMS VTEX quando necessário.
2. A data enviada ao Blip é sempre convertida para `dd/MM/aaaa` quando o valor parece data.

## Troubleshooting
1. **`The table public.WebhookLog does not exist`**  
   Execute `npx prisma db push` para criar as tabelas no banco.
2. **`Invalid database string`**  
   Verifique se `DATABASE_URL` está com caracteres escapados (ex.: `(` vira `%28`, `<` vira `%3C`, `?` vira `%3F`).
3. **Blip retorna erro 401/403**  
   Confirme `BLIP_ENDPOINT` e `BLIP_AUTH`.
4. **Erro ao buscar tracking da VTEX**  
   Verifique `VTEX_BASE_URL`, `VTEX_APP_KEY`, `VTEX_APP_TOKEN`.
5. **`trackingUrl` não aparece na mensagem**  
   O template precisa ser `pedido_com_confirmacao_de_envio` e o OMS precisa retornar a URL.

## Checklist de Deploy
1. `npm install`
2. Preencher `.env` com todas as variáveis obrigatórias
3. `npx prisma generate`
4. `npx prisma db push`
5. `npm run build`
6. `npm start` (ou via Docker)
