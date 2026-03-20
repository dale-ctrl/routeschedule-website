-- AlterTable
ALTER TABLE "Order" ADD COLUMN "depot" TEXT;

-- AlterTable
ALTER TABLE "Route" ADD COLUMN "depot" TEXT;

-- CreateTable
CREATE TABLE "Depot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" REAL,
    "lng" REAL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Depot_name_key" ON "Depot"("name");
