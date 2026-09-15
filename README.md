# 🗄️ Smart Tijori — स्मार्ट तिजोरी

### Bilingual Family Document Vault • द्विभाषी पारिवारिक दस्तावेज़ तिजोरी

A senior-friendly, bilingual (**English / हिंदी**) vault for the whole family — **Papa · Mummy · Me**.
Photograph a paper, and the vault **recognises whose it is, what it is, reads its key numbers, and
files it in the right folder — zero clicks.** Later, when a government portal demands
"*upload must be under 500 KB*", one slider delivers a **perfectly-sized file**.

---

## ✨ What's inside • अंदर क्या-क्या है

| English | हिंदी |
| --- | --- |
| **People, not just files** — add any number of family members (**/people**), rename them, pick a colour/icon, list the other names that appear on their papers, and remove them (documents move to someone else or to the Recycle Bin). Each person gets 5 folders: शिक्षा · पहचान पत्र · अंकतालिका · भूमि दस्तावेज़ · अन्य + custom folders | **लोग, सिर्फ़ फ़ाइलें नहीं** — जितने चाहें सदस्य जोड़ें, नाम बदलें, हटाएँ |
| **Folders you control** — create, **rename** (even the default ones) and delete folders; documents from a deleted folder land safely in *Other* | **फ़ोल्डर आपके हाथ में** — बनाएँ, नाम बदलें, हटाएँ |
| **Check → Name → Save upload** — every file first appears as a review card: **rename it right there**, choose the person, folder and *document type* (or leave any on "let the vault decide"); "Suggest name" gives *"Papa - Aadhaar Card"*; "Apply to all" copies the choice to a whole batch; **Save all** at once. Up to **100 MB per file**, chunked & resumable | **जाँचें → नाम दें → सहेजें** — अपलोड करते समय ही नाम बदलें |
| **📄 Paper Scanner (Adobe-Scan style)** — point the phone camera at a paper; the vault finds the edges live, you capture, drag the 4 corners to fit, pick a finish (**Auto Clean · Black & White · Sepia · Original**), add up to 8 pages, and it becomes one clean scan — single page → crisp JPEG, many pages → one PDF at real paper size. All on-device: the photo never leaves the phone. Then the normal review card (name / person / type) saves it into the right folder | **📄 पेपर स्कैनर (एडोब-स्कैन जैसा)** — कैमरा कागज़ पर रखें; किनारे अपने आप मिलते हैं, कोने खींचें, फिनिश चुनें, 8 पेज तक जोड़ें — एक साफ़ स्कैन बनता है (एक पेज = JPG, कई पेज = एक PDF)। सब फ़ोन पर, फोटो बाहर नहीं जाती |
| **Document types** — Aadhaar · PAN · Voter · Passport · Ration · Khasra/Khatauni · Registry · Naksha · Marksheet · Degree · Medical · Insurance … detected from the file name / PDF text, editable on any card. Browse **person-wise → folder-wise → type-wise**; search understands them (*"मम्मी का आधार"*, *"papa ki registry"*) | **कागज़ के प्रकार** — आधार-वार, पैन-वार, खसरा-वार देखें व खोजें |
| **Rename anywhere** — pencil icon on every document card; the extension is kept for you | **कहीं भी नाम बदलें** |
| **SmartScan still auto-files** what you leave on auto: member (by name aliases, Hindi or English) and folder; if unsure it asks *"क्या यह पापा का है?"* with one-tap confirm/change | **अपने-आप व्यवस्थित** — जो आप छोड़ दें, तिजोरी खुद तय करे |
| **🎯 Exact-size downloads in any format** — images → JPG / PNG / PDF, **PDFs → JPG / PNG too** (multi-page PDFs come back as a ZIP of pages); slide to a target (50 KB…10 MB); iterative quality+dimension search lands ±5%, always **under the portal limit**. Live byte-accurate estimate before downloading | **🎯 तय साइज़, किसी भी फ़ॉर्मैट में** — PDF, JPG, PNG |
| **Voice + text search across the family** — *"पापा की मार्कशीट"*, *"Show Mummy's Aadhaar"*, *"खसरा 245"* — understands member, folder, time range & names (Devanagari⇄Latin transliteration) | **बोलकर खोजें** — किसी भी सदस्य का कागज़ तुरंत |
| **Smart tags without opening the file** — khasra no, area, owner; Aadhaar/PAN number (masked), expiry; marksheet %, year | **स्मार्ट टैग** — ज़रूरी जानकारी फ़ाइल खोले बिना |
| **Duplicate detection** — identical bytes → Replace / Keep-both / Skip | **नकल पहचान** — दोहरी फ़ाइल पर सवाल |
| **Recycle bin** — 30-day restore; auto-purge; bulk empty | **कचरा पेटी** — 30 दिन तक वापसी |
| **Audit timeline** — every upload/download/share/delete with day-wise grouping | **गतिविधि** — किसने क्या किया, कब |
| **Bulk ops** — select many → one PDF, ZIP, move, delete | **थोक काम** — कई फ़ाइलें एक साथ |
| **QR sharing with expiry** — viewer passcode + optional 24h/7d expiry | **QR साझा** — समय-सीमा के साथ |
| **Security** — 4-digit PIN · drawable pattern · password · Hindi security question · **OTP 2FA** · **auto-lock after 5 idle minutes** · voice-guided (TTS) lock setup in Hindi | **सुरक्षा** — PIN, पैटर्न, OTP, खुद ताला |
| **Read-aloud**, numbers as `२.५ — ढाई बीघा`, 60px+ targets, WCAG AA contrast | **सुनें बटन**, आसान बड़े अक्षर |
| **PWA** — installable, offline cache, offline upload outbox, chunked resumable uploads | **PWA** — इंटरनेट के बिना भी |
| **Self-healing** — SHA-256 verified; corrupt files auto-restored from previous version; weekly ZIP backup | **स्व-उपचार + बैकअप** |

