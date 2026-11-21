
const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const gameFile = "naruto_shinobi_ultimeite_organizado.html";

const rooms = new Map();
const clients = new Map();

function makeCode() {
  let code;
  do {
    code = String(100000 + crypto.randomInt(900000));
  } while (rooms.has(code));
  return code;
}

function send(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(room, from, payload) {
  for (const client of room.players) {
    if (client !== from) send(client, payload);
  }
}

function removeClient(ws) {
  const info = clients.get(ws);
  if (!info) return;

  const room = rooms.get(info.code);

  if (room) {
    room.players.delete(ws);
    broadcast(room, ws, { type: "opponent_disconnected" });

    if (room.players.size === 0) {
      rooms.delete(info.code);
    }
  }

  clients.delete(ws);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/health") {
    res.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*"
    });

    return res.end(JSON.stringify({
      ok: true,
      service: "Naruto Shinobi Ultimate multiplayer relay",
      rooms: rooms.size
    }));
  }

  let requestedPath = decodeURIComponent(url.pathname);

  if (requestedPath === "/" || requestedPath === "/index.html") {
    requestedPath = "/" + gameFile;
  }

  const filePath = path.resolve(publicDir, "." + requestedPath);

  if (!filePath.startsWith(publicDir + path.sep)) {
    res.writeHead(403);
    return res.end("Acesso negado.");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, {
        "content-type": "text/plain; charset=utf-8"
      });
      return res.end("Arquivo não encontrado.");
    }

    const contentType =
      mimeTypes[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream";

    res.writeHead(200, {
      "content-type": contentType
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, {
        type: "error",
        message: "Mensagem inválida."
      });
    }

    if (msg.type === "create_room") {
      if (clients.has(ws)) {
        return send(ws, {
          type: "error",
          message: "Você já está em uma sala."
        });
      }

      const code = makeCode();
      const room = {
        code,
        players: new Set([ws]),
        createdAt: Date.now()
      };

      rooms.set(code, room);
      clients.set(ws, { code, role: "host" });

      return send(ws, {
        type: "room_created",
        code,
        role: "host"
      });
    }

    if (msg.type === "join_room") {
      const code = String(msg.code || "")
        .replace(/\D/g, "")
        .slice(0, 6);

      const room = rooms.get(code);

      if (!room) {
        return send(ws, {
          type: "error",
          message: "Sala não encontrada. Confira o código."
        });
      }

      if (room.players.size >= 2) {
        return send(ws, {
          type: "error",
          message: "Essa sala já está cheia."
        });
      }

      if (clients.has(ws)) {
        return send(ws, {
          type: "error",
          message: "Você já está em uma sala."
        });
      }

      room.players.add(ws);
      clients.set(ws, { code, role: "guest" });

      send(ws, {
        type: "room_joined",
        code,
        role: "guest"
      });

      broadcast(room, ws, {
        type: "opponent_joined"
      });

      return;
    }

    const info = clients.get(ws);

    if (!info) {
      return send(ws, {
        type: "error",
        message: "Entre em uma sala primeiro."
      });
    }

    const room = rooms.get(info.code);

    if (!room) {
      return send(ws, {
        type: "error",
        message: "A sala foi encerrada."
      });
    }

    if (["game_event", "ready", "leave_room", "ping"].includes(msg.type)) {
      if (msg.type === "leave_room") {
        removeClient(ws);
        return send(ws, { type: "room_left" });
      }

      broadcast(room, ws, {
        type: msg.type,
        from: info.role,
        payload: msg.payload ?? null
      });
    }
  });

  ws.on("close", () => removeClient(ws));
  ws.on("error", () => removeClient(ws));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NSU multiplayer server listening on ${PORT}`);
});
