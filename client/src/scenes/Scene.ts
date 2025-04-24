/**
 * - Connecting with the room
 * - Sending inputs at the user's framerate
 * - Update other player's positions WITH interpolation (for other players)
 * - Client-predicted input for local (current) player
 * - Fixed tickrate on both client and server
 */

import Phaser from "phaser";
import { Room, Client, getStateCallbacks } from "colyseus.js";
import { BACKEND_HTTP_URL, BACKEND_URL } from "../backend";

// Import the state type from server-side code
import type { MyRoomState } from "../../../server/src/rooms/Room";

export class Part4Scene extends Phaser.Scene {
  room: Room<MyRoomState>;

  currentPlayer: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  playerEntities: {
    [sessionId: string]: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  } = {};

  // Add lap counting properties
  lapCount: number = 0;
  lastCheckpoint: number = 0;
  checkpoints: { x: number; y: number }[] = [];
  lapText: Phaser.GameObjects.Text;
  isRaceFinished: boolean = false;
  winnerScreen: Phaser.GameObjects.Container;
  playerCount: number = 0; // Track number of players

  // Add player movement properties
  playerVelocity = { x: 0, y: 0 };
  maxSpeed = 5;
  acceleration = 0.3;
  deceleration = 0.1;
  offTrackSpeedMultiplier = 0.7; // Speed reduction when off track

  // Add track layout reference
  trackLayout: number[][] = [];

  localRef: Phaser.GameObjects.Rectangle;
  remoteRef: Phaser.GameObjects.Rectangle;

  cursorKeys: Phaser.Types.Input.Keyboard.CursorKeys;
  wasdKeys: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  inputPayload = {
    left: false,
    right: false,
    up: false,
    down: false,
    tick: undefined,
    velocityX: 0,
    velocityY: 0,
  };

  elapsedTime = 0;
  fixedTimeStep = 1000 / 60;

  currentTick: number = 0;

  constructor() {
    super({ key: "part4" });
  }

  preload() {
    this.load.setBaseURL(BACKEND_HTTP_URL);

    this.load.image("car_red", "assets/PNG/Vehicles/car-red.png");
    this.load.image(
      "bottom_left",
      "assets/PNG/Road_01/Road_01_Tile_01/bottom_left.png"
    );
    this.load.image(
      "top_right",
      "assets/PNG/Road_01/Road_01_Tile_01/top_right.png"
    );
    this.load.image(
      "bottom_right",
      "assets/PNG/Road_01/Road_01_Tile_01/bottom_right.png"
    );
    this.load.image(
      "top_left",
      "assets/PNG/Road_01/Road_01_Tile_01/top_left.png"
    );

    this.load.image(
      "horizontal_1",
      "assets/PNG/Road_01/Road_01_Tile_03/horizontal.png"
    );
    this.load.image(
      "vertical_1",
      "assets/PNG/Road_01/Road_01_Tile_03/vertical.png"
    );
    this.load.image(
      "horizontal_2",
      "assets/PNG/Road_01/Road_01_Tile_04/horizontal.png"
    );
    this.load.image(
      "vertical_2",
      "assets/PNG/Road_01/Road_01_Tile_04/vertical.png"
    );
    this.load.image(
      "t_junction",
      "assets/PNG/Road_01/Road_01_Tile_05/Road_01_Tile_05.png"
    );
    this.load.image(
      "curve_down",
      "assets/PNG/Road_01/Road_01_Tile_06/Road_01_Tile_06.png"
    );
    this.load.image(
      "horizontal_half",
      "assets/PNG/Road_01/Road_01_Tile_07/Road_01_Tile_07.png"
    );
    this.load.image(
      "funil",
      "assets/PNG/Road_01/Road_01_Tile_08/Road_01_Tile_08.png"
    );
  }

