import { Router } from "express";
import { MatchController } from "../controllers/match.controller.js";

const router = Router();
const matchController = new MatchController();

router.get("/upcoming", (req, res) =>
  matchController.getUpcomingMatches(req, res)
);
router.get("/matchweek/:matchweek", (req, res) =>
  matchController.getMatchByMatchWeek(req, res)
);
router.get("/status/:status", (req, res) =>
  matchController.getMatchesByStatus(req, res)
);
router.get("/:id", (req, res) => matchController.getMatchById(req, res));

export default router;
