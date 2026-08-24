-- CreateEnum
CREATE TYPE "Qualifier" AS ENUM ('PROVISIONAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "PipelineJob" AS ENUM ('USGS_INGEST', 'USGS_RESCAN', 'OPEN_METEO_INGEST', 'PREDICT', 'SCORE', 'RETRAIN');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('OK', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "gauges" (
    "id" TEXT NOT NULL,
    "usgsSiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "drainageAreaSqMi" DOUBLE PRECISION,
    "timezone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gauges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" TEXT NOT NULL,
    "gaugeId" TEXT NOT NULL,
    "validTime" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "valueCfs" DOUBLE PRECISION NOT NULL,
    "qualifier" "Qualifier" NOT NULL,
    "ingestRunId" TEXT NOT NULL,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "job" "PipelineJob" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gauges_usgsSiteId_key" ON "gauges"("usgsSiteId");

-- CreateIndex
CREATE INDEX "observations_gaugeId_validTime_recordedAt_idx" ON "observations"("gaugeId", "validTime", "recordedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "observations_gaugeId_validTime_recordedAt_key" ON "observations"("gaugeId", "validTime", "recordedAt");

-- CreateIndex
CREATE INDEX "pipeline_runs_job_startedAt_idx" ON "pipeline_runs"("job", "startedAt");

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_gaugeId_fkey" FOREIGN KEY ("gaugeId") REFERENCES "gauges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_ingestRunId_fkey" FOREIGN KEY ("ingestRunId") REFERENCES "pipeline_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
