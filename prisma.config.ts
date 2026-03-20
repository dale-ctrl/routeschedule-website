import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "file:./dev.db",
    ...(process.env["TURSO_AUTH_TOKEN"]
      ? { authToken: process.env["TURSO_AUTH_TOKEN"] }
      : {}),
  },
});
