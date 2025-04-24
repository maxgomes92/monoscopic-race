export const BACKEND_URL = "ws://0.tcp.eu.ngrok.io:19265"

export const BACKEND_HTTP_URL = BACKEND_URL.replace("ws", process.env.NODE_ENV === "development" ? "http" : "https");