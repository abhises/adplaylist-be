import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const sql = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  const separator = connectionString.includes("?") ? "&" : "?";
  const connection = await mysql.createConnection(
    `${connectionString}${separator}multipleStatements=true`
  );

  console.log("Running migrations...");
  await connection.query(sql);
  console.log("Migrations complete.");
  await connection.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
