# MazeCD — PWA multi-istanza per ArgoCD

**Data:** 2026-09-11
**Stato:** approvato, pronto per il piano di implementazione

## 1. Obiettivo

Una PWA mobile-first per operare su più istanze ArgoCD dal telefono: vedere cosa
è rotto adesso e agire (sync, refresh, rollback, delete, log) senza aprire la web
UI ufficiale e senza riautenticarsi continuamente.

Criteri di successo:

1. Da schermata di blocco a "sync avviato su app X" in meno di 15 secondi.
2. Nessun re-login se si apre l'app almeno una volta ogni 90 giorni.
3. Dopo il deploy di una nuova release, il client si aggiorna senza interventi
   manuali (no svuotamento cache, no reinstall).
4. Le app di tutte le istanze sono visibili in una lista sola.

Non obiettivi: sostituire la web UI ArgoCD per attività di configurazione,
amministrare ArgoCD (repo, cluster, project, ApplicationSet), essere multi-utente.

## 2. Decisioni architetturali

| Decisione | Scelta | Motivo |
|---|---|---|
| Dove vivono le credenziali | Backend (BFF) | Le API ArgoCD non espongono CORS permissivi cross-origin; i token non devono stare sul dispositivo |
| Comunicazione con ArgoCD | Reverse proxy autenticato | Evita di reimplementare ~30 endpoint: le azioni arrivano gratis |
| Credenziali ArgoCD | API token per-account | Long-lived, revocabili, RBAC dedicata, nessuna scadenza da gestire |
| Registrazione istanze | File di config + env expansion | GitOps-friendly, token da secret Kubernetes |
| Cifratura token a riposo | Nessuna (deliberata) | I token stanno già in un secret montato; cifrarli con una master key adiacente non aggiunge sicurezza |
| Persistenza | Un file JSON | L'unico stato è la credenziale passkey |
| Auth applicativa | Password bcrypt + passkey | Single-user, sessione lunga, nessuna dipendenza esterna |
| Aggiornamento dati | Polling adattivo | Semplice, batteria-friendly, backend stateless |
| Stack | Go + React/Vite/TS/Tailwind | Binario singolo con statici embedded; ecosistema PWA maturo |
| Deploy | Immagine Docker singola | Target immediato Docker, successivamente Kubernetes |

Scala di riferimento: fino a ~10 istanze e qualche centinaio di Application
totali. Oltre, la lista aggregata va paginata server-side.

## 3. Architettura

Un solo processo Go che serve API e PWA dalla stessa origine (nessun CORS,
nessun nginx). I file statici sono incorporati nel binario con `go:embed`.

```
Browser (PWA)
  │  cookie di sessione httpOnly
  ▼
MazeCD (Go, :8080)
  ├── /api/auth/*              password, passkey, sessione
  ├── /api/instances           nomi, colori, stato connessione (mai i token)
  ├── /api/apps                fan-out aggregato su tutte le istanze
  ├── /api/i/{istanza}/*  ───► {url}/api/v1/*  con Bearer token iniettato
  ├── /api/version             versione build (controllo aggiornamenti)
  └── /*                       PWA, SPA fallback
  │
  ▼ HTTPS (CA custom opzionale)
argocd-server (prod, staging, dev, ...)
```

### 3.1 Proxy per-istanza

`/api/i/{istanza}/*` inoltra il path residuo a `{url_istanza}/api/v1/*`,
sostituendo l'header `Authorization` con il token dell'istanza. Requisiti:

- Richiede una sessione valida, altrimenti 401. Non è un relay aperto.
- Istanza non presente in config → 404.
- Header `Authorization` in ingresso dal client sempre scartato.
- Streaming preservato (log dei pod, `?follow=true`): nessun buffering della
  risposta, flush immediato.
- Client HTTP per istanza, con `RootCAs` da `caCert` o `InsecureSkipVerify`
  quando richiesto dal config.
- La RBAC del token ArgoCD è la seconda linea di difesa: se il token non può
  sincronizzare, ArgoCD risponde 403 e la UI mostra l'errore.

