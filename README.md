# Hidramais Disparo Ativo

Serviço webhook para processar eventos da VTEX, enriquecer dados quando necessário e disparar mensagens via Blip, com logs completos em Postgres (Prisma).

## Funcionalidades
1. Recebe webhook VTEX (`/webhook/vtex`).
2. Normaliza dados (nome, telefone, data).
3. Resolve template de mensagem por status.
4. Para status de envio (`invoiced`/`shipped`), busca `trackingUrl` no OMS da VTEX caso não venha no webhook.
5. Se o `trackingUrl` for dos Correios, usa o template `envio_correios` e inclui o código de rastreio (`trackingNumber`).
6. Envia campanha via Blip.
7. Salva logs completos no Postgres.

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

## Rotas
### `POST /webhook/vtex`
- Uso: recebe webhook da VTEX para processar status do pedido e disparar mensagem no Blip.
- Autenticação: não exige token nesta rota (comportamento atual).
- Status processados: `ready-for-handling`, `handling`, `invoiced`, `shipped`.
- Respostas:
  - `200`: webhook processado (`handled: true`)
  - `202`: status ignorado (`handled: false`)
  - `502`: erro ao processar webhook
- Exemplo (`curl`):
```bash
curl -X POST http://localhost:3000/webhook/vtex \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "1600000000000-01",
    "status": "shipped",
    "creationDate": "2026-01-27T18:14:13.7165141+00:00",
    "packageAttachment": {
      "packages": [
        {
          "trackingUrl": "https://www2.correios.com.br/sistemas/rastreamento?objetos=AN60000000BR",
          "trackingNumber": "AN604000000BR"
        }
      ]
    },
    "clientProfileData": {
      "firstName": "Renata",
      "lastName": "Costa",
      "email": "renata@email.com",
      "phone": "+55 (34) 99999-9999"
    }
  }'
```

### `GET /api/vtex/orders/:pedidoId`
- Uso: consulta um pedido direto no OMS da VTEX e retorna um resumo (status, data, número, produtos e `urlRastreamento`).
- Autenticação: exige token em `x-api-token` ou `Authorization: Bearer <token>` (`API_ROUTE_TOKEN`).
- Respostas:
  - `200`: pedido encontrado e mapeado
  - `400`: `pedidoId` ausente
  - `401`: token inválido
  - `500`: `API_ROUTE_TOKEN` não configurado
  - `502`: falha ao consultar VTEX
- Exemplo (`curl` com header `x-api-token`):
```bash
curl -X GET "http://localhost:3000/api/vtex/orders/1600000000000-01" \
  -H "x-api-token: SEU_API_ROUTE_TOKEN"
```
- Exemplo (`curl` com Bearer token):
```bash
curl -X GET "http://localhost:3000/api/vtex/orders/16000000000000-01" \
  -H "Authorization: Bearer SEU_API_ROUTE_TOKEN"
```

### Exemplo de payload
```
{
    "ok": true,
    "pedidoId": "1600000000-01",
    "data": {
        "status": "Faturado",
        "dataCompra": "16/02/2026",
        "numeroPedido": "1600000000-01",
        "descricaoProduto": "• Creme Nano Enzimático 500g | Massagem Detox e Redutora\n• Creme Hipoalergênico para Massagem 1kg | Pele Protegida\n• Creme para Massagem SlimDetox 1kg | Redução de Medidas e Detox\n• Creme Bio Drenagem 500g | Massagem Drenante e Modeladora\n• Creme Massagem Localizada 1kg | Redução e Firmeza\n• Creme para Massagem Lipodetox 1kg | Drenagem e Firmeza\n• Óleo Corporal Cereja e Avelã | Hidratação e Perfume\n• Óleo Corporal Amêndoas e Colágeno 120ml | Hidratação e Elasticidade\n• Óleo Corporal Ameixa Negra 120ml | Hidratação e Perfume\n• Óleo Corporal Semente de Uva 120ml | Nutrição e Elasticidade",
        "urlRastreamento": "https://www2.correios.com.br/sistemas/rastreamento?objetos=AN600000BR"
    }
}
```

## Template e parâmetros
### Resolução de template por status
1. `ready-for-handling` / `handling` -> `pedido_ready_for_handling_v1`
2. `invoiced` / `shipped` + `trackingUrl` contendo `correios` -> `envio_correios`
3. `invoiced` / `shipped` (demais casos) -> `pedido_com_confirmacao_de_envio_v1`

### `messageParams` enviados ao Blip
O serviço envia:
1. Nome
2. Número do pedido
3. Data da compra (`dd/MM/aaaa`)
4. `trackingUrl` (templates de envio)
5. `trackingNumber` (somente no template `envio_correios`)

## Logs no banco
Tabela: `WebhookLog` (schema em `prisma/schema.prisma`), contendo:
1. Payload do webhook
2. Payload enviado ao Blip
3. Resposta do Blip
4. Payload do OMS VTEX (quando aplicável)
5. Erros e mensagens

## Observações
1. `trackingUrl` pode ser buscado no OMS VTEX quando necessário.
2. Para Correios, o serviço tenta obter `trackingNumber` do payload VTEX e faz fallback pela URL (`?objetos=`).
3. A data enviada ao Blip é sempre convertida para `dd/MM/aaaa` quando o valor parece data.

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
   O pedido precisa cair em um template de envio (`pedido_com_confirmacao_de_envio_v1` ou `envio_correios`) e o OMS/webhook precisa retornar a URL.
6. **Template `envio_correios` não dispara**  
   Verifique se o `trackingUrl` contém `correios` e se existe `trackingNumber` (ou código em `?objetos=` na URL).

## Checklist de Deploy
1. `npm install`
2. Preencher `.env` com todas as variáveis obrigatórias
3. `npx prisma generate`
4. `npx prisma db push`
5. `npm run build`
6. `npm start` (ou via Docker)
