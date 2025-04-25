import config from "@colyseus/tools";
import { Server } from "@colyseus/core";
import { monitor } from "@colyseus/monitor";
import { playground } from "@colyseus/playground";
import path from "path";
import express from "express";
import cors from "cors";

/**
 * Import your Room files
 */
import { Part4Room } from "./rooms/Room";

let gameServerRef: Server;

export default config({
  options: {
    devMode: process.env.NODE_ENV === "development",
  },

  initializeGameServer: (gameServer) => {
    /**
     * Define your room handlers:
     */
    gameServer.define("part4_room", Part4Room);

    //
    // keep gameServer reference
    //
    gameServerRef = gameServer;
  },

  initializeExpress: (app) => {
    // Configure CORS
    if (process.env.NODE_ENV === "production") {
      app.use(
        cors({
          origin: "https://maxgomes92.github.io",
          methods: ["GET", "POST"],
          credentials: true,
        })
      );
    } else {
      app.use(cors());
    }

    /**
     * Bind your custom express routes here:
     */
    app.get("/hello", (req, res) => {
      res.send("It's time to kick ass and chew bubblegum!");
    });

    // Serve static files from public/assets directory
    app.use("/assets", express.static(path.join(__dirname, "./public/assets")));

    if (process.env.NODE_ENV !== "production") {
      app.use("/", playground());
    }

    /**
     * Bind @colyseus/monitor
     * It is recommended to protect this route with a password.
     * Read more: https://docs.colyseus.io/tools/monitor/
     */
    app.use("/colyseus", monitor());
  },

  beforeListen: () => {
    /**
     * Before before gameServer.listen() is called.
     */
  },
});
