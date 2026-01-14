import { CreateZapSchema } from "@repo/types";
import { Request, Response } from "express"
import { formatZodError } from "../helper";
import client from "@repo/db";
import { executeAction } from "./ActionsController";

export const createZap = async (req: Request, res: Response): Promise<any> => {
    try {
        const body = req.body;
        const validation = CreateZapSchema.safeParse(body);
        // @ts-ignore
        const id: string = req.id;

        if (validation.error) {
            return res.status(411).json({
                message: "Incorrect inputs",
                error: formatZodError(validation.error)
            })
        }

        const zapId = await client.$transaction(async tx => {
            const zap = await tx.zap.create({
                data: {
                    userId: parseInt(id),
                    triggerId: "",
                    actions: {
                        create: validation?.data?.actions.map((x, index) => ({
                            actionId: x.availableActionId as string,
                            metadata: x.actionMetaData,
                            sortingOrder: index + 1,
                        }))
                    }
                }
            });

            const trigger = await tx.trigger.create({
                data: {
                    triggerId: validation?.data?.availableTriggerId,
                    zapId: zap.id,
                }
            });

            await tx.zap.update({
                where: {
                    id: zap.id
                },
                data: {
                    triggerId: trigger.id
                }
            });

            return zap.id;
        })

        return res.status(201).json({
            message: "Zap created successfully",
            zapId

        });
    } catch (error) {
        console.log(error)
        res.status(400).json({
            message: "Failed to create a zap!",
            error: error
        })
    }
}

export const fetchZapList = async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const id = req.id;
        const zaps = await client.zap.findMany({
            where: {
                userId: id,
            },
            include: {
                actions: {
                    include: {
                        action: true
                    }
                },
                trigger: {
                    include: {
                        trigger: true
                    }
                },
            }
        })

        return res.status(200).json({
            message: "Zaps fetched successsfully",
            data: {
                zaps,
                total: zaps.length
            }
        })
    } catch (error: any) {
        res.status(500).json({
            message: "Could not fetch the zaps!",
            error: error?.response
        })
    }
}

export const fetchZapWithId = async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const id = req.id;
        const zap = await client.zap.findUnique({
            where: {
                userId: id,
                id: req.params.zapId as string
            },
            include: {
                actions: {
                    include: {
                        action: true
                    }
                },
                trigger: {
                    include: {
                        trigger: true
                    }
                }
            }
        });

        return res.status(200).json({
            message: "Zap fetched successfully",
            zap
        })
    } catch (error: any) {
        res.status(500).json({
            message: "Could not fetch the zap",
            error: error
        })
    }
}

export const processWebhookTrigger = async (zapId: string, payload: any) => {
    try {
        const zap = await client.zap.findUnique({
            where: { id: zapId, isActive: true },
            include: {
                actions: {
                    include: { action: true },
                    orderBy: { sortingOrder: 'asc' }
                }
            }
        });

        if (!zap) {
            console.log(`Zap ${zapId} not found or inactive`);
            return;
        }

        console.log(`Processing webhook for zap ${zapId} with ${zap.actions.length} actions`);

        // Execute each action in order
        for (const zapAction of zap.actions) {
            try {
                await executeAction(zapAction.action.type, zapAction.metadata, payload);
                console.log(`Executed action ${zapAction.action.type} successfully`);
            } catch (error) {
                console.error(`Failed to execute action ${zapAction.action.type}:`, error);
            }
        }

        // Log the webhook execution
        await client.zapRun.create({
            data: {
                zapId: zap.id,
                metadata: payload
            }
        });

        console.log(`Webhook processed successfully for zap ${zapId}`);
    } catch (error) {
        console.error(`Error processing webhook for zap ${zapId}:`, error);
        throw error;
    }
};

