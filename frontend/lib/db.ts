import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  const isLocal =
    !!connectionString && /(localhost|127\.0\.0\.1)/.test(connectionString);
  const pool = new Pool({
    connectionString,
    // Hosted Postgres (Supabase pooler, Neon, …) requires TLS, but their pooler
    // certs aren't in Node's default CA chain — encrypt without verifying the chain.
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// Reuse a single client across hot-reloads / warm serverless instances.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? createPrisma();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
