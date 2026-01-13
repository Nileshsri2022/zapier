-- CreateTable
CREATE TABLE "GmailServer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailTrigger" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "zapId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "watchedLabels" TEXT[],
    "senderFilter" TEXT,
    "subjectFilter" TEXT,
    "webhookExpiry" TIMESTAMP(3),
    "watchExpiration" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "GmailTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailAction" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "zapId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "GmailAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailWatch" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "expiry" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmailTrigger_zapId_key" ON "GmailTrigger"("zapId");

-- AddForeignKey
ALTER TABLE "GmailServer" ADD CONSTRAINT "GmailServer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailTrigger" ADD CONSTRAINT "GmailTrigger_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "GmailServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailTrigger" ADD CONSTRAINT "GmailTrigger_zapId_fkey" FOREIGN KEY ("zapId") REFERENCES "Zap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailAction" ADD CONSTRAINT "GmailAction_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "GmailServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailAction" ADD CONSTRAINT "GmailAction_zapId_fkey" FOREIGN KEY ("zapId") REFERENCES "Zap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailWatch" ADD CONSTRAINT "GmailWatch_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "GmailServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
