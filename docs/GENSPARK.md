# 🤖 Genspark Development Guide

Instructions for AI assistants (Genspark, Claude, etc.) to continue developing this project.

## 📋 Project Overview

**Netflix Video Downloader** - A Python toolkit for downloading Netflix content.

### Current Status
- ✅ Session management (cookies)
- ✅ MSL protocol client
- ✅ Widevine CDM integration
- ✅ Desktop screen recording
- ⚠️ DRM decryption (needs .wvd file)
- ⚠️ Segment download (encrypted without keys)

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Netflix Downloader                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Cookies   │→ │ MSL Client  │→ │     Manifest        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         ↓                                    ↓               │
│  ┌─────────────┐                   ┌─────────────────────┐  │
│  │   Browser   │                   │    PSSH Extract     │  │
│  │   Session   │                   └─────────────────────┘  │
│  └─────────────┘                             ↓               │
│                                    ┌─────────────────────┐  │
│                                    │   Widevine CDM      │  │
│                                    │   License Request   │  │
│                                    └─────────────────────┘  │
│                                              ↓               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Download + Decrypt + Mux                   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 📂 Key Files

### Entry Points
| File | Purpose | Command |
|------|---------|---------|
| `netflix_login_save_cookies.py` | Save Netflix session | `python netflix_login_save_cookies.py` |
| `netflix_desktop_record.py` | Screen recording method | `python netflix_desktop_record.py --title ID --duration SEC` |
| `netflix_drm_downloader.py` | DRM decryption method | `python netflix_drm_downloader.py --title ID --device FILE` |
| `app.py` | Web dashboard | `python app.py` |

### Core Modules
| Module | Purpose |
|--------|---------|
| `msl/client.py` | Netflix MSL API (manifest, license requests) |
| `msl/crypto.py` | AES encryption for MSL messages |
| `utils/widevine.py` | Widevine CDM wrapper using pywidevine |
| `utils/manifest.py` | Parse Netflix manifests and MPD |
| `utils/downloader.py` | Async segment downloader |
| `utils/ffmpeg.py` | FFmpeg wrapper for decrypt/mux |

## 🔧 How to Continue Development

### Priority Tasks

1. **Fix MSL Authentication**
   - File: `msl/client.py`
   - Issue: Handshake not completing properly
   - Solution: Implement proper key exchange with Netflix

2. **Improve Manifest Parsing**
   - File: `utils/manifest.py`
   - Add: Parse encrypted MSL manifest responses
   - Add: Extract all quality levels

3. **Add Audio Capture**
   - File: `netflix_desktop_record.py`
   - Add: Windows audio loopback capture with FFmpeg

4. **Web Dashboard Improvements**
   - File: `app.py`, `templates/`
   - Add: Download progress tracking
   - Add: Quality selection UI

### Code Patterns

**Loading Cookies:**
```python
with open('netflix_cookies.json', 'r') as f:
    cookies = json.load(f)
```

**Using MSL Client:**
```python
from msl.client import MSLClient
client = MSLClient(cookies)
manifest = client.get_manifest(title_id)
```

**Using Widevine:**
```python
from utils.widevine import WidevineCDM
cdm = WidevineCDM('devices/device.wvd')
cdm.open_session()
challenge = cdm.get_license_challenge(pssh)
# Send challenge to Netflix, get license
cdm.parse_license(license_response)
keys = cdm.get_all_keys_for_ffmpeg()
```

**FFmpeg Decrypt:**
```python
from utils.ffmpeg import FFmpegWrapper
ffmpeg = FFmpegWrapper()
ffmpeg.decrypt(encrypted_path, decrypted_path, key)
```

## 🚫 Known Limitations

1. **DRM Encryption** - Netflix content is Widevine encrypted. Without a valid `.wvd` device file, content cannot be decrypted.

2. **Screen Recording Quality** - Desktop recording captures at display resolution, not native stream quality.

3. **Netflix Detection** - Netflix may detect automation and block access.

## 📝 Development Commands

```bash
# Install dependencies
pip install -r requirements.txt
playwright install chromium

# Run tests (when added)
pytest tests/

# Format code
black .

# Type checking
mypy .
```

## 🔗 External Resources

- [pywidevine](https://github.com/devine-dl/pywidevine) - Widevine CDM library
- [Playwright](https://playwright.dev/python/) - Browser automation
- [FFmpeg](https://ffmpeg.org/documentation.html) - Video processing

## 💡 Tips for AI Assistants

1. **Always check cookies exist** before running download methods
2. **Test with short durations** (60s) before long recordings
3. **Desktop recording is the fallback** when DRM methods fail
4. **Keep browser visible** during desktop recording
5. **Check FFmpeg is installed** before video operations

## 📊 Status Codes

| Code | Meaning |
|------|---------|
| `MSL_AUTH_ERROR` | MSL handshake failed |
| `NO_COOKIES` | Cookies file not found |
| `NO_WVD` | Widevine device file missing |
| `ENCRYPTED` | Content is DRM encrypted |
| `PLAYABLE` | Video file can be played |
