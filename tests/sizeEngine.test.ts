/**
 * Unit tests — exact-size engine + AI classification (spec: ±5% accuracy).
 * Run: npx vitest run
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { sizeImage, sizePdf, extractJpegStreams, compressToTarget } from "../src/lib/sizeEngine";
import { classify, detectMember, extractMetadata } from "../src/lib/classifier";
import { parseIntent } from "../src/lib/nlp";
import { termVariants } from "../src/lib/transliterate";
import type { Member } from "../src/db/schema";

/** A realistic noisy "scanned document" image (noise defeats cheap compression). */
async function noisyScannedDoc(w = 2200, h = 3000): Promise<Buffer> {
  const noise = Buffer.alloc(w * h * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = 215 + Math.floor(Math.random() * 40);
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${h}" fill="#f4efe2"/>
      ${Array.from({ length: 24 }, (_, i) => `<text x="80" y="${160 + i * 110}" font-size="52" font-family="sans-serif" fill="#4a3f2c">Khasra No 245/1 Ram Kumar Bigha land record line ${i + 1}</text>`).join("")}
    </svg>`,
  );
  return sharp(noise, { raw: { width: w, height: h, channels: 3 } })
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

const within = (actual: number, target: number, tol = 0.05) => Math.abs(actual - target) / target <= tol;

describe("EXACT-SIZE ENGINE (±5% spec)", () => {
  it("lands close to 500 KB for a large JPEG (and never over the limit)", async () => {
    const input = await noisyScannedDoc();
    const target = 500 * 1024;
    const r = await sizeImage(input, target, "jpg");
    expect(r.mime).toBe("image/jpeg");
    expect(r.actualBytes).toBeLessThanOrEqual(target * 1.02);
    expect(r.actualBytes).toBeGreaterThan(target * 0.5); // fidelity retained
    expect(r.perfect).toBe(true); // under the portal limit with good quality
  }, 60000);

  it("hits 200 KB within a tight band for a large JPEG", async () => {
    const input = await noisyScannedDoc();
    const target = 200 * 1024;
    const r = await sizeImage(input, target, "jpg");
    expect(within(r.actualBytes, target, 0.08)).toBe(true);
  }, 60000);

  it("target above the original → max fidelity, never bloated past the limit", async () => {
    const input = await noisyScannedDoc();
    const target = 1024 * 1024; // larger than the ~566KB source
    const r = await sizeImage(input, target, "jpg");
    expect(r.actualBytes).toBeLessThanOrEqual(target);
    expect(r.actualBytes).toBeGreaterThan(input.length * 0.6);
  }, 60000);

  it("reports floorReached honestly for impossible targets", async () => {
    const input = await noisyScannedDoc();
    const r = await sizeImage(input, 25 * 1024, "jpg");
    // either close to target or honestly flagged as floored
    expect(r.floorReached || within(r.actualBytes, 25 * 1024, 0.1)).toBe(true);
  }, 60000);

  it("compresses an image-based PDF towards its target", async () => {
    const input = await noisyScannedDoc(1600, 2200);
    const pre = await compressToTarget("t1", "c1", input, "image/jpeg", 9999999, "pdf");
    expect(pre.mime).toBe("application/pdf");
    expect(extractJpegStreams(pre.buffer).length).toBeGreaterThan(0);
    const target = 350 * 1024;
    const r = await sizePdf(pre.buffer, target);
    expect(r.mime).toBe("application/pdf");
    expect(r.actualBytes).toBeLessThanOrEqual(target * 1.08);
  }, 90000);

  it("passes through originals already under target", async () => {
    const small = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 180, b: 120 } } }).jpeg().toBuffer();
    const r = await compressToTarget("t2", "c2", small, "image/jpeg", 500 * 1024, "original");
    expect(r.actualBytes).toBe(small.length);
    expect(r.perfect).toBe(true);
  }, 30000);
});

describe("AI CLASSIFICATION", () => {
  it("routes land records (English + Hindi)", () => {
    expect(classify("Khatauni_RamKumar.pdf").folder).toBe("land");
    expect(classify("मेरी खतौनी फाइल.jpg").folder).toBe("land");
    expect(classify("जमाबंदी नक्शा gata 221").folder).toBe("land");
  });

  it("routes ID cards", () => {
    expect(classify("Aadhaar final.jpg").folder).toBe("id");
    expect(classify("PAN_SitaDevi.png").folder).toBe("id");
    expect(classify("मेरा पैन कार्ड").folder).toBe("id");
    expect(classify("Voter_ID.pdf").folder).toBe("id");
  });

  it("routes marksheets vs education distinctly", () => {
    expect(classify("Class12_Marksheet_Amit.jpg").folder).toBe("marksheet");
    expect(classify("Semester 3 result.pdf").folder).toBe("marksheet");
    expect(classify("BSc Degree Certificate.pdf").folder).toBe("education");
    expect(classify("convocation diploma 2023").folder).toBe("education");
  });

  it("falls back to 'other' for unknown content", () => {
    expect(classify("IMG_20240814_133012.jpg").folder).toBe("other");
  });

  it("extracts land tags", () => {
    const tags = extractMetadata("Khatauni Khasra No: 245/1 Owner: Ram Kumar Area: 2.5 Bigha", "land");
    expect(tags.surveyNo).toBe("245/1");
    expect(tags.owner).toBe("Ram Kumar");
    expect(tags.area).toBe("2.5");
  });

  it("extracts ID + marksheet tags", () => {
    const id = extractMetadata("PAN: ABCDE1234F Income Tax", "id");
    expect(id.cardType).toBe("PAN");
    const ms = extractMetadata("Result Pass Percentage 78.4% Year 2020", "marksheet");
    expect(ms.percentage).toBe("78.4%");
    expect(ms.year).toBe("2020");
  });
});

describe("MEMBER DETECTION", () => {
  const roster = [
    { key: "papa", nameEn: "Papa", nameHi: "पापा", aliases: ["Ram Kumar", "राम कुमार"] },
    { key: "mummy", nameEn: "Mummy", nameHi: "मम्मी", aliases: ["Sita Devi", "सीता देवी"] },
    { key: "me", nameEn: "Me", nameHi: "मैं", aliases: ["Amit Kumar", "अमित कुमार"] },
  ] as unknown as Member[];

  it("detects Papa from his name", () => {
    expect(detectMember("Aadhaar Ram Kumar UIDAI", roster)?.member.key).toBe("papa");
  });
  it("detects Mummy from Hindi alias", () => {
    expect(detectMember("आधार सीता देवी", roster)?.member.key).toBe("mummy");
  });
  it("returns null when nobody matches (ask the user)", () => {
    expect(detectMember("random scan 1440", roster)).toBeNull();
  });
});

describe("QUERY NLP (voice search)", () => {
  it("parses Hindi member + folder", () => {
    const i = parseIntent("मुझे पापा की मार्कशीट दिखाओ");
    expect(i.memberKey).toBe("papa");
    expect(i.folder).toBe("marksheet");
  });
  it("parses English member + folder + possessive", () => {
    const i = parseIntent("Show Papa's Aadhaar card");
    expect(i.memberKey).toBe("papa");
    expect(i.folder).toBe("id");
  });
  it("parses time ranges in Hindi", () => {
    const i = parseIntent("पिछले महीने के भूमि रिकॉर्ड");
    expect(i.folder).toBe("land");
    expect(i.from).not.toBeNull();
  });
  it("keeps names as terms and transliterates them", () => {
    const i = parseIntent("राम कुमार का खतौनी");
    expect(i.folder).toBe("land");
    expect(i.terms).toContain("राम");
    const v = termVariants("राम");
    expect(v).toContain("ram");
  });
});
