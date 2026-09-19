import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Columns added after the initial schema shipped. schema.sql's
// CREATE TABLE IF NOT EXISTS is a no-op against tables that already exist,
// so any column added there since must also be listed here as an idempotent
// ALTER, or it will never reach a database that predates it.
const COLUMN_MIGRATIONS: {
  table: string;
  column: string;
  definition: string;
}[] = [
  { table: "ads", column: "editable", definition: "TINYINT(1) NOT NULL DEFAULT 0" },
  { table: "ads", column: "canva_url", definition: "VARCHAR(500)" },
  { table: "ads", column: "dominant_color", definition: "VARCHAR(30)" },
  { table: "ads", column: "video_length", definition: "VARCHAR(20)" },
  { table: "creative_requests", column: "reason", definition: "TEXT" },
  { table: "creative_requests", column: "attachment_url", definition: "VARCHAR(500)" },
  { table: "creative_requests", column: "attachment_name", definition: "VARCHAR(255)" },
  { table: "creative_requests", column: "ad_id", definition: "INT" },
];

const CONSTRAINT_MIGRATIONS: {
  table: string;
  constraint: string;
  definition: string;
}[] = [
  {
    table: "creative_requests",
    constraint: "fk_requests_ad",
    definition:
      "FOREIGN KEY (ad_id) REFERENCES ads(id) ON DELETE SET NULL",
  },
];

async function columnExists(
  connection: mysql.Connection,
  database: string,
  table: string,
  column: string
) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [database, table, column]
  );
  return rows.length > 0;
}

async function constraintExists(
  connection: mysql.Connection,
  database: string,
  table: string,
  constraint: string
) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [database, table, constraint]
  );
  return rows.length > 0;
}

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const database = new URL(connectionString).pathname.replace(/^\//, "");
  const sql = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  const separator = connectionString.includes("?") ? "&" : "?";
  const connection = await mysql.createConnection(
    `${connectionString}${separator}multipleStatements=true`
  );

  console.log("Running migrations...");
  await connection.query(sql);

  for (const { table, column, definition } of COLUMN_MIGRATIONS) {
    if (await columnExists(connection, database, table, column)) continue;
    console.log(`Adding column ${table}.${column}...`);
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }

  for (const { table, constraint, definition } of CONSTRAINT_MIGRATIONS) {
    if (await constraintExists(connection, database, table, constraint)) continue;
    console.log(`Adding constraint ${constraint} on ${table}...`);
    await connection.query(
      `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\` ${definition}`
    );
  }

  console.log("Migrations complete.");
  await connection.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