Conseguenza: sync (con tutte le opzioni), refresh e hard refresh, history e
rollback, delete application, delete/restart di singole risorse, eventi,
manifest, diff e log in streaming non richiedono codice dedicato nel backend.

### 3.2 Endpoint aggregato

`GET /api/apps` interroga in parallelo `/api/v1/applications` su ogni istanza
con timeout per-istanza (5s), normalizza il risultato al sottoinsieme di campi
usato dalla UI e marca ogni voce con l'istanza di provenienza.

Tolleranza ai guasti: un'istanza che non risponde non fa fallire la richiesta.
La risposta è sempre `200` con risultati parziali:

```json
{
  "apps": [ { "instance": "prod", "name": "...", "project": "...",
              "namespace": "...", "health": "Degraded", "sync": "OutOfSync",
              "revision": "abc1234", "operationPhase": "Running" } ],
  "errors": [ { "instance": "staging", "message": "context deadline exceeded" } ]
}
```

Nessuna cache server-side: il polling del client è la sola sorgente di freschezza.

### 3.3 Configurazione

```yaml
# /etc/mazecd/config.yaml
listen: ":8080"
instances:
  - name: prod
    url: https://argocd.prod.internal
    token: ${ARGOCD_TOKEN_PROD}
    color: "#ef4444"
    production: true
    caCert: /certs/prod.pem
    insecureSkipVerify: false
  - name: dev
    url: https://argocd.dev.internal
    token: ${ARGOCD_TOKEN_DEV}
    color: "#3b82f6"
```

- `${VAR}` è espanso dall'ambiente al caricamento; una variabile mancante è un
  errore fatale allo startup (fail fast, non un token vuoto).
- `name` univoco, obbligatorio, usato come segmento di URL: `[a-z0-9-]+`.
- `production: true` attiva conferme rinforzate nella UI.
- Letta **solo allo startup**. `ponytail: reload allo startup; aggiungere
  fsnotify solo se la rotazione dei token senza restart diventa un problema reale.`

Variabili d'ambiente:

| Variabile | Obbligatoria | Uso |
|---|---|---|
| `MAZECD_CONFIG` | no (default `/etc/mazecd/config.yaml`) | percorso config |
| `MAZECD_PASSWORD_HASH` | sì | hash bcrypt della password, da `mazecd hash` |
| `MAZECD_SESSION_KEY` | sì | chiave di firma dei cookie di sessione (32 byte base64) |
| `MAZECD_STATE` | no (default `/data/state.json`) | stato passkey |
| `MAZECD_RP_ID` | sì se si usa la passkey | hostname per WebAuthn |
| `MAZECD_ORIGIN` | sì se si usa la passkey | origin completo servito, es. `https://mazecd.example.com` |
| `ARGOCD_TOKEN_*` | secondo config | token delle istanze |

## 4. Autenticazione

### 4.1 Login

1. `POST /api/auth/login {password}` → verifica bcrypt (cost 12) contro
   `MAZECD_PASSWORD_HASH` (confronto a tempo costante), rate limit 5 tentativi
   per 15 minuti per IP. bcrypt e non argon2id: due chiamate a
   `golang.org/x/crypto/bcrypt` invece di ~60 righe di encoding e parsing
   scritte a mano, che è esattamente il codice in cui è facile sbagliare in
   silenzio.
2. In caso di successo, cookie di sessione: `httpOnly`, `Secure`,
   `SameSite=Lax`, `Path=/`, token opaco firmato in HMAC-SHA256 su `iat|exp`
   con `MAZECD_SESSION_KEY`, scadenza 90 giorni. Non un JWT: nessuna
   negoziazione di algoritmo da sbagliare e nessuna dipendenza.
3. Rinnovo scorrevole: ad ogni richiesta autenticata, se il token è stato
   emesso più di 24 ore prima, viene riemesso con scadenza a 90 giorni dal
   momento attuale. Aprire l'app almeno una volta ogni 90 giorni significa non
   riautenticarsi mai.
4. `POST /api/auth/logout` cancella il cookie.

### 4.2 Passkey

