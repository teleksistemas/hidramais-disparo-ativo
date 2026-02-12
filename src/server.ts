import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { constrainedMemory } from "process";
import { formatDateIfValid } from "./utils/date.js";
import { Prisma, PrismaClient } from "@prisma/client";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use((req: Request, _res: Response, next: NextFunction) => {
  logInfo("Request recebido", {
    body: req.body,
  });
  next();
});
const prisma = new PrismaClient();

const allowedStatuses = new Set([
  "ready-for-handling",
  "handling",
  "invoiced",
  "shipped",
]);

type VtexWebhookPayload = {
  orderId?: string;
  status?: string;
  creationDate?: string;
  OrderId?: string;
  State?: string;
  LastState?: string;
  LastChange?: string;
  CurrentChange?: string;
  Domain?: string;
  Origin?: {
    Account?: string;
    Key?: string;
  } | null;
  packageAttachment?: {
    packages?: Array<{
      trackingUrl?: string | null;
    }> | null;
  } | null;
  clientProfileData?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
};

function normalizeStatus(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "invoice") return "invoiced";
  return s;
}

function extractStatus(payload: VtexWebhookPayload): string | null {
  return payload.status ?? payload.State ?? null;
}

function extractCustomerName(payload: VtexWebhookPayload): string | null {
  const firstName = payload.clientProfileData?.firstName?.trim();
  const lastName = payload.clientProfileData?.lastName?.trim();
  const full = [firstName, lastName].filter(Boolean).join(" ").trim();
  return full.length > 0 ? full : null;
}

function extractOrderNumber(payload: VtexWebhookPayload): string | null {
  return payload.orderId ?? payload.OrderId ?? null;
}

function extractPurchaseDate(payload: VtexWebhookPayload): string | null {
  return payload.creationDate ?? payload.CurrentChange ?? payload.LastChange ?? null;
}

function extractTrackingUrl(payload: VtexWebhookPayload): string | null {
  const packages = payload.packageAttachment?.packages ?? [];
  for (const pkg of packages) {
    const url = pkg?.trackingUrl ?? null;
    if (url) return url;
  }
  return null;
}

type BlipPayload = {
  id: string;
  to: string;
  method: "set";
  uri: string;
  type: string;
  resource: {
    campaign: {
      name: string;
      campaignType: "Batch";
      flowId: string;
      stateId: string;
      masterstate: string;
      channelType: "WhatsApp";
      sourceApplication?: string;
    };
    audiences: Array<{
      recipient: string;
      messageParams: Record<string, string>;
    }>;
    message: {
      messageTemplate: string;
      messageParams: string[];
      channelType?: "WhatsApp";
    };
  };
};

const blipEndpoint = process.env.BLIP_ENDPOINT ?? "";
const blipAuth = process.env.BLIP_AUTH ?? "";
const campaignNamePrefix = process.env.CAMPAIGN_NAME_PREFIX ?? "Hidramais";
const flowId = process.env.FLOW_ID ?? "";
const masterstate = process.env.MASTERSTATE ?? "";
const vtexBaseUrl = process.env.VTEX_BASE_URL ?? "";
const vtexAppKey = process.env.VTEX_APP_KEY ?? "";
const vtexAppToken = process.env.VTEX_APP_TOKEN ?? "";
function resolveMessageTemplate(status: string): string {
  if (
    status === "ready-for-handling" ||
    status === "handling"
  ) {
    return "pedido_ready_for_handling_v1";
  }
  if (status === "invoiced" || status === "shipped") {
    return "pedido_com_confirmacao_de_envio_v1";
  }
  return "";
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `+${normalized}`;
}

function logInfo(message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

async function alreadySent(orderNumber: string, messageTemplate: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    return false;
  }

  try {
    const existing = await prisma.webhookLog.findFirst({
      where: { orderNumber, messageTemplate },
      select: { id: true },
    });
    return Boolean(existing);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo("Falha ao consultar logs duplicados", { message, orderNumber, messageTemplate });
    return false;
  }
}

