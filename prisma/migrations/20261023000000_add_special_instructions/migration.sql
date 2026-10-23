-- AlterTable
ALTER TABLE "Order" ADD COLUMN "specialInstructions" TEXT;
ALTER TABLE "Order" ADD COLUMN "windowStart" INTEGER;
ALTER TABLE "Order" ADD COLUMN "windowEnd" INTEGER;
ALTER TABLE "Order" ADD COLUMN "instructionFlags" TEXT;

-- AlterTable
ALTER TABLE "Route" ADD COLUMN "startTime" INTEGER;
