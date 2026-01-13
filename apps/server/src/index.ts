import express, { Express } from "express";
import router from "./routes";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

// Handling all the routes
app.use("/api", router);

app.get("/", (req, res) => {
    res.send("Server is working!")
})

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}!`)
})

