import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaMariaDb(connectionString);

export const prisma = new PrismaClient({ adapter });

export async function waitForDatabase(
  maxAttempts = 10,
  delayMs = 2000
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.warn(
        `Database not reachable yet (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
