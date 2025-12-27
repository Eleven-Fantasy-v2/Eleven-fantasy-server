import type { Request, Response } from "express";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const pool = new Pool({
  connectionString:
    process.env.NODE_ENV === "production"
      ? process.env.PROD_DATABASE_URL
      : process.env.DEV_DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class MatchController {
  async getUpcomingMatches(req: Request, res: Response) {
    try {
      const matches = await prisma.match.findMany({
        where: {
          status: "scheduled",
          matchDate: {
            gte: new Date(),
          },
        },
        orderBy: {
          matchDate: "asc",
        },
        take: 10,
      });

      return res.status(200).json({
        success: true,
        length: matches.length,
        data: matches,
      });
    } catch (err) {
      console.error("Get upcoming matches error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  //Get match by matchweek
  async getMatchByMatchWeek(req: Request, res: Response) {
    try {
      const { matchweek } = req.params;

      const matchweekNum = matchweek ? parseInt(matchweek, 10) : undefined;

      const matches = await prisma.match.findMany({
        where: matchweekNum !== undefined ? { matchweek: matchweekNum } : {},
        orderBy: {
          matchDate: "asc",
        },
      });

      return res.status(200).json({
        success: true,
        length: matches.length,
        data: matches,
      });
    } catch (err) {
      console.error("Get matches by status error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Get matches by status
  async getMatchesByStatus(req: Request, res: Response) {
    try {
      const { status } = req.params; // scheduled, live, finished

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      if (page < 1 || limit < 1) {
        return res.status(400).json({
          success: false,
          message: "Page and limit must be positive integers",
        });
      }

      const skip = (page - 1) * limit;

      const matches = await prisma.match.findMany({
        where: status ? { status } : {},
        orderBy: {
          matchDate: status === "finished" ? "desc" : "asc",
        },
        skip,
        take: limit,
      });

      const total = await prisma.match.count({
        where: status ? { status } : {},
      });

      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        success: true,
        length: matches.length,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
        data: matches,
      });
    } catch (error) {
      console.error("Get matches by status error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Get match details with players from ESPN API
  async getMatchById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: "Match ID is required" });
      }

      const match = await prisma.match.findUnique({
        where: { id },
        include: {
          contest: true,
        },
      });

      if (!match) {
        return res.status(404).json({ error: "Match not found" });
      }

      const players = await this.fetchMatchLineups(match.externalId);

      return res.status(200).json({
        success: true,
        match: {
          ...match,
          players,
        },
      });
    } catch (error) {
      console.error("Get match error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  private async fetchMatchLineups(eventId: string) {
    try {
      const response = await axios.get(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary`,
        { params: { event: eventId }, timeout: 15000 }
      );

      const data = response.data;
      const rosters = data.rosters || [];
      console.log("roster", rosters.roster);

      if (rosters.length === 0 || !rosters[0]?.roster) {
        console.log(
          `Lineups not available yet for event ${eventId} (normal before ~60 mins to kickoff)`
        );
        return {
          available: false,
          home: null,
          away: null,
          formation: { home: null, away: null },
        };
      }

      // Determine home/away from header.competitions
      const comp = data.header?.competitions?.[0];
      const homeTeamId = comp?.competitors?.find(
        (c: any) => c.homeAway === "home"
      )?.team?.id;
      const awayTeamId = comp?.competitors?.find(
        (c: any) => c.homeAway === "away"
      )?.team?.id;

      // Find home and away roster objects
      let homeRoster = rosters.find(
        (r: any) => r.team?.id == homeTeamId || r.homeAway === "home"
      );
      let awayRoster = rosters.find(
        (r: any) => r.team?.id == awayTeamId || r.homeAway === "away"
      );

      // Safety fallback
      if (!homeRoster || !awayRoster) {
        [homeRoster, awayRoster] = rosters;
      }

      // Formation
      const homeFormation = homeRoster.formation || null;
      const awayFormation = awayRoster.formation || null;

      const homeLineup = this.parseTeamLineup(homeRoster);
      const awayLineup = this.parseTeamLineup(awayRoster);

      return {
        available: true,
        home: homeLineup,
        away: awayLineup,
        formation: { home: homeFormation, away: awayFormation },
      };
    } catch (error: any) {
      console.error(
        `Error fetching lineups for event ${eventId}:`,
        error.message || error
      );
      return {
        available: false,
        home: null,
        away: null,
        formation: { home: null, away: null },
      };
    }
  }

  // Parse a single team's roster into starters + bench
  private parseTeamLineup(rosterData: any) {
    if (!rosterData || !Array.isArray(rosterData.roster)) {
      return {
        team: "Unknown Team",
        teamId: null,
        starters: [],
        bench: [],
      };
    }

    const teamName =
      rosterData.team?.displayName || rosterData.team?.name || "Unknown Team";
    const teamId = rosterData.team?.id;

    const starters: any[] = [];
    const bench: any[] = [];

    for (const entry of rosterData.roster) {
      const athlete = entry.athlete;

      if (!athlete?.id) continue;

      const player = {
        id: athlete.id,
        name: athlete.displayName || athlete.fullName || "Unknown Player",
        position: this.mapESPNPosition(
          athlete.position?.abbreviation || athlete.position?.name || "MID"
        ),
        formationPlace: entry.formationPlace
          ? parseInt(entry.formationPlace, 10)
          : null,
        jerseyNumber: entry.jersey ? parseInt(entry.jersey, 10) : null,
        photo: athlete.headshot?.href || null,
        starter: entry.starter === true,
        subbedIn: entry.subbedIn === true,
        subbedOut: entry.subbedOut === true,
      };

      if (entry.starter === true) {
        starters.push(player);
      } else {
        bench.push(player);
      }
    }

    return {
      team: teamName,
      teamId,
      starters,
      bench,
    };
  }

  private mapESPNPosition(espnPosition: string): string {
    if (!espnPosition) return "MID";

    const pos = espnPosition.toUpperCase();

    if (pos.includes("GK") || pos === "G") return "GK";
    if (
      pos.includes("DEF") ||
      pos === "D" ||
      pos.includes("CB") ||
      pos.includes("LB") ||
      pos.includes("RB")
    )
      return "DEF";
    if (
      pos.includes("MID") ||
      pos === "M" ||
      pos.includes("CM") ||
      pos.includes("DM") ||
      pos.includes("AM")
    )
      return "MID";
    if (
      pos.includes("FWD") ||
      pos === "F" ||
      pos.includes("ST") ||
      pos.includes("CF") ||
      pos.includes("LW") ||
      pos.includes("RW")
    )
      return "FWD";

    return "MID";
  }
}
