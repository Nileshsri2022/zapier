-- AlterTable
ALTER TABLE "GmailServer" ADD COLUMN     "email" TEXT,
ADD COLUMN     "lastHistoryId" TEXT;

-- CreateIndex
CREATE INDEX "GmailServer_email_idx" ON "GmailServer"("email");
