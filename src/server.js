import 'dotenv/config';
import express from "express";
import cors from "cors";
import authRouter from "./routes/auth.js";
import notificationsRouter from "./routes/notifications.js";


const app = express();

const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:3000",
  "http://localhost:8081",
  "http://localhost:19006",  // Expo web
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());
app.use("/api/auth", authRouter);
app.get("/api/health", (_, res) => res.json({ ok: true, time: new Date() }));
app.use("/api/notifications", notificationsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Server running → http://localhost:${PORT}`));