-- CreateTable
CREATE TABLE "WhatsAppServer" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "displayName" TEXT,
    "phoneNumber" TEXT,
    "webhookVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTrigger" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "zapId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'message_received',
    "lastProcessedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppServer_phoneNumberId_key" ON "WhatsAppServer"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppServer_userId_idx" ON "WhatsAppServer"("userId");

-- CreateIndex
CREATE INDEX "WhatsAppServer_phoneNumberId_idx" ON "WhatsAppServer"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppServer_isActive_idx" ON "WhatsAppServer"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTrigger_zapId_key" ON "WhatsAppTrigger"("zapId");

-- CreateIndex
CREATE INDEX "WhatsAppTrigger_serverId_idx" ON "WhatsAppTrigger"("serverId");

-- CreateIndex
CREATE INDEX "WhatsAppTrigger_isActive_idx" ON "WhatsAppTrigger"("isActive");

-- CreateIndex
CREATE INDEX "WhatsAppTrigger_zapId_idx" ON "WhatsAppTrigger"("zapId");

-- AddForeignKey
ALTER TABLE "WhatsAppServer" ADD CONSTRAINT "WhatsAppServer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTrigger" ADD CONSTRAINT "WhatsAppTrigger_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "WhatsAppServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTrigger" ADD CONSTRAINT "WhatsAppTrigger_zapId_fkey" FOREIGN KEY ("zapId") REFERENCES "Zap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
