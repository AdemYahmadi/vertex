<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-lockup-dark.png">
    <img alt="Vertex" src="assets/logo-lockup.png" width="208">
  </picture>
</p>

<p align="center">
  Turn photos of paper documents into clean, scanner-quality PDFs — in the browser or from the command line.
</p>

<p align="center">
  <a href="#live-demo">Live Demo</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#web-app">Web App</a>
</p>

<p align="center">
  <img alt="Python" src="https://img.shields.io/badge/python-3.9%2B-blue">
  <img alt="React" src="https://img.shields.io/badge/react-19-149eca">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

## Overview

Vertex turns a photograph of a paper document into a flattened, scanner-quality PDF. It detects the page in the frame, corrects perspective distortion, evens out shadows and uneven lighting, and enhances the result to look like it came off an office scanner.

It comes in two forms:

- **Web app** — drop in one or more photos, scan them, and download the PDFs. Try it instantly, nothing to install.
- **Command-line tool** — an installable `vertex` command for full-resolution local scanning with no size limits and the most accurate model.

## Live Demo

**[vertex.ademyahmadi.com](https://vertex.ademyahmadi.com)**

> [!IMPORTANT]
> The demo runs on a **free server**, so to keep it responsive it uses a **lightweight detection model** and **scales large images down to 1800px**. For best results, photograph the page against a plain, uncluttered background. For **full-resolution scans and the most accurate model**, install the [CLI](#cli) — it runs the full pipeline locally with no size limits.

## Features

- **Deep-learning document detection** — locates the page and its four corners even against complex backgrounds and in uneven lighting
- **Perspective correction** — flattens the detected page into a clean, rectangular scan of any paper size
- **Illumination normalization** — evens out shadows and bright spots for a uniform page
- **Scanner-style enhancement** — pure-white background, crisp ink, and sharpened edges

## How It Works

```text
Input Image
     │
     ▼
Document Detection        locate the page and its four corners
     │
     ▼
Perspective Correction    warp the page flat
     │
     ▼
Background Trimming       remove leftover background around the paper
     │
     ▼
Image Enhancement         flatten lighting, whiten the page, sharpen ink
     │
     ▼
PDF Export
```

On first run, the detection model weights (~5–20 MB) are downloaded automatically and cached locally. Vertex runs fully offline afterward.

## CLI

The command-line tool gives you the full-quality experience: the most accurate model and no image downscaling.

### Installation

```bash
git clone https://github.com/AdemYahmadi/vertex.git
cd vertex
pipx install .
```

Don't have pipx?

```bash
brew install pipx        # macOS
pipx ensurepath          # then restart your terminal
```

Verify it:

```bash
vertex --help
```

### Usage

```bash
# a single image
vertex document.jpg output/

# several images at once
vertex document1.jpg document2.jpg output/

# an entire folder
vertex images/ output/

# any mix of files and folders
vertex a.jpg b.jpg images/ output/
```

Each document is written as its own PDF into the output folder.

**Supported formats:** `.jpg`, `.jpeg`, `.png`

## Web App

Prefer to run the web interface yourself?

**Backend** (from the repository root):

```bash
python -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn api:app --reload --port 8000
```

**Frontend** (in a second terminal):

```bash
cd frontend
npm install
npm run dev
```

Then open the printed local URL.

## Project Structure

```text
vertex/
├── api.py                      # FastAPI web service
├── main.py                     # Command-line entry point
├── src/
│   ├── processor.py            # Orchestrates the scanning pipeline
│   ├── core/
│   │   ├── geometry.py         # Detection and perspective correction
│   │   └── enhancement.py      # Background trimming and enhancement
│   └── utils/
│       └── io.py               # Image loading
└── frontend/
    └── src/
        └── VertexScanner.jsx   # The complete web interface
```

## License

Released under the MIT License.