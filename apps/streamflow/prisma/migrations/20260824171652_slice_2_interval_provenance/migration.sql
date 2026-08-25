-- AlterTable
ALTER TABLE "predictions" ADD COLUMN     "bucketSize" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hindcast" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "intervalClamped" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "issueRegime" "Regime",
ADD COLUMN     "q10Used" DOUBLE PRECISION,
ADD COLUMN     "q90Used" DOUBLE PRECISION,
ALTER COLUMN "intervalSeeded" SET DEFAULT false;

-- AlterTable
ALTER TABLE "scores" ALTER COLUMN "regime" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "predictions_gaugeId_modelVersionId_horizonHours_issueRegime_idx" ON "predictions"("gaugeId", "modelVersionId", "horizonHours", "issueRegime");
