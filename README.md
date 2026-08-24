# Placeholder Image Builder

Generate 1920 x 1080, 5-second MOV files from two CSV files in the browser.

## Usage

1. Start the app:

   ```sh
   npm start
   ```

2. Open `http://localhost:5173`.
3. Choose File 1 CSV and File 2 CSV.
4. Pick the background, text, and animation colors.
5. Enter an absolute output folder path, such as `/Users/Drew/Desktop/output`.
6. Click **Generate MOVs**.

The app creates one 5-second MOV for every File 1 row combined with every File 2 row where File 2 column 3 is not empty.
