/** Vérifie la clé de contrôle d’un IBAN (ISO 13616, modulo 97). */
export function isValidIban(raw: string): boolean {
  const s = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  let rem = 0;
  for (const ch of s.slice(4) + s.slice(0, 4)) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** Ressemble à un IBAN (2 lettres + 2 chiffres) : dans ce cas il doit être valide. */
export const looksLikeIban = (raw: string) => /^[A-Za-z]{2}\d{2}/.test(raw.replace(/\s/g, ""));

/** FR76 3000 6000 ... : groupes de 4 caractères pour la lisibilité. */
export function formatAccountNumber(raw: string): string {
  const s = raw.replace(/\s/g, "").toUpperCase();
  return looksLikeIban(s) ? s.replace(/(.{4})/g, "$1 ").trim() : raw.trim();
}

export const isValidBic = (raw: string) => /^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(raw.replace(/\s/g, ""));