---

## 🚀 Run it (English — for the family tech helper)

### Option A — One command (Docker)

```bash
docker compose up --build
# open http://localhost:3000  (PostgreSQL + Redis + app all start together)
```

### Option B — Node.js directly

```bash
cp .env.example .env            # set DATABASE_URL
npm install --legacy-peer-deps   # (peer-dep quirk between vitest 4 + eslint on some npm versions)
npx drizzle-kit push            # create tables
npx tsx --env-file=.env scripts/seed.ts   # demo family + documents
# upgrading from an older vault? tag existing files with a document type:
npx tsx --env-file=.env scripts/backfill-doctypes.ts
npm run build && npm start      # production  |  npm run dev for development
```

**Tests** (size engine ±5%, classifier, member detection, NLP):

```bash
npx vitest run
```

**API reference:** see [`openapi.yaml`](./openapi.yaml) (import into Swagger Editor / Postman).

### 🩺 "I can't save any file" — check the database

If the app cannot reach PostgreSQL, every screen shows a **red banner** saying so
(the app keeps checking and the banner disappears by itself when the connection
returns). A failed save also shows the *reason* on the card, e.g.:

| Message shown | What it means | Fix |
| --- | --- | --- |
| `db:connect: …ECONNREFUSED / timeout…` | The server can't reach the database at all | Check `DATABASE_URL` in `.env` (host, port, SSL, credentials). On Neon use the **pooled** or **direct** connection string with the `sslmode` your account needs. |
| `db:schema: relation "…" does not exist` | Database is reachable but tables are missing | Run `npx drizzle-kit push` once with that `DATABASE_URL`. |
| `db:schema: password authentication failed` | Wrong credentials in the URL | Fix the password in `DATABASE_URL`. |

With Neon specifically, after setting `DATABASE_URL=postgresql://…?sslmode=require`
run **`npx drizzle-kit push`** (creates the tables) — then saves work.

### ☁️ Deploying to Vercel — the three things that must be true

1. **`DATABASE_URL` exists in the Vercel project** (Settings → Environment Variables,
   Production *and* Preview). Missing → every route answers
   `503 db:config: DATABASE_URL is not set …`.
2. **The schema has been pushed once** against that database:
   `DATABASE_URL="<neon connection string>" npx drizzle-kit push`
   (nothing else is needed; `push` is idempotent and never deletes data).
   Without it, `/api/members`, `/api/documents`, `/api/stats` and `/api/lock`
   answer `500 db:schema: relation "settings" does not exist` — a reachable
   database with missing tables, *not* a connection problem.