Dopo il primo login si può registrare una passkey (`POST
/api/auth/passkey/register/begin|finish`), così i login successivi usano
Face ID / impronta (`/api/auth/passkey/login/begin|finish`). Le credenziali
(credential ID, public key, sign count) vivono in `state.json`; la passkey si
può cancellare dalle impostazioni.

La password resta sempre valida come metodo di recupero.

### 4.3 Stato persistente

`state.json` è l'unico file scritto a runtime e contiene solo le credenziali
passkey. Scritture atomiche (write su file temporaneo + rename). Perderlo
significa solo dover rifare la registrazione della passkey.

## 5. Aggiornamento della PWA

Il vincolo è esplicito: dopo un deploy il client non deve restare su una
versione vecchia per colpa della cache. Tre livelli indipendenti:

1. **Header HTTP.** `index.html`, il manifest, il service worker e `/api/*` sono
   serviti con `Cache-Control: no-store`. Solo gli asset con hash nel nome sono
   `public, max-age=31536000, immutable`.
2. **Service worker.** `vite-plugin-pwa` in `registerType: 'autoUpdate'`:
   precache dell'app shell, `NetworkOnly` per `/api/*` — nessuna risposta
   ArgoCD finisce in cache, perché uno stato di sync stantio presentato come
   attuale è un rischio operativo, non una comodità.
3. **Controllo attivo.** Il client chiama `registration.update()` al load, ad
   ogni ritorno in foreground (`visibilitychange`) e ogni 60 secondi. Quando
   arriva un nuovo worker: `skipWaiting` + `clients.claim`, toast "Nuova
   versione disponibile — ricarica" e reload automatico se non ci sono
   operazioni in corso o sheet aperti.

`GET /api/version` restituisce la versione di build come controllo di
sicurezza: se differisce da quella compilata nel bundle, la UI mostra lo stesso
toast anche se il service worker non ha ancora visto il cambiamento.

Comportamento offline: l'app shell si apre, un banner dichiara "non connesso",
nessun dato viene mostrato come fresco.

## 6. Interfaccia

Dark-first, mobile-first, identità propria nel layout e nella tipografia, ma
codici colore di stato identici ad ArgoCD (Healthy verde, Progressing giallo,
Degraded rosso, OutOfSync arancio, Missing/Unknown grigio) perché sono memoria
muscolare.

### 6.1 Schermate

**Apps (home).** Lista aggregata di tutte le app di tutte le istanze
(nessuna virtualizzazione in v1: qualche centinaio di righe si rende senza
problemi su un telefono, e `@tanstack/react-virtual` si inserisce dietro lo
stesso componente se serve). Ogni riga: nome, badge colorato dell'istanza, health e sync, indicatore
di operazione in corso. Filtri per istanza, health, sync e project, più ricerca
testuale. Pull-to-refresh. Banner per le istanze non raggiungibili.

**App detail.** Header con stato, revisione, project e destinazione. Tab:

- *Tree*: albero delle risorse gestite, con health per nodo.
- *Diff*: differenze live vs desired.
- *Events*: eventi Kubernetes dell'app.
- *Manifest*: manifest desiderato e live.

Action bar sticky: Sync, Refresh (tap lungo → Hard refresh), History, Delete.

**Sync sheet.** Revision (default `HEAD`), i toggle sotto elencati, retry, e
selezione opzionale del sottoinsieme di risorse da sincronizzare. Se un sync è
in corso, il pulsante diventa "Terminate".

Mapping esatto verso `POST /api/v1/applications/{name}/sync` — è il punto in cui
un errore di traduzione produce un effetto distruttivo non voluto, quindi è
vincolante e coperto da test:

| Toggle UI | Campo della SyncRequest |
|---|---|
| Prune | `prune: true` |
| Dry run | `dryRun: true` |
| Force | `strategy.apply.force: true` (oppure `strategy.hook.force` se gli hook non sono saltati) |
| Replace | `syncOptions: ["Replace=true"]` |
| Salta gli hook | `strategy.apply` invece di `strategy.hook` |
| Risorse selezionate | `resources: [{group, kind, name, namespace}]` |
| Retry | `retryStrategy` |

