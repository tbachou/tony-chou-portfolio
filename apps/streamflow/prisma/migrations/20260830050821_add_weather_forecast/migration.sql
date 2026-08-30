-- CreateTable
CREATE TABLE "weather_forecasts" (
    "id" TEXT NOT NULL,
    "gaugeId" TEXT NOT NULL,
    "validTime" TIMESTAMP(3) NOT NULL,
    "leadHours" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "precipMm" DOUBLE PRECISION NOT NULL,
    "tempC" DOUBLE PRECISION,
    "model" TEXT NOT NULL,
    "ingestRunId" TEXT NOT NULL,

    CONSTRAINT "weather_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weather_forecasts_gaugeId_model_leadHours_validTime_idx" ON "weather_forecasts"("gaugeId", "model", "leadHours", "validTime");

-- CreateIndex
CREATE UNIQUE INDEX "weather_forecasts_gaugeId_validTime_leadHours_model_recorde_key" ON "weather_forecasts"("gaugeId", "validTime", "leadHours", "model", "recordedAt");

-- AddForeignKey
ALTER TABLE "weather_forecasts" ADD CONSTRAINT "weather_forecasts_gaugeId_fkey" FOREIGN KEY ("gaugeId") REFERENCES "gauges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_forecasts" ADD CONSTRAINT "weather_forecasts_ingestRunId_fkey" FOREIGN KEY ("ingestRunId") REFERENCES "pipeline_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
