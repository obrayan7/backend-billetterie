import { randomBytes } from "crypto";
import { Prisma, type PaymentProvider } from "@prisma/client";
import { prisma } from "./client";
import { parseTicketNumber } from "./format";

/** Durée de réservation des places dans le panier. */
export const RESERVATION_MINUTES = 15;

/** Erreur « métier » dont le message peut être montré tel quel au client. */
export class CartError extends Error {}

type Tx = Prisma.TransactionClient;
const minutes = (n: number) => new Date(Date.now() + n * 60_000);

/**
 * Verrouille les lignes TicketType concernées (FOR UPDATE, dans un ordre stable pour éviter les deadlocks).
 * Deux réservations concurrentes sur le même billet sont ainsi traitées l'une après l'autre : pas de survente.
 */
async function lockTicketTypes(tx: Tx, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`;
}

/** Places prises = commandes payées + commandes en attente non expirées (hors commande `excludeOrderId`). */
async function takenSeats(tx: Tx, ids: string[], excludeOrderId?: string) {
  const rows = await tx.orderItem.groupBy({
    by: ["ticketTypeId"],
    where: {
      ticketTypeId: { in: ids },
      ...(excludeOrderId ? { orderId: { not: excludeOrderId } } : {}),
      order: { OR: [{ status: "PAID" }, { status: "PENDING", expiresAt: { gt: new Date() } }] },
    },
    _sum: { quantity: true },
  });
  return Object.fromEntries(rows.map((r) => [r.ticketTypeId, r._sum.quantity ?? 0])) as Record<string, number>;
}

export type CartChange = { ticketTypeId: string; quantity: number; mode: "add" | "set" };

/**
 * Ajoute / modifie / retire des billets dans le panier (= une commande PENDING qui réserve les places).
 * Toute modification relance le compte à rebours de 15 minutes.
 * Retourne l'id de la commande, ou null si le panier est vide.
 */
export async function updateCart(params: { orderId?: string | null; changes: CartChange[]; userId?: string | null }) {
  const { changes } = params;
  for (const c of changes) {
    if (!Number.isInteger(c.quantity) || c.quantity < 0 || c.quantity > 100) throw new CartError("Quantité invalide.");
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const order = params.orderId
      ? await tx.order.findFirst({
          where: { id: params.orderId, status: "PENDING", expiresAt: { gt: now } },
          include: { items: true },
        })
      : null;

    const ids = changes.map((c) => c.ticketTypeId);
    await lockTicketTypes(tx, ids);

    const types = await tx.ticketType.findMany({ where: { id: { in: ids } }, include: { event: true } });
    const byId = new Map(types.map((t) => [t.id, t]));
    const taken = await takenSeats(tx, ids, order?.id);

    const desired = new Map<string, number>();
    for (const c of changes) {
      const tt = byId.get(c.ticketTypeId);
      if (!tt) throw new CartError("Ce billet n'existe plus.");
      const current = order?.items.find((i) => i.ticketTypeId === tt.id)?.quantity ?? 0;
      const qty = c.mode === "add" ? current + c.quantity : c.quantity;
      if (qty > 0) {
        if (tt.event.status !== "PUBLISHED" || tt.event.startsAt <= now) throw new CartError("Cet événement n'est plus en vente.");
        if (qty > tt.maxPerOrder) throw new CartError(`Maximum ${tt.maxPerOrder} billets « ${tt.name} » par commande.`);
        const available = tt.quantity - (taken[tt.id] ?? 0);
        if (qty > available) {
          throw new CartError(available <= 0 ? `« ${tt.name} » est complet.` : `Il ne reste que ${available} place${available > 1 ? "s" : ""} pour « ${tt.name} ».`);
        }
      }
      desired.set(tt.id, qty);
    }

    const needsOrder = [...desired.values()].some((q) => q > 0);
    let orderId = order?.id ?? null;
    if (!orderId && needsOrder) {
      const created = await tx.order.create({
        // Jeton d’accès à la commande : aléatoire cryptographique (un cuid est en partie prévisible)
        data: { userId: params.userId ?? null, accessToken: randomBytes(24).toString("base64url"), expiresAt: minutes(RESERVATION_MINUTES) },
      });
      orderId = created.id;
    }
    if (!orderId) return null;

    for (const [ticketTypeId, qty] of desired) {
      if (qty === 0) {
        await tx.orderItem.deleteMany({ where: { orderId, ticketTypeId } });
      } else {
        const tt = byId.get(ticketTypeId)!;
        await tx.orderItem.upsert({
          where: { orderId_ticketTypeId: { orderId, ticketTypeId } },
          create: { orderId, ticketTypeId, quantity: qty, unitCents: tt.priceCents },
          update: { quantity: qty, unitCents: tt.priceCents },
        });
      }
    }

    const items = await tx.orderItem.findMany({ where: { orderId } });
    if (items.length === 0) {
      await tx.order.delete({ where: { id: orderId } });
      return null;
    }
    await tx.order.update({
      where: { id: orderId },
      data: { totalCents: items.reduce((s, i) => s + i.quantity * i.unitCents, 0), expiresAt: minutes(RESERVATION_MINUTES) },
    });
    return orderId;
  });
}

/** Annule un panier / une commande non payée : les places sont libérées immédiatement. */
export async function cancelOrder(orderId: string) {
  await prisma.order.updateMany({ where: { id: orderId, status: "PENDING" }, data: { status: "CANCELLED" } });
}

/**
 * Nettoyage : passe en EXPIRED les commandes en attente dont le délai est dépassé.
 * La disponibilité des places ne dépend PAS de cette tâche (elle ignore déjà les réservations expirées) :
 * c'est un rangement de statuts, exécuté par la tâche planifiée et à l'occasion des actions du panier.
 */
export async function expireOrders() {
  const now = new Date();
  const expired = await prisma.order.findMany({ where: { status: "PENDING", expiresAt: { lt: now } }, select: { id: true } });
  if (expired.length === 0) return 0;
  const ids = expired.map((o) => o.id);
  await prisma.$transaction([
    prisma.order.updateMany({ where: { id: { in: ids }, status: "PENDING" }, data: { status: "EXPIRED" } }),
    prisma.payment.updateMany({ where: { orderId: { in: ids }, status: "PENDING" }, data: { status: "EXPIRED" } }),
  ]);
  return ids.length;
}

/** Prolonge la réservation pendant le paiement (Stripe impose 30 minutes minimum pour une session). */
export async function extendReservation(orderId: string, minutesFromNow: number) {
  const target = minutes(minutesFromNow);
  await prisma.order.updateMany({
    where: { id: orderId, status: "PENDING", expiresAt: { lt: target } },
    data: { expiresAt: target },
  });
}

export async function setCheckoutInfo(orderId: string, info: { email: string; holderName: string; userId?: string | null }) {
  await prisma.order.update({
    where: { id: orderId },
    data: { email: info.email, holderName: info.holderName, userId: info.userId ?? undefined, cgvAcceptedAt: new Date() },
  });
}

export async function createPayment(input: {
  orderId: string;
  provider: PaymentProvider;
  externalId: string;
  amountCents: number;
  checkoutUrl?: string | null;
}) {
  return prisma.payment.create({ data: { ...input, status: "PENDING" } });
}

export function newTicketCode() {
  return randomBytes(18).toString("base64url");
}

/**
 * Confirme le paiement d'une commande et émet les billets. Idempotent : peut être appelé plusieurs fois
 * (les prestataires renvoient leurs webhooks) sans créer de billets en double.
 *  - issued: true  → les billets viennent d'être émis (envoyer l'e-mail maintenant)
 *  - issued: false → déjà payée, ou commande introuvable / annulée / places plus disponibles
 */
export async function markOrderPaid(input: { orderId: string; provider: PaymentProvider }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: input.orderId }, include: { items: true } });
    if (!order) return { issued: false as const, reason: "not_found" as const };

    await tx.payment.updateMany({
      where: { orderId: order.id, provider: input.provider, status: { in: ["PENDING", "EXPIRED", "PROOF_SUBMITTED", "REJECTED"] } },
      data: { status: "PAID" },
    });

    if (order.status === "PAID") return { issued: false as const, reason: "already_paid" as const };
    if (order.status === "CANCELLED") return { issued: false as const, reason: "cancelled" as const };

    // Verrou sur les billets concernés : stock vérifié et sièges attribués sans doublon, même en cas de paiements simultanés
    const ids = order.items.map((i) => i.ticketTypeId);
    await lockTicketTypes(tx, ids);
    const types = await tx.ticketType.findMany({ where: { id: { in: ids } } });

    if (order.status === "EXPIRED") {
      // Paiement arrivé après expiration : on ne valide que si les places sont encore libres.
      const taken = await takenSeats(tx, ids, order.id);
      const enough = order.items.every((i) => {
        const tt = types.find((t) => t.id === i.ticketTypeId);
        return tt && tt.quantity - (taken[tt.id] ?? 0) >= i.quantity;
      });
      if (!enough) return { issued: false as const, reason: "no_stock" as const };
    }

    await tx.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date() } });
    // Les autres tentatives de paiement de cette commande ne sont plus utilisables
    await tx.payment.updateMany({ where: { orderId: order.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    for (const item of order.items) {
      const tt = types.find((t) => t.id === item.ticketTypeId)!;
      // Numérotation automatique des sièges (A1, A2…) si le billet a un préfixe ; sinon placement libre
      const already = tt.seatPrefix ? await tx.ticket.count({ where: { orderItem: { ticketTypeId: tt.id } } }) : 0;
      await tx.ticket.createMany({
        data: Array.from({ length: item.quantity }, (_, i) => ({
          orderItemId: item.id,
          code: newTicketCode(),
          seat: tt.seatPrefix ? `${tt.seatPrefix}${already + i + 1}` : null,
        })),
      });
    }
    return { issued: true as const, reason: "issued" as const };
  });
}

export async function markPaymentFailed(input: { orderId: string; provider: PaymentProvider; status: "FAILED" | "EXPIRED" }) {
  await prisma.payment.updateMany({
    where: { orderId: input.orderId, provider: input.provider, status: "PENDING" },
    data: { status: input.status },
  });
}

/** Après envoi d’une preuve de virement, la réservation est maintenue le temps de la vérification par l’admin. */
export const BANK_REVIEW_DAYS = 7;
export const MAX_PROOFS_PER_PAYMENT = 5;

/** Enregistre une preuve de virement (fichier déjà contrôlé) et passe le paiement « en attente de vérification ». */
export async function recordBankProof(input: { paymentId: string; filename: string; mimeType: string; data: Buffer }) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, include: { order: true } });
    if (!payment || payment.provider !== "BANK_TRANSFER") throw new CartError("Paiement introuvable.");
    if (!["PENDING", "PROOF_SUBMITTED", "REJECTED", "EXPIRED"].includes(payment.status)) throw new CartError("Ce paiement n’attend plus de preuve.");
    if (!["PENDING", "EXPIRED"].includes(payment.order.status)) throw new CartError("Cette commande n’accepte plus de preuve de paiement.");
    if ((await tx.paymentProof.count({ where: { paymentId: payment.id } })) >= MAX_PROOFS_PER_PAYMENT) {
      throw new CartError(`Maximum ${MAX_PROOFS_PER_PAYMENT} documents par commande.`);
    }
    const proof = await tx.paymentProof.create({
      data: { paymentId: payment.id, filename: input.filename, mimeType: input.mimeType, size: input.data.length, data: input.data },
      select: { id: true },
    });
    await tx.payment.update({ where: { id: payment.id }, data: { status: "PROOF_SUBMITTED", rejectionReason: null } });
    if (payment.order.status === "PENDING") {
      const target = new Date(Date.now() + BANK_REVIEW_DAYS * 864e5);
      await tx.order.updateMany({ where: { id: payment.orderId, status: "PENDING", expiresAt: { lt: target } }, data: { expiresAt: target } });
    }
    return { proofId: proof.id, orderId: payment.orderId };
  });
}

/** Commande complète (articles, événement, billets, paiements) à partir de son jeton d'accès. */
export function getOrderByToken(accessToken: string) {
  return prisma.order.findUnique({
    where: { accessToken },
    include: {
      payments: { orderBy: { createdAt: "desc" }, include: { proofs: { select: { id: true, filename: true, createdAt: true } } } },
      items: {
        include: {
          ticketType: { include: { event: { include: { venue: true, images: { orderBy: [{ isCover: "desc" }, { position: "asc" }], take: 1 } } } } },
          tickets: { orderBy: { id: "asc" } },
        },
      },
    },
  });
}

export type FullOrder = NonNullable<Awaited<ReturnType<typeof getOrderByToken>>>;

/** Validation d'un billet à l'entrée (QR code ou numéro lisible) : accepté une seule fois, de façon atomique. */
export async function scanTicket(input: string) {
  const clean = input.trim();
  if (!clean) return { result: "invalid" as const };
  const serial = parseTicketNumber(clean);
  const where = serial !== null ? { serial } : { code: clean };
  const found = await prisma.ticket.findFirst({ where, select: { id: true } });
  if (!found) return { result: "invalid" as const };

  const updated = await prisma.ticket.updateMany({ where: { id: found.id, status: "VALID" }, data: { status: "USED", usedAt: new Date() } });
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: found.id },
    include: { orderItem: { include: { order: true, ticketType: { include: { event: true } } } } },
  });
  return {
    result: updated.count === 1 ? ("valid" as const) : ("used" as const),
    event: ticket.orderItem.ticketType.event.title,
    category: ticket.orderItem.ticketType.name,
    seat: ticket.seat,
    holder: ticket.orderItem.order.holderName,
    usedAt: ticket.usedAt,
  };
}
