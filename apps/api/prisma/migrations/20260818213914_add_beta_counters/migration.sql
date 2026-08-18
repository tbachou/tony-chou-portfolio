-- CreateTable
CREATE TABLE "BetaDailyUsageCounter" (
    "date" DATE NOT NULL,
    "planCount" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BetaDailyUsageCounter_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "BetaIpDailyCount" (
    "hashedIp" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BetaIpDailyCount_pkey" PRIMARY KEY ("hashedIp","date")
);
