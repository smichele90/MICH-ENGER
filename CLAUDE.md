# MICH-ENGER — Claude Code Guide

App desktop Electron per gestire contatti WhatsApp con interfaccia simile a Slack, messaggi programmati, sistema task/to-do e supporto multi-account.

---

## Stack Tecnologico

| Componente | Tecnologia |
|---|---|
| Desktop Shell | Electron 33 |
| UI Framework | React 19 + Vite 6 |
| Database | better-sqlite3 (WAL mode) |
| WhatsApp | whatsapp-web.js 1.26 |
| Scheduling | node-schedule 2.1 |
| QR Code | qrcode 1.5 |
| Notifiche | Electron Notification API |
| Icone | Lucide React |
| Tema | CSS Custom Properties |

---

## Architettura

```
Main Process          Preload              Renderer (React)
─────────────         ──────────           ────────────────
SQLite (better-       contextBridge   ←──  UI Components
  sqlite3)       ←──  API (65 fn)          State Management
whatsapp-web.js                            Lucide icons
node-schedule
Electron Notifications
IPC Handlers
```

### Regole architetturali
- `contextIsolation: true`, `nodeIntegration: false` sempre
- Tutta la logica Node.js nel Main Process
- Il Renderer non accede mai direttamente al filesystem o a Node
- Comunicazione Renderer → Main solo tramite `contextBridge`
- Media serviti tramite protocollo custom `media://` (sicuro, no file://)

---

## Struttura File

```
MICH-ENGER/
├── package.json
├── vite.config.js
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── main.js                    # Entry Electron, BrowserWindow, protocollo media://
│   │   ├── database.js                # SQLite WAL, schema 12 tabelle, migrazioni runtime
│   │   ├── ipc-handlers.js            # IPC bridge (tutti gli handler CRUD)
│   │   ├── whatsapp.js                # WhatsAppManager multi-account (classe principale)
│   │   ├── scheduler.js               # Messaggi programmati con node-schedule
│   │   └── notification-manager.js    # Notifiche desktop (task + programmati)
│   ├── preload/
│   │   └── preload.js                 # contextBridge con 65 API sicure
│   └── renderer/
│       ├── index.html
│       ├── index.jsx                  # React entry
│       ├── index.css                  # Design system + temi chiaro/scuro
│       ├── App.jsx                    # Layout root, listener WA events, state globale
│       └── components/
│           ├── Sidebar.jsx            # Ricerca, sezioni, folder tree, badge non letti
│           ├── FolderTree.jsx         # Albero cartelle ricorsivo, CRUD inline
│           ├── FolderView.jsx         # Vista lista contatti di una cartella
│           ├── FolderContactManager.jsx # Assegnazione contatti a cartella
│           ├── AccountSwitcher.jsx    # Avatar account, status dot, theme/volume/color
│           ├── ThemeToggle.jsx        # Switch tema dark/light
│           ├── ColorPanel.jsx         # Editor colori custom per tema
│           ├── AvatarImage.jsx        # Avatar con fallback icona
│           ├── ChatView.jsx           # Chat completa: bolle, media, @mention, reazioni
│           ├── MessageBody.jsx        # Rendering testo + @mention colorate
│           ├── MediaPreview.jsx       # Galleria foto/video/audio/ptt, download on-demand
│           ├── ForwardModal.jsx       # Forward messaggio a contatti/gruppi
│           ├── QRCodeModal.jsx        # QR pairing con stati e timeout
│           ├── ScheduleMessageModal.jsx # Modal programma messaggio con @mention gruppi
│           ├── ScheduledList.jsx      # Lista programmati con stato e azioni
│           ├── TaskView.jsx           # Board kanban 4 colonne, drag & drop
│           ├── TaskDetailModal.jsx    # Editing completo task con etichette e notifica
│           ├── TaskCreateModal.jsx    # Quick-create task
│           ├── MessageToTask.jsx      # Crea task da bolla messaggio
│           ├── SearchOverlay.jsx      # Ctrl+K ricerca globale raggruppata
│           └── ConfirmDialog.jsx      # Dialog conferma generico
├── assets/
│   └── icons/
└── media/                             # Media WhatsApp scaricati on-demand
```

---

## Schema Database

```
ACCOUNTS ||--o{ CONTACTS
ACCOUNTS ||--o{ SCHEDULED_MESSAGES
CONTACTS ||--o{ MESSAGES
CONTACTS ||--o{ FOLDER_MEMBERS
FOLDERS  ||--o{ FOLDER_MEMBERS
FOLDERS  ||--o{ FOLDERS (self-ref, nesting illimitato)
MESSAGES ||--o{ TASKS
MESSAGES ||--o{ MESSAGE_REACTIONS
TASKS    ||--o{ TASK_LABEL_MAP
TASK_LABELS ||--o{ TASK_LABEL_MAP
SCHEDULED_MESSAGES }o--|| CONTACTS
SCHEDULED_MESSAGES }o--|| FOLDERS
```

**Tabelle:** `accounts`, `contacts`, `folders`, `folder_members`, `messages`, `message_reactions`, `scheduled_messages`, `tasks`, `task_labels`, `task_label_map`, `settings`

**Colonne notevoli:**
- `messages.wa_serialized_id` — ID serializzato WhatsApp per ack e reazioni
- `messages.reactions` — JSON conteggio reazioni per tipo emoji
- `messages.ack` — stato consegna (0=pending, 1=sent, 2=delivered, 3=read)
- `scheduled_messages.mentions_json` — JSON array wa_id per menzioni in gruppi
- `contacts.is_group` — 1 per gruppi WhatsApp

Database in `app.getPath('userData')`, WAL mode + foreign keys attivi.
Migrazioni additive eseguite runtime (no `DROP TABLE`, retrocompatibili).

---

## Layout UI

```
┌──────────────────────────────────────────────────────────┐
│  Titlebar personalizzata (no frame nativo)               │
├────┬───────────────┬─────────────────────────────────────┤
│ AC │  SIDEBAR      │  MAIN AREA                         │
│ SW │               │                                     │
│    │ 🔍 Ricerca    │  [Header: nome contatto/cartella]  │
│    │               │                                     │
│    │ 📁 Cartelle   │  Chat / Task View / Programmati    │
│    │  ├─ ...       │  (bolle messaggi stile chat)       │
│    │               │                                     │
│    │ 👤 Contatti   │  [Input + @mention + emoji + 📎]  │
│    │ 👥 Gruppi     │  [📷 🎤 ⏰ Programma]             │
│    │ ✅ Tasks      │                                     │
│    │ ⏰ Programmati│                                     │
├────┴───────────────┴─────────────────────────────────────┤
│  Status: Connesso ● | Account: +39 xxx | Tema 🌙 | 🔊  │
└──────────────────────────────────────────────────────────┘
```

---

## Avvertenze importanti

> **whatsapp-web.js è una libreria non ufficiale.** WhatsApp può bannare temporaneamente account che la usano in modo aggressivo. Limitare la frequenza di invio e non inviare a molti contatti contemporaneamente.

---

## Stato Implementazione

### Fase 1 — Fondamenta ✅ COMPLETA
- [x] Setup progetto Electron + React + Vite
- [x] Database SQLite (schema 11 tabelle + migrazioni runtime)
- [x] IPC handlers (tutti gli handler CRUD per ogni entità)
- [x] Preload script con contextBridge (65 API)
- [x] Design system CSS (temi chiaro/scuro + custom color editor)
- [x] Layout principale (Sidebar + Main Area, titlebar custom)
- [x] Account Switcher (multi-account, avatar, status dot)
- [x] Folder Tree (ricorsivo, CRUD inline, gestione membri)
- [x] Theme Toggle + Color Panel
- [x] Sezioni sidebar (Contatti, Gruppi, Tasks, Programmati)
- [x] Ricerca globale (Ctrl+K, risultati raggruppati)

### Fase 2 — WhatsApp Connection + Chat ✅ COMPLETA
- [x] WhatsApp Manager multi-account (`whatsapp.js`, classe `WhatsAppManager`)
- [x] QR Code Modal (stati: loading/qr/connecting/ready/error, timeout 120s)
- [x] Sincronizzazione contatti/gruppi (bulk + deduplication)
- [x] Chat View completa (bolle, media inline, scroll)
- [x] Supporto media on-demand (foto, video, audio, ptt, documenti, sticker)
- [x] Badge non letti + indicatori ack (pending/sent/delivered/read)
- [x] Reazioni emoji (aggiunta, rimozione, conteggio per tipo)
- [x] Forward messaggio a qualsiasi contatto/gruppo
- [x] @mention autocomplete in gruppi (mostra nome, non numero)

### Fase 3 — Messaggi Programmati + Cartelle Avanzate ✅ COMPLETA
- [x] Schedule Message Modal (contatto/gruppo/cartella, anteprima)
- [x] @mention gruppi nei messaggi programmati
- [x] Scheduler engine (node-schedule, riallineamento boot)
- [x] Ricorrenze: once, daily, weekly, monthly, custom (cron)
- [x] Lista messaggi programmati (pause/resume/edit/delete)
- [x] Folder Contact Manager (assegnazione multi-contatto)

### Fase 4 — Task/To-Do + Notifiche + Polish ✅ COMPLETA
- [x] Task Board (kanban 4 colonne, drag & drop, filtri priorità)
- [x] Task Detail Modal (editing, etichette, notifica, link messaggio)
- [x] Creazione task da messaggio (quick-create dalla bolla)
- [x] Etichette task con colori personalizzati
- [x] Notification Manager (task scaduti, messaggi programmati)
- [x] Search Overlay (Ctrl+K, messaggi + task + contatti)
- [x] Badge taskbar (Windows/macOS) con conteggio non letti
- [x] Suoni notifica nuovi messaggi

---

## Feature Avanzate (non pianificate in origine)

| Feature | File | Note |
|---|---|---|
| Reazioni emoji | `whatsapp.js` + `ChatView.jsx` | upsert/delete, conteggio per tipo |
| Message ack | `whatsapp.js` + `ChatView.jsx` | 4 stati con icone |
| Forward messaggio | `whatsapp.js` + `ForwardModal.jsx` | ricerca destinatario |
| Deduplica contatti | `database.js` + `ipc-handlers.js` | merge per stesso numero |
| Media thumb base64 | `whatsapp.js` | preview immediata senza scaricare |
| Custom color editor | `ColorPanel.jsx` | 6 variabili colore per tema |
| Window controls custom | `main.js` | titlebar nascosta, pulsanti custom |
| Protocollo media:// | `main.js` | accesso sicuro ai media locali |
| @mention → nome | `ChatView.jsx` | mostra nome invece del numero |
| @mention in programmati | `ScheduleMessageModal.jsx` | dropdown partecipanti gruppo |

---

## Comandi di Sviluppo

```bash
npm run dev      # Avvia Electron + Vite in dev mode
npm run build    # Build renderer (Vite)
npm run package  # Pacchetto installabile (electron-builder)
```

---

## Verification Plan

### Manuale
- Scansione QR e connessione account WhatsApp
- Invio/ricezione messaggi in tempo reale
- @mention in gruppi: verifica nome nel testo e mention metadata a WA
- Messaggi programmati con ricorrenze e @mention
- Cartelle nidificate + assegnazione contatti
- Task da messaggio + gestione board kanban
- Reazioni emoji (aggiungi, rimuovi, visualizza conteggio)
- Forward messaggio
- Switch tema chiaro/scuro + custom colors
- Multi-account (aggiungi, switch, disconnetti)
- Notifiche desktop (task scaduti, programmati inviati)
- Badge taskbar e suoni notifica
- Ricerca globale Ctrl+K
