/**
 * DEMO SEED v2 — family-first.
 * Creates the three members (Papa / Mummy / Me) with bilingual names +
 * detection aliases, their five default folders each, and realistic sample
 * documents routed through the REAL smart pipeline (folder classification,
 * member detection, tag extraction).
 * Run:  npx tsx scripts/seed.ts
 */
import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash } from "crypto";
import { db, pool } from "../src/db";
import { documents, folders, members } from "../src/db/schema";
import { classify, detectMember, extractPdfText } from "../src/lib/classifier";
import { DEFAULT_FOLDERS } from "../src/lib/folderDefs";

function cardSvg(title: string, lines: string[], accent: string): string {
  const rows = lines
    .map((l, i) => `<text x="60" y="${190 + i * 72}" font-size="38" font-family="DejaVu Sans, sans-serif" fill="#3a2f22">${l}</text>`)
    .join("");
  return `
  <svg width="1000" height="1400" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="1400" rx="36" fill="#fffdf7"/>
    <rect width="1000" height="1400" rx="36" fill="none" stroke="${accent}" stroke-width="14"/>
    <rect x="40" y="40" width="920" height="104" rx="20" fill="${accent}"/>
    <text x="60" y="108" font-size="44" font-weight="bold" font-family="DejaVu Sans, sans-serif" fill="#ffffff">${title}</text>
    ${rows}
    <line x1="60" y1="1240" x2="940" y2="1240" stroke="${accent}" stroke-width="4"/>
    <text x="60" y="1310" font-size="30" font-family="DejaVu Sans, sans-serif" fill="#8a7a5c">Smart Tijori sample document</text>
  </svg>`;
}

async function makeJpg(title: string, lines: string[], accent: string): Promise<Buffer> {
  return sharp(Buffer.from(cardSvg(title, lines, accent))).jpeg({ quality: 88 }).toBuffer();
}

async function makeLandMapPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 40, y: 40, width: 515, height: 762, borderWidth: 3, borderColor: rgb(0.09, 0.34, 0.2) });
  page.drawText("VILLAGE LAND MAP (NAKSHA)", { x: 60, y: 780, size: 20, font, color: rgb(0.09, 0.34, 0.2) });
  const plots = [
    { n: "245/1", x: 70, y: 560, w: 210, h: 180 },
    { n: "245/2", x: 290, y: 560, w: 220, h: 180 },
    { n: "246", x: 70, y: 380, w: 440, h: 160 },
  ];
  for (const p of plots) {
    page.drawRectangle({ x: p.x, y: p.y, width: p.w, height: p.h, borderWidth: 2, borderColor: rgb(0.85, 0.42, 0) });
    page.drawText(`Khasra No: ${p.n}`, { x: p.x + 14, y: p.y + p.h / 2, size: 15, font: body, color: rgb(0.2, 0.15, 0.08) });
  }
  page.drawText("Owner: Ram Kumar", { x: 60, y: 320, size: 14, font: body });
  page.drawText("Khasra No: 245/1  Area: 2.5 Bigha", { x: 60, y: 295, size: 14, font: body });
  page.drawText("Tehsil: Sadar  |  Village: Rampur", { x: 60, y: 270, size: 14, font: body });
  return Buffer.from(await pdf.save());
}

