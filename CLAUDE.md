# MICH-ENGER — Claude Code Guide

App desktop Electron per gestire contatti WhatsApp con interfaccia simile a Slack, messaggi programmati, sistema task/to-do e supporto multi-account.

---

## Stack Tecnologico

| Componente | Tecnologia |
|---|---|
| Desktop Shell | Electron 33+ |
| UI Framework | React 19 + Vite |
| Database | better-sqlite3 (WAL mode) |
| WhatsApp | whatsapp-web.js |
| Scheduling | node-schedule |
| Notifiche | Electron Notification API |
| Icone | Lucide React |
| Tema | CSS Custom Properties |

---

## Architettura

```
Main Process          Preload              Renderer (React)
─────────────         ──────────           ────────────────
SQLite (better-       contextBridge   ←──  UI Components
  sqlite3)       ←──  API                  State Management
whatsapp-web.js
node-schedule
Electron Notifications
IPC Handlers
```

### Regole architetturali
- `contextIsolation: true`, `nodeIntegration: false` sempre
- Tutta la logica Node.js nel Main Process
- Il Renderer non accede mai direttamente al filesystem o a Node
- Comunicazione Renderer → Main solo tramite `contextBridge`

---

## Struttura File

```
MICH-ENGER/
├── package.json
├── vite.config.js
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── main.js                    # Entry Electron
│   │   ├── database.js                # SQLite setup + CRUD
│   │   ├── ipc-handlers.js            # IPC bridge
│   │   ├── whatsapp-manager.js        # Multi-account WhatsApp
│   │   ├── scheduler.js               # Messaggi programmati
│   │   └── notification-manager.js    # Notifiche desktop
│   ├── preload/
│   │   └── preload.js                 # contextBridge
│   └── renderer/
│       ├── index.html
│       ├── index.jsx                  # React entry
│       ├── index.css                  # Design system + temi
│       ├── App.jsx                    # Layout + routing
│       └── components/
│           ├── Sidebar.jsx
│           ├── FolderTree.jsx
│           ├── AccountSwitcher.jsx
│           ├── ThemeToggle.jsx
│           ├── ChatView.jsx
│           ├── ContactList.jsx
│           ├── QRCodeModal.jsx
│           ├── ScheduleMessageModal.jsx
│           ├── ScheduledList.jsx
│           ├── FolderContactManager.jsx
│           ├── TaskView.jsx
│           ├── TaskDetailModal.jsx
│           ├── MessageToTask.jsx
│           └── SearchOverlay.jsx
├── assets/
│   └── icons/
└── media/                             # Media WhatsApp scaricati
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
TASKS    ||--o{ TASK_LABEL_MAP
TASK_LABELS ||--o{ TASK_LABEL_MAP
SCHEDULED_MESSAGES }o--|| CONTACTS
SCHEDULED_MESSAGES }o--|| FOLDERS
```

Tabelle principali: `ACCOUNTS`, `CONTACTS`, `FOLDERS`, `FOLDER_MEMBERS`, `MESSAGES`, `SCHEDULED_MESSAGES`, `TASKS`, `TASK_LABELS`, `TASK_LABEL_MAP`.

Database in `app.getPath('userData')`, WAL mode attivo.

---

## Layout UI

```
┌──────────────────────────────────────────────────────────┐
│  Menu Bar                                                │
├────┬───────────────┬─────────────────────────────────────┤
│ AC │  SIDEBAR      │  MAIN AREA                         │
│ SW │               │                                     │
│    │ 🔍 Ricerca    │  [Header: nome contatto/cartella]  │
│    │               │                                     │
│    │ 📁 Cartelle   │  Chat / Task View                  │
│    │  ├─ Lavoro    │  (bolle messaggi stile chat)       │
│    │  └─ Personale │                                     │
│    │               │  [Input messaggio...]              │
│    │ 👤 Contatti   │  [📎 📷 🎤 ⏰ Programma]          │
│    │ 👥 Gruppi     │                                     │
│    │ ✅ Tasks      │                                     │
│    │ ⏰ Programmati│                                     │
├────┴───────────────┴─────────────────────────────────────┤
│  Status: Connesso ● | Account: +39 xxx | Tema: 🌙      │
└──────────────────────────────────────────────────────────┘
```

---

## Avvertenze importanti

> **whatsapp-web.js è una libreria non ufficiale.** WhatsApp può bannare temporaneamente account che la usano in modo aggressivo. Limitare la frequenza di invio e non inviare a molti contatti contemporaneamente.

---

## Task Tracker

