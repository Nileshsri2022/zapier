import type { ZodError } from "zod";

export const formatZodError = (error: ZodError) => {
    return error?.issues?.reduce((acc, issue) => {
        const key = issue.path[0] as string;
        const value = issue.message;

        return {...acc, [key]: value}
    }, {})
}