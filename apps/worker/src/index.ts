import express, { Request, Response } from 'express';
import kafka from '@repo/kafka';
import client from '@repo/db';
import dotenv from 'dotenv';
import { sendZapFailureNotification } from '@repo/email';
import { evaluateFilters, FilterCondition } from './evaluateFilters';
import { executeActionWithRetry } from './actionRegistry';
import { prepareRunMetadata } from './utils/runMetadata';
import { advanceSkippedStage } from './utils/skipStage';
import { readAiPolicy } from '@repo/ai';
import { validateAiConnectionEnvironment } from '@repo/ai-connections';

dotenv.config();

// Optional AI credentials stay optional; malformed configured policy must fail startup.
readAiPolicy();
validateAiConnectionEnvironment();

const app = express();
const PORT = process.env.PORT || 3002;
const TOPIC_NAME = 'zap-events';

let consumer: any = null;
let producer: any = null;

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

// Execution lives in actionRegistry.ts. Imported (for this file's run loop) and
// re-exported (so tests and callers keep one import site).
export { executeActionWithRetry } from './actionRegistry';
export type { ActionOutput } from './actionRegistry';

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