export const processGmailTrigger = async (zapId: string, emailData: any) => {
    try {
        const zap = await client.zap.findUnique({
            where: { id: zapId, isActive: true },
            include: {
                actions: {
                    include: { action: true },
                    orderBy: { sortingOrder: 'asc' }
                }
            }
        });

        if (!zap) {
            console.log(`Zap ${zapId} not found or inactive`);
            return;
        }

        console.log(`Processing Gmail trigger for zap ${zapId} with ${zap.actions.length} actions`);

        // Execute each action in order
        for (const zapAction of zap.actions) {
            try {
                await executeAction(zapAction.action.type, zapAction.metadata, emailData);
                console.log(`Executed action ${zapAction.action.type} successfully`);
            } catch (error) {
                console.error(`Failed to execute action ${zapAction.action.type}:`, error);
            }
        }

        // Log the Gmail trigger execution
        await client.zapRun.create({
            data: {
                zapId: zap.id,
                metadata: emailData
            }
        });

        console.log(`Gmail trigger processed successfully for zap ${zapId}`);
    } catch (error) {
        console.error(`Error processing Gmail trigger for zap ${zapId}:`, error);
        throw error;
    }
};

export const deleteZapWithId = async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const id = req.id;
        const zapId = req.params.zapId as string;

        const zap = await client.$transaction(async tx => {
            // First delete ZapRunOutbox records (they reference ZapRun)
            const zapRuns = await tx.zapRun.findMany({
                where: { zapId },
                select: { id: true }
            });

            if (zapRuns.length > 0) {
                await tx.zapRunOutbox.deleteMany({
                    where: {
                        zapRunId: { in: zapRuns.map(r => r.id) }
                    }
                });
            }

            // Delete ZapRun records
            await tx.zapRun.deleteMany({
                where: { zapId }
            });

            // Delete Gmail-related records if they exist
            await tx.gmailTrigger.deleteMany({
                where: { zapId }
            });

            await tx.gmailAction.deleteMany({
                where: { zapId }
            });

            // Delete trigger
            await tx.trigger.delete({
                where: { zapId }
            });

            // Delete actions
            await tx.action.deleteMany({
                where: { zapId }
            });

            // Finally delete the zap
            return await tx.zap.delete({
                where: {
                    id: zapId,
                    userId: id
                }
            });
        });

        return res.status(202).json({
            message: "Zap deleted successfully",
            deletedZap: zap
        });
    } catch (error: any) {
        console.error("Delete zap error:", error);
        res.status(401).json({
            message: "Could not delete the zap, Please try again",
            error: error.message
        });
    }
}

export const renameZapWithId = async (req: Request, res: Response): Promise<any> => {
    // @ts-ignore
    const id = req.id;
    const { name } = req.body;

    try {
        const zap = await client.zap.update({
            where: {
                userId: id,
                id: req.params.zapId as string
            },
            data: {
                name: name
            }
        })

        res.status(200).json({
            message: "Zap renamed successfully!",
            zap: zap
        })
    } catch (error) {
        console.log(error);
        res.status(500).json({
            message: "Could not rename the zap!",
            error: error
        })
    }
}

export const enableZapExecution = async (req: Request, res: Response): Promise<any> => {
    // @ts-ignore
    const id = req.id;
    const { isActive } = req.body;

    try {
        const zap = await client.zap.update({
            where: {
                userId: id,
                id: req.params.zapId as string
            },
            data: {
                isActive: isActive
            }
        })

        res.status(200).json({
            message: "Zap renamed successfully!",
            zap: zap
        })
    } catch (error) {
        console.log(error);
        res.status(500).json({
            message: "Could not rename the zap!",
            error: error
        })
    }
}

export const updateZapWithId = async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const id = req.id;
        const { actions } = req.body;

        const zap = await client.$transaction(async tx => {

            if (actions.length) {
                await tx.action.deleteMany({
                    where: {
                        zapId: req.params.zapId as string
                    }
                })

                await tx.zap.update({
                    where: {
                        userId: id,
                        id: req.params.zapId as string
                    },
                    data: {
                        actions: {
                            create: actions.map((x: any, index: number) => ({
                                actionId: x.availableActionId as string,
                                metadata: x.actionMetaData,
                                sortingOrder: index + 1,
                            }))
                        }
                    }
                })
            }
        })

        return res.status(201).json({
            message: "Zap updated successfully",
            zap
        })
    } catch (error: any) {
        res.status(401).json({
            message: "Could not update the zap, please try again",
            error: error.response
        })
    }
}
