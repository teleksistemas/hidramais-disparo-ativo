import { Request, Response, Router } from "express";
import { VtexWebhookPayload } from "../types/vtex.js";

type WebhookRoutesDeps = {
  allowedStatuses: Set<string>;
  normalizeStatus: (status: string | null | undefined) => string;
  extractStatus: (payload: VtexWebhookPayload) => string | null;
  extractCustomerName: (payload: VtexWebhookPayload) => string | null;
  extractOrderNumber: (payload: VtexWebhookPayload) => string | null;
  extractPurchaseDate: (payload: VtexWebhookPayload) => string | null;
  handleAllowedStatus: (payload: VtexWebhookPayload, status: string) => Promise<void>;
  logInfo: (message: string, data?: Record<string, unknown>) => void;
};

export function createWebhookRoutes(deps: WebhookRoutesDeps) {
  const router = Router();

  router.post("/webhook/vtex", async (req: Request, res: Response) => {
    const payload = req.body as VtexWebhookPayload;
    const status = deps.normalizeStatus(deps.extractStatus(payload));

    if (deps.allowedStatuses.has(status)) {
      try {
        deps.logInfo("Status permitido recebido", { status });
        await deps.handleAllowedStatus(payload, status);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        deps.logInfo("Falha ao processar webhook", { status, message });
        return res.status(502).json({ ok: false, handled: false, status, message });
      }
      return res.status(200).json({
        ok: true,
        handled: true,
        status,
        customerName: deps.extractCustomerName(payload),
        orderNumber: deps.extractOrderNumber(payload),
        purchaseDate: deps.extractPurchaseDate(payload),
      });
    }

    return res.status(202).json({
      ok: true,
      handled: false,
      status,
      message: "Status ignorado",
    });
  });

  return router;
}
