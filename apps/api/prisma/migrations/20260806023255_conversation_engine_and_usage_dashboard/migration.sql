-- CreateEnum
CREATE TYPE "StoryOwnership" AS ENUM ('SOLO', 'CONTRIBUTED', 'CO_LED');

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('INTERVIEWER', 'TONY');

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_authorId_fkey";

-- DropTable
DROP TABLE "Author";

-- DropTable
DROP TABLE "Post";

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownership" "StoryOwnership" NOT NULL,
    "engagement" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "requiredFraming" TEXT,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "role" "ConversationRole" NOT NULL,
    "text" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "hashedIp" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyUsageCounter" (
    "date" DATE NOT NULL,
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyUsageCounter_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "_StoryToTopic" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StoryToTopic_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Topic_slug_key" ON "Topic"("slug");

-- CreateIndex
CREATE INDEX "ConversationTurn_conversationId_idx" ON "ConversationTurn"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationTurn_createdAt_idx" ON "ConversationTurn"("createdAt");

-- CreateIndex
CREATE INDEX "ConversationTurn_hashedIp_idx" ON "ConversationTurn"("hashedIp");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_conversationId_turnIndex_role_key" ON "ConversationTurn"("conversationId", "turnIndex", "role");

-- CreateIndex
CREATE INDEX "_StoryToTopic_B_index" ON "_StoryToTopic"("B");

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StoryToTopic" ADD CONSTRAINT "_StoryToTopic_A_fkey" FOREIGN KEY ("A") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StoryToTopic" ADD CONSTRAINT "_StoryToTopic_B_fkey" FOREIGN KEY ("B") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

