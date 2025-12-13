"""
Netflix Scraper Web Dashboard
==============================
Flask-based web application to:
- Trigger Netflix scraping
- View scraped content
- Manage sessions
- REST API for integration

Run with: python app.py
Access at: http://localhost:5000
"""

import asyncio
import json
import os
import glob
from datetime import datetime
from functools import wraps
from flask import Flask, jsonify, request, render_template, send_from_directory
from flask_cors import CORS
from dataclasses import asdict

# Import our scrapers
from netflix_scraper_v3 import NetflixScraperV3, NetflixTitle
from netflix_stream_scraper import NetflixStreamScraper, NetflixStreamData

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)  # Enable CORS for API access

# Configuration
BASE_PATH = os.path.dirname(os.path.abspath(__file__))
SCRAPED_DATA_DIR = os.path.join(BASE_PATH, "scraped_data")
COOKIES_FILE = os.path.join(BASE_PATH, "netflix_cookies.json")

os.makedirs(SCRAPED_DATA_DIR, exist_ok=True)


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def run_async(coro):
    """Run async function in sync context."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def get_all_scraped_titles():
    """Get all scraped title data from JSON files."""
    titles = []
    pattern = os.path.join(SCRAPED_DATA_DIR, "netflix_*.json")
    
    for filepath in glob.glob(pattern):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Add filename for reference
                data["_filename"] = os.path.basename(filepath)
                titles.append(data)
        except Exception as e:
            print(f"Error reading {filepath}: {e}")
    
    # Sort by scraped_at date (newest first)
    titles.sort(key=lambda x: x.get("scraped_at", ""), reverse=True)
    return titles


def check_session_valid():
    """Check if Netflix session cookies are valid."""
    if not os.path.exists(COOKIES_FILE):
        return {"valid": False, "message": "No cookies file found"}
    
    try:
        with open(COOKIES_FILE, "r", encoding="utf-8") as f:
            cookies = json.load(f)
        
        # Check for critical cookies
        netflix_id = next((c for c in cookies if c["name"] == "NetflixId"), None)
        secure_id = next((c for c in cookies if c["name"] == "SecureNetflixId"), None)
        
        if not netflix_id or not secure_id:
            return {"valid": False, "message": "Critical auth cookies missing"}
        
        # Check expiration
        now = datetime.now().timestamp()
        if netflix_id.get("expires", 0) < now:
            return {"valid": False, "message": "Session expired"}
        
        expiry = datetime.fromtimestamp(netflix_id.get("expires", 0))
        return {
            "valid": True,
            "message": "Session is valid",
            "expires_at": expiry.isoformat(),
            "cookies_count": len(cookies)
        }
    except Exception as e:
        return {"valid": False, "message": str(e)}


# ============================================================================
# API ROUTES
# ============================================================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    })


@app.route('/api/session', methods=['GET'])
def get_session_status():
    """Get Netflix session status."""
    return jsonify(check_session_valid())


@app.route('/api/titles', methods=['GET'])
def get_all_titles():
    """Get all scraped titles."""
    titles = get_all_scraped_titles()
    return jsonify({
        "count": len(titles),
        "titles": titles
    })


@app.route('/api/titles/<title_id>', methods=['GET'])
def get_title(title_id):
    """Get a specific title by ID."""
    filepath = os.path.join(SCRAPED_DATA_DIR, f"netflix_{title_id}.json")
    
    if not os.path.exists(filepath):
        return jsonify({"error": "Title not found"}), 404
    
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    return jsonify(data)


@app.route('/api/scrape', methods=['POST'])
def scrape_title():
    """
    Scrape a Netflix title.
    
    Request body:
    {
        "title_id": "81210788",
        "url": "https://www.netflix.com/title/81210788" (optional)
    }
    """
    data = request.get_json() or {}
    
    title_id = data.get("title_id")
    if not title_id:
        # Try to extract from URL
        url = data.get("url", "")
        import re
        match = re.search(r'/(?:watch|title)/(\d+)', url)
        if match:
            title_id = match.group(1)
    
    if not title_id:
        return jsonify({"error": "title_id is required"}), 400
    
    # Check session first
    session = check_session_valid()
    if not session["valid"]:
        return jsonify({
            "error": "Invalid session",
            "details": session["message"],
            "action": "Run netflix_login_save_cookies.py to refresh session"
        }), 401
    
    try:
        # Run the scraper
        scraper = NetflixScraperV3(base_path=BASE_PATH)
        result = run_async(scraper.scrape_title(title_id))
        scraper.save_result(result)
        
        return jsonify({
            "success": True,
            "message": f"Successfully scraped title {title_id}",
            "data": asdict(result)
        })
    
    except Exception as e:
        return jsonify({
            "error": "Scraping failed",
            "details": str(e)
        }), 500


@app.route('/api/titles/<title_id>', methods=['DELETE'])
def delete_title(title_id):
    """Delete a scraped title."""
    filepath = os.path.join(SCRAPED_DATA_DIR, f"netflix_{title_id}.json")
    
    if not os.path.exists(filepath):
        return jsonify({"error": "Title not found"}), 404
    
    try:
        os.remove(filepath)
        # Also remove screenshot if exists
        screenshot = os.path.join(SCRAPED_DATA_DIR, f"screenshot_{title_id}.png")
        if os.path.exists(screenshot):
            os.remove(screenshot)
        
        return jsonify({"success": True, "message": f"Deleted title {title_id}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/screenshots/<filename>', methods=['GET'])
def get_screenshot(filename):
    """Serve screenshot images."""
    return send_from_directory(SCRAPED_DATA_DIR, filename)


@app.route('/api/streams/<title_id>', methods=['GET'])
def get_streams(title_id):
    """Get captured stream data for a title."""
    filepath = os.path.join(SCRAPED_DATA_DIR, f"streams_{title_id}.json")
    
    if not os.path.exists(filepath):
        return jsonify({"error": "Stream data not found. Run stream scraper first."}), 404
    
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    return jsonify(data)


@app.route('/api/scrape-streams', methods=['POST'])
def scrape_streams():
    """
    Scrape video stream URLs for a Netflix title.
    
    Request body:
    {
        "title_id": "81210788",
        "play_duration": 30  (optional, seconds to capture)
    }
    """
    data = request.get_json() or {}
    
    title_id = data.get("title_id")
    if not title_id:
        return jsonify({"error": "title_id is required"}), 400
    
    play_duration = data.get("play_duration", 30)
    
    # Check session
    session = check_session_valid()
    if not session["valid"]:
        return jsonify({
            "error": "Invalid session",
            "details": session["message"]
        }), 401
    
    try:
        scraper = NetflixStreamScraper(base_path=BASE_PATH)
        result = run_async(scraper.scrape_streams(title_id, play_duration))
        scraper.save_result(result)
        
        # Return summary
        return jsonify({
            "success": True,
            "message": f"Captured streams for {title_id}",
            "summary": {
                "manifests": len(result.manifests),
                "video_streams": len(result.video_streams),
                "audio_streams": len(result.audio_streams),
                "total_requests": len(result.all_requests),
                "drm_type": result.drm_info.get("drm_type", "unknown")
            },
            "file": f"streams_{title_id}.json"
        })
    
    except Exception as e:
        return jsonify({
            "error": "Stream scraping failed",
            "details": str(e)
        }), 500


# ============================================================================
# WEB ROUTES
# ============================================================================

@app.route('/')
def index():
    """Main dashboard page."""
    return render_template('index.html')


@app.route('/title/<title_id>')
def title_detail(title_id):
    """Title detail page."""
    return render_template('title.html', title_id=title_id)


# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    print("\n" + "="*60)
    print("NETFLIX SCRAPER WEB DASHBOARD")
    print("="*60)
    print(f"Data directory: {SCRAPED_DATA_DIR}")
    print(f"Cookies file: {COOKIES_FILE}")
    
    session = check_session_valid()
    if session["valid"]:
        print(f"[OK] Session valid until: {session.get('expires_at', 'unknown')}")
    else:
        print(f"[WARNING] Session invalid: {session['message']}")
    
    print("\nStarting server...")
    print("   Dashboard: http://localhost:5000")
    print("   API: http://localhost:5000/api/")
    print("="*60 + "\n")
    
    app.run(host='0.0.0.0', port=5000, debug=True)


