-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "pageSpeedApiKey" TEXT;

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "intelligenceItems" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "pageSpeed" TEXT;
