# Melogic Records

**Melogic Records** is a producer-first music platform built around digital audio goods, creator commerce, artist infrastructure, community, livestreaming, and browser-based creative tools.

The project is currently built as a Vite-powered web app with Firebase-backed hosting, authentication, Firestore, Storage, and Cloud Functions. It also integrates Stripe for commerce, LiveKit for realtime communication, and Three.js for interactive studio/stage tooling.

---

## What Melogic Is

Melogic is being designed as more than a record label website. It is a full creative platform for musicians, producers, artists, and digital audio creators.

Core areas include:

- **Marketplace** — sell and discover digital audio products, sample packs, tools, presets, and creator-made resources.
- **Melogic Studio** — browser-based music creation tools and project workflows.
- **Stage Maker** — visual stage and viewport planning tools for creative/live-production layouts.
- **Community** — posts, profiles, creator discovery, and community spaces.
- **Inbox** — messaging, calls, content notifications, and system communication.
- **Livestreaming** — live creator sessions and realtime interaction.
- **Distribution** — release and artist infrastructure workflows.
- **Admin Console** — product review, users, reports, orders, team tools, operations, logs, and platform settings.

---

## Current Tech Stack

### Frontend

- **Vite**
- **Vanilla JavaScript / ES Modules**
- **CSS modules by feature/page structure**
- **Firebase client SDK**
- **Stripe.js**
- **LiveKit client**
- **Three.js**
- **JSZip**
- **QRCode**

### Backend / Platform

- **Firebase Hosting**
- **Firebase Authentication**
- **Cloud Firestore**
- **Firebase Storage**
- **Firebase Cloud Functions**
- **Stripe**
- **LiveKit server SDK**
- **Nodemailer**

---

## Major Routes

Melogic currently supports a large route surface, including:

| Area | Routes |
|---|---|
| Home | `/home` |
| Marketplace | `/products`, `/products/new`, `/products/dashboard`, `/products/:id` |
| Cart & Orders | `/cart`, `/account/orders`, `/account/library` |
| Auth | `/auth`, `/auth/action` |
| Profiles | `/profile`, `/profile/edit`, `/profile/public`, `/u/:username`, `/profiles/:id` |
| Inbox | `/inbox`, `/inbox/messages`, `/inbox/calls`, `/inbox/content`, `/inbox/system` |
| Community | `/community`, `/community/communities`, `/community/create`, `/community/c/:slug`, `/community/post/:id` |
| Live | `/live` |
| Studio | `/studio`, `/studio/daw`, `/studio/daw/project/:id` |
| Stage Maker | `/studio/stagemaker`, `/studio/stagemaker/project/:id`, `/stage` |
| Support | `/support`, `/faq`, `/forms` |
| Distribution | `/distribution` |
| Admin | `/admin`, `/admin/reviews`, `/admin/products`, `/admin/users`, `/admin/reports`, `/admin/orders`, `/admin/team`, `/admin/logs`, `/admin/tools`, `/admin/operations`, `/admin/settings` |

---

## Project Structure

```txt
MELOGIC_RECORDS/
├── functions/               # Firebase Cloud Functions
├── scripts/                 # Build/config validation scripts
├── src/
│   ├── components/          # Shared UI components
│   ├── firebase/            # Firebase client/platform helpers
│   ├── livekit/             # LiveKit-related helpers/debug tooling
│   ├── styles/              # Base and feature styling
│   └── utils/               # Shared utilities and route helpers
├── firebase.json            # Firebase Hosting, rewrites, headers, emulators
├── firestore.rules          # Firestore security rules
├── firestore.indexes.json   # Firestore index configuration
├── storage.rules            # Firebase Storage rules
├── package.json             # Frontend dependencies and scripts
└── index.html               # Main app shell
