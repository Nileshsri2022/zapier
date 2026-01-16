-- AlterTable
ALTER TABLE "ZapRun" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "GmailServer_userId_idx" ON "GmailServer"("userId");

-- CreateIndex
CREATE INDEX "GmailServer_isActive_idx" ON "GmailServer"("isActive");

-- CreateIndex
CREATE INDEX "GoogleSheetsServer_userId_idx" ON "GoogleSheetsServer"("userId");

-- CreateIndex
CREATE INDEX "GoogleSheetsServer_isActive_idx" ON "GoogleSheetsServer"("isActive");

-- CreateIndex
CREATE INDEX "GoogleSheetsTrigger_isActive_idx" ON "GoogleSheetsTrigger"("isActive");

-- CreateIndex
CREATE INDEX "GoogleSheetsTrigger_lastPolledAt_idx" ON "GoogleSheetsTrigger"("lastPolledAt");

-- CreateIndex
CREATE INDEX "GoogleSheetsTrigger_serverId_idx" ON "GoogleSheetsTrigger"("serverId");

-- CreateIndex
CREATE INDEX "Zap_userId_idx" ON "Zap"("userId");

-- CreateIndex
CREATE INDEX "Zap_isActive_idx" ON "Zap"("isActive");

-- CreateIndex
CREATE INDEX "Zap_createdDate_idx" ON "Zap"("createdDate");

-- CreateIndex
CREATE INDEX "ZapRun_zapId_idx" ON "ZapRun"("zapId");

-- CreateIndex
CREATE INDEX "ZapRun_createdAt_idx" ON "ZapRun"("createdAt");
