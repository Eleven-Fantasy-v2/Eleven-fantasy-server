import { Router } from "express";
import { MatchController } from "../controllers/match.controller.js";

const router = Router();
const matchController = new MatchController();

router.get("/upcoming", matchController.getUpcomingMatches);
router.get("/matchweek/:matchweek", matchController.getMatchByMatchWeek);
router.get("/status/:status", matchController.getMatchesByStatus);
router.get("/:id", (req, res) => matchController.getMatchById(req, res));

export default router;
