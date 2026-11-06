/**
 * Vérification de la configuration au démarrage en production.
 * Les ERREURS empêchent le démarrage (mieux vaut échouer tout de suite que vendre des billets sans e-mail
 * ou avec un secret de démonstration). Les AVERTISSEMENTS sont écrits dans les logs.
 * Pour une préproduction : SKIP_ENV_CHECK=1 transforme les erreurs en avertissements.
 */
export function checkProductionEnv(app: "web" | "admin") {
  const e = process.env;
  const errors: string[] = [];
  const warnings: string[] = [];
  const placeholder = (v?: string) => !v || /remplacer|changer|example|changeme/i.test(v);

  if (!e.DATABASE_URL) errors.push("DATABASE_URL manquant.");

  if (!e.INTERNAL_API_SECRET || e.INTERNAL_API_SECRET.length < 32) errors.push("INTERNAL_API_SECRET : 32 caractères minimum (secret partagé entre le site et l’admin, utilisé pour confirmer les virements).");

  if (app === "web") {
    if (!e.ADMIN_URL) warnings.push("ADMIN_URL manquant : les e-mails « virement à vérifier » n’auront pas de lien vers l’admin.");
    if (placeholder(e.CUSTOMER_SESSION_SECRET) || e.CUSTOMER_SESSION_SECRET!.length < 32) errors.push("CUSTOMER_SESSION_SECRET : 32 caractères minimum, valeur aléatoire (openssl rand -base64 32).");
    if (!e.SITE_URL?.startsWith("https://")) errors.push("SITE_URL doit commencer par https:// en production.");
    if (!e.CRON_SECRET || e.CRON_SECRET.length < 16) errors.push("CRON_SECRET manquant ou trop court (16 caractères minimum).");
    if (!e.RESEND_API_KEY) errors.push("RESEND_API_KEY manquant : sans lui, aucun e-mail (billets, mot de passe oublié) ne partira.");
    if (!e.MAIL_FROM || /example\./i.test(e.MAIL_FROM)) errors.push("MAIL_FROM doit utiliser votre vrai domaine d'envoi (SPF/DKIM configurés).");

    const card = Boolean(e.STRIPE_SECRET_KEY);
    const crypto = Boolean(e.NOWPAYMENTS_API_KEY);
    if (!card && !crypto) warnings.push("Aucun paiement en ligne configuré (Stripe ou NOWPayments) : seul le virement bancaire sera proposé s'il y a un compte actif.");
    if (card && !e.STRIPE_WEBHOOK_SECRET) errors.push("STRIPE_WEBHOOK_SECRET manquant : les billets ne seraient jamais émis après un paiement.");
    if (card && /_test_/.test(e.STRIPE_SECRET_KEY!)) warnings.push("Stripe est en MODE TEST : aucun paiement réel ne sera encaissé.");
    if (crypto && !e.NOWPAYMENTS_IPN_SECRET) errors.push("NOWPAYMENTS_IPN_SECRET manquant : les paiements crypto ne seraient jamais confirmés.");
    if (crypto && /sandbox/i.test(e.NOWPAYMENTS_API_URL ?? "")) warnings.push("NOWPayments est en MODE SANDBOX : aucun paiement réel ne sera encaissé.");
  } else {
    if (placeholder(e.ADMIN_SESSION_SECRET) || e.ADMIN_SESSION_SECRET!.length < 32) errors.push("ADMIN_SESSION_SECRET : 32 caractères minimum, valeur aléatoire (openssl rand -base64 32).");
    for (const k of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"]) {
      if (!e[k]) errors.push(`${k} manquant : le stockage S3 des images est obligatoire en production.`);
    }
    if (!e.WEB_URL?.startsWith("https://")) warnings.push("WEB_URL devrait être l'adresse https du site public.");
  }
  return { errors, warnings };
}

export function runEnvCheck(app: "web" | "admin") {
  if (process.env.NODE_ENV !== "production") return;
  const { errors, warnings } = checkProductionEnv(app);
  for (const w of warnings) console.warn(`[config] ⚠ ${w}`);
  if (errors.length === 0) return;
  const message = `Configuration de production invalide (${app}) :\n - ${errors.join("\n - ")}`;
  if (process.env.SKIP_ENV_CHECK === "1") console.error(`[config] ${message}\n(SKIP_ENV_CHECK=1 : démarrage autorisé malgré tout)`);
  else throw new Error(message);
}
