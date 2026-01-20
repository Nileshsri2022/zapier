-- AlterTable
ALTER TABLE "ZapRun" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "ZapRun_status_idx" ON "ZapRun"("status");