3. **The native image engine ships with the functions.** `sharp` dlopen()s
   `libvips-cpp.so` at runtime, which static file tracing cannot see, so
   `next.config.ts` lists `sharp`, `@img/*`, `@napi-rs/canvas*`, `tesseract.js*`
   and `@tesseract.js-data/**` under `outputFileTracingIncludes`. Do not remove
   those globs: without them the deployment fails with
   `Failed to load external module sharp / ERR_DLOPEN_FAILED: libvips-cpp.so …`.
   (Verified by building and running sharp against the traced `.nft.json` file
   list alone.)

`GET /api/health` reports the truth for all three, and the app shows a banner
when something is wrong:

```json
{ "ok": false,
  "db": { "ok": false, "code": "db:schema", "missingTables": ["settings"] },
  "imageEngine": { "ok": true, "error": null },
  "smart": { "ocr": true, "ai": false } }
```

If the image engine is missing, the vault keeps working: images are filed by
name/type, `/api/analyze` still reads PDF text layers, and image-only endpoints
answer `503 engine:sharp: …` instead of crashing the whole route. Nothing is
ever reported as a success when it did not happen.

## 🚀 चलाने का तरीका (हिंदी — पिताजी के लिए)

1. कंप्यूटर पर Docker Desktop चालू करें।
2. इस फ़ोल्डर में चलाएँ: **`docker compose up --build`**
3. ब्राउज़र में खोलें: **http://localhost:3000**
4. ऊपर दाईं तरफ़ **हिंदी** चुनें — सब कुछ हिंदी में।
5. **Settings → सुरक्षा ताला** में *"सुनकर सीखें"* बटन दबाएँ — आवाज़ सुनते हुए PIN बना लें।
6. नारंगी बटन दबाकर कागज़ की फोटो खींचिए — बाक़ी सब ऐप खुद करेगा।
7. जब पोर्टल साइज़ माँगे: डाउनलोड → **साइज़ लिमिट** चुनें → स्लाइडर घुमाएँ → डाउनलोड। बस!

---

## 🧱 Architecture

```
Next.js 16 (App Router) + React 19   UI · API routes · PWA shell
PostgreSQL 16 + Drizzle ORM          members · folders · documents(BYTEA) · audit · settings
sharp                                 size engine (quality+dimension search), conversions
pdf-lib                               image→PDF, batch merge, scanned-PDF rebuild
unpdf                                 PDF text-layer extraction (SmartScan)
Web Speech API + speechSynthesis      voice search & read-aloud & voice-guided setup (hi/en)
IndexedDB outbox + Service Worker     offline queue + offline vault
Vitest                                45 unit tests (size accuracy, classifier, NLP, scanner detection & enhancement)
```

- **All files live inside PostgreSQL** — nothing sensitive on the public file system.
- **Size engine accuracy:** ±5% target band, and *always ≤ the requested limit* when
  physically reachable (portal-limit semantics). Results are memo-cached so the
  on-screen estimate is byte-identical to the downloaded file.
- **All UI strings** in `src/lib/i18n.ts`; Hindi is LTR (Devanagari) — no RTL flip needed.
- Env vars: `DATABASE_URL` (required), `REDIS_URL` (optional), `SMS_WEBHOOK_URL`
  (optional OTP SMS provider — without it the OTP is logged server-side and shown in dev).
- Fonts are **self-hosted** (`@fontsource-variable/*`) so `next build` never needs
  network access to Google Fonts — builds work in restricted CI/Vercel networks.

## ♿ Accessibility (WCAG 2.1 AA)

Targets ≥ 60px (most 72–76px) · contrast ≥ 4.5:1 · 4px saffron focus rings ·
full keyboard operability · aria labels/live regions on mic, toasts, dialogs ·
colour never the only cue (icon + text on every state) · 18px base type,
numbers repeated in Devanagari + Hindi words.

## 🔐 Security notes

Secrets are scrypt hashes only · 12h httpOnly cookie · 5-minute idle auto-lock ·
optional OTP (hashed, 5-minute validity) · QR shares carry their own 4-digit passcode
and optional expiry · family-grade by design — for hostile networks add disk
encryption + firewall.

Made with ❤️ for family. आपके कागज़ात, आपके पास।
