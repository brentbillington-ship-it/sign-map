# Chaka Signs Map — Setup Instructions

## Step 1: Create the Google Sheet

1. Go to sheets.google.com → New spreadsheet
2. Name it: **Chaka Signs Data**
3. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/` **← THIS PART →** `/edit`
4. Keep this tab open

## Step 2: Deploy the Apps Script

1. In your Google Sheet: **Extensions → Apps Script**
2. Delete all existing code in the editor
3. Paste the contents of `apps_script.js`
4. Paste your Sheet ID into the `SHEET_ID = ''` line (between the quotes)
5. Click **Save** (floppy disk icon)
6. Click **Deploy → New deployment**
7. Click the gear ⚙ next to "Select type" → choose **Web app**
8. Set:
   - Description: `Chaka Signs v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
9. Click **Deploy** → copy the Web App URL (looks like `https://script.google.com/macros/s/AKfy.../exec`)

## Step 3: Wire up index.html

1. Open `index.html` in a text editor
2. Find this line near the top of the `<script>` section:
   ```
   const APPS_SCRIPT_URL = ''; // Fill in after deploying Apps Script
   ```
3. Paste your Web App URL between the quotes:
   ```
   const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfy.../exec';
   ```
4. Save the file

## Step 4: Deploy to GitHub Pages

1. Create a new GitHub repo (e.g. `chaka-map`)
2. Upload `index.html` to the repo root
3. Go to **Settings → Pages → Source: Deploy from branch → main / root**
4. Your map will be live at: `https://YOUR-USERNAME.github.io/chaka-map/`

## Step 5: Share

- Send the GitHub Pages URL to Kevin and others
- They can **view** without a password
- **Admin editing** (place points, edit, delete) requires the password: `choochoo`
- To change the password: edit `const ADMIN_PASSWORD = 'choochoo';` in index.html

---

## Apps Script Update Reminder

Every time you change `apps_script.js`:
**Save → Deploy → Manage deployments → pencil icon → New version → Deploy**
(Same URL, no changes needed in index.html)

---

## Uploading the Property Lines KMZ

1. Open the map
2. Click **Upload KMZ** in the sidebar
3. Select your property lines `.kmz` file
4. It renders as yellow outlines automatically

> Note: KMZ layers are local to your browser session — they don't sync to Sheets.
> Each user needs to re-upload the KMZ. For a permanent property lines layer,
> let Brent know and we can bake the GeoJSON directly into the app.
