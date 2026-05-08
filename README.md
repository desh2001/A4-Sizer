# A4 Sizer - Photo Layout Studio

A sleek, interactive web application designed to help you perfectly arrange, resize, and position multiple images onto an A4-sized canvas. Whether you're preparing photos for printing or generating an organized PDF, A4 Sizer automatically maximizes space efficiency without cropping any of your content.

## Features

- **Smart Auto-Arrangement**: Simply drag and drop your images. The intelligent layout engine will automatically pack them onto the A4 canvas proportionally.
- **Manual Control**: Resize any image manually—its dimensions will lock into place, and the rest of the canvas will elegantly reflow around it.
- **Drag & Drop**: Reposition your images by freely dragging them across the page.
- **Export to PDF & PNG**: Generate high-quality A4 layout PDFs or image files with a single click, perfectly scaled for printing.
- **Zero Cropping**: All images use `object-fit: contain` behavior, guaranteeing that your photos are never cropped.

## Tech Stack

- **React 18** / **19** - UI Framework
- **Vite** - Lightning-fast build tool
- **TypeScript** - Strongly typed JavaScript
- **react-moveable** - For interactive dragging and resizing operations
- **html2canvas** & **jspdf** - For rendering the canvas and exporting it to PDF/Image

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Run the development server**
   ```bash
   npm run dev
   ```

3. **Open the app**
   Open `http://localhost:5173` in your browser.

## How It Works

- Upload images — they auto-arrange to fill the A4 canvas (210 × 297 mm).
- Resize any image — its size locks 🔒, and the other unlocked images reflow.
- Select a locked image to unlock it individually, or click **Re-Arrange All** to reset all locks.
- Select an image and hit **Delete** (or use the sidebar button) to remove it and instantly re-calculate the layout.
