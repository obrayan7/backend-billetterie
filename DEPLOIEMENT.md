# Guide de mise en production

Objectif : une fois les comptes créés et les clés renseignées, **le site est réel et les paiements sont réels**.
Au démarrage en production, le site vérifie sa configuration et **refuse de démarrer** si un élément critique manque
(secret de démonstration, webhook non configuré, stockage d'images absent, e-mails non configurés…).

## 1. Comptes à créer (une seule fois)

| Service | Sert à | Ce qu'il faut récupérer |
|---|---|---|
| **Serveur (VPS) en Europe** ou **Vercel Pro** | Héberger le site et l'admin | Accès SSH / compte |
| **Nom de domaine** | `monsite.fr` + `admin.monsite.fr` | Accès à la zone DNS |
| **Stripe** | Paiement par carte | Clé secrète **live** `sk_live_…` ; activer le compte (informations de la société, IBAN, pièce d'identité du dirigeant) |
| **NOWPayments** | Paiement crypto | Clé API + secret IPN ; compte validé ; **règlement en euros** à confirmer avec eux |
| **Resend** | E-mails (billets, mot de passe) | Clé API ; domaine d'envoi vérifié (enregistrements SPF, DKIM, DMARC) |
| **Stockage S3 UE** (Scaleway, Cloudflare R2, OVH…) | Images des événements | Bucket **public en lecture**, clés d'accès, URL publique |

## 2. Configuration

```bash
cp .env.production.example .env.production
```
Remplir **toutes** les variables. Générer chaque secret avec `openssl rand -base64 32` (un secret différent par variable).

## 3. Première migration de la base (à faire UNE fois, sur votre poste)

Les migrations Prisma doivent être générées par un outil qui a accès au moteur Prisma, ce que je n'ai pas pu faire de mon côté :

```bash
cp .env.example .env            # DATABASE_URL pointant vers le PostgreSQL local (docker compose up -d)
npm install
npm run db:migrate -- --name init
git add packages/db/prisma/migrations && git commit -m "Migration initiale"
```
Le dossier `packages/db/prisma/migrations` fait ensuite partie du projet. Chaque évolution du schéma = une nouvelle migration (`npm run db:migrate -- --name ce_que_je_change`), appliquée en production par `prisma migrate deploy` (automatique avec le compose ci-dessous).

## 4a. Déploiement sur un serveur (VPS) — recommandé pour garder la main

Sur le serveur (Docker et Docker Compose installés), DNS : deux enregistrements `A` (`monsite.fr` et `admin.monsite.fr`) vers l'IP du serveur.

```bash
git clone <votre-dépôt> rideau && cd rideau
cp .env.production.example .env.production   # puis remplir
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```
Cela démarre : PostgreSQL, les migrations, le site, l'admin, HTTPS automatique (Caddy), le nettoyage des commandes expirées (toutes les 5 min) et une sauvegarde quotidienne de la base.

Créer les données de base et le premier administrateur :
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate npm run db:seed
```
(le seed ajoute aussi 4 événements de démonstration : à supprimer ou archiver depuis l'admin avant l'ouverture.)

Vérifier : `https://monsite.fr/api/health` et `https://admin.monsite.fr/api/health` doivent répondre `{"ok":true}`.

## 4b. Déploiement sur Vercel (alternative)

- Deux projets Vercel depuis le même dépôt : *Root Directory* `apps/web` et `apps/admin`. Mêmes variables d'environnement que ci-dessus.
- Il faut la formule **Pro** (usage commercial et tâche toutes les 5 minutes, voir `apps/web/vercel.json`).
- Base PostgreSQL managée dans l'UE (`DATABASE_URL`), migrations appliquées depuis votre poste : `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`.

## 5. Déclarer les webhooks (obligatoire : sans eux, aucun billet n'est émis)

**Stripe** (Développeurs → Webhooks → Ajouter un endpoint, en mode **production**)
- URL : `https://monsite.fr/api/webhooks/stripe`
- Événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
- Copier le secret de signature (`whsec_…`) dans `STRIPE_WEBHOOK_SECRET`, puis redémarrer.

**NOWPayments**
- URL de notification (IPN) : `https://monsite.fr/api/webhooks/nowpayments` (déjà envoyée avec chaque facture)
- Secret IPN dans `NOWPAYMENTS_IPN_SECRET`. Utiliser `NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1`.

## 5 bis. Virement bancaire

Le client peut choisir « Virement bancaire » au paiement. Fonctionnement :

1. **L'admin enregistre ses comptes** : Admin → *Comptes bancaires* (IBAN vérifié par sa clé de contrôle, mot de passe demandé à chaque modification). Sans compte actif, l'option n'apparaît pas.
2. Le client choisit le virement : il reçoit **par e-mail et sur sa page de commande** le montant, la référence à mettre en libellé et les coordonnées. Ses places sont réservées `BANK_HOLD_HOURS` heures (48 par défaut).
3. Il **envoie la capture ou le PDF** de sa preuve depuis sa page de commande. Le fichier est contrôlé (type réel, 5 Mo), nettoyé (métadonnées retirées) et stocké **en base de données, jamais dans un espace public**. Les administrateurs reçoivent un e-mail.
4. L'admin ouvre **Virements → À vérifier**, compare avec son relevé bancaire, puis :
   - **Confirme** : les billets sont générés et envoyés au client automatiquement ;
   - ou **refuse** avec un motif (le client est prévenu et peut renvoyer une preuve).
5. Pendant la vérification, la réservation est maintenue 7 jours. Si l'admin confirme après expiration et que les places ont été vendues entre-temps, l'admin en est informé : il faut alors **rembourser le client**.

Configuration requise : `INTERNAL_API_SECRET` (identique pour le site et l'admin), `ADMIN_URL`. L'admin confirme les virements en appelant l'API interne du site (`/api/internal/bank`) : avec le Caddyfile fourni elle n'est **pas accessible depuis Internet** (l'admin l'appelle via le réseau Docker, `WEB_INTERNAL_URL`). Sur Vercel, l'API reste protégée par le secret.

## 6. Check-list avant ouverture au public

- [ ] `https://monsite.fr/api/health` répond `ok` ; aucun avertissement « MODE TEST » dans les logs (`docker compose logs web`)
- [ ] Mot de passe administrateur changé ; comptes de l'équipe créés ; événements de démonstration retirés
- [ ] **Achat réel de test** (quelques euros) par carte : billet reçu par e-mail, PDF lisible, QR scanné une fois puis refusé la 2ᵉ fois, puis remboursement depuis le tableau de bord Stripe
- [ ] Même test avec la crypto, avec un petit montant
- [ ] Virement : compte bancaire ajouté, commande de test par virement, preuve envoyée, e-mail reçu par l'admin, confirmation, billets reçus
- [ ] Les coordonnées bancaires affichées au client sont **exactement** celles de votre banque (relire l'IBAN)
- [ ] Images : téléverser une image dans l'admin, elle s'affiche sur le site
- [ ] Mot de passe oublié : l'e-mail arrive (et pas dans les courriers indésirables)
- [ ] Pages légales complétées (`apps/web/lib/legal.ts`) et relues par un juriste
- [ ] Restauration d'une sauvegarde testée au moins une fois
- [ ] Scanner testé sur un vrai téléphone, en HTTPS

## 7. Exploitation

- **Logs** : `docker compose --env-file .env.production -f docker-compose.prod.yml logs -f web admin`
- **Commande payée mais non validable** (places reprises après expiration) : signalée dans les logs par `traitement manuel requis` ; rembourser depuis Stripe / NOWPayments.
- **Mise à jour** : `git pull` puis relancer la commande `up -d --build` (les migrations s'appliquent seules).
- **Sauvegardes** : volume Docker `backups` (14 jours). Pensez à les copier hors du serveur.
