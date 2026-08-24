const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");

const HOST = "127.0.0.1";
const PORT = 5173;
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION_SECONDS = 5;
const FRAME_COUNT = FPS * DURATION_SECONDS;
const PIE_CENTER_X = WIDTH / 2;
const PIE_CENTER_Y = 850;
const PIE_RADIUS = 100;
const FONT_SIZE = 96;
const FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": MIME_TYPES[".json"] });
  response.end(JSON.stringify(payload));
}

function isRow(value) {
  return Array.isArray(value) && value.every((cell) => typeof cell === "string");
}

function parseColor(value, label) {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${label} must be a hex color.`);
  }

  return {
    ffmpeg: `0x${value.slice(1)}`,
    rgb: [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
    ],
  };
}

function requiredCell(row, index, label) {
  const cell = row[index];
  if (typeof cell !== "string") {
    throw new Error(`${label} is missing.`);
  }
  return cell.trim();
}

function validateRows(rows, minimumColumns, label) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${label} has no rows.`);
  }

  rows.forEach((row, rowIndex) => {
    if (!isRow(row) || row.length < minimumColumns) {
      throw new Error(`${label} row ${rowIndex + 1} needs at least ${minimumColumns} columns.`);
    }
  });
}

function sanitizeFileName(value) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function makeImageText(fileOneRow, fileTwoRow) {
  return [
    `${requiredCell(fileOneRow, 0, "File 1 column 1")}-${requiredCell(fileOneRow, 1, "File 1 column 2")}`,
    requiredCell(fileTwoRow, 0, "File 2 column 1"),
    `${requiredCell(fileTwoRow, 1, "File 2 column 2")}-${requiredCell(fileTwoRow, 2, "File 2 column 3")}`,
  ];
}

function makeOutputName(fileOneRow, fileTwoRow) {
  const rawName = [
    `${requiredCell(fileOneRow, 0, "File 1 column 1")}-${requiredCell(fileTwoRow, 1, "File 2 column 2")}`,
    requiredCell(fileOneRow, 1, "File 1 column 2"),
    requiredCell(fileTwoRow, 0, "File 2 column 1"),
    requiredCell(fileTwoRow, 2, "File 2 column 3"),
  ].join(" ");

  return `${sanitizeFileName(rawName) || "placeholder"}.mov`;
}

function makeUniqueFileName(fileName, usedFileNames) {
  const match = fileName.match(/^(.*?)(\.mov)$/i);
  const baseName = match ? match[1] : fileName;
  const extension = match ? match[2] : ".mov";
  let candidate = fileName;
  let duplicateIndex = 2;

  while (usedFileNames.has(candidate.toLowerCase())) {
    candidate = `${baseName} (${duplicateIndex})${extension}`;
    duplicateIndex += 1;
  }

  usedFileNames.add(candidate.toLowerCase());
  return candidate;
}

function getOutputItems(fileOneRows, fileTwoRows) {
  const usedFileNames = new Set();
  const items = [];

  fileOneRows.forEach((fileOneRow) => {
    fileTwoRows.forEach((fileTwoRow) => {
      if (requiredCell(fileTwoRow, 2, "File 2 column 3").length === 0) {
        return;
      }

      items.push({
        lines: makeImageText(fileOneRow, fileTwoRow),
        fileName: makeUniqueFileName(makeOutputName(fileOneRow, fileTwoRow), usedFileNames),
      });
    });
  });

  return items;
}

function blendChannel(foreground, background, alpha) {
  return Math.round(foreground * alpha + background * (1 - alpha));
}

function makeBaseFrame(backgroundRgb, animationRgb) {
  const frame = Buffer.allocUnsafe(WIDTH * HEIGHT * 3);

  for (let index = 0; index < frame.length; index += 3) {
    frame[index] = backgroundRgb[0];
    frame[index + 1] = backgroundRgb[1];
    frame[index + 2] = backgroundRgb[2];
  }

  const ringInner = PIE_RADIUS - 5;
  const ringOuter = PIE_RADIUS + 5;
  const ringColor = animationRgb.map((channel, index) =>
    blendChannel(channel, backgroundRgb[index], 0.28),
  );

  for (let y = PIE_CENTER_Y - ringOuter; y <= PIE_CENTER_Y + ringOuter; y += 1) {
    for (let x = PIE_CENTER_X - ringOuter; x <= PIE_CENTER_X + ringOuter; x += 1) {
      const distance = Math.hypot(x - PIE_CENTER_X, y - PIE_CENTER_Y);
      if (distance >= ringInner && distance <= ringOuter) {
        const offset = (y * WIDTH + x) * 3;
        frame[offset] = ringColor[0];
        frame[offset + 1] = ringColor[1];
        frame[offset + 2] = ringColor[2];
      }
    }
  }

  return frame;
}

