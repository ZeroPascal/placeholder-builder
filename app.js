const IMAGE_WIDTH = 1920;
const IMAGE_HEIGHT = 1080;

const fileOneInput = document.querySelector("#fileOneInput");
const fileTwoInput = document.querySelector("#fileTwoInput");
const backgroundColorInput = document.querySelector("#backgroundColorInput");
const textColorInput = document.querySelector("#textColorInput");
const generateButton = document.querySelector("#generateButton");
const previewCanvas = document.querySelector("#previewCanvas");
const statusText = document.querySelector("#statusText");
const progressBar = document.querySelector("#progressBar");

let fileOneRows = [];
let fileTwoRows = [];

function setStatus(message) {
  statusText.textContent = message;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value.trim());
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(value.trim());
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value.trim());
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function requiredCell(row, index, label) {
  const cell = row[index];
  if (cell === undefined) {
    throw new Error(`${label} is missing.`);
  }
  return cell.trim();
}

function validateRows(rows, minimumColumns, fileLabel) {
  if (rows.length === 0) {
    throw new Error(`${fileLabel} has no rows.`);
  }

  rows.forEach((row, rowIndex) => {
    if (row.length < minimumColumns) {
      throw new Error(
        `${fileLabel} row ${rowIndex + 1} needs at least ${minimumColumns} columns.`,
      );
    }
  });
}

async function readCsvFile(file, fileLabel, minimumColumns) {
  if (!file) {
    return [];
  }

  const text = await file.text();
  const rows = parseCsv(text);
  validateRows(rows, minimumColumns, fileLabel);
  return rows;
}

function updateGenerateState() {
  generateButton.disabled = fileOneRows.length === 0 || fileTwoRows.length === 0;
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

  return `${sanitizeFileName(rawName) || "placeholder"}.png`;
}

function makeUniqueFileName(fileName, usedFileNames) {
  const match = fileName.match(/^(.*?)(\.png)$/i);
  const baseName = match ? match[1] : fileName;
  const extension = match ? match[2] : ".png";
  let candidate = fileName;
  let duplicateIndex = 2;

  while (usedFileNames.has(candidate.toLowerCase())) {
    candidate = `${baseName} (${duplicateIndex})${extension}`;
    duplicateIndex += 1;
  }

  usedFileNames.add(candidate.toLowerCase());
  return candidate;
}

function drawImage(canvas, lines, backgroundColor, textColor) {
  const context = canvas.getContext("2d");
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  context.fillStyle = textColor;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "700 96px Arial, Helvetica, sans-serif";

  const lineHeight = 124;
  const startY = IMAGE_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    context.fillText(line, IMAGE_WIDTH / 2, startY + index * lineHeight, IMAGE_WIDTH - 160);
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not create PNG image."));
      }
    }, "image/png");
  });
}

async function createPngBlob(canvas) {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }

  return canvasToBlob(canvas);
}

function createWorkingCanvas() {
  if ("OffscreenCanvas" in window) {
    return new OffscreenCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  }

  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  return canvas;
}

function getOutputRows() {
  const rows = [];

  fileOneRows.forEach((fileOneRow) => {
    fileTwoRows.forEach((fileTwoRow) => {
      const fileTwoColumnThree = requiredCell(fileTwoRow, 2, "File 2 column 3");
      if (fileTwoColumnThree.length > 0) {
        rows.push({ fileOneRow, fileTwoRow });
      }
    });
  });

  return rows;
}

function renderPreview() {
  const fileOneRow = fileOneRows[0] || ["File1Col1", "File1Col2"];
  const fileTwoRow = fileTwoRows.find((row) => (row[2] || "").trim().length > 0) || [
    "File2Col1",
    "File2Col2",
    "File2Col3",
  ];

  drawImage(
    previewCanvas,
    makeImageText(fileOneRow, fileTwoRow),
    backgroundColorInput.value,
    textColorInput.value,
  );
}

async function handleFileChange() {
  try {
    fileOneRows = await readCsvFile(fileOneInput.files[0], "File 1", 2);
    fileTwoRows = await readCsvFile(fileTwoInput.files[0], "File 2", 3);

    updateGenerateState();
    renderPreview();

    if (fileOneRows.length > 0 && fileTwoRows.length > 0) {
      const outputCount = getOutputRows().length;
      setStatus(`${fileOneRows.length} File 1 rows and ${fileTwoRows.length} File 2 rows loaded. ${outputCount} PNGs ready.`);
    }
  } catch (error) {
    generateButton.disabled = true;
    setStatus(error.message);
  }
}

async function writePng(directoryHandle, fileName, blob) {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function generateImages() {
  if (!window.showDirectoryPicker) {
    setStatus("This browser does not support choosing an output folder. Use current Chrome, Edge, or another Chromium browser.");
    return;
  }

  try {
    const outputRows = getOutputRows();
    if (outputRows.length === 0) {
      setStatus("No files to generate because File 2 column 3 is empty in every row.");
      return;
    }

    const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const workingCanvas = createWorkingCanvas();

    progressBar.hidden = false;
    progressBar.value = 0;
    progressBar.max = outputRows.length;
    generateButton.disabled = true;
    const usedFileNames = new Set();

    for (const [index, outputRow] of outputRows.entries()) {
      const lines = makeImageText(outputRow.fileOneRow, outputRow.fileTwoRow);
      const fileName = makeUniqueFileName(
        makeOutputName(outputRow.fileOneRow, outputRow.fileTwoRow),
        usedFileNames,
      );

      drawImage(workingCanvas, lines, backgroundColorInput.value, textColorInput.value);
      const blob = await createPngBlob(workingCanvas);
      await writePng(directoryHandle, fileName, blob);

      progressBar.value = index + 1;
      setStatus(`Generated ${index + 1} of ${outputRows.length}: ${fileName}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    setStatus(`Done. Generated ${outputRows.length} PNG files.`);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Output folder selection was canceled.");
    } else {
      setStatus(error.message);
    }
  } finally {
    progressBar.hidden = true;
    updateGenerateState();
  }
}

fileOneInput.addEventListener("change", handleFileChange);
fileTwoInput.addEventListener("change", handleFileChange);
backgroundColorInput.addEventListener("input", renderPreview);
textColorInput.addEventListener("input", renderPreview);
generateButton.addEventListener("click", generateImages);

renderPreview();
