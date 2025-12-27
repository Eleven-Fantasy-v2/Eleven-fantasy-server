import axios from "axios";
import cron from "node-cron";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  connectionString:
    process.env.NODE_ENV === "production"
      ? process.env.PROD_DATABASE_URL
      : process.env.DEV_DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ESPN_BASE_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1";

export class MatchSyncService {
  private calendarDates: string[] = [];

  constructor() {}

  // Fetch calendar + season info
  private async fetchCalendar() {
    console.log("Fetching ESPN Premier League calendar...");

    const response = await axios.get(`${ESPN_BASE_URL}/scoreboard`);
    const league = response.data.leagues[0];

    this.calendarDates = league.calendar.map(
      (dateStr: string) => dateStr.split("T")[0]
    );

    console.log(`Calendar loaded: ${this.calendarDates.length} match dates`);
    return this.calendarDates;
  }

  //Full season sync using calendar dates
  async fullSync() {
    console.log("[Full Sync] Starting ESPN season sync...");

    try {
      if (this.calendarDates.length === 0) {
        await this.fetchCalendar();
      }

      const allEvents: any[] = [];

      // Fetch ONE date at a time
      for (let i = 0; i < this.calendarDates.length; i++) {
        const date = this.calendarDates[i];
        if (!date) continue;

        const dateStr = date.replace(/-/g, "");
        // const dateStr = this.calendarDates[i]?.replace(/-/g, "") ? "";

        console.log(
          `Fetching date ${i + 1}/${this.calendarDates.length}: ${dateStr}`
        );

        try {
          const response = await axios.get(`${ESPN_BASE_URL}/scoreboard`, {
            params: { dates: dateStr },
            timeout: 15000,
          });

          const events = response.data.events || [];
          allEvents.push(...events);

          await new Promise((r) => setTimeout(r, 150));
        } catch (err: any) {
          console.error(
            `Failed on date ${dateStr}:`,
            err.response?.status || err.message
          );
        }
      }

      console.log(`Fetched ${allEvents.length} total matches across season`);

      // Group into matchweeks
      const matchweekGroups = this.groupEventsIntoMatchweeks(allEvents);

      // Process each computed matchweek
      let weekNumber = 1;
      for (const weekEvents of matchweekGroups) {
        const weekDates = weekEvents.map((e: any) => new Date(e.date));
        const startDate = new Date(
          Math.min(...weekDates.map((d) => d.getTime()))
        );
        const endDate = new Date(
          Math.max(...weekDates.map((d) => d.getTime()))
        );

        console.log("weeknum", weekNumber);

        const contest = await prisma.contest.upsert({
          where: { matchweek: weekNumber },
          update: {
            startDate,
            endDate,
            status:
              new Date() < startDate
                ? "upcoming"
                : new Date() > endDate
                ? "completed"
                : "active",
          },
          create: {
            name: `Match Week ${weekNumber}`,
            matchweek: weekNumber,
            startDate,
            endDate,
            status:
              new Date() < startDate
                ? "upcoming"
                : new Date() > endDate
                ? "completed"
                : "active",
            season: "2025/2026",
            league: "Premier League",
            entryFee: 0,
            maxParticipant: 1000,
          },
        });

        // Upsert matches
        for (const event of weekEvents) {
          const comp = event.competitions[0];
          const home = comp.competitors.find((c: any) => c.homeAway === "home");
          const away = comp.competitors.find((c: any) => c.homeAway === "away");
          const statusDesc = comp.status.type.description;
          const shortDesc = comp.status.type.shortDetail;
          const status = this.mapEspnStatus(statusDesc, shortDesc);

          await prisma.match.upsert({
            where: { externalId: event.id },
            update: {
              status,
              homeScore: parseInt(home?.score || "0"),
              awayScore: parseInt(away?.score || "0"),
              matchDate: new Date(event.date),
              matchweek: weekNumber,
            },
            create: {
              externalId: event.id,
              matchweek: weekNumber,
              contestId: contest.id,
              homeTeam: home.team.displayName,
              awayTeam: away.team.displayName,
              homeTeamId: home.team.id,
              awayTeamId: away.team.id,
              homeTeamLogo: home.team.logo,
              awayTeamLogo: away.team.logo,
              matchDate: new Date(event.date),
              venue: comp.venue?.fullName || null,
              status,
              homeScore: parseInt(home?.score || "0"),
              awayScore: parseInt(away?.score || "0"),
            },
          });
        }

        console.log(
          `Saved Match Week ${weekNumber} (${weekEvents.length} matches)`
        );
        weekNumber++;
      }

      console.log("[Full Sync] Completed successfully");
    } catch (error: any) {
      console.error("[Full Sync] Error:", error.message || error);
    }
  }

