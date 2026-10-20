import express, { Request, Response } from 'express';
import kafka from '@repo/kafka';
import client from '@repo/db';
import dotenv from 'dotenv';
import { sendEmailWithTextBody, sendZapFailureNotification } from '@repo/email';
import { withRetry, RetryResult } from './utils/retry';
import { sendSol, getSolanaPrivateKey } from './sendSolana';
import { sendDiscordMessage, resolveDiscordPlaceholders } from './sendDiscord';
import { evaluateFilters, FilterCondition } from './evaluateFilters';
import { isKnownActionType } from './utils/actionTypes';
import { prepareRunMetadata } from './utils/runMetadata';
import { advanceSkippedStage } from './utils/skipStage';
import { replaceKeys } from './utils/replaceKeys';
import { readAiPolicy } from '@repo/ai';
import { validateAiConnectionEnvironment } from '@repo/ai-connections';
import type { AiActionContext } from './executeAiAction';

dotenv.config();

// Optional AI credentials stay optional; malformed configured policy must fail startup.
readAiPolicy();
validateAiConnectionEnvironment();

const app = express();
const PORT = process.env.PORT || 3002;
const TOPIC_NAME = 'zap-events';

let consumer: any = null;
let producer: any = null;

const validateEmail = (email: string) => {
  const regex = /^\S+@\S+\.\S+$/;
  return regex.test(email);
};

// Initialize Kafka
async function initKafka() {
  if (!consumer) {
    consumer = kafka.consumer({ groupId: 'worker' });
    await consumer.connect();
    await consumer.subscribe({ topic: TOPIC_NAME, fromBeginning: true });
    console.log('Kafka consumer connected');
  }
  if (!producer) {
    producer = kafka.producer();
    await producer.connect();
    console.log('Kafka producer connected');
  }
}

