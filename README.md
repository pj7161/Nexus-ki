# NEXUS AI · Private Workspace

Eine responsive, passwortgeschützte KI-Website für den privaten Zugriff über iPhone, Tablet und PC. Das Projekt läuft als Node.js-Webserver und kann bei einem Hosting-Anbieter mit HTTPS veröffentlicht werden.

## Enthaltene Module

- **Privater Login:** ein Passwort, keine öffentliche Registrierung, HttpOnly-Session-Cookie, SameSite=Strict, Secure-Cookie in Produktion und Login-Rate-Limit.
- **KI-Chat:** OpenAI-kompatibler Chat-Completions-Endpunkt, lokaler Chatverlauf im Browser.
- **Image Studio:** Bildgenerierung über die OpenAI Images API; Bilder lassen sich herunterladen und in einer lokalen IndexedDB-Galerie speichern.
- **Video Studio:** optionale Anbindung an Replicate. Das gewählte Modell muss die generischen Eingaben `prompt`, `aspect_ratio` und `duration` unterstützen.
- **Datei-Analyse:** TXT, Markdown, CSV, JSON, PDF und DOCX werden im Browser ausgelesen. Der extrahierte Text wird für die Analyse an die Chat-KI gesendet.
- **Voice Studio:** Spracheingabe über die Web Speech API und Vorlesen über die Browser-Sprachausgabe. Browser-Unterstützung variiert.
- **Websuche:** Brave Search API.
- **Responsive Oberfläche:** dunkles NEXUS-Design, optionales helles Theme, mobile Navigation.

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

1. `.env.example` kopieren und als `.env` speichern.
2. In `.env` ein eigenes `ADMIN_PASSWORD` mit mindestens 12 Zeichen setzen.
3. Optional die API-Zugänge eintragen (siehe unten).
4. Im Projektordner ausführen:

   ```bash
   npm start
   ```

5. `http://localhost:3000` öffnen.

Ohne KI-API-Schlüssel bleibt die Website privat erreichbar, die jeweiligen KI-Funktionen zeigen aber an, dass der Dienst nicht verbunden ist.

## API-Konfiguration

```env
# Erforderlich für den Login
ADMIN_PASSWORD=EIN_LANGES_EINZIGARTIGES_PASSWORT

# Chat (OpenAI-kompatibel)
API_BASE_URL=https://api.openai.com/v1
API_KEY=DEIN_CHAT_API_KEY
MODEL=gpt-4o-mini

# Bilder (OpenAI Images API)
IMAGE_API_BASE_URL=https://api.openai.com/v1
IMAGE_API_KEY=DEIN_BILD_API_KEY
IMAGE_MODEL=gpt-image-1

# Websuche
BRAVE_SEARCH_API_KEY=DEIN_BRAVE_SEARCH_KEY

# Optionales Video über Replicate
REPLICATE_API_TOKEN=DEIN_REPLICATE_TOKEN
VIDEO_MODEL=OWNER/MODEL
```

API-Schlüssel gehören ausschließlich in die Server-Umgebungsvariablen bzw. `.env`, niemals in `app.js` oder `index.html`. KI-, Bild-, Such- und Videodienste können nutzungsabhängige Kosten verursachen. Modellzugang, Eingabeparameter, Sicherheitsfilter und Preise legt der jeweilige Anbieter fest.

## Online veröffentlichen

Du brauchst ein Hosting-Konto bei einem Anbieter, der Node.js-Webdienste unterstützt (z. B. Render, Railway oder ein eigener VPS).

- Repository/Projekt hochladen.
- Build-Befehl: keiner erforderlich.
- Start-Befehl: `npm start`.
- Node-Version: 20 oder neuer.
- Als Environment Variables mindestens `ADMIN_PASSWORD` eintragen. Weitere API-Werte je nach gewünschtem Modul.
- HTTPS beim Hosting aktivieren. Bei `NODE_ENV=production` setzt NEXUS das Session-Cookie mit `Secure`.
- `TRUST_PROXY=1` nur setzen, wenn der Dienst hinter einem vertrauenswürdigen Reverse Proxy läuft.

Das Projekt wird durch den Login geschützt. Die statischen HTML/CSS/JS-Dateien enthalten keine Geheimnisse; alle `/api/*`-Funktionen außer Login, Logout und Sessionstatus verlangen eine gültige Sitzung.

## Wichtige Grenzen und Datenschutz

- **Noch nicht veröffentlicht:** Das ZIP enthält den Website-Code. Eine echte Internetadresse entsteht erst nach dem Deployment bei einem Hosting-Anbieter.
- **Einzelserver:** Sessions liegen im Arbeitsspeicher. Für eine einzelne Hosting-Instanz gedacht; nach einem Serverneustart musst du dich erneut anmelden.
- **Galerie und Chatverlauf:** Werden lokal im Browser gespeichert. Sie synchronisieren sich nicht automatisch zwischen iPhone und PC und können beim Löschen der Browserdaten verloren gehen.
- **Dateien:** Werden im Browser ausgelesen; der extrahierte Text wird an den gewählten KI-Anbieter übertragen. Keine vertraulichen Dokumente hochladen, ohne die Datenschutzbedingungen des Anbieters zu prüfen.
- **Video:** Replicate-Modelle haben unterschiedliche Eingabeschemata. Nicht jedes Modell akzeptiert die hier verwendeten Felder. Bei Bedarf muss der Video-Adapter auf das gewählte Modell angepasst werden.
- **Voice:** Mikrofonzugriff funktioniert normalerweise nur über HTTPS oder localhost und hängt vom Browser ab.
- **Kein unbegrenzter KI-Dienst:** Anbieter setzen Kosten, Nutzungslimits und Inhaltsregeln. NEXUS hebt diese nicht auf.

## Dateien

- `index.html` – Oberfläche und Module
- `style.css` – Layout und responsives Design
- `app.js` – Login-Flow, Chat, Galerie, Datei- und Voice-Funktionen
- `server.js` – Login, Sessions, API-Proxy, Rate-Limits und statischer Server
- `.env.example` – Konfigurationsvorlage
