import { Prisma } from "@prisma/client";
import { prisma } from "./client";

export type EventFilters = {
  q?: string;
  city?: string;
  category?: string; // slug
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  maxPrice?: number; // en euros
  sort?: "date" | "prix";
  page?: number;
};

export const PAGE_SIZE = 12;

/** Places déjà vendues ou réservées (commandes payées + commandes en attente non expirées). */
export async function getTakenByTicketType(ticketTypeIds: string[]): Promise<Record<string, number>> {
  if (ticketTypeIds.length === 0) return {};
  const rows = await prisma.orderItem.groupBy({
    by: ["ticketTypeId"],
    where: {
      ticketTypeId: { in: ticketTypeIds },
      order: {
        OR: [{ status: "PAID" }, { status: "PENDING", expiresAt: { gt: new Date() } }],
      },
    },
    _sum: { quantity: true },
  });
  return Object.fromEntries(rows.map((r) => [r.ticketTypeId, r._sum.quantity ?? 0]));
}

export async function listEvents(filters: EventFilters = {}) {
  const now = new Date();
  const where: Prisma.EventWhereInput = {
    status: "PUBLISHED",
    startsAt: { gte: filters.from ? new Date(filters.from) : now },
  };
  if (filters.to) {
    (where.startsAt as Prisma.DateTimeFilter).lte = new Date(`${filters.to}T23:59:59`);
  }
  if (filters.category) where.category = { slug: filters.category };
  if (filters.city) where.venue = { city: { equals: filters.city, mode: "insensitive" } };
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: "insensitive" } },
      { description: { contains: filters.q, mode: "insensitive" } },
      { venue: { name: { contains: filters.q, mode: "insensitive" } } },
      { venue: { city: { contains: filters.q, mode: "insensitive" } } },
    ];
  }
  if (filters.maxPrice !== undefined && !Number.isNaN(filters.maxPrice)) {
    where.ticketTypes = { some: { priceCents: { lte: Math.round(filters.maxPrice * 100) } } };
  }

  const events = await prisma.event.findMany({
    where,
    orderBy: { startsAt: "asc" },
    include: {
      venue: true,
      category: true,
      images: { orderBy: [{ isCover: "desc" }, { position: "asc" }], take: 1 },
      ticketTypes: { select: { priceCents: true } },
    },
  });

  const withPrice = events.map((e) => ({
    ...e,
    fromPriceCents: e.ticketTypes.length ? Math.min(...e.ticketTypes.map((t) => t.priceCents)) : null,
  }));

  if (filters.sort === "prix") {
    withPrice.sort((a, b) => (a.fromPriceCents ?? Infinity) - (b.fromPriceCents ?? Infinity));
  }

  const page = Math.max(1, filters.page ?? 1);
  return {
    total: withPrice.length,
    page,
    pageSize: PAGE_SIZE,
    events: withPrice.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  };
}

export async function getEventBySlug(slug: string) {
  const event = await prisma.event.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: {
      venue: true,
      category: true,
      images: { orderBy: [{ isCover: "desc" }, { position: "asc" }] },
      ticketTypes: { orderBy: { priceCents: "asc" } },
    },
  });
  if (!event) return null;
  const taken = await getTakenByTicketType(event.ticketTypes.map((t) => t.id));
  return {
    ...event,
    ticketTypes: event.ticketTypes.map((t) => ({
      ...t,
      available: Math.max(0, t.quantity - (taken[t.id] ?? 0)),
    })),
  };
}
