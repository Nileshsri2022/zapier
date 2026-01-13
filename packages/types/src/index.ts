import { z } from "zod";

// Auth Schemas
const SignupSchema = z.object({
    name: z.string().min(3, { message: "Name must have three characters" }),
    email: z.string().email({ message: "Enter a valid email" }),
    password: z.string().min(8, { message: "Password must have 8 characters" })
})

type TSignup = z.infer<typeof SignupSchema>;

const SigninSchema = z.object({
    email: z.string().email({ message: "Enter a valid email" }),
    password: z.string().min(8)
})

type TSignin = z.infer<typeof SigninSchema>;

// ZapSchemas
const CreateZapSchema = z.object({
    availableTriggerId: z.string(),
    triggerMetaData: z.any().optional(),
    actions: z.object({
        availableActionId: z.string(),
        actionMetaData: z.any().optional()
    }).array()
})

type TCreateZap = z.infer<typeof CreateZapSchema>

const SelectedTriggerSchema = z.object({
    availableTriggerId: z.string(),
    triggerType: z.string(),
    triggerMetaData: z.any().optional(),
})

type TSelectedTrigger = z.infer<typeof SelectedTriggerSchema>

const SelectedActionSchema = z.object({  
    availableActionId: z.string(),
    actionType: z.string(),
    actionMetaData: z.any().optional()

});

type TSelectedAction = z.infer<typeof SelectedActionSchema>

export {
    SignupSchema,
    SigninSchema,

    CreateZapSchema,
}

export type {
    TSignup,
    TSignin,
    TCreateZap,
    TSelectedTrigger,
    TSelectedAction
}
