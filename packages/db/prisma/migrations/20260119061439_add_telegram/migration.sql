-- CreateTable
CREATE TABLE "TelegramBot" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "botToken" TEXT NOT NULL,
    "botUsername" TEXT NOT NULL,
    "botName" TEXT NOT NULL,
    "webhookConfigured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramTrigger" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "zapId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'message',
    "filterCommand" TEXT,
    "lastProcessedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBot_botToken_key" ON "TelegramBot"("botToken");

-- CreateIndex
CREATE INDEX "TelegramBot_userId_idx" ON "TelegramBot"("userId");

-- CreateIndex
CREATE INDEX "TelegramBot_isActive_idx" ON "TelegramBot"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramTrigger_zapId_key" ON "TelegramTrigger"("zapId");

-- CreateIndex
CREATE INDEX "TelegramTrigger_botId_idx" ON "TelegramTrigger"("botId");

-- CreateIndex
CREATE INDEX "TelegramTrigger_isActive_idx" ON "TelegramTrigger"("isActive");

-- CreateIndex
CREATE INDEX "TelegramTrigger_zapId_idx" ON "TelegramTrigger"("zapId");

-- AddForeignKey
ALTER TABLE "TelegramBot" ADD CONSTRAINT "TelegramBot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramTrigger" ADD CONSTRAINT "TelegramTrigger_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramTrigger" ADD CONSTRAINT "TelegramTrigger_zapId_fkey" FOREIGN KEY ("zapId") REFERENCES "Zap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
