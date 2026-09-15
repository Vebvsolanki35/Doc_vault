import { describe, expect, it } from "vitest";
import { detectDocType, docTypeLabel } from "../src/lib/docTypes";
import { detectMember } from "../src/lib/classifier";
import { sanitizeName, suggestName } from "../src/lib/naming";
import { parseIntent } from "../src/lib/nlp";

const ROSTER: any[] = [
  { id: "1", key: "papa", nameEn: "Papa", nameHi: "पापा", aliases: ["Ram Kumar", "राम कुमार", "राम", "Ram"], sort: 1 },
  { id: "2", key: "mummy", nameEn: "Mummy", nameHi: "मम्मी", aliases: ["Sita Devi", "सिता देवी", "सिता", "Sita"], sort: 2 },
  { id: "3", key: "me", nameEn: "Me", nameHi: "मैं", aliases: ["Amit", "Amit Kumar"], sort: 3 },
];

describe("member detection", () => {
  it("picks the right person when a place name contains another name (Rampur ≠ Ram)", () => {
    // "Rampur" must NOT count as evidence for "Ram Kumar"; the patient Amit wins.
    const text = "PRESCRIPTION\nDr. Sharma Clinic\nHospital Road, Rampur\nPatient: Amit Kumar\nRx: Paracetamol 650mg";
    expect(detectMember(text, ROSTER)?.member.key).toBe("me");
  });
  it("matches complete names in Hindi and English", () => {
    expect(detectMember("Name: Ram Kumar\nPAN: ABCDE1234F", ROSTER)?.member.key).toBe("papa");
    expect(detectMember("नाम: सीता देवी", ROSTER)?.member.key).toBe("mummy");
    expect(detectMember("परीक्षा अंकतालिका — अमित कुमार", ROSTER)?.member.key).toBe("me");
  });
  it("returns null when nobody is mentioned", () => {
    expect(detectMember("buy milk and bread", ROSTER)).toBeNull();
  });
});

describe("document type detection", () => {
  it("recognises Aadhaar from name or number", () => {
    expect(detectDocType("Papa_Aadhaar_front.jpg")?.type).toBe("aadhaar");
    expect(detectDocType("scan001 4523 7812 9034")?.type).toBe("aadhaar");
  });
  it("recognises PAN, Khasra, Registry, Marksheet", () => {
    expect(detectDocType("PAN_RamKumar.jpg")?.type).toBe("pan");
    expect(detectDocType("खतौनी राम कुमार 2024.pdf")?.type).toBe("khasra");
    expect(detectDocType("registry sale deed plot 12.pdf")?.type).toBe("registry");
    expect(detectDocType("Class12_Marksheet_Amit.jpg")?.type).toBe("marksheet");
  });
  it("maps types to folders", () => {
    expect(detectDocType("ration card mummy.jpg")?.folder).toBe("id");
    expect(detectDocType("naksha village.pdf")?.folder).toBe("land");
  });
  it("recognises camera photos (IMG_/DSC_ prefix, with or without date)", () => {
    expect(detectDocType("IMG_4521.jpg")?.type).toBe("photo");
    expect(detectDocType("IMG4521.jpg")?.type).toBe("photo");
    expect(detectDocType("DSC_0031.jpg")?.type).toBe("photo");
    expect(detectDocType("IMG_20240101_1200.jpg")?.type).toBe("photo");
  });
  it("returns null for meaningless names", () => {
    expect(detectDocType("randomfile.jpg")).toBeNull();
    expect(detectDocType("photo of something maybe.jpg")?.type).toBe("photo"); // the word "photo" is real evidence
  });
  it("labels are bilingual", () => {
    expect(docTypeLabel("aadhaar", "hi")).toBe("आधार कार्ड");
    expect(docTypeLabel("aadhaar", "en")).toBe("Aadhaar Card");
    expect(docTypeLabel(undefined, "en")).toBe("Other");
  });
});

describe("file naming", () => {
  it("keeps the original extension when the user drops it", () => {
    expect(sanitizeName("Papa Aadhaar", "IMG_1.jpg", "image/jpeg")).toBe("Papa Aadhaar.jpg");
  });
  it("normalises a typed extension", () => {
    expect(sanitizeName("Papa Aadhaar.JPEG", "IMG_1.jpg", "image/jpeg")).toBe("Papa Aadhaar.jpg");
  });
  it("strips path separators and control chars", () => {
    expect(sanitizeName("../evil\\name", "x.pdf", "application/pdf")).toBe("evil name.pdf");
  });
  it("falls back to the original when empty", () => {
    expect(sanitizeName("   ", "orig.png", "image/png")).toBe("orig.png");
  });
  it("suggests a person-type name", () => {
    expect(suggestName("Papa", "Aadhaar Card", "IMG_1.jpg")).toBe("Papa - Aadhaar Card.jpg");
  });
});

describe("search intent understands document types", () => {
  it("parses Hindi + English type queries", () => {
    const a = parseIntent("मम्मी का आधार");
    expect(a.docType).toBe("aadhaar");
    expect(a.memberKey).toBe("mummy");
    const b = parseIntent("papa ki registry");
    expect(b.docType).toBe("registry");
    expect(b.folder).toBe("land");
  });
});

describe("OCR-driven tag extraction", () => {
  it("reads a spaced Aadhaar number and the labelled name", async () => {
    const { extractMetadata } = await import("../src/lib/classifier");
    const tags = extractMetadata("GOVERNMENT OF INDIA Name: Sita Devi DOB: 04/08/1968 Female 4523 7812 9034 Aadhaar - Aam Aadmi ka Adhikar", "id");
    expect(tags.cardType).toBe("Aadhaar");
    expect(tags.cardNo).toBe("XXXX-XXXX-9034");
    expect(tags.person).toBe("Sita Devi");
  });
  it("does not mistake slogans for people", async () => {
    const { extractMetadata } = await import("../src/lib/classifier");
    const tags = extractMetadata("Aadhaar Aam Aadmi ka Adhikar 4523 7812 9034", "id");
    expect(tags.person).toBeUndefined();
  });
});

describe("OCR engine", () => {
  it("reads text from a rendered image (eng+hin packs bundled)", async () => {
    const sharp = (await import("sharp")).default;
    const { ocrImage } = await import("../src/lib/ocr");
    const svg = `<svg width="800" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="20" y="120" font-size="60" font-family="DejaVu Sans">PAN ABCPK1234F</text></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const r = await ocrImage(png);
    expect(r.engine).toBe("tesseract");
    expect(r.text.replace(/\s/g, "")).toContain("ABCPK1234F");
  }, 60000);
});