  async create() {
    this.cursorKeys = this.input.keyboard.createCursorKeys();
    this.wasdKeys = this.input.keyboard.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
    }) as {
      W: Phaser.Input.Keyboard.Key;
      A: Phaser.Input.Keyboard.Key;
      S: Phaser.Input.Keyboard.Key;
      D: Phaser.Input.Keyboard.Key;
    };

    // Add lap counter text
    this.lapText = this.add.text(16, 16, "Lap: 0/5", {
      fontSize: "32px",
      color: "#ffffff",
      backgroundColor: "#000000",
      padding: { x: 10, y: 5 },
    });
    this.lapText.setScrollFactor(0); // Keep text fixed on screen
    this.lapText.setDepth(9999); // Set depth to render on top of everything

    // Create winner screen (initially hidden)
    this.createWinnerScreen();

    // Enable physics for player collisions
    this.physics.world.setBounds(0, 0, 800, 600);
    this.physics.world.on("worldstep", () => {
      // Handle player collisions after physics update
      this.handlePlayerCollisions();
    });

    // connect with the room
    await this.connect();

    const $ = getStateCallbacks(this.room);

    $(this.room.state).players.onAdd((player, sessionId) => {
      this.playerCount++; // Increment player count

      const entity = this.physics.add.image(0, 1430, "car_red");
      entity.setOrigin(0.5, 0.5); // Set origin to center for proper rotation
      this.playerEntities[sessionId] = entity;

      // is current player
      if (sessionId === this.room.sessionId) {
        this.currentPlayer = entity;

        this.localRef = this.add.rectangle(0, 0, entity.width, entity.height);
        this.localRef.setStrokeStyle(1, 0x00ff00);

        this.remoteRef = this.add.rectangle(0, 0, entity.width, entity.height);
        this.remoteRef.setStrokeStyle(1, 0xff0000);

        // Set up camera to follow the player
        this.cameras.main.startFollow(this.currentPlayer, true);
        this.cameras.main.setZoom(1);
        this.cameras.main.setBackgroundColor("#000000");

        // Update player position from server state
        $(player).onChange(() => {
          this.remoteRef.x = player.x;
          this.remoteRef.y = player.y;

          // Only update position if it's significantly different to avoid jitter
          const dx = player.x - this.currentPlayer.x;
          const dy = player.y - this.currentPlayer.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance > 10) {
            // Threshold for position correction
            this.currentPlayer.x = player.x;
            this.currentPlayer.y = player.y;
            this.playerVelocity.x = player.velocityX || 0;
            this.playerVelocity.y = player.velocityY || 0;
          }
        });
      } else {
        // listening for server updates
        $(player).onChange(() => {
          entity.setData("serverX", player.x);
          entity.setData("serverY", player.y);
        });
      }
    });

    // Update player count when players leave
    $(this.room.state).players.onRemove((player, sessionId) => {
      this.playerCount--; // Decrement player count
      const entity = this.playerEntities[sessionId];
      if (entity) {
        entity.destroy();
        delete this.playerEntities[sessionId];
      }
    });

    // this.cameras.main.startFollow(this.ship, true, 0.2, 0.2);
    // this.cameras.main.setZoom(1);
    this.cameras.main.setBounds(0, 0, 800, 600);

    this.createTrack();
  }

  createTrack() {
    // Create a 2D array to represent the track layout
    this.trackLayout = [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
      [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
      [0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0],
      [0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      [0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      [0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      [0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];

    // Create a simple track layout
    const scale = 0.1 * 2;
    const tileSize = 46 * 2; // Reduced from 64 to 32 for smaller tiles
    const trackWidth = this.trackLayout[0].length;
    const trackHeight = this.trackLayout.length;

    // Create the track tiles
    const tiles = [];

    for (let y = 0; y < trackHeight; y++) {
      for (let x = 0; x < trackWidth; x++) {
        const tileType = this.trackLayout[y][x];
        if (tileType === 1) {
          // Place a road tile based on its position and surrounding tiles
          let tileKey = "funil"; // Default straight road

          // Check surrounding tiles to determine the appropriate road tile
          const hasTop = y > 0 && this.trackLayout[y - 1][x] === 1;
          const hasBottom =
            y < trackHeight - 1 && this.trackLayout[y + 1][x] === 1;
          const hasLeft = x > 0 && this.trackLayout[y][x - 1] === 1;
          const hasRight =
            x < trackWidth - 1 && this.trackLayout[y][x + 1] === 1;

          // Determine the appropriate tile based on connections
          if (hasTop && hasBottom && !hasLeft && !hasRight) {
            tileKey = Math.random() < 0.5 ? "vertical_1" : "vertical_2"; // Vertical straight
          } else if (!hasTop && !hasBottom && hasLeft && hasRight) {
            tileKey = Math.random() < 0.5 ? "horizontal_1" : "horizontal_2"; // Horizontal straight
          } else if (hasTop && hasRight && !hasBottom && !hasLeft) {
            tileKey = "bottom_left";
          } else if (hasTop && hasLeft && !hasBottom && !hasRight) {
            tileKey = "bottom_right";
          } else if (hasBottom && hasRight && !hasTop && !hasLeft) {
            tileKey = "top_left";
          } else if (hasBottom && hasLeft && !hasTop && !hasRight) {
            tileKey = "top_right";
          } else if (hasTop && hasBottom && hasLeft && !hasRight) {
            tileKey = "t_junction"; // T-junction
          } else if (hasTop && hasBottom && hasRight && !hasLeft) {
            tileKey = "t_junction"; // T-junction
          }

          if (
            ["bottom_left", "bottom_right", "top_left", "top_right"].includes(
              tileKey
            )
          ) {
            tiles.push({ x, y, tileKey });
          } else {
            tiles.unshift({ x, y, tileKey });
          }
        }
      }
    }

    for (const { x, y, tileKey } of tiles) {
      const image = this.add.image(x * tileSize, y * tileSize, tileKey);
      image.setOrigin(0, 0);
      image.setScale(scale);
    }

    // Set up camera bounds
    this.cameras.main.setBounds(
      0,
      0,
      trackWidth * tileSize,
      trackHeight * tileSize
    );

    // Define checkpoints for lap counting
    this.checkpoints = [
      { x: 1400, y: 1380 }, // Start/finish line at specific coordinates
    ];

    // Add visual indicator for start/finish line
    const startLine = this.add.rectangle(
      this.checkpoints[0].x,
      this.checkpoints[0].y,
      tileSize * 1.5,
      10,
      0x00ff00
    );
    startLine.setOrigin(0, 0.5);
    startLine.setAlpha(0.5);
    startLine.setRotation(Math.PI / 2);
  }

  async connect() {
    // add connection status text
    const connectionStatusText = this.add
      .text(0, 0, "Trying to connect with the server...")
      .setStyle({ color: "#ff0000" })
      .setPadding(4);

    const client = new Client(BACKEND_URL);

    try {
      this.room = await client.joinOrCreate("part4_room", {});

      // connection successful!
      connectionStatusText.destroy();
    } catch (e) {
      // couldn't connect
      connectionStatusText.text = "Could not connect with the server.";
    }
  }

  update(time: number, delta: number): void {
    // skip loop if not connected yet.
    if (!this.currentPlayer) {
      return;
    }

    this.elapsedTime += delta;
    while (this.elapsedTime >= this.fixedTimeStep) {
      this.elapsedTime -= this.fixedTimeStep;
      this.fixedTick(time, this.fixedTimeStep);
    }
  }

  isOnTrack(x: number, y: number): boolean {
    const tileSize = 46 * 2;
    const trackX = Math.floor(x / tileSize);
    const trackY = Math.floor(y / tileSize);

    // Check if coordinates are within track bounds
    if (
      trackY >= 0 &&
      trackY < this.trackLayout.length &&
      trackX >= 0 &&
      trackX < this.trackLayout[0].length
    ) {
      return this.trackLayout[trackY][trackX] === 1;
    }
    return false;
  }

  handlePlayerCollisions() {
    const players = Object.values(this.playerEntities);

    // Check collisions between all players
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const player1 = players[i];
        const player2 = players[j];

        // Calculate distance between players
        const dx = player2.x - player1.x;
        const dy = player2.y - player1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If players are colliding (distance less than sum of their radii)
        const minDistance = (player1.width + player2.width) / 2;
        if (distance < minDistance) {
          // Calculate push force
          const pushForce = 0.5; // Adjust this value to control push strength
          const pushX = (dx / distance) * pushForce;
          const pushY = (dy / distance) * pushForce;

          // Apply push force to both players
          if (player1 === this.currentPlayer) {
            this.playerVelocity.x -= pushX;
            this.playerVelocity.y -= pushY;
          }
          if (player2 === this.currentPlayer) {
            this.playerVelocity.x += pushX;
            this.playerVelocity.y += pushY;
          }

          // Move players apart to prevent sticking
          const overlap = minDistance - distance;
          const moveX = (dx / distance) * overlap * 0.5;
          const moveY = (dy / distance) * overlap * 0.5;

          player1.x -= moveX;
          player1.y -= moveY;
          player2.x += moveX;
          player2.y += moveY;
        }
      }
    }
  }

  createWinnerScreen() {
    this.winnerScreen = this.add.container(0, 0);

    // Create semi-transparent background
    const bg = this.add.rectangle(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      this.cameras.main.width,
      this.cameras.main.height,
      0x000000,
      0.8
    );

    // Create winner text
    const winnerText = this.add
      .text(
        this.cameras.main.width / 2,
        this.cameras.main.height / 2 - 50,
        "Race Complete!",
        {
          fontSize: "64px",
          color: "#ffffff",
          fontStyle: "bold",
        }
      )
      .setOrigin(0.5);

    // Create lap count text
    const lapCountText = this.add
      .text(
        this.cameras.main.width / 2,
        this.cameras.main.height / 2 + 50,
        "You completed 5 laps!",
        {
          fontSize: "32px",
          color: "#ffffff",
        }
      )
      .setOrigin(0.5);

    // Add all elements to container
    this.winnerScreen.add([bg, winnerText, lapCountText]);

    // Center the container
    this.winnerScreen.setPosition(0, 0);

    // Initially hide the winner screen
    this.winnerScreen.setVisible(false);
  }

  checkLapProgress() {
    if (!this.currentPlayer || this.isRaceFinished) return;

    const playerX = this.currentPlayer.x;
    const playerY = this.currentPlayer.y;
    const checkpointRadius = 50; // Detection radius for checkpoints

    // Check if player is near the next checkpoint
    const nextCheckpoint = this.checkpoints[this.lastCheckpoint];
    const dx = playerX - nextCheckpoint.x;
    const dy = playerY - nextCheckpoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < checkpointRadius) {
      this.lastCheckpoint = (this.lastCheckpoint + 1) % this.checkpoints.length;

      // If we've completed all checkpoints and returned to start/finish
      if (this.lastCheckpoint === 0) {
        this.lapCount++;
        this.lapText.setText(`Lap: ${this.lapCount}/5`);

        // Check if race is finished
        if (this.lapCount >= 5) {
          this.finishRace();
        }
      }
    }
  }

  finishRace() {
    this.isRaceFinished = true;
    this.winnerScreen.setVisible(true);

    // Disable player movement
    this.playerVelocity.x = 0;
    this.playerVelocity.y = 0;

    // Add restart button
    const restartButton = this.add
      .text(
        this.cameras.main.width / 2,
        this.cameras.main.height / 2 + 150,
        "Click to Restart",
        {
          fontSize: "32px",
          color: "#ffffff",
          backgroundColor: "#000000",
          padding: { x: 20, y: 10 },
        }
      )
      .setOrigin(0.5)
      .setInteractive()
      .on("pointerdown", () => {
        this.scene.restart();
      });

    this.winnerScreen.add(restartButton);
  }

  fixedTick(time, delta) {
    this.currentTick++;

    // Skip input processing if race is finished
    if (this.isRaceFinished) return;

    // Add lap progress check
    this.checkLapProgress();

    // Log player coordinates
    // if (this.currentPlayer) {
    //   console.log(`Player Position - X: ${Math.round(this.currentPlayer.x)}, Y: ${Math.round(this.currentPlayer.y)}`);
    // }

    // Check both arrow keys and WASD
    this.inputPayload.left =
      this.cursorKeys.left.isDown || this.wasdKeys.A.isDown;
    this.inputPayload.right =
      this.cursorKeys.right.isDown || this.wasdKeys.D.isDown;
    this.inputPayload.up = this.cursorKeys.up.isDown || this.wasdKeys.W.isDown;
    this.inputPayload.down =
      this.cursorKeys.down.isDown || this.wasdKeys.S.isDown;
    this.inputPayload.tick = this.currentTick;

    // Handle rotation (A/D keys)
    const rotationSpeed = 0.05;
    if (this.inputPayload.left) {
      this.currentPlayer.rotation -= rotationSpeed;
    } else if (this.inputPayload.right) {
      this.currentPlayer.rotation += rotationSpeed;
    }

    // Handle forward/backward movement (W/S keys)
    const moveSpeed = 10;
    if (this.inputPayload.up) {
      // Move forward in the direction the car is facing
      this.playerVelocity.x = Math.cos(this.currentPlayer.rotation) * moveSpeed;
      this.playerVelocity.y = Math.sin(this.currentPlayer.rotation) * moveSpeed;
    } else if (this.inputPayload.down) {
      // Move backward in the direction the car is facing
      this.playerVelocity.x =
        -Math.cos(this.currentPlayer.rotation) * moveSpeed;
      this.playerVelocity.y =
        -Math.sin(this.currentPlayer.rotation) * moveSpeed;
    } else {
      // Apply deceleration when no movement input
      this.playerVelocity.x *= 0.95;
      this.playerVelocity.y *= 0.95;
    }

    // Check if player is on track and apply speed reduction if off track
    const isOnTrack = this.isOnTrack(
      this.currentPlayer.x,
      this.currentPlayer.y
    );
    if (!isOnTrack) {
      this.playerVelocity.x *= this.offTrackSpeedMultiplier;
      this.playerVelocity.y *= this.offTrackSpeedMultiplier;
    }

    // Update input payload with current velocity
    this.inputPayload.velocityX = this.playerVelocity.x;
    this.inputPayload.velocityY = this.playerVelocity.y;

    // Send input to server
    this.room.send(0, this.inputPayload);

    // Apply velocity to player position
    this.currentPlayer.x += this.playerVelocity.x;
    this.currentPlayer.y += this.playerVelocity.y;

    // Update local reference
    this.localRef.x = this.currentPlayer.x;
    this.localRef.y = this.currentPlayer.y;

    // Interpolate other players' positions and rotations
    for (let sessionId in this.playerEntities) {
      if (sessionId === this.room.sessionId) {
        continue;
      }

      const entity = this.playerEntities[sessionId];
      const { serverX, serverY } = entity.data.values;

      if (serverX !== undefined && serverY !== undefined) {
        // Interpolate position
        entity.x = Phaser.Math.Linear(entity.x, serverX, 0.2);
        entity.y = Phaser.Math.Linear(entity.y, serverY, 0.2);

        // Calculate and interpolate rotation based on movement
        const dx = serverX - entity.x;
        const dy = serverY - entity.y;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          const targetAngle = Math.atan2(dy, dx);
          entity.rotation = Phaser.Math.Linear(
            entity.rotation,
            targetAngle,
            0.2
          );
        }
      }
    }
  }
}