### Fase 1 — Fondamenta *(in corso)*
- [/] Setup progetto Electron + React + Vite
- [ ] Configurazione electron-vite
- [ ] Database SQLite (schema completo)
- [ ] IPC handlers (bridge Main ↔ Renderer)
- [ ] Preload script con contextBridge
- [ ] Design system CSS (temi chiaro/scuro)
- [ ] Layout principale (Sidebar + Main Area)
- [ ] Account Switcher
- [ ] Folder Tree (ricorsivo, CRUD)
- [ ] Theme Toggle
- [ ] Sezioni sidebar (Contatti, Gruppi, Tasks, Programmati)
- [ ] Ricerca globale (UI base)

### Fase 2 — WhatsApp Connection + Chat
- [ ] WhatsApp Manager (multi-account)
- [ ] QR Code Modal
- [ ] Sincronizzazione contatti/gruppi
- [ ] Chat View completa
- [ ] Supporto media (immagini, video, audio, documenti)
- [ ] Contact List con badge non letti

### Fase 3 — Messaggi Programmati + Cartelle Avanzate
- [ ] Schedule Message Modal
- [ ] Scheduler engine (node-schedule)
- [ ] Lista messaggi programmati
- [ ] Ricorrenze (giornaliero, settimanale, mensile, personalizzato)
- [ ] Folder Contact Manager (assegnazione multi-cartella)
- [ ] Anteprima messaggio

### Fase 4 — Task/To-Do + Notifiche + Polish
- [ ] Task Board (colonne per stato)
- [ ] Task Detail Modal
- [ ] Creazione task da messaggio
- [ ] Etichette task con colori
- [ ] Notification Manager
- [ ] Search Overlay (Ctrl+K)
- [ ] Animazioni e polish finale

---

## Implementation Plan per Fase

### Fase 1
- `package.json` — dipendenze: electron, react, vite, better-sqlite3, lucide-react; script: dev, build, package
- `src/main/main.js` — BrowserWindow, contextIsolation, init DB
- `src/main/database.js` — SQLite WAL, schema completo, CRUD per ogni entità
- `src/main/ipc-handlers.js` — handler per accounts, contacts, folders, messages, tasks, scheduled
- `src/preload/preload.js` — contextBridge con API sicure
- `src/renderer/App.jsx` — layout sidebar + main area, router viste
- `src/renderer/index.css` — CSS custom properties, tema chiaro/scuro, stile Slack-like
- `src/renderer/components/Sidebar.jsx` — account switcher, folder tree, sezioni, ricerca
- `src/renderer/components/FolderTree.jsx` — componente ricorsivo, CRUD inline, drag & drop
- `src/renderer/components/ThemeToggle.jsx` — switch tema, salvataggio in localStorage

### Fase 2
- `src/main/whatsapp-manager.js` — multi-istanza, QR via IPC, sync contatti, download media
- `src/renderer/components/QRCodeModal.jsx` — stati: attesa / scansione / connesso / errore
- `src/renderer/components/ChatView.jsx` — bolle, media inline, input con emoji e allegati, scroll infinito
- `src/renderer/components/ContactList.jsx` — foto profilo, badge non letti
- `src/renderer/components/AccountSwitcher.jsx` — avatar, bottone "+", stato connessione

### Fase 3
- `src/renderer/components/ScheduleMessageModal.jsx` — data/ora, ricorrenze, selezione destinatari, anteprima
- `src/main/scheduler.js` — node-schedule, check al boot e ogni minuto, gestione ricorrenze, log
- `src/renderer/components/ScheduledList.jsx` — lista con stato, prossimo invio, azioni
- `src/renderer/components/FolderContactManager.jsx` — assegnazione contatti multipli, conteggio per cartella

### Fase 4
- `src/renderer/components/TaskView.jsx` — board kanban, drag & drop, filtri
- `src/renderer/components/TaskDetailModal.jsx` — editing completo, etichette, notifica, link messaggio
- `src/renderer/components/MessageToTask.jsx` — quick-create da bolla, collegamento bidirezionale
- `src/main/notification-manager.js` — notifiche task e messaggi programmati
- `src/renderer/components/SearchOverlay.jsx` — Ctrl+K, risultati raggruppati per tipo

---

## Verification Plan

### Automated
- Test unitari `database.js` (CRUD tutte le tabelle)
- Test `scheduler.js` (calcolo prossimo invio, ricorrenze)
- Avvio app Electron e verifica rendering UI

### Manual
- Scansione QR e connessione WhatsApp
- Invio/ricezione messaggi in tempo reale
- Cartelle nidificate + assegnazione contatti
- Messaggi programmati con ricorrenze
- Task da messaggio + gestione board
- Switch tema chiaro/scuro
- Multi-account
- Notifiche desktop
