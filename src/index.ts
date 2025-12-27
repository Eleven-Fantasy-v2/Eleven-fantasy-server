import express from "express";
import type { Application, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { matchSyncService } from "./services/matchSync.service.js";
import matchRoutes from "./routes/match.routes.js";

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "OK",
    message: "Eleven Fantasy Backend is running",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/matches", matchRoutes);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err: Error, req: Request, res: Response) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);

  matchSyncService.setupCronJobs();
  console.log("⏰ Cron jobs initialized for automatic match updates");
});

export default app;
