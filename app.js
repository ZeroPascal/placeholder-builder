const IMAGE_WIDTH = 1920;
const IMAGE_HEIGHT = 1080;

const fileOneInput = document.querySelector("#fileOneInput");
const fileTwoInput = document.querySelector("#fileTwoInput");
const backgroundColorInput = document.querySelector("#backgroundColorInput");
const textColorInput = document.querySelector("#textColorInput");
const animationColorInput = document.querySelector("#animationColorInput");
const outputFolderInput = document.querySelector("#outputFolderInput");
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
  generateButton.disabled =
    fileOneRows.length === 0 ||
    fileTwoRows.length === 0 ||
    outputFolderInput.value.trim().length === 0;
}

function makeImageText(fileOneRow, fileTwoRow) {
  return [
    `${requiredCell(fileOneRow, 0, "File 1 column 1")}-${requiredCell(fileOneRow, 1, "File 1 column 2")}`,
    requiredCell(fileTwoRow, 0, "File 2 column 1"),
    `${requiredCell(fileTwoRow, 1, "File 2 column 2")}-${requiredCell(fileTwoRow, 2, "File 2 column 3")}`,
  ];
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

function drawPie(context, centerX, centerY, radius, progress, color) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 10;
  context.globalAlpha = 0.28;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.stroke();

  context.globalAlpha = 1;
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(centerX, centerY);
  context.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  context.closePath();
  context.fill();
  context.restore();
}

function drawPreview(progress) {
  const context = previewCanvas.getContext("2d");
  const fileOneRow = fileOneRows[0] || ["File1Col1", "File1Col2"];
  const fileTwoRow = fileTwoRows.find((row) => (row[2] || "").trim().length > 0) || [
    "File2Col1",
    "File2Col2",
    "File2Col3",
  ];
  const lines = makeImageText(fileOneRow, fileTwoRow);

  context.fillStyle = backgroundColorInput.value;
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  context.fillStyle = textColorInput.value;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "700 96px Arial, Helvetica, sans-serif";

  const lineHeight = 124;
  const startY = IMAGE_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    context.fillText(line, IMAGE_WIDTH / 2, startY + index * lineHeight, IMAGE_WIDTH - 160);
  });

  drawPie(context, IMAGE_WIDTH / 2, 850, 100, progress, animationColorInput.value);
}

function renderPreview() {
  drawPreview((performance.now() % 5000) / 5000);
  requestAnimationFrame(renderPreview);
}

async function handleFileChange() {
  try {
    fileOneRows = await readCsvFile(fileOneInput.files[0], "File 1", 2);
    fileTwoRows = await readCsvFile(fileTwoInput.files[0], "File 2", 3);

    updateGenerateState();

    if (fileOneRows.length > 0 && fileTwoRows.length > 0) {
      const outputCount = getOutputRows().length;
      setStatus(`${fileOneRows.length} File 1 rows and ${fileTwoRows.length} File 2 rows loaded. ${outputCount} MOVs ready.`);
    }
  } catch (error) {
    generateButton.disabled = true;
    setStatus(error.message);
  }
}

async function generateVideos() {
  try {
    if (window.location.protocol === "file:") {
      throw new Error("Open http://127.0.0.1:5173 to generate MOV files.");
    }

    const outputRows = getOutputRows();
    if (outputRows.length === 0) {
      setStatus("No files to generate because File 2 column 3 is empty in every row.");
      return;
    }

    progressBar.hidden = false;
    progressBar.value = 0;
    progressBar.max = outputRows.length;
    generateButton.disabled = true;
    setStatus("Starting MOV generation...");

    const response = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileOneRows,
        fileTwoRows,
        backgroundColor: backgroundColorInput.value,
        textColor: textColorInput.value,
        animationColor: animationColorInput.value,
        outputFolder: outputFolderInput.value.trim(),
      }),
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "MOV generation failed.");
    }

    progressBar.value = outputRows.length;
    setStatus(`Done. Generated ${result.generated} MOV files in ${result.outputFolder}.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    progressBar.hidden = true;
    updateGenerateState();
  }
}

fileOneInput.addEventListener("change", handleFileChange);
fileTwoInput.addEventListener("change", handleFileChange);
backgroundColorInput.addEventListener("input", updateGenerateState);
textColorInput.addEventListener("input", updateGenerateState);
animationColorInput.addEventListener("input", updateGenerateState);
outputFolderInput.addEventListener("input", updateGenerateState);
generateButton.addEventListener("click", generateVideos);

renderPreview();

if (window.location.protocol === "file:") {
  setStatus("Open http://127.0.0.1:5173 to generate MOV files.");
}