function drawPieFrame(frame, progress, animationRgb) {
  const angleLimit = Math.PI * 2 * progress;

  for (let y = PIE_CENTER_Y - PIE_RADIUS; y <= PIE_CENTER_Y + PIE_RADIUS; y += 1) {
    for (let x = PIE_CENTER_X - PIE_RADIUS; x <= PIE_CENTER_X + PIE_RADIUS; x += 1) {
      const dx = x - PIE_CENTER_X;
      const dy = y - PIE_CENTER_Y;
      if (dx * dx + dy * dy > PIE_RADIUS * PIE_RADIUS) {
        continue;
      }

      let angle = Math.atan2(dx, -dy);
      if (angle < 0) {
        angle += Math.PI * 2;
      }

      if (angle <= angleLimit) {
        const offset = (y * WIDTH + x) * 3;
        frame[offset] = animationRgb[0];
        frame[offset + 1] = animationRgb[1];
        frame[offset + 2] = animationRgb[2];
      }
    }
  }
}

function escapeFilterPath(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "'\\\\\\''").replace(/:/g, "\\:");
}

async function writeTextFiles(lines) {
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "placeholder-builder-"));
  const files = [];

  for (const [index, line] of lines.entries()) {
    const filePath = path.join(temporaryDirectory, `line-${index}.txt`);
    await fsp.writeFile(filePath, line, "utf8");
    files.push(filePath);
  }

  return { temporaryDirectory, files };
}

function makeDrawTextFilter(textFiles, textColor) {
  const lineHeight = 124;
  const startY = HEIGHT / 2 - ((textFiles.length - 1) * lineHeight) / 2;

  return textFiles
    .map((file, index) => {
      const y = startY + index * lineHeight;
      const options = [
        `fontfile='${escapeFilterPath(FONT_PATH)}'`,
        `textfile='${escapeFilterPath(file)}'`,
        `fontcolor=${textColor.ffmpeg}`,
        `fontsize=${FONT_SIZE}`,
        "x=(w-text_w)/2",
        `y=${y}-(text_h/2)`,
      ];

      return `drawtext=${options.join(":")}`;
    })
    .join(",");
}

function waitForDrain(stream) {
  return new Promise((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function writeFrames(stream, baseFrame, animationRgb) {
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    if (stream.destroyed) {
      return;
    }

    const frame = Buffer.from(baseFrame);
    drawPieFrame(frame, frameIndex / FRAME_COUNT, animationRgb);

    try {
      if (!stream.write(frame)) {
        await waitForDrain(stream);
      }
    } catch (error) {
      if (error.code === "EPIPE") {
        return;
      }
      throw error;
    }
  }

  stream.end();
}

async function runFfmpeg(outputPath, lines, colors) {
  const { temporaryDirectory, files } = await writeTextFiles(lines);
  const filter = makeDrawTextFilter(files, colors.text);
  const baseFrame = makeBaseFrame(colors.background.rgb, colors.animation.rgb);

  try {
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s:v",
        `${WIDTH}x${HEIGHT}`,
        "-r",
        String(FPS),
        "-i",
        "pipe:0",
        "-t",
        String(DURATION_SECONDS),
        "-vf",
        filter,
        "-an",
        "-c:v",
        "prores_ks",
        "-profile:v",
        "3",
        "-pix_fmt",
        "yuv422p10le",
        outputPath,
      ]);
      let errorOutput = "";

      ffmpeg.stderr.on("data", (chunk) => {
        errorOutput += chunk.toString();
      });
      ffmpeg.stdin.on("error", (error) => {
        if (error.code !== "EPIPE") {
          reject(error);
        }
      });
      ffmpeg.on("error", reject);
      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(errorOutput || `ffmpeg exited with code ${code}.`));
        }
      });

      writeFrames(ffmpeg.stdin, baseFrame, colors.animation.rgb).catch((error) => {
        ffmpeg.stdin.destroy(error);
        reject(error);
      });
    });
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function parseJsonRequest(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleGenerate(request, response) {
  try {
    const body = await parseJsonRequest(request);
    validateRows(body.fileOneRows, 2, "File 1");
    validateRows(body.fileTwoRows, 3, "File 2");

    const outputFolder = typeof body.outputFolder === "string" ? body.outputFolder.trim() : "";
    if (outputFolder.length === 0 || !path.isAbsolute(outputFolder)) {
      throw new Error("Output folder must be an absolute path.");
    }

    await fsp.mkdir(outputFolder, { recursive: true });
    const outputStats = await fsp.stat(outputFolder);
    if (!outputStats.isDirectory()) {
      throw new Error("Output folder path is not a folder.");
    }

    const colors = {
      background: parseColor(body.backgroundColor, "Background color"),
      text: parseColor(body.textColor, "Text color"),
      animation: parseColor(body.animationColor, "Animation color"),
    };
    const items = getOutputItems(body.fileOneRows, body.fileTwoRows);

    if (items.length === 0) {
      throw new Error("No files to generate because File 2 column 3 is empty in every row.");
    }

    for (const item of items) {
      await runFfmpeg(path.join(outputFolder, item.fileName), item.lines, colors);
    }

    sendJson(response, 200, {
      ok: true,
      generated: items.length,
      outputFolder,
    });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error.message,
    });
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(__dirname, pathname);

  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fsp.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/generate") {
    handleGenerate(request, response);
    return;
  }

  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`Placeholder Image Builder running at http://${HOST}:${PORT}`);
});
