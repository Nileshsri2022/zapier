import express, { Request, Response } from 'express';
import kafka from '@repo/kafka';
import client from '@repo/db';
import dotenv from 'dotenv';
import { sendEmailWithTextBody, sendZapFailureNotification } from '@repo/email';
import { withRetry, RetryResult } from './utils/retry';
import { sendSol } from './sendSolana';
import { evaluateFilters, FilterCondition } from './evaluateFilters';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;
const TOPIC_NAME = 'zap-events';

let consumer: any = null;
let producer: any = null;

const validateEmail = (email: string) => {
  const regex = /^\S+@\S+\.\S+$/;
  return regex.test(email);
};

function replaceKeys(template: string, replacements: Record<string, any>): string {
  return template.replace(/{(.*?)}/g, (_, key) => {
    // Support nested keys like {previousOutput.amount} or {data.user.email}
    const keys = key.split('.');
    let value: any = replacements;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return `{${key}}`; // Key not found, return placeholder
      }
    }

    return value !== undefined && value !== null ? String(value) : `{${key}}`;
  });
}

// Initialize Kafka
async function initKafka() {
  if (!consumer) {
    consumer = kafka.consumer({ groupId: 'worker' });
    await consumer.connect();
    await consumer.subscribe({ topic: TOPIC_NAME, fromBeginning: false });
    console.log('Kafka consumer connected');
  }
  if (!producer) {
    producer = kafka.producer();
    await producer.connect();
    console.log('Kafka producer connected');
  }
}

// Execute action with retry - returns output data for chaining
async function executeActionWithRetry(
  actionType: string,
  metadata: any,
  zapRunMetadata: any,
  previousOutputs?: Record<number, any> // Outputs from previous steps
): Promise<RetryResult<{ success: boolean; message: string; output?: any }>> {
  return withRetry(
    async () => {
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
        console.log('  - Processed body (first 100 chars):', emailBody?.substring(0, 100));

        const result = await sendEmailWithTextBody(emailReceiver, subject, emailBody);
        console.log('📧 [Worker] Email send result:', JSON.stringify(result));

        // @ts-ignore - Handle both success and error response types
        if (result && result.error) {
          // @ts-ignore
          throw new Error(`Email send failed: ${result.error}`);
        }

        return {
          success: true,
          message: `Email sent to ${emailReceiver}`,
          output: { to: emailReceiver, subject, sentAt: new Date().toISOString() },
        };
      }

      if (actionType === 'Solana') {
        const { address, amount } = metadata;
        const resolvedAddress = replaceKeys(address, zapRunMetadata);
        const resolvedAmount = replaceKeys(amount, zapRunMetadata);

        // Check if SOL_PRIVATE_KEY is configured
        if (!process.env.SOL_PRIVATE_KEY) {
          console.warn('⚠️ SOL_PRIVATE_KEY not configured - skipping Solana transfer');
          return { success: false, message: 'SOL_PRIVATE_KEY not configured' };
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

      if (actionType === 'WhatsApp') {
        const { to, message, phoneNumberId, accessToken } = metadata;
        const resolvedTo = replaceKeys(to, zapRunMetadata);
        const resolvedMessage = replaceKeys(message, zapRunMetadata);

        // Dynamic imports for sendWhatsApp
        const { sendWhatsAppMessage } = await import('./sendWhatsApp');

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

      if (actionType === 'Telegram') {
        const { chatId, message, botToken } = metadata;
        const resolvedChatId = replaceKeys(chatId, zapRunMetadata);
        const resolvedMessage = replaceKeys(message, zapRunMetadata);

        // Dynamic imports for sendTelegram
        const { sendTelegramMessage } = await import('./sendTelegram');

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

      if (actionType === 'Webhook') {
        const { url, method = 'POST', headers = {}, body } = metadata;
        const resolvedUrl = replaceKeys(url, zapRunMetadata);
        const resolvedBody = body ? replaceKeys(JSON.stringify(body), zapRunMetadata) : null;

        // Dynamic import for sendWebhook
        const { sendWebhook } = await import('./sendWebhook');

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
          output: { url: resolvedUrl, statusCode: result.statusCode, response: result.data },
        };
      }

      return { success: true, message: `Unknown action: ${actionType}`, output: {} };
    },
    { maxRetries: 3, initialDelayMs: 1000 }
  );
}

// Process a single Kafka message
async function processMessage(message: any) {
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

  // Update status to running
  await client.zapRun.update({
    where: { id: zapRunId },
    data: { status: 'running' },
  });

  const lastStage = zapRunDetails?.zap?.actions?.length || 1;
  const currentAction = zapRunDetails?.zap?.actions?.find((a: any) => a.sortingOrder === stage);

  // Evaluate filters on first stage only
  if (stage === 1) {
    const filterConditions =
      ((zapRunDetails?.zap as any)?.filterConditions as FilterCondition[]) || [];
    const triggerData = zapRunDetails?.metadata || {};

    if (!evaluateFilters(filterConditions, triggerData)) {
      console.log(`🚫 Filters blocked ZapRun ${zapRunId} - skipping all actions`);
      return {
        success: true,
        reason: 'filtered',
        duration: Date.now() - startTime,
        message: 'Zap run skipped due to filter conditions',
      };
    }
  }

  if (!currentAction) {
    console.log('Current Action not found');
    return { success: false, reason: 'action_not_found', duration: Date.now() - startTime };
  }

  // Get previous step outputs from metadata (for chaining)
  const zapMetadata = (zapRunDetails?.metadata || {}) as Record<string, any>;
  const stepOutputs: Record<number, any> = zapMetadata.stepOutputs || {};
  const previousOutput = stepOutputs[stage - 1] || {};

  // Evaluate step conditions (skip action if conditions not met)
  const stepConditions = (currentAction as any).stepConditions || [];
  if (stepConditions.length > 0) {
    const conditionContext = { ...zapMetadata, previousOutput, stepOutputs };

    if (!evaluateFilters(stepConditions as FilterCondition[], conditionContext)) {
      console.log(
        `⏭️ Skipping action ${stage} (${currentAction.action.type}) - step conditions not met`
      );

      // Queue next stage even though this one was skipped
      if (stage !== lastStage) {
        await producer.send({
          topic: TOPIC_NAME,
          messages: [{ value: JSON.stringify({ zapRunId, stage: stage + 1 }) }],
        });
      }

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
    stepOutputs
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

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'worker' });
});

// Process messages - triggered by cron
app.post('/process', async (req: Request, res: Response): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    // Verify cron secret if configured
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await initKafka();

    let processedCount = 0;
    const maxMessages = 20; // Process up to 20 messages per cron trigger
    const results: any[] = [];

    // Run consumer for a batch
    await consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }: any) => {
        if (processedCount >= maxMessages) return;

        try {
          const result = await processMessage(message);
          results.push(result);
          processedCount++;

          await consumer.commitOffsets([
            {
              topic,
              partition,
              offset: (parseInt(message.offset) + 1).toString(),
            },
          ]);
        } catch (error) {
          console.error('Message processing error:', error);
          results.push({ success: false, error: String(error) });
        }
      },
    });

    // Wait a bit to allow message processing
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Pause consumer after batch
    await consumer.pause([{ topic: TOPIC_NAME }]);

    return res.json({
      message: 'Processing complete',
      processed: processedCount,
      results,
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

app.listen(PORT, () => {
  console.log(`Worker service running on port ${PORT}`);
});
