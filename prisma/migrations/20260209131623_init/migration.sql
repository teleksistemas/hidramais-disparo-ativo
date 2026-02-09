-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT,
    "orderNumber" TEXT,
    "messageTemplate" TEXT,
    "purchaseDate" TEXT,
    "trackingUrl" TEXT,
    "note" TEXT,
    "webhookPayload" JSONB NOT NULL,
    "blipPayload" JSONB,
    "blipResponse" JSONB,
    "vtexOrderPayload" JSONB,
    "errorMessage" TEXT,
    "errorStack" TEXT,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);