  private groupEventsIntoMatchweeks(events: any[]): any[][] {
    const groups: any[][] = [];

    // Sort by date
    const sorted = [...events].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const MATCHES_PER_WEEK = 10;

    // Simply slice every 10 matches
    for (let i = 0; i < sorted.length; i += MATCHES_PER_WEEK) {
      const weekMatches = sorted.slice(i, i + MATCHES_PER_WEEK);
      groups.push(weekMatches);
    }

    if (groups.length !== 38) {
      console.warn(
        `Warning: Expected 38 matchweeks, got ${groups.length}. Check data.`
      );
    }

    console.log(
      `Created ${groups.length} matchweeks from ${sorted.length} matches`
    );

    return groups;
  }

  private mapEspnStatus(description: string, shortDetail?: string): string {
    const desc = (description || shortDetail || "").toLowerCase();

    if (desc.includes("full time") || desc.includes("ft")) return "finished";
    if (
      desc.includes("in progress") ||
      desc.includes("live") ||
      desc.includes("second") ||
      desc.includes("half")
    )
      return "live";
    if (desc.includes("postponed")) return "postponed";
    if (desc.includes("cancelled")) return "cancelled";
    if (desc.includes("scheduled")) return "scheduled";

    return "scheduled";
  }

  // JOB 2: Live sync — update recent matches (scores + status)
  async liveSync() {
    console.log("[Live Sync] Updating today's and recent matches...");

    try {
      const today = new Date();
      const dates: string[] = [];

      // Last 2 days + today + next 1 day
      for (let i = -2; i <= 1; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const iso = d.toISOString();
        const datePart = iso.split("T")[0];
        if (!datePart) continue;

        dates.push(datePart.replace(/-/g, ""));
      }

      // Sort and create range: earliest-latest
      dates.sort();
      const dateRange = `${dates[0]}-${dates[dates.length - 1]}`;

      console.log(`Fetching live/recent matches for range: ${dateRange}`);

      const response = await axios.get(`${ESPN_BASE_URL}/scoreboard`, {
        params: { dates: dateRange },
        timeout: 15000,
      });

      const events = response.data.events || [];

      if (events.length === 0) {
        console.log("No matches found in recent range.");
        return;
      }

      for (const event of events) {
        const comp = event.competitions[0];
        const home = comp.competitors.find((c: any) => c.homeAway === "home");
        const away = comp.competitors.find((c: any) => c.homeAway === "away");
        const statusDesc = comp.status.type.description || "";
        const shortDesc = comp.status.type.shortDetail || "";
        const status = this.mapEspnStatus(statusDesc, shortDesc);

        // Update only status and scores (matchDate shouldn't change)
        await prisma.match.update({
          where: { externalId: event.id },
          data: {
            status,
            homeScore: parseInt(home?.score || "0", 10),
            awayScore: parseInt(away?.score || "0", 10),
          },
        });

        if (status === "finished") {
          console.log(
            `Match finished: ${home.team.displayName} ${home.score || 0} - ${
              away.score || 0
            } ${away.team.displayName}`
          );
          // TODO: Trigger scoring calculation
        }
      }

      console.log(`[Live Sync] Updated ${events.length} matches`);
    } catch (error: any) {
      console.error(
        "[Live Sync] Error:",
        error.response?.status || error.message
      );
    }
  }

  // cron jobs
  setupCronJobs() {
    // Full sync: once daily at 2 AM
    cron.schedule("0 2 * * *", () => {
      this.fullSync();
    });

    // Live sync: every 5 minutes
    cron.schedule("*/5 * * * *", () => {
      this.liveSync();
    });

    // Run full sync on startup
    this.fullSync();
  }
}

export const matchSyncService = new MatchSyncService();