// Execute action with retry - returns output data for chaining
export async function executeActionWithRetry(
  actionType: string,
  metadata: any,
  zapRunMetadata: any,
  previousOutputs?: Record<number, any>, // Outputs from previous steps
  context?: AiActionContext
): Promise<RetryResult<{ success: boolean; message: string; output?: any }>> {
  if (actionType === 'AI Transform') {
    const { executeAiAction } = await import('./executeAiAction.js');
    return executeAiAction(metadata, zapRunMetadata, previousOutputs, context);
  }
  return withRetry(
    async () => {
      // Fail loudly for actions the worker cannot execute. Previously an unknown
      // type fell through to a fake `success: true` no-op and the run was marked
      // completed (gap D2 in reports/workflow-execution-gaps.md).
      if (!isKnownActionType(actionType)) {
        throw new Error(
          `Unknown action type: "${actionType}". The worker does not implement this action; ` +
            `check the Zap's steps against the available action catalog.`
        );
      }

      if (actionType === 'Email') {
        const { to, subject, body } = metadata;
        let emailReceiver: string;

        console.log('📧 [Worker] Processing Email action:');
        console.log('  - Raw "to" from metadata:', to);
        console.log('  - Subject:', subject);
        console.log('  - Body (first 100 chars):', body?.substring(0, 100));

        if (validateEmail(to)) {
          emailReceiver = to;
        } else {
          const searchKey = JSON.stringify(zapRunMetadata);
          emailReceiver = searchKey.slice(
            searchKey.indexOf('email') + 8,
            searchKey.indexOf('.com') + 4
          );
          console.log('  - Extracted email from metadata:', emailReceiver);
        }

        console.log('📧 [Worker] Sending email to:', emailReceiver);
        const emailBody = replaceKeys(body, zapRunMetadata);
        // Template the subject like the body. It previously went out raw, so
        // "{previousOutput.…}" in a subject was delivered literally (the
        // server-side inline Email executor templated all three fields —
        // see reports/gmail-worker-routing-spec.md D8).
        const emailSubject = subject ? replaceKeys(String(subject), zapRunMetadata) : subject;
        console.log('  - Processed body (first 100 chars):', emailBody?.substring(0, 100));

        const result = await sendEmailWithTextBody(emailReceiver, emailSubject, emailBody);
        console.log('📧 [Worker] Email send result:', JSON.stringify(result));

        // @ts-ignore - Handle both success and error response types
        if (result && result.error) {
          // @ts-ignore
          throw new Error(`Email send failed: ${result.error}`);
        }

        return {
          success: true,
          message: `Email sent to ${emailReceiver}`,
          output: { to: emailReceiver, subject: emailSubject, sentAt: new Date().toISOString() },
        };
      }

      if (actionType === 'Solana') {
        const { address, amount } = metadata;
        const resolvedAddress = replaceKeys(address, zapRunMetadata);
        const resolvedAmount = replaceKeys(amount, zapRunMetadata);

        // Check if a Solana key is configured (documented name, then legacy).
        // Fail the run loudly instead of silently skipping a configured transfer.
        if (!getSolanaPrivateKey()) {
          throw new Error(
            'Solana action configured but SOLANA_PRIVATE_KEY is not set. ' +
              'Configure the key or remove the Solana step from the Zap.'
          );
        }

        console.log(`Sending ${resolvedAmount} SOL to ${resolvedAddress}...`);
        await sendSol(resolvedAddress, resolvedAmount);
        console.log(`✅ SOL sent successfully to ${resolvedAddress}`);
        return {
          success: true,
          message: `${resolvedAmount} SOL sent to ${resolvedAddress}`,
          output: {
            address: resolvedAddress,
            amount: resolvedAmount,
            sentAt: new Date().toISOString(),
          },
        };
      }

      if (actionType.startsWith('WhatsApp')) {
        const { to, message, phoneNumberId, accessToken } = metadata;
        const resolvedTo = replaceKeys(to, zapRunMetadata);
        const resolvedMessage = replaceKeys(message, zapRunMetadata);

        // Dynamic imports for sendWhatsApp
        const { sendWhatsAppMessage } = await import('./sendWhatsApp.js');

        const result = await sendWhatsAppMessage(
          phoneNumberId,
          accessToken,
          resolvedTo,
          resolvedMessage
        );

        if (!result.success) {
          throw new Error(`WhatsApp send failed: ${result.error}`);
        }

        console.log(`✅ WhatsApp message sent to ${resolvedTo}`);
        return {
          success: true,
          message: `WhatsApp sent to ${resolvedTo}`,
          output: { to: resolvedTo, sentAt: new Date().toISOString() },
        };
      }

      if (actionType.startsWith('Telegram')) {
        const { chatId, message, botToken } = metadata;
        const resolvedChatId = replaceKeys(chatId, zapRunMetadata);
        const resolvedMessage = replaceKeys(message, zapRunMetadata);

        // Dynamic imports for sendTelegram
        const { sendTelegramMessage } = await import('./sendTelegram.js');

        const result = await sendTelegramMessage(botToken, resolvedChatId, resolvedMessage);

        if (!result.success) {
          throw new Error(`Telegram send failed: ${result.error}`);
        }

        console.log(`✅ Telegram message sent to ${resolvedChatId}`);
        return {
          success: true,
          message: `Telegram sent to chat ${resolvedChatId}`,
          output: { chatId: resolvedChatId, sentAt: new Date().toISOString() },
        };
      }

      if (actionType === 'Discord Send Message') {
        const { webhookUrl, content, username, avatarUrl, embed } = metadata;

        const resolvedOptions = resolveDiscordPlaceholders(
          {
            content: content || undefined,
            username: username || undefined,
            avatarUrl: avatarUrl || undefined,
            embed,
          },
          zapRunMetadata
        );

        const result = await sendDiscordMessage(webhookUrl || '', resolvedOptions);

        if (!result.success) {
          const err = new Error(`Discord send failed: ${result.error}`);
          (err as any).isFatal = result.isFatal;
          throw err;
        }

        console.log(`✅ Discord message sent via webhook`);
        return {
          success: true,
          message: `Discord message delivered`,
          output: {
            messageId: result.messageId,
            timestamp: result.timestamp || new Date().toISOString(),
          },
        };
      }

      if (actionType === 'Webhook') {
        const { url, method = 'POST', headers = {}, body } = metadata;
        const resolvedUrl = replaceKeys(url, zapRunMetadata);
        const resolvedBody = body ? replaceKeys(JSON.stringify(body), zapRunMetadata) : null;

        // Dynamic import for sendWebhook
        const { sendWebhook } = await import('./sendWebhook.js');

        const result = await sendWebhook({
          url: resolvedUrl,
          method: method.toUpperCase() as any,
          headers,
          body: resolvedBody ? JSON.parse(resolvedBody) : undefined,
        });

        if (!result.success) {
          throw new Error(`Webhook failed: ${result.error}`);
        }

        console.log(`✅ Webhook sent to ${resolvedUrl} (${result.statusCode})`);
        return {
          success: true,
          message: `Webhook sent to ${resolvedUrl}`,
          output: { url: resolvedUrl, statusCode: result.statusCode, response: result.response },
        };
      }

      // Safety net — unreachable while the guard above uses the same registry,
      // but never report success for an unimplemented action.
      throw new Error(`Unknown action: ${actionType}`);
    },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      shouldRetry: (error: Error) => !(error as any).isFatal && !error.message.includes('[FATAL]'),
    }
  );
}

