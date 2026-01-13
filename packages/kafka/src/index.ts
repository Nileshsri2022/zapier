import { Kafka } from "kafkajs";

const kafka = new Kafka({
    clientId: "zapier",
    brokers: ["localhost:9092"]
})

export default kafka;