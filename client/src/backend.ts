export const BACKEND_URL = process.env.NODE_ENV === "development" ? "ws://localhost:2567" : "https://monoscopic-race-148203050277.europe-north2.run.app";

export const BACKEND_HTTP_URL = BACKEND_URL.replace("ws", process.env.NODE_ENV === "development" ? "http" : "https");