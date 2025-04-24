import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

export interface InputData {
  left: false;
  right: false;
  up: false;
  down: false;
  tick: number;
  velocityX: number;
  velocityY: number;
}

export class Player extends Schema {
  @type("number") x: number;
  @type("number") y: number;
  @type("number") tick: number;
  @type("number") velocityX: number = 0;
  @type("number") velocityY: number = 0;
  inputQueue: InputData[] = [];
}

export class MyRoomState extends Schema {
  @type("number") mapWidth: number;
  @type("number") mapHeight: number;
  @type({ map: Player }) players = new MapSchema<Player>();
}

export class Part4Room extends Room<MyRoomState> {
  state = new MyRoomState();
  fixedTimeStep = 1000 / 60;

  onCreate(options: any) {
    // set map dimensions
    this.state.mapWidth = 800;
    this.state.mapHeight = 600;

    this.onMessage(0, (client, input) => {
      // handle player input
      const player = this.state.players.get(client.sessionId);

      // enqueue input to user input buffer.
      player.inputQueue.push(input);
    });

    let elapsedTime = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;

      while (elapsedTime >= this.fixedTimeStep) {
        elapsedTime -= this.fixedTimeStep;
        this.fixedTick(this.fixedTimeStep);
      }
    });
  }

  fixedTick(timeStep: number) {
    this.state.players.forEach((player) => {
      let input: InputData;

      // dequeue player inputs
      while ((input = player.inputQueue.shift())) {
        // Update velocity based on input
        player.velocityX = input.velocityX;
        player.velocityY = input.velocityY;

        // Update position based on velocity
        player.x += player.velocityX;
        player.y += player.velocityY;

        player.tick = input.tick;
      }
    });
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");

    const startingPosition = this.getStartingPosition();
    const player = new Player();
    player.x = startingPosition.x;
    player.y = startingPosition.y;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  getStartingPosition(): { x: number; y: number } {
    // Base position at finish line
    const baseX = 1300;
    const baseY = 1430;

    // Calculate offset based on player count
    const offset = this.state.players.size * 150; // 50 pixels between each player

    // Return position with offset
    return {
      x: baseX - offset,
      y: baseY,
    };
  }
}