/**
 * Best-effort failure transition for a run that cannot be processed.
 * Exported for tests; the Kafka loop uses it before committing the offset so
 * one bad message cannot be redelivered forever.
 */
export async function markRunFailed(zapRunId: string | undefined, errorMessage: string) {
  if (!zapRunId) return;
  try {
    // Only pending/running runs may transition to failed; never overwrite a
    // run that already completed successfully.
    await client.zapRun.updateMany({
      where: { id: zapRunId, status: { in: ['pending', 'running'] } },
      data: {
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    console.error(`Failed to mark ZapRun ${zapRunId} failed:`, error);
  }
}

// Process a single Kafka message
export async function processMessage(message: any) {
  const { zapRunId, stage } = JSON.parse(message.value.toString());
  const startTime = Date.now();

  const zapRunDetails = await client.zapRun.findFirst({
    where: { id: zapRunId },
    include: {
      zap: {
        include: {
          actions: {
            include: { action: true },
          },
          user: true, // Include user for email notification
        },
      },
    },
  });

  // A missing run means the message references a deleted/invalid run; failing
  // loudly lets the consumer mark-and-advance instead of retrying forever.
  if (!zapRunDetails) {
    throw new Error(`ZapRun ${zapRunId} does not exist (deleted or invalid outbox message)`);
  }

  // Drop untrusted ingress replay keys on first execution; persisted later outputs remain reusable.
  const freshRun = zapRunDetails.status === 'pending';
  const zapMetadata = prepareRunMetadata(zapRunDetails.metadata, freshRun);
  // Update status to running
  await client.zapRun.update({
    where: { id: zapRunId },
    data: { status: 'running', ...(freshRun ? { metadata: zapMetadata as any } : {}) },
  });

  const lastStage = zapRunDetails?.zap?.actions?.length || 1;
  const currentAction = zapRunDetails?.zap?.actions?.find((a: any) => a.sortingOrder === stage);

  // Evaluate filters on first stage only
  if (stage === 1) {
    const filterConditions =
      ((zapRunDetails?.zap as any)?.filterConditions as FilterCondition[]) || [];
    const triggerData = zapMetadata;

    if (!evaluateFilters(filterConditions, triggerData)) {
      console.log(`🚫 Filters blocked ZapRun ${zapRunId} - skipping all actions`);
      await client.zapRun.update({
        where: { id: zapRunId },
        data: { status: 'completed', completedAt: new Date() },
      });
      return {
        success: true,
        reason: 'filtered',
        duration: Date.now() - startTime,
        message: 'Zap run skipped due to filter conditions',
      };
    }
  }

  if (!currentAction) {
    // Previously this returned without touching the run, leaving it
    // 'running' forever (and the message uncommitted).
    const message = `Action for stage ${stage} was not found`;
    console.log(message);
    await markRunFailed(zapRunId, message);
    return {
      success: false,
      reason: 'action_not_found',
      duration: Date.now() - startTime,
      error: message,
    };
  }

  // Get previous step outputs from metadata (for chaining)
  const stepOutputs = (zapMetadata.stepOutputs || {}) as Record<number, any>;
  const previousOutput = stepOutputs[stage - 1] || {};

  // Evaluate step conditions (skip action if conditions not met)
  const stepConditions = (currentAction as any).stepConditions || [];
  if (stepConditions.length > 0) {
    const conditionContext = { ...zapMetadata, previousOutput, stepOutputs };

    if (!evaluateFilters(stepConditions as FilterCondition[], conditionContext)) {
      console.log(
        `⏭️ Skipping action ${stage} (${currentAction.action.type}) - step conditions not met`
      );

      await advanceSkippedStage(
        stage,
        lastStage,
        () =>
          producer.send({
            topic: TOPIC_NAME,
            messages: [{ value: JSON.stringify({ zapRunId, stage: stage + 1 }) }],
          }),
        () =>
          client.zapRun.update({
            where: { id: zapRunId },
            data: { status: 'completed', completedAt: new Date() },
          })
      );

      return {
        success: true,
        reason: 'skipped',
        action: currentAction.action.type,
        duration: Date.now() - startTime,
        message: 'Action skipped due to step conditions',
      };
    }
  }

  // Execute action with retry - passing previous outputs
  const result = await executeActionWithRetry(
    currentAction.action.type,
    currentAction.metadata,
    { ...zapMetadata, stepOutputs, previousOutput },
    stepOutputs,
    { userId: zapRunDetails!.zap.userId, zapRunId, stage }
  );

  console.log(
    `Action ${currentAction.action.type}: ${result.success ? 'SUCCESS' : 'FAILED'} after ${result.attempts} attempt(s)`
  );

  // Store action output for next step (chaining)
  if (result.success && result.data?.output) {
    const updatedStepOutputs = { ...stepOutputs, [stage]: result.data.output };
    await client.zapRun.update({
      where: { id: zapRunId },
      data: {
        metadata: { ...zapMetadata, stepOutputs: updatedStepOutputs },
      },
    });
    console.log(`📦 Stored output from step ${stage} for next action`);
  }

  // Queue next stage if not last and action succeeded
  if (result.success && stage !== lastStage) {
    console.log('Pushing next stage to kafka');
    await producer.send({
      topic: TOPIC_NAME,
      messages: [
        {
          value: JSON.stringify({ zapRunId, stage: stage + 1 }),
        },
      ],
    });
  }

  // Update ZapRun status based on result
  if (result.success && stage === lastStage) {
    // All actions completed successfully
    await client.zapRun.update({
      where: { id: zapRunId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });
    console.log(`✅ ZapRun ${zapRunId} completed successfully`);
  } else if (!result.success) {
    // Action failed after all retries
    await client.zapRun.update({
      where: { id: zapRunId },
      data: {
        status: 'failed',
        errorMessage: result.error?.message || 'Unknown error',
        completedAt: new Date(),
      },
    });

    // Send failure notification email
    const userEmail = (zapRunDetails?.zap as any)?.user?.email;
    const zapName = zapRunDetails?.zap?.name || 'Untitled Zap';
    const zapId = zapRunDetails?.zap?.id;

    if (userEmail && zapId) {
      console.log(`📧 Sending failure notification to ${userEmail}`);
      await sendZapFailureNotification(
        userEmail,
        zapName,
        zapId,
        result.error?.message || 'Action failed after retries',
        zapRunId
      );
    }
  }

  return {
    success: result.success,
    action: currentAction?.action?.type,
    attempts: result.attempts,
    duration: Date.now() - startTime,
    error: result.error?.message,
  };
}

let isConsumerRunning = false;

async function startConsumer() {
  if (isConsumerRunning) return;
  await initKafka();
  isConsumerRunning = true;
  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }: any) => {
      try {
        await processMessage(message);
        await consumer.commitOffsets([
          {
            topic,
            partition,
            offset: (parseInt(message.offset) + 1).toString(),
          },
        ]);
      } catch (error) {
        console.error('Message processing error:', error);

        // Do not leave the offset uncommitted: KafkaJS would otherwise skip
        // this message on the next successful commit (silent loss) or
        // redeliver it forever after a restart (poison pill). Persist the
        // failure first, then advance.
        let zapRunId: string | undefined;
        try {
          zapRunId = JSON.parse(message.value.toString()).zapRunId;
        } catch {
          // Malformed payload: nothing to update, just advance.
        }
        await markRunFailed(
          zapRunId,
          error instanceof Error ? error.message : 'Unknown processing error'
        );

        await consumer.commitOffsets([
          {
            topic,
            partition,
            offset: (parseInt(message.offset) + 1).toString(),
          },
        ]);
      }
    },
  });
  console.log('✅ Worker Kafka consumer started and running continuously');
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'worker', isConsumerRunning });
});

// Process messages - triggered by cron or manual ping
app.post('/process', async (req: Request, res: Response): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    // Fail closed: an unset secret must reject, not allow
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!isConsumerRunning) {
      await startConsumer();
    }

    return res.json({
      message: 'Worker is actively listening and processing events',
      isRunning: isConsumerRunning,
    });
  } catch (error) {
    console.error('Worker error:', error);
    return res.status(500).json({
      error: 'Processing failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📛 SIGTERM received, shutting down...');
  if (consumer) await consumer.disconnect();
  if (producer) await producer.disconnect();
  process.exit(0);
});

// Do not bind a port (or start Kafka) when the module is imported by tests.
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, async () => {
    console.log(`Worker service running on port ${PORT}`);
    try {
      await startConsumer();
    } catch (err) {
      console.error('Failed to start consumer on boot:', err);
      isConsumerRunning = false;
    }
  });
}
