-- CreateTable
CREATE TABLE "GoogleCalendarServer" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleCalendarTrigger" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "zapId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "triggerType" TEXT NOT NULL,
    "isInstant" BOOLEAN NOT NULL DEFAULT false,
    "searchQuery" TEXT,
    "reminderMinutes" INTEGER,
    "watchChannelId" TEXT,
    "watchResourceId" TEXT,
    "watchExpiry" TIMESTAMP(3),
    "syncToken" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoogleCalendarServer_userId_idx" ON "GoogleCalendarServer"("userId");

-- CreateIndex
CREATE INDEX "GoogleCalendarServer_isActive_idx" ON "GoogleCalendarServer"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarTrigger_zapId_key" ON "GoogleCalendarTrigger"("zapId");

-- CreateIndex
CREATE INDEX "GoogleCalendarTrigger_serverId_idx" ON "GoogleCalendarTrigger"("serverId");

-- CreateIndex
CREATE INDEX "GoogleCalendarTrigger_isActive_idx" ON "GoogleCalendarTrigger"("isActive");

-- CreateIndex
CREATE INDEX "GoogleCalendarTrigger_zapId_idx" ON "GoogleCalendarTrigger"("zapId");

-- CreateIndex
CREATE INDEX "GoogleCalendarTrigger_triggerType_idx" ON "GoogleCalendarTrigger"("triggerType");

-- CreateIndex
CREATE INDEX "GoogleCalendarTrigger_lastPolledAt_idx" ON "GoogleCalendarTrigger"("lastPolledAt");

-- AddForeignKey
ALTER TABLE "GoogleCalendarServer" ADD CONSTRAINT "GoogleCalendarServer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleCalendarTrigger" ADD CONSTRAINT "GoogleCalendarTrigger_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "GoogleCalendarServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleCalendarTrigger" ADD CONSTRAINT "GoogleCalendarTrigger_zapId_fkey" FOREIGN KEY ("zapId") REFERENCES "Zap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
