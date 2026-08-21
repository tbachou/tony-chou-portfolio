-- CreateEnum
CREATE TYPE "GradePhotoSource" AS ENUM ('own_photo', 'permission_given', 'licensed', 'unlicensed_test');

-- CreateTable
CREATE TABLE "GradePhoto" (
    "id" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "trueGrade" INTEGER NOT NULL,
    "source" "GradePhotoSource" NOT NULL,
    "sourceNote" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GradePhoto_objectKey_key" ON "GradePhoto"("objectKey");

-- CreateIndex
CREATE INDEX "GradePhoto_active_idx" ON "GradePhoto"("active");

-- AddForeignKey
ALTER TABLE "GradeDay" ADD CONSTRAINT "GradeDay_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "GradePhoto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
