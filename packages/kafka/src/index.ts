import { Kafka, logLevel, SASLOptions } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

// Get Kafka configuration from environment variables
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const KAFKA_USERNAME = process.env.KAFKA_USERNAME;
const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD;
const KAFKA_SSL_CA = process.env.KAFKA_SSL_CA; // Optional: CA certificate for SSL

// Check if we're using cloud Kafka with SASL authentication
const isCloudKafka = KAFKA_USERNAME && KAFKA_PASSWORD;

// SASL configuration for cloud Kafka (Aiven/Upstash/Confluent)
// Aiven uses SCRAM-SHA-512, Upstash uses SCRAM-SHA-256
const KAFKA_SASL_MECHANISM = (process.env.KAFKA_SASL_MECHANISM || 'scram-sha-512') as
  | 'scram-sha-512'
  | 'scram-sha-256';

// Build SASL config with proper type narrowing for discriminated union
const buildSaslConfig = (): SASLOptions | undefined => {
  if (!isCloudKafka) return undefined;

  // Type narrowing: each branch returns a correctly typed object
  if (KAFKA_SASL_MECHANISM === 'scram-sha-512') {
    return {
      mechanism: 'scram-sha-512',
      username: KAFKA_USERNAME!,
      password: KAFKA_PASSWORD!,
    };
  } else {
    return {
      mechanism: 'scram-sha-256',
      username: KAFKA_USERNAME!,
      password: KAFKA_PASSWORD!,
    };
  }
};

const saslConfig = buildSaslConfig();

// SSL configuration
// For cloud Kafka providers, SSL is required
// WARNING: rejectUnauthorized: false is insecure - add KAFKA_SSL_CA for production
const sslConfig = isCloudKafka
  ? {
      // If CA cert provided, verify it; otherwise allow insecure for testing
      rejectUnauthorized: KAFKA_SSL_CA ? true : false,
      // If CA certificate is provided, use it
      ...(KAFKA_SSL_CA && { ca: [KAFKA_SSL_CA] }),
    }
  : false;

const kafka = new Kafka({
  clientId: 'zapmate',
  brokers: [KAFKA_BROKER],
  ssl: sslConfig,
  sasl: saslConfig,
  // Connection settings for reliability
  connectionTimeout: 10000, // 10 seconds
  requestTimeout: 30000, // 30 seconds
  retry: {
    initialRetryTime: 100,
    retries: 8,
    maxRetryTime: 30000,
    restartOnFailure: async () => true,
  },
  // Log level based on environment
  logLevel: process.env.NODE_ENV === 'production' ? logLevel.ERROR : logLevel.INFO,
});

console.log(
  `🔗 Kafka configured for: ${isCloudKafka ? 'Cloud (SSL+SASL)' : 'Local'} - Broker: ${KAFKA_BROKER}`
);
console.log(
  `   SASL: ${KAFKA_SASL_MECHANISM}, User: ${KAFKA_USERNAME ? KAFKA_USERNAME.substring(0, 3) + '***' : 'NOT SET'}`
);
console.log(`   SSL CA: ${KAFKA_SSL_CA ? 'PROVIDED' : 'NOT SET (rejectUnauthorized=false)'}`);

// Export producer and consumer factories for convenience
export const createProducer = () => kafka.producer();
export const createConsumer = (groupId: string) => kafka.consumer({ groupId });

// Export topic names as constants
export const TOPICS = {
  ZAP_EVENTS: 'zap-events',
} as const;

export default kafka;
