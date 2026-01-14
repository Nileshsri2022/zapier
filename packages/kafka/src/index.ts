import { Kafka, logLevel } from "kafkajs";
import dotenv from "dotenv";

dotenv.config();

// Get Kafka configuration from environment variables
const KAFKA_BROKER = process.env.KAFKA_BROKER || "localhost:9092";
const KAFKA_USERNAME = process.env.KAFKA_USERNAME;
const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD;

// Check if we're using cloud Kafka (Aiven) with SASL authentication
const isCloudKafka = KAFKA_USERNAME && KAFKA_PASSWORD;

// SASL configuration for cloud Kafka (Aiven)
const saslConfig = isCloudKafka
    ? {
        mechanism: "scram-sha-256" as const,
        username: KAFKA_USERNAME!,
        password: KAFKA_PASSWORD!,
    }
    : undefined;

const kafka = new Kafka({
    clientId: "zapier",
    brokers: [KAFKA_BROKER],
    // SSL and SASL only for cloud Kafka
    ssl: isCloudKafka ? true : false,
    sasl: saslConfig,
    // Log level based on environment
    logLevel: process.env.NODE_ENV === "production" ? logLevel.ERROR : logLevel.INFO,
});

console.log(`🔗 Kafka configured for: ${isCloudKafka ? "Cloud (Aiven)" : "Local"} - Broker: ${KAFKA_BROKER}`);

export default kafka;