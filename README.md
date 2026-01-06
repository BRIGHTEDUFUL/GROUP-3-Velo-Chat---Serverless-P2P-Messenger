<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Velo Mesh - Serverless P2P Messenger

This is a distributed peer-to-peer messenger built with React, PeerJS, and Vite.

View your app in AI Studio: https://ai.studio/apps/drive/1w6AU4yvOSm7FbBzvnTDqUHxEoF3xk9l6

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   ```bash
   npm install
   ```
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key (optional)
3. Run the app:
   ```bash
   npm run dev
   ```

## Deploy to GitHub Pages

This repository is configured to automatically deploy to GitHub Pages when you push to the `main` branch.

### Setup GitHub Pages:

1. Go to your repository **Settings** > **Pages**
2. Under **Source**, select **GitHub Actions**
3. Push to the `main` branch to trigger automatic deployment

The app will be available at: `https://BRIGHTEDUFUL.github.io/GROUP-3-Velo-Chat---Serverless-P2P-Messenger/`

### Manual Build:

To build the project manually:
```bash
npm run build
```

To preview the build locally:
```bash
npm run preview
```
