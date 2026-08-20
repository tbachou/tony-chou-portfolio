-- Grade Guesser daily game (spec 0006). One row per UTC day, keyed by the
-- `YYYY-MM-DD` string the api computes, created lazily by that day's first
-- guess.
--
-- Written by hand rather than by `prisma migrate dev`: dev and prod share one
-- Prisma Postgres database (apps/api/AGENTS.md gotcha), so running the dev
-- command locally would have applied this straight to production. It needs no
-- shadow database and matches what Prisma emits for the GradeDay model;
-- `prisma migrate deploy` on the api's next Render release applies it.
--
-- Scalar list columns are nullable in DDL on purpose: that is Prisma's own
-- convention for `String[]` / `Int[]` fields, and the client never writes NULL
-- into them.

-- CreateTable
CREATE TABLE "GradeDay" (
    "date" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "modelGrade" INTEGER,
    "modelConfidence" TEXT,
    "observations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reasoning" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "guessCounts" INTEGER[] DEFAULT ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0]::INTEGER[],
    "plays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeDay_pkey" PRIMARY KEY ("date")
);
