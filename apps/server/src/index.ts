import express, { Express } from "express";
import router from "./routes";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// CORS configuration
const corsOptions = {
    origin: [
        'http://localhost:3000',
        'https://zapier-web-seven.vercel.app',
        /\.vercel\.app$/  // Allow all Vercel preview deployments
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(express.json());
app.use(cors(corsOptions));

// Handling all the routes
app.use("/api", router);

app.get("/", (req, res) => {
    res.send("Server is working!")
})

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}!`)
})

