-- Additive only; credentials never stored in Action.metadata.
CREATE TABLE "AiConnection" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai_compatible',
    "baseUrl" TEXT NOT NULL,
    "capabilityProfileId" TEXT NOT NULL,
    "credentialCiphertext" TEXT NOT NULL,
    "credentialNonce" TEXT NOT NULL,
    "credentialTag" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiConnection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiConnection_provider_check" CHECK ("provider" = 'openai_compatible')
);
CREATE INDEX "AiConnection_userId_revokedAt_idx" ON "AiConnection"("userId", "revokedAt");
ALTER TABLE "AiConnection" ADD CONSTRAINT "AiConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
