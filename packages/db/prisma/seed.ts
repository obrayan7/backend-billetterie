import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const day = (n: number, hour = 20) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d;
};

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.ADMIN_PASSWORD ?? "changer-ce-mot-de-passe";
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Administrateur", role: "ADMIN", password: await bcrypt.hash(password, 12) },
  });

  const categories = [
    ["Concerts", "concerts"],
    ["Théâtre", "theatre"],
    ["Humour", "humour"],
    ["Sport", "sport"],
    ["Festivals", "festivals"],
    ["Famille", "famille"],
  ];
  for (const [name, slug] of categories) {
    await prisma.category.upsert({ where: { slug }, update: {}, create: { name, slug } });
  }

  const venues = [
    { id: "venue-paris", name: "Salle des Lumières", address: "12 rue des Arts", city: "Paris" },
    { id: "venue-lyon", name: "Théâtre du Rhône", address: "5 quai Saint-Antoine", city: "Lyon" },
    { id: "venue-marseille", name: "Le Dôme du Vieux-Port", address: "88 quai du Port", city: "Marseille" },
  ];
  for (const v of venues) {
    await prisma.venue.upsert({ where: { id: v.id }, update: {}, create: v });
  }

  const cat = async (slug: string) => (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;

  const events = [
    { slug: "nuit-electro-paris", title: "Nuit électro", category: "concerts", venueId: "venue-paris", startsAt: day(21), description: "Une nuit de sets électro avec trois scènes et un finale en lumière.", organizer: "Rideau Productions", tickets: [["Fosse", 3500, 400], ["Balcon", 5500, 120, "B"]] },
    { slug: "le-malade-imaginaire-lyon", title: "Le Malade imaginaire", category: "theatre", venueId: "venue-lyon", startsAt: day(35), description: "La comédie de Molière dans une mise en scène contemporaine.", organizer: "Compagnie du Rhône", tickets: [["Orchestre", 4200, 150, "A"], ["Corbeille", 3200, 100, "B"], ["Galerie", 2200, 80, "C"]] },
    { slug: "soiree-stand-up-marseille", title: "Soirée stand-up", category: "humour", venueId: "venue-marseille", startsAt: day(14), description: "Cinq humoristes, un seul plateau, deux heures de rires.", organizer: "Comedy Club Marseille", tickets: [["Placement libre", 2500, 300]] },
    { slug: "finale-handball-paris", title: "Finale de handball", category: "sport", venueId: "venue-paris", startsAt: day(60, 18), description: "La grande finale de la saison, dans une salle comble.", organizer: "Fédération de handball", tickets: [["Tribune basse", 4800, 500, "T"], ["Tribune haute", 2900, 800, "H"]] },
  ];

  for (const e of events) {
    const created = await prisma.event.upsert({
      where: { slug: e.slug },
      update: {},
      create: {
        slug: e.slug,
        title: e.title,
        description: e.description,
        startsAt: e.startsAt,
        status: "PUBLISHED",
        organizer: e.organizer,
        venueId: e.venueId,
        categoryId: await cat(e.category),
      },
    });
    const count = await prisma.ticketType.count({ where: { eventId: created.id } });
    if (count === 0) {
      await prisma.ticketType.createMany({
        data: e.tickets.map(([name, priceCents, quantity, seatPrefix]) => ({
          eventId: created.id,
          name: name as string,
          priceCents: priceCents as number,
          quantity: quantity as number,
          seatPrefix: (seatPrefix as string | undefined) ?? null,
        })),
      });
    }
  }
  console.log(`Seed terminé. Admin : ${email}`);
}

main().finally(() => prisma.$disconnect());