async function saveLog(data: {
  status?: string;
  orderNumber?: string;
  messageTemplate?: string;
  purchaseDate?: string;
  trackingUrl?: string;
  note?: string;
  webhookPayload: unknown;
  blipPayload?: unknown;
  blipResponse?: unknown;
  vtexOrderPayload?: unknown;
  errorMessage?: string;
  errorStack?: string;
}) {
  if (!process.env.DATABASE_URL) {
    logInfo("DATABASE_URL não configurado; log não salvo");
    return;
  }

  try {
    await prisma.webhookLog.create({
      data: {
        status: data.status ?? null,
        orderNumber: data.orderNumber ?? null,
        messageTemplate: data.messageTemplate ?? null,
        purchaseDate: data.purchaseDate ?? null,
        trackingUrl: data.trackingUrl ?? null,
        note: data.note ?? null,
        webhookPayload: data.webhookPayload as Prisma.InputJsonValue,
        blipPayload: (data.blipPayload ?? undefined) as Prisma.InputJsonValue | undefined,
        blipResponse: (data.blipResponse ?? undefined) as Prisma.InputJsonValue | undefined,
        vtexOrderPayload: (data.vtexOrderPayload ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        errorMessage: data.errorMessage ?? null,
        errorStack: data.errorStack ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo("Falha ao salvar log no banco", { message });
  }
}

function pickTrackingUrlFromOrder(order: unknown): string | null {
  const orderAny = order as {
    packageAttachment?: { packages?: Array<{ trackingUrl?: string | null }> };
    shippingData?: {
      logisticsInfo?: Array<{ trackingUrl?: string | null }>;
    };
  };

  const packages = orderAny.packageAttachment?.packages ?? [];
  for (const pkg of packages) {
    const url = pkg?.trackingUrl ?? null;
    if (url) return url;
  }

  const logistics = orderAny.shippingData?.logisticsInfo ?? [];
  for (const item of logistics) {
    const url = item?.trackingUrl ?? null;
    if (url) return url;
  }

  return null;
}

function buildOrderDetails(order: unknown): string | null {
  const orderAny = order as {
    statusDescription?: string | null;
    creationDate?: string | null;
    orderId?: string | null;
    items?: Array<{ name?: string | null; quantity?: number | null }> | null;
  };

  if (!orderAny) return null;

  const items = orderAny.items ?? [];
  const details = {
    status: orderAny.statusDescription ?? null,
    data: orderAny.creationDate ?? null,
    numero_pedido: orderAny.orderId ?? null,
    produtos: items.map((item) => ({
      nome: item?.name ?? null,
      quantidade: item?.quantity ?? null,
    })),
  };

  return JSON.stringify(details);
}

async function fetchTrackingUrlFromVtex(
  orderNumber: string,
): Promise<{ trackingUrl: string | null; order: unknown | null }> {
  if (!vtexBaseUrl || !vtexAppKey || !vtexAppToken) {
    logInfo("VTEX não configurado para buscar trackingUrl", {
      vtexBaseUrl: Boolean(vtexBaseUrl),
      vtexAppKey: Boolean(vtexAppKey),
      vtexAppToken: Boolean(vtexAppToken),
    });
    return { trackingUrl: null, order: null };
  }

  const endpoint = `${vtexBaseUrl}/api/oms/pvt/orders/${orderNumber}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "X-VTEX-API-AppKey": vtexAppKey,
      "X-VTEX-API-AppToken": vtexAppToken,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    logInfo("VTEX respondeu com erro ao buscar trackingUrl", {
      status: response.status,
      body,
    });
    return { trackingUrl: null, order: null };
  }

  const order = (await response.json()) as unknown;
  return { trackingUrl: pickTrackingUrlFromOrder(order), order };
}

function buildBlipPayload(input: {
  name: string;
  email: string;
  phone: string;
  leadType: string;
  messageTemplate: string;
  orderNumber: string;
  purchaseDate: string;
  trackingUrl?: string;
  orderDetails?: string;
}): BlipPayload {
  
  return {
    id: randomUUID(),
    to: "postmaster@activecampaign.msging.net",
    method: "set",
    uri: "/campaign/full",
    type: "application/vnd.iris.activecampaign.full-campaign+json",
    resource: {
      campaign: {
        name: `${campaignNamePrefix} ${randomUUID()}`,
        campaignType: "Batch",
        flowId,
        stateId: "onboarding",
        masterstate,
        channelType: "WhatsApp",
        sourceApplication: "API de Alerta Webhook VTEX",
      },
      audiences: [
        {
          recipient: normalizePhone(input.phone),
          messageParams: {
            "order":input.orderNumber,
            "1": input.name,
            "2": input.orderNumber,
            "3": formatDateIfValid(input.purchaseDate),
            ...(input.trackingUrl ? { "4": input.trackingUrl } : {}),
            ...(input.orderDetails ? { "pedido": input.orderDetails } : {}),
          },
        },
      ],
      message: {
        messageTemplate: input.messageTemplate,
        messageParams: input.trackingUrl ? ["1", "2", "3", "4"] : ["1", "2", "3"],
        channelType: "WhatsApp",
      },
    },
  };
}

async function sendToBlip(payload: BlipPayload): Promise<{ status: number; body: string }> {
  
  if (!blipEndpoint) {
    throw new Error("BLIP_ENDPOINT não configurado");
  }
  if (!blipAuth) {
    throw new Error("BLIP_AUTH não configurado");
  }

  logInfo("Enviando payload para Blip", {
    endpoint: blipEndpoint,
    campaign: payload.resource.campaign.name,
    data: JSON.stringify(payload)
  });

  const response = await fetch(blipEndpoint, {
    method: "POST",
    headers: {
      Authorization: blipAuth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Erro Blip: ${response.status} ${body}`);
  }

  const body = await response.text();
  logInfo("Blip respondeu com sucesso", { status: response.status });
  return { status: response.status, body };
}

async function handleAllowedStatus(payload: VtexWebhookPayload, status: string) {
  let customerName = extractCustomerName(payload);
  const orderNumber = extractOrderNumber(payload);
  let purchaseDate = extractPurchaseDate(payload);
  let trackingUrl = extractTrackingUrl(payload);
  let email = payload.clientProfileData?.email ?? null;
  let phone = payload.clientProfileData?.phone ?? null;

  if (!orderNumber) {
    logInfo("Webhook sem orderNumber", { status, payloadOrderId: payload.OrderId });
    await saveLog({
      status,
      orderNumber: undefined,
      purchaseDate: purchaseDate ?? undefined,
      trackingUrl: trackingUrl ?? undefined,
      note: "Webhook sem orderNumber",
      webhookPayload: payload,
    });
    return;
  }

  const messageTemplate = resolveMessageTemplate(status);
  if (!messageTemplate) {
    logInfo("Status sem template configurado", { status });
    return;
  }

  const duplicated = await alreadySent(orderNumber, messageTemplate);
  if (duplicated) {
    logInfo("Duplicata detectada: mensagem já enviada para este pedido/template; nada será reenviado", {
      orderNumber,
      messageTemplate,
    });
    return;
  }

  let vtexOrderPayload: unknown | null = null;
  let orderDetails: string | null = null;
  const vtexResult = await fetchTrackingUrlFromVtex(orderNumber);
  vtexOrderPayload = vtexResult.order;

  if (vtexOrderPayload) {
    const orderAny = vtexOrderPayload as {
      creationDate?: string | null;
      clientProfileData?: {
        firstName?: string | null;
        lastName?: string | null;
        email?: string | null;
        phone?: string | null;
      } | null;
    };

    purchaseDate = purchaseDate ?? orderAny.creationDate ?? null;

    const client = orderAny.clientProfileData;
    if (client) {
      if (!customerName) {
        const firstName = client.firstName?.trim();
        const lastName = client.lastName?.trim();
        const full = [firstName, lastName].filter(Boolean).join(' ').trim();
        customerName = full.length > 0 ? full : null;
      }
      email = email ?? client.email ?? null;
      phone = phone ?? client.phone ?? null;
    }

    orderDetails = buildOrderDetails(vtexOrderPayload);
    if (!trackingUrl) {
      trackingUrl = vtexResult.trackingUrl ?? pickTrackingUrlFromOrder(vtexOrderPayload);
    }
  }

  if (!customerName || !email || !phone || !orderNumber || !purchaseDate) {
    logInfo('Dados obrigatórios ausentes mesmo após consulta VTEX', {
      customerName,
      email,
      phone,
      orderNumber,
      purchaseDate,
      status,
    });
    await saveLog({
      status,
      orderNumber: orderNumber ?? undefined,
      purchaseDate: purchaseDate ?? undefined,
      trackingUrl: trackingUrl ?? undefined,
      note: 'Dados obrigatórios ausentes mesmo após consulta VTEX',
      webhookPayload: payload,
      vtexOrderPayload: vtexOrderPayload ?? undefined,
    });
    return;
  }

  if (messageTemplate === 'pedido_com_confirmacao_de_envio_v1') {
    if (!trackingUrl) {
      logInfo('Não foi possível obter trackingUrl', {
        orderNumber,
        purchaseDate,
      });
      await saveLog({
        status,
        orderNumber,
        messageTemplate,
        purchaseDate,
        note: 'Não foi possóvel obter trackingUrl',
        webhookPayload: payload,
        vtexOrderPayload: vtexOrderPayload ?? undefined,
      });
      return;
    }
  }

  const leadType = 'api_alerta_webhook';
  logInfo('Webhook validado e pronto para envio', {
    status,
    orderNumber,
    messageTemplate,
  });

  const blipPayload = buildBlipPayload({
    name: customerName,
    email,
    phone,
    leadType,
    messageTemplate,
    orderNumber,
    purchaseDate,
    trackingUrl: trackingUrl ?? undefined,
    orderDetails: orderDetails ?? undefined,
  });

  try {
    const blipResponse = await sendToBlip(blipPayload);
    await saveLog({
      status,
      orderNumber,
      messageTemplate,
      purchaseDate,
      trackingUrl: trackingUrl ?? undefined,
      webhookPayload: payload,
      blipPayload,
      blipResponse,
      vtexOrderPayload: vtexOrderPayload ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? null : null;
    await saveLog({
      status,
      orderNumber,
      messageTemplate,
      purchaseDate,
      trackingUrl: trackingUrl ?? undefined,
      webhookPayload: payload,
      blipPayload,
      vtexOrderPayload: vtexOrderPayload ?? undefined,
      errorMessage: message,
      errorStack: stack ?? undefined,
    });
    throw error;
  }
}

app.post("/webhook/vtex", async (req: Request, res: Response) => {
  const payload = req.body as VtexWebhookPayload;
  const status = normalizeStatus(extractStatus(payload));

  if (allowedStatuses.has(status)) {
    try {
      logInfo("Status permitido recebido", { status });
      await handleAllowedStatus(payload, status);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      logInfo("Falha ao processar webhook", { status, message });
      return res.status(502).json({ ok: false, handled: false, status, message });
    }
    return res.status(200).json({
      ok: true,
      handled: true,
      status,
      customerName: extractCustomerName(payload),
      orderNumber: extractOrderNumber(payload),
      purchaseDate: extractPurchaseDate(payload),
    });
  }

  return res.status(202).json({
    ok: true,
    handled: false,
    status,
    message: "Status ignorado",
  });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Servidor webhook ativo em http://localhost:${port}`);
});