**Resource sheet** (bottom sheet aprendo un nodo del tree). Log in streaming con
scelta del container e filtro testuale, eventi della risorsa, manifest,
azioni delete e restart.

**History.** Elenco delle revisioni deployate con autore e messaggio del commit,
azione di rollback.

**Settings.** Istanze in sola lettura con esito del test di connessione e
validità del token, gestione passkey, versione di build, logout.

### 6.2 Guardrail

Il rischio principale di una UI multi-istanza è agire sull'istanza sbagliata.

- Ogni dialogo di conferma mostra in evidenza **istanza + app**, con il colore
  dell'istanza.
- Il delete di una application richiede di digitare il nome dell'app.
- Le istanze con `production: true` richiedono conferma esplicita anche per il
  sync, non solo per le azioni distruttive.
- Il tasto Sync è disabilitato mentre un'operazione è in corso, per non
  accodare sync duplicati.

### 6.3 Dati lato client

TanStack Query con `refetchInterval: 8000`, sospeso quando il documento è in
background, `refetchOnWindowFocus` e `refetchOnReconnect` attivi, invalidazione
delle query dopo ogni mutazione. Nessun motore di polling scritto a mano.

Tipi TypeScript: sottoinsieme scritto a mano dei soli campi consumati dalla UI,
non l'intero swagger ArgoCD. `ponytail: tipi minimi a mano; generare da
swagger.json solo se il drift diventa un problema.`

## 7. Gestione degli errori

| Situazione | Comportamento |
|---|---|
| Istanza non raggiungibile | Risultati parziali + banner nella lista, riga di errore in Settings |
| 401 da ArgoCD | "Token dell'istanza X non valido" in Settings, azione bloccata |
| 403 da ArgoCD | Messaggio di permesso negato con l'errore originale |
| Sessione scaduta | Redirect alla schermata di login, con ritorno alla vista precedente |
| Variabile di config mancante | Errore fatale allo startup con il nome della variabile |
| Rete assente sul client | Banner offline, mutazioni disabilitate |

Gli errori ArgoCD vengono propagati verbatim: nessun messaggio generico che
nasconde la causa.

## 8. Test

Go:

- Richiesta al proxy senza sessione → 401.
- Il proxy inietta il token dell'istanza e scarta l'`Authorization` del client.
- Istanza sconosciuta → 404.
- Espansione `${ENV}` nel config; variabile mancante → errore allo startup.
- Fan-out con un'istanza che va in timeout → risultati parziali e `errors`
  popolato.
- Verifica password: hash corretto accettato, errato rifiutato.

Frontend:

- Mapping delle opzioni della sync sheet → payload della SyncRequest, secondo la
  tabella in 6.1 (unico punto dove un errore produce un effetto distruttivo non
  voluto).

Nessun framework e2e in v1.

## 9. Struttura del repository

```
cmd/mazecd/           main, subcomando `hash`
internal/config/      parsing, env expansion, validazione
internal/auth/        argon2id, webauthn, sessioni, state.json
internal/argocd/      proxy per-istanza, fan-out aggregato, client TLS
internal/web/         go:embed dei file statici, header di cache
web/                  React + Vite + TypeScript + Tailwind
docker/               Dockerfile multi-stage, compose.yaml
docs/superpowers/     spec e piani
```

Immagine: build Node → build Go → `distroless/static`. Un binario con la PWA
incorporata, circa 20 MB. Porta 8080, volume per `/data`, config e certificati
montati read-only.

## 10. Fuori scope in v1 (YAGNI)

Sono decisioni consapevoli, non dimenticanze:

- SSE / watch stream: il polling adattivo copre il caso d'uso reale.
- Web push su sync failed o health degraded: richiede watch persistenti e
  gestione delle subscription.
- ApplicationSets, Projects, Repositories, Clusters (anche in sola lettura).
- Multi-utente e RBAC applicativa.
- Terminal nei pod.
- Cifratura applicativa dei token a riposo.
- Hot-reload del config.
- Paginazione server-side della lista aggregata.
