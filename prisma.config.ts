import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env.NODE_ENV === "production"
    ? process.env.PROD_DATABASE_URL
    : process.env.DEV_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE URL is not defined");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },

  datasource: {
    url: databaseUrl,
  },
});
