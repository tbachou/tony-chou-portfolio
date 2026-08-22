/*
  Warnings:

  - You are about to drop the `GradeDay` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "GradeDay" DROP CONSTRAINT "GradeDay_photoId_fkey";

-- DropTable
DROP TABLE "GradeDay";

-- CreateTable
CREATE TABLE "GradeProblem" (
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

    CONSTRAINT "GradeProblem_pkey" PRIMARY KEY ("photoId")
);

-- AddForeignKey
ALTER TABLE "GradeProblem" ADD CONSTRAINT "GradeProblem_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "GradePhoto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
