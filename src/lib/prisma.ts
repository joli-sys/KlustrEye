import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Raw SQL statements matching prisma/schema.prisma — used to bootstrap the
// database when the Prisma CLI is unavailable (e.g. packaged Electron app).
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Organization_name_key" ON "Organization"("name")`,

  `CREATE TABLE IF NOT EXISTS "ClusterContext" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contextName" TEXT NOT NULL,
    "displayName" TEXT,
    "lastNamespace" TEXT NOT NULL DEFAULT 'default',
    "pinned" BOOLEAN NOT NULL DEFAULT 0,
    "organizationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClusterContext_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ClusterContext_contextName_key" ON "ClusterContext"("contextName")`,

  `CREATE TABLE IF NOT EXISTS "ClusterSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clusterId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClusterSetting_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ClusterContext" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ClusterSetting_clusterId_key_key" ON "ClusterSetting"("clusterId", "key")`,

  `CREATE TABLE IF NOT EXISTS "UserPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UserPreference_key_key" ON "UserPreference"("key")`,

  `CREATE TABLE IF NOT EXISTS "SavedTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "yaml" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS "TerminalSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contextName" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "podName" TEXT NOT NULL,
    "containerName" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

let ensured = false;

export async function ensureDatabase(): Promise<void> {
  if (ensured) return;
  ensured = true;
  try {
    for (const sql of SCHEMA_STATEMENTS) {
      await prisma.$executeRawUnsafe(sql);
    }
  } catch (err) {
    console.error("ensureDatabase failed:", err);
  }
}
