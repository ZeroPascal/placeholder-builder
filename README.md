# Placeholder Image Builder

Generate 1920 x 1080 PNG images from two CSV files in the browser.

## Usage

1. Start the app:

   ```sh
   npm start
   ```

2. Open `http://localhost:5173`.
3. Choose File 1 CSV and File 2 CSV.
4. Pick the background and text colors.
5. Click **Generate PNGs** and choose an output folder.

The app creates one image for every File 1 row combined with every File 2 row where File 2 column 3 is not empty.
