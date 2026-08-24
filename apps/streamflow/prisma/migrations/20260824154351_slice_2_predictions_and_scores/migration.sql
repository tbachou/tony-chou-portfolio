-- CreateEnum
CREATE TYPE "ModelKind" AS ENUM ('BASELINE', 'MODEL');

-- CreateEnum
CREATE TYPE "Regime" AS ENUM ('BASEFLOW', 'RISING', 'PEAK');

-- CreateTable
CREATE TABLE "model_versions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ModelKind" NOT NULL,
    "trainedAt" TIMESTAMP(3),
    "trainWindowStart" TIMESTAMP(3),
    "trainWindowEnd" TIMESTAMP(3),
    "hyperparams" JSONB,
    "codeSha" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictions" (
    "id" TEXT NOT NULL,
    "gaugeId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "targetTime" TIMESTAMP(3) NOT NULL,
    "horizonHours" INTEGER NOT NULL,
    "centralCfs" DOUBLE PRECISION NOT NULL,
    "lowerCfs" DOUBLE PRECISION NOT NULL,
    "upperCfs" DOUBLE PRECISION NOT NULL,
    "intervalLevel" DOUBLE PRECISION NOT NULL,
    "intervalSeeded" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL,
    "actualCfs" DOUBLE PRECISION NOT NULL,
    "actualRecordedAt" TIMESTAMP(3) NOT NULL,
    "absError" DOUBLE PRECISION NOT NULL,
    "pctError" DOUBLE PRECISION NOT NULL,
    "withinInterval" BOOLEAN NOT NULL,
    "regime" "Regime" NOT NULL,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_versions_name_key" ON "model_versions"("name");

-- CreateIndex
CREATE INDEX "predictions_targetTime_idx" ON "predictions"("targetTime");

-- CreateIndex
CREATE UNIQUE INDEX "predictions_gaugeId_modelVersionId_issuedAt_targetTime_key" ON "predictions"("gaugeId", "modelVersionId", "issuedAt", "targetTime");

-- CreateIndex
CREATE INDEX "scores_regime_idx" ON "scores"("regime");

-- CreateIndex
CREATE UNIQUE INDEX "scores_predictionId_actualRecordedAt_key" ON "scores"("predictionId", "actualRecordedAt");

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_gaugeId_fkey" FOREIGN KEY ("gaugeId") REFERENCES "gauges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "predictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
