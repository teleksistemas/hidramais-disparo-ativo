import { NextFunction, Request, Response, Router } from "express";
import { formatDateIfValid } from "../utils/date.js";

type BuscarPedidoVtexRoutesDeps = {
  requireApiRouteToken: (req: Request, res: Response, next: NextFunction) => void;
  buscarPedidoNaVtex: (
    pedidoId: string,
  ) => Promise<{ trackingUrl: string | null; order: unknown | null }>;
  logInfo: (message: string, data?: Record<string, unknown>) => void;
};

export function createBuscarPedidoVtexRoutes(deps: BuscarPedidoVtexRoutesDeps) {
  const router = Router();

  function mapPedidoResumo(order: unknown, trackingUrl: string | null) {
    const orderAny = order as {
      status?: string | null;
      statusDescription?: string | null;
      creationDate?: string | null;
      orderId?: string | null;
      items?: Array<{ name?: string | null }> | null;
    };

    const descricaoProduto = (orderAny.items ?? [])
      .map((item) => item?.name?.trim())
      .filter((name): name is string => Boolean(name))
      .map((name) => `• ${name}`)
      .join("\n");

    return {
      status: orderAny.statusDescription ?? orderAny.status ?? null,
      dataCompra: orderAny.creationDate ? formatDateIfValid(orderAny.creationDate) : null,
      numeroPedido: orderAny.orderId ?? null,
      descricaoProduto,
      urlRastreamento: trackingUrl ?? null,
    };
  }

  const handlerBuscarPedido = async (req: Request, res: Response) => {
    const pedidoId = req.params.pedidoId?.trim();
    if (!pedidoId) {
      return res.status(400).json({
        ok: false,
        message: "pedidoId é obrigatório",
      });
    }

    try {
      const { order, trackingUrl } = await deps.buscarPedidoNaVtex(pedidoId);
      if (!order) {
        return res.status(502).json({
          ok: false,
          message: "Falha ao buscar pedido na VTEX",
          pedidoId,
        });
      }

      return res.status(200).json({
        ok: true,
        pedidoId,
        data: mapPedidoResumo(order, trackingUrl),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      deps.logInfo("Falha ao consultar pedido na VTEX", { pedidoId, message });
      return res.status(502).json({
        ok: false,
        pedidoId,
        message,
      });
    }
  };

  router.get(
    "/api/vtex/orders/:pedidoId",
    deps.requireApiRouteToken,
    handlerBuscarPedido,
  );

  return router;
}

parseInt
