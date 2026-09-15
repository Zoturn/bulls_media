import { PrismaClient } from '@prisma/client';

/**
 * A single Prisma client for the process, held on `globalThis` across Next's dev-server module
 * reloads. Without this, every hot reload creates a fresh client — and a fresh connection pool —
 * on top of the ones from every reload before it, which exhausts SQLite's file handles quickly.
 */
declare global {
  var __prismaClient: PrismaClient | undefined;
}

export const db: PrismaClient = globalThis.__prismaClient ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prismaClient = db;
}
