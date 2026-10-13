-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospectId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "confidence" REAL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evidence_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Prospect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "offerId" TEXT,
    "searchJobId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "city" TEXT,
    "country" TEXT,
    "address" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "socialLinks" TEXT,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "placeId" TEXT,
    "lat" REAL,
    "lng" REAL,
    "rating" REAL,
    "ratingCount" INTEGER,
    "businessStatus" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "digitalPresence" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'PENDING',
    "nicheFit" TEXT,
    "painDetected" BOOLEAN NOT NULL DEFAULT false,
    "painType" TEXT,
    "painEvidence" TEXT,
    "intentSignals" TEXT,
    "disqualifyReason" TEXT,
    "qualificationDetails" TEXT,
    "techStack" TEXT,
    "freshnessData" TEXT,
    "lookAlikeScore" REAL,
    "leadScore" INTEGER,
    "leadScoreBreakdown" TEXT,
    "intelligenceSummary" TEXT,
    "intelligenceOpportunity" TEXT,
    "intelligenceAngle" TEXT,
    "intelligenceConfidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "lastContactedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prospect_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Prospect_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Prospect_searchJobId_fkey" FOREIGN KEY ("searchJobId") REFERENCES "SearchJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Prospect" ("address", "category", "city", "country", "createdAt", "description", "disqualifyReason", "email", "freshnessData", "id", "intelligenceAngle", "intelligenceConfidence", "intelligenceOpportunity", "intelligenceSummary", "intentSignals", "isFavorite", "lastContactedAt", "leadScore", "leadScoreBreakdown", "lookAlikeScore", "name", "nicheFit", "offerId", "painDetected", "painEvidence", "painType", "phone", "qualificationDetails", "searchJobId", "socialLinks", "source", "sourceUrl", "status", "techStack", "tier", "updatedAt", "userId", "website") SELECT "address", "category", "city", "country", "createdAt", "description", "disqualifyReason", "email", "freshnessData", "id", "intelligenceAngle", "intelligenceConfidence", "intelligenceOpportunity", "intelligenceSummary", "intentSignals", "isFavorite", "lastContactedAt", "leadScore", "leadScoreBreakdown", "lookAlikeScore", "name", "nicheFit", "offerId", "painDetected", "painEvidence", "painType", "phone", "qualificationDetails", "searchJobId", "socialLinks", "source", "sourceUrl", "status", "techStack", "tier", "updatedAt", "userId", "website" FROM "Prospect";
DROP TABLE "Prospect";
ALTER TABLE "new_Prospect" RENAME TO "Prospect";
CREATE TABLE "new_SearchJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "offerId" TEXT,
    "city" TEXT NOT NULL,
    "country" TEXT,
    "category" TEXT,
    "keywords" TEXT,
    "radius" INTEGER,
    "sourceAdapter" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "foundCount" INTEGER NOT NULL DEFAULT 0,
    "qualifiedCount" INTEGER NOT NULL DEFAULT 0,
    "tierACount" INTEGER NOT NULL DEFAULT 0,
    "tierBCount" INTEGER NOT NULL DEFAULT 0,
    "tierCCount" INTEGER NOT NULL DEFAULT 0,
    "tierFCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "partialSources" INTEGER NOT NULL DEFAULT 0,
    "failedSources" TEXT,
    "providerCalls" INTEGER NOT NULL DEFAULT 0,
    "providerCallsDetail" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SearchJob_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SearchJob" ("category", "city", "completedAt", "country", "createdAt", "errorMessage", "foundCount", "id", "keywords", "offerId", "qualifiedCount", "radius", "sourceAdapter", "startedAt", "status", "tierACount", "tierBCount", "tierCCount", "tierFCount", "userId") SELECT "category", "city", "completedAt", "country", "createdAt", "errorMessage", "foundCount", "id", "keywords", "offerId", "qualifiedCount", "radius", "sourceAdapter", "startedAt", "status", "tierACount", "tierBCount", "tierCCount", "tierFCount", "userId" FROM "SearchJob";
DROP TABLE "SearchJob";
ALTER TABLE "new_SearchJob" RENAME TO "SearchJob";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Evidence_prospectId_field_idx" ON "Evidence"("prospectId", "field");
