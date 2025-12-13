# 🎬 Netflix Video Downloader

A Python toolkit for downloading Netflix video content using multiple methods.

![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)
![Playwright](https://img.shields.io/badge/Playwright-Latest-green.svg)
![FFmpeg](https://img.shields.io/badge/FFmpeg-Required-red.svg)

> ⚠️ **EDUCATIONAL USE ONLY** - For learning about streaming protocols and DRM.

## 📁 Project Structure

```
netflix-original/
├── msl/                    # Netflix MSL Protocol
│   ├── __init__.py
│   ├── client.py           # MSL API client
│   └── crypto.py           # Encryption utilities
│
├── utils/                  # Utility modules
│   ├── __init__.py
│   ├── manifest.py         # Manifest parser
│   ├── widevine.py         # Widevine CDM
│   ├── downloader.py       # Segment downloader
│   └── ffmpeg.py           # FFmpeg wrapper
│
├── templates/              # Flask templates
├── devices/                # Widevine .wvd files
├── output/                 # Downloaded videos
│
├── netflix_login_save_cookies.py   # Step 1: Save cookies
├── netflix_desktop_record.py       # Method A: Screen recording
├── netflix_drm_downloader.py       # Method B: DRM decryption
├── app.py                          # Flask web dashboard
│
├── requirements.txt
└── README.md
```

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pip install -r requirements.txt
playwright install chromium
```

### 2. Save Netflix Cookies
```bash
python netflix_login_save_cookies.py
```

### 3. Download Video

**Method A - Screen Recording (Always Works):**
```bash
python netflix_desktop_record.py --title 81210788 --duration 7200
```

**Method B - DRM Decryption (Best Quality):**
```bash
python netflix_drm_downloader.py --title 81210788 --device devices/device.wvd
```

## 🛠️ Core Components

| File | Purpose |
|------|---------|
| `netflix_login_save_cookies.py` | Save Netflix session cookies |
| `netflix_desktop_record.py` | Record screen while Netflix plays |
| `netflix_drm_downloader.py` | Full DRM decryption pipeline |
| `app.py` | Flask web dashboard |
| `msl/client.py` | Netflix MSL API communication |
| `utils/widevine.py` | Widevine CDM integration |

## ⚠️ Requirements

- Python 3.10+
- FFmpeg installed and in PATH
- Netflix account
- For DRM decryption: Widevine device file (.wvd)

## 📜 License

Educational use only. Not for commercial purposes.
