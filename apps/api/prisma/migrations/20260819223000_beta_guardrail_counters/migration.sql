-- AlterTable
ALTER TABLE "BetaDailyUsageCounter" ADD COLUMN     "guardBlockCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "injectionBlockCount" INTEGER NOT NULL DEFAULT 0;
