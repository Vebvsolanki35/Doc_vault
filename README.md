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
| **Family hierarchy** — three avatar tiles (Papa/Mummy/Me), each with 5 folders: शिक्षा · पहचान पत्र · अंकतालिका · भूमि दस्तावेज़ · अन्य + custom folders (e.g. Medical Reports) | **परिवार की व्यवस्था** — हर सदस्य की अपनी जगह और फ़ोल्डर |
| **Zero-click auto-filing** — SmartScan detects the *member* (by name aliases, Hindi or English) and the *folder*; if unsure it asks *"क्या यह पापा का है?"* with one-tap confirm/change | **अपने-आप व्यवस्थित** — कागज़ खुद ढूंढता है किसका है और कहाँ रखना है |
| **🎯 Exact-size downloads** — slide to a target (50 KB…10 MB); iterative quality+dimension search lands ±5%, always **under the portal limit**. Scanned-PDF images are re-compressed too. Live byte-accurate estimate before downloading. "Recommended" = 80% of original | **🎯 तय साइज़ डाउनलोड** — सरकारी पोर्टल की साइज़ लिमिट के लिए एकदम सही फ़ाइल |
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
npm install
npx drizzle-kit push            # create tables
npx tsx scripts/seed.ts         # demo family + documents
npm run build && npm start      # production  |  npm run dev for development
```

**Tests** (size engine ±5%, classifier, member detection, NLP):

```bash
npx vitest run
```

**API reference:** see [`openapi.yaml`](./openapi.yaml) (import into Swagger Editor / Postman).

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
Vitest                                19 unit tests (size accuracy, classifier, NLP)
```

- **All files live inside PostgreSQL** — nothing sensitive on the public file system.
- **Size engine accuracy:** ±5% target band, and *always ≤ the requested limit* when
  physically reachable (portal-limit semantics). Results are memo-cached so the
  on-screen estimate is byte-identical to the downloaded file.
- **All UI strings** in `src/lib/i18n.ts`; Hindi is LTR (Devanagari) — no RTL flip needed.
- Env vars: `DATABASE_URL` (required), `REDIS_URL` (optional), `SMS_WEBHOOK_URL`
  (optional OTP SMS provider — without it the OTP is logged server-side and shown in dev).

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
