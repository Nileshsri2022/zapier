import kafka from "@repo/kafka";
import client from "@repo/db";
const TOPIC_NAME = "zap-events";
import dotenv from "dotenv";
import { sendEmailWithTextBody } from "@repo/email";
dotenv.config()

const validateEmail = (email: string) => {
    const regex = /^\S+@\S+\.\S+$/
    return regex.test(email);
};

function replaceKeys(template: string, replacements: Record<string, string>): string {
    return template.replace(/{(.*?)}/g, (_, key) => {
        return replacements[key] || `{${key}}`; // Keep the placeholder if no replacement found
    });
}

async function main() {
    // Creating consumer and subscribing to the zap-events topic created by transaction processor service
    const consumer = kafka.consumer({ groupId: "worker" });
    await consumer.connect();

    const producer = kafka.producer();
    await producer.connect();

    await consumer.subscribe({ topic: TOPIC_NAME, fromBeginning: false});

    await consumer.run({
        // AutoCommit fetches the message from kafka and marks directly it to be processed, which we don't want
        // Only mark zap processed if the entire zap actions have been performed, or else do not remove it from kafka
        autoCommit: false,
        eachMessage: async ({topic, partition, message}) => {
            if(!message?.value?.toString())
                return;

            const { zapRunId, stage } = JSON.parse(message?.value?.toString());

            const zapRunDetails = await client.zapRun.findFirst({
                where: {
                    id: zapRunId
                },
                include: {
                    zap: {
                        include: {
                            actions: {
                                include: {
                                    action: true
                                }
                            }
                        }
                    }
                }
            });

            const lastStage = zapRunDetails?.zap?.actions?.length || 1;
            const currentAction = zapRunDetails?.zap?.actions?.find(a => a.sortingOrder === stage)

            if(!currentAction) {
                console.log("Current Action not found")
                return;
            }

            // Send Email Logic
            if(currentAction?.action?.type === "Email") {
                console.log("Sending Email")
                // @ts-ignore
                const { to, subject, body } = currentAction?.metadata;
                let emailReceiver;

                if(validateEmail(to)) {
                    emailReceiver = to;
                } else {
                    const searchKey = JSON.stringify(zapRunDetails?.metadata);
                    emailReceiver = searchKey.slice(searchKey.indexOf("email")+8, searchKey.indexOf(".com")+4);
                }

                // @ts-ignore
                let emailBody = replaceKeys(body, zapRunDetails?.metadata);
                sendEmailWithTextBody(emailReceiver, subject, emailBody);
            }

            // Send Solana Logic
            if(currentAction?.action?.type === "Solana") {
                // @ts-ignore
                const { address, amount } = currentAction?.metadata;
                // @ts-ignore
                console.log(`Send sol to ${replaceKeys(address, zapRunDetails?.metadata)} of amount :  ${replaceKeys(amount, zapRunDetails?.metadata)}`)
            }

            if(stage !== lastStage) {
                console.log("Pushing back to the kafka");
                producer.send({
                    topic: TOPIC_NAME,
                    messages: [{
                        value: JSON.stringify({zapRunId: zapRunId, stage: stage+1})
                    }]
                })
            }

            console.log("Action execution successfull");
            await consumer.commitOffsets([{
                topic: topic,
                partition: partition,
                offset: (parseInt(message.offset) + 1).toString()
            }])
        }
    })
}

main();