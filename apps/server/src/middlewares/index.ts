require('dotenv').config()
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization as string | undefined;

    // Handle both "Bearer <token>" and plain "<token>" formats
    const token = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7)
        : authHeader;

    if (!token) {
        res.status(403).json({
            message: "You are not logged in"
        });
        return;
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET as string);
        // @ts-ignore
        req.id = payload.id;
        next();
    } catch (e) {
        res.status(403).json({
            message: "You are not logged in"
        })
        return;
    }
}
