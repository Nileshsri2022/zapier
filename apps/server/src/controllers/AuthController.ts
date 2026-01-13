import { Request, Response } from "express";
import { SigninSchema, SignupSchema } from "@repo/types";
import { formatZodError } from "../helper";
import client from "@repo/db";
import { sendEmail } from "@repo/email";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

export const signup = async (req: Request, res: Response): Promise<any> => {
    const body = req.body;

    const validation = SignupSchema.safeParse(body);
    if(validation.error) {
        return res.status(422).json({
            message: "Invalid credentials",
            error: formatZodError(validation.error)
        })
    }
    
    const user = await client.user.findUnique({
        where: {
            email: validation?.data?.email
        }
    })

    if(user) {
        return res.status(404).json({
            message: "Invalid request",
            error: {
                email: "User with this email already exists"
            }
        })
    }

    const pwHash = bcrypt.hashSync(validation?.data?.password, 10);

    const newUser = await client.user.create({
        data: {
            name: validation?.data?.name,
            email: validation?.data?.email,
            password: pwHash
        }
    })

    if(!newUser) {
        return res.status(500).json({
            message: "Something went wrong!",
            error: {
                message: "Internal server error, please try again later"
            }
        })
    }
    
    const emailSubject = "Welcome to ZapMate! Let’s Get Automating!";
    await sendEmail(validation?.data?.email, emailSubject, "signup-confirmation.html");

    return res.status(201).json({
        message: "Signup successful",
        data: {
            user: newUser
        }
    })
}

export const signin = async (req: Request, res: Response): Promise<any> => {
    const body = req.body;
    const validation = SigninSchema.safeParse(body);

    if(validation.error) {
        return res.status(422).json({
            message: "Invalid credentials",
            error: formatZodError(validation.error)
        })
    }

    const user = await client.user.findUnique({
        where: {
            email: validation?.data?.email
        }
    })
    
    if(!user) {
        return res.status(422).json({
            message: "User does not exist",
            error: "User does not exist"
        })
    }

    if(user && !bcrypt.compareSync(validation?.data?.password, user?.password)) {
        return res.status(422).json({
            message: "Invalid credentials",
            error: {}
        })
    }

    const token = jwt.sign({
        id: user?.id
    }, process.env.JWT_SECRET as string);

    return res.status(200).json({
        message: "Signin successful",
        data: {
            id: user?.id,
            name: user?.name,
            email: user?.email,
            token,
        }
    })
}

export const getUserDetails = async (req: Request, res: Response): Promise<any> => {
    const { userId } = req.params;
    const user = await client.user.findFirst({
        where: {
            id: parseInt(userId as string)
        }
    })

    if(!user) {
        res.status(403).json({
            message: "User not found!"
        })
    }

    return res.status(200).json({
        message: "User fetched successfully",
        data: {
            user
        }
    })
}
