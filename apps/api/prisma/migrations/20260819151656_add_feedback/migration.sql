-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('beta', 'portfolio');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('bug', 'feature', 'other');

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "FeedbackSource" NOT NULL,
    "category" "FeedbackCategory",
    "message" VARCHAR(2000) NOT NULL,
    "hashedIp" TEXT NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_hashedIp_idx" ON "Feedback"("hashedIp");