const SAMPLES: { name: string; mime: string; make: () => Promise<Buffer>; daysAgo: number; ocrHint: string }[] = [
  {
    name: "Khatauni_RamKumar.jpg", mime: "image/jpeg", daysAgo: 3,
    ocrHint: "Khatauni Khasra No: 245/1 Owner: Ram Kumar Area: 2.5 Bigha Tehsil Sadar Village Rampur",
    make: () => makeJpg("KHATAUNI — LAND RECORD", ["Khasra No: 245/1", "Owner: Ram Kumar", "Area: 2.5 Bigha", "Village: Rampur", "Tehsil: Sadar", "Year: 2024"], "#175732"),
  },
  {
    name: "Village_Map_Naksha_245.pdf", mime: "application/pdf", daysAgo: 40, ocrHint: "",
    make: makeLandMapPdf,
  },
  {
    name: "Aadhaar Sita Devi.jpg", mime: "image/jpeg", daysAgo: 12,
    ocrHint: "Aadhaar Sita Devi UIDAI Government of India Aadhaar No 2345 6789 4521 Valid Till 31/12/2035",
    make: () => makeJpg("AADHAAR CARD", ["Name: Sita Devi", "Aadhaar No: 2345 6789 4521", "DOB: 04/07/1963", "Valid Till: 31/12/2035"], "#a84e00"),
  },
  {
    name: "PAN_RamKumar.jpg", mime: "image/jpeg", daysAgo: 25,
    ocrHint: "PAN CARD Ram Kumar Income Tax Department Permanent Account Number ABCDE1234F",
    make: () => makeJpg("PAN CARD", ["Name: Ram Kumar", "PAN: ABCDE1234F", "Income Tax Department", "Government of India"], "#0f4023"),
  },
  {
    name: "Class12_Marksheet_Amit.jpg", mime: "image/jpeg", daysAgo: 55,
    ocrHint: "Class 12 Marksheet High School Intermediate Roll No 884122 Amit Kumar Result Pass Percentage 78.4% Year 2020",
    make: () => makeJpg("CLASS 12 MARK SHEET", ["Name: Amit Kumar", "Roll No: 884122", "Board: UP Board", "Percentage: 78.4%", "Year: 2020"], "#3d3673"),
  },
  {
    name: "BSc_Degree_Amit.pdf", mime: "application/pdf", daysAgo: 400, ocrHint: "",
    make: async () => {
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([842, 595]);
      const font = await pdf.embedFont(StandardFonts.HelveticaBold);
      const body = await pdf.embedFont(StandardFonts.Helvetica);
      page.drawRectangle({ x: 30, y: 30, width: 782, height: 535, borderWidth: 4, borderColor: rgb(0.24, 0.21, 0.45) });
      page.drawText("BACHELOR OF SCIENCE — DEGREE CERTIFICATE", { x: 90, y: 500, size: 22, font, color: rgb(0.24, 0.21, 0.45) });
      page.drawText("This is to certify that Amit Kumar", { x: 90, y: 430, size: 16, font: body });
      page.drawText("has been awarded the degree of Bachelor of Science (Agriculture)", { x: 90, y: 402, size: 16, font: body });
      page.drawText("University: CSA University, Kanpur   Year: 2023", { x: 90, y: 360, size: 14, font: body });
      page.drawText("Division: First   Percentage: 81.2%", { x: 90, y: 332, size: 14, font: body });
      return Buffer.from(await pdf.save());
    },
  },
];

async function main() {
  console.log("Seeding Smart Tijori family vault…");

  // wipe old demo state (dev/demo only)
  await db.delete(documents);
  await db.delete(folders);
  await db.delete(members);

  const [papa] = await db.insert(members).values({
    key: "papa", nameEn: "Papa", nameHi: "पापा", icon: "tractor", color: "leaf", sort: 1,
    aliases: ["Ram Kumar", "राम कुमार", "राम", "Ram"],
  }).returning();
  const [mummy] = await db.insert(members).values({
    key: "mummy", nameEn: "Mummy", nameHi: "मम्मी", icon: "heart", color: "saffron", sort: 2,
    aliases: ["Sita Devi", "सीता देवी", "सीता", "Sita"],
  }).returning();
  const [me] = await db.insert(members).values({
    key: "me", nameEn: "Me", nameHi: "मैं", icon: "user", color: "indigo", sort: 3,
    aliases: ["Amit Kumar", "अमित कुमार", "अमित", "Amit"],
  }).returning();

  const roster = [papa, mummy, me];
  const folderIds: Record<string, Record<string, string>> = {};
  for (const m of roster) {
    folderIds[m.id] = {};
    for (let i = 0; i < DEFAULT_FOLDERS.length; i++) {
      const [f] = await db.insert(folders).values({
        memberId: m.id, key: DEFAULT_FOLDERS[i].key, isDefault: true, sort: i + 1,
      }).returning();
      folderIds[m.id][DEFAULT_FOLDERS[i].key] = f.id;
    }
  }
  // one custom folder to show the feature
  await db.insert(folders).values({ memberId: mummy.id, key: "custom", nameEn: "Medical Reports", nameHi: "मेडिकल रिपोर्ट", isDefault: false, sort: 10 });

  for (const s of SAMPLES) {
    const buf = await s.make();
    const ocrText = s.mime === "application/pdf" ? await extractPdfText(buf) : s.ocrHint || "";
    const source = `${s.name}\n${ocrText}`;
    const { folder: folderKey, tags } = classify(source);
    const guess = detectMember(source, roster);
    const member = guess?.member ?? papa;
    const createdAt = new Date(Date.now() - s.daysAgo * 24 * 3600 * 1000);
    await db.insert(documents).values({
      name: s.name,
      mimeType: s.mime,
      size: buf.length,
      category: folderKey,
      memberId: member.id,
      folderId: folderIds[member.id][folderKey] ?? folderIds[member.id]["other"],
      fileData: buf,
      checksum: createHash("sha256").update(buf).digest("hex"),
      ocrText: ocrText.slice(0, 20000),
      tags,
      createdAt,
      updatedAt: createdAt,
    });
    console.log(`  ✓ ${s.name} → ${member.key}/${folderKey}`, tags);
  }

  await pool.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
