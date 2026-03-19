import { PrismaClient } from '@/app/generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'path'

function createPrismaClient() {
  // DATABASE_URL is "file:./dev.db" — strip the "file:" prefix for better-sqlite3
  const rawUrl = process.env.DATABASE_URL ?? 'file:./dev.db'
  const relativePath = rawUrl.replace(/^file:/, '')
  const dbPath = path.resolve(process.cwd(), relativePath)
  const adapter = new PrismaBetterSqlite3({ url: dbPath })
  return new PrismaClient({ adapter })
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
