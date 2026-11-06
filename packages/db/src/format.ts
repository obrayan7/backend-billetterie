export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function formatDate(date: Date, withTime = false): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Europe/Paris",
  }).format(date);
}

/** URL d'une variante d'image : /uploads/abc-1600.webp -> /uploads/abc-800.webp */
export function imageVariant(url: string, width: 400 | 800 | 1600): string {
  return url.replace(/-1600\.webp$/, `-${width}.webp`);
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Numéro de billet lisible : EV + date de l'événement (AAAAMMJJ) + numéro séquentiel sur 4 chiffres minimum. */
export function ticketNumber(serial: number, startsAt: Date): string {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(startsAt).replace(/-/g, "");
  return `EV${day}${String(serial).padStart(4, "0")}`;
}

/** Retrouve le numéro séquentiel depuis un numéro de billet saisi à la main (ou null). */
export function parseTicketNumber(input: string): number | null {
  const m = /^EV(\d{8})(\d{4,})$/i.exec(input.trim().replace(/\s/g, ""));
  return m ? parseInt(m[2], 10) : null;
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function providerLabel(provider: string): string {
  return provider === "STRIPE" ? "Carte" : provider === "CRYPTO" ? "Crypto" : provider === "BANK_TRANSFER" ? "Virement" : provider;
}
