-- Backfills the newsletter package as PER_UNIT and every other existing row as PER_THOUSAND —
-- matching prisma/seed-data.ts exactly, so an existing database ends up in the same state a fresh
-- reseed would produce. No DB-level DEFAULT is kept on the final column: prisma/schema.prisma
-- declares no default, and every write path is expected to set this field explicitly (see
-- add-agent-tools/design.md on rejecting a channel-inferred default).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RateCardPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "pricingUnit" TEXT NOT NULL,
    "availableVolume" INTEGER NOT NULL,
    "minFlightDays" INTEGER NOT NULL,
    "maxFlightDays" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_RateCardPackage" ("id", "name", "channel", "format", "unitPriceCents", "pricingUnit", "availableVolume", "minFlightDays", "maxFlightDays", "createdAt")
SELECT "id", "name", "channel", "format", "unitPriceCents",
  CASE WHEN "channel" = 'newsletter' THEN 'PER_UNIT' ELSE 'PER_THOUSAND' END,
  "availableVolume", "minFlightDays", "maxFlightDays", "createdAt"
FROM "RateCardPackage";
DROP TABLE "RateCardPackage";
ALTER TABLE "new_RateCardPackage" RENAME TO "RateCardPackage";
CREATE INDEX "RateCardPackage_channel_idx" ON "RateCardPackage"("channel");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
