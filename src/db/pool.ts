import "dotenv/config";
import mysql from "mysql2/promise";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = mysql.createPool(connectionString);
