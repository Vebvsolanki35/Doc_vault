import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  jsonb,
  customType,
  index,
} from "drizzle-orm/pg-core";

/**
 * Raw binary column (BYTEA) so vault files live *inside* PostgreSQL —
 * nothing sensitive ever touches the public file system.
 */
const bytea = customType<{ data: Buffer | null; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value as Buffer;
  },
  fromDriver(value) {
    return value as unknown as Buffer | null;
  },
});

// ── Family members (Papa / Mummy / Me — seeded, extendable) ──────────
export const members = pgTable("members", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(), // papa | mummy | me
  nameEn: text("name_en").notNull(),
  nameHi: text("name_hi").notNull(),
  icon: text("icon").notNull().default("user"), // lucide icon name
  color: text("color").notNull().default("leaf"), // avatar theme key
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]), // names used by AI member-detection
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Folders inside a member's space (5 defaults + custom) ────────────
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // education | id | marksheet | land | other | custom
    nameEn: text("name_en"),
    nameHi: text("name_hi"), // null → use default key labels
    isDefault: boolean("is_default").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("folders_member_idx").on(t.memberId)],
);

export type DocumentTags = {
  owner?: string; // Land: extracted owner / मालिक
  surveyNo?: string; // Khasra / survey number
  area?: string;
  areaUnit?: string; // bigha | kanal | hectare | acre | sqft
  person?: string;
  cardNo?: string; // ID: masked card number
  expiry?: string; // ID: expiry date
  cardType?: string; // ID: Aadhaar / PAN / Voter...
  percentage?: string; // Marksheet: 78.4%
  year?: string; // Marksheet/Education: exam year
  confidence?: number;
};

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    category: text("category").notNull().default("other"), // folder key cache: education|id|marksheet|land|other|custom
    memberId: uuid("member_id").references(() => members.id),
    folderId: uuid("folder_id").references(() => folders.id),
    fileData: bytea("file_data").notNull(),
    checksum: text("checksum").notNull(),
    prevFileData: bytea("prev_file_data"),
    prevChecksum: text("prev_checksum"),
    prevSize: integer("prev_size"),
    ocrText: text("ocr_text").notNull().default(""),
    tags: jsonb("tags").$type<DocumentTags>().notNull().default({}),
    shareToken: text("share_token"),
    sharePasscode: text("share_passcode"),
    shareExpiresAt: timestamp("share_expires_at"), // optional QR expiry
    deletedAt: timestamp("deleted_at"), // recycle bin (30-day retention)
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("documents_category_idx").on(t.category),
    index("documents_member_idx").on(t.memberId),
    index("documents_folder_idx").on(t.folderId),
    index("documents_deleted_idx").on(t.deletedAt),
    index("documents_created_idx").on(t.createdAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    action: text("action").notNull(), // upload | download | delete | restore | share | move | merge | backup | purge | heal
    docName: text("doc_name").notNull().default(""),
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Member = typeof members.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
