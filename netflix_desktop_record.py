#!/usr/bin/env python3
"""
Netflix Desktop Recording
===========================
Uses FFmpeg to record the ENTIRE DESKTOP while Netflix plays.
This captures the actual pixels displayed on screen, bypassing DRM.

IMPORTANT: 
- Keep the browser window MAXIMIZED and VISIBLE
- Do NOT minimize or cover the window during recording

Usage:
    python netflix_desktop_record.py --title 81210788 --duration 120
"""

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright


def get_storage_state():
    """Load Netflix cookies."""
    cookies_file = Path("netflix_cookies.json")
    if not cookies_file.exists():
        return None
    
    try:
        with open(cookies_file, 'r', encoding='utf-8') as f:
            cookies = json.load(f)
        
        playwright_cookies = []
        for cookie in cookies:
            pc = {
                'name': cookie.get('name', ''),
                'value': cookie.get('value', ''),
                'domain': cookie.get('domain', '.netflix.com'),
                'path': cookie.get('path', '/'),
                'sameSite': 'Lax'
            }
            if 'expires' in cookie and cookie['expires'] and cookie['expires'] != -1:
                pc['expires'] = cookie['expires']
            if cookie.get('secure'):
                pc['secure'] = True
            if cookie.get('httpOnly'):
                pc['httpOnly'] = True
            playwright_cookies.append(pc)
        
        return {'cookies': playwright_cookies, 'origins': []}
    except:
        return None


def start_desktop_recording(output_path: str, duration: int) -> subprocess.Popen:
    """Start FFmpeg desktop recording."""
    # Windows GDI capture - captures what's displayed on screen
    cmd = [
        'ffmpeg',
        '-y',  # Overwrite
        '-f', 'gdigrab',  # Windows screen capture
        '-framerate', '30',
        '-draw_mouse', '0',  # Hide mouse cursor
        '-t', str(duration + 5),  # Extra time to ensure completion
        '-i', 'desktop',
        # Video encoding
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',  # Ensure proper file finalization
        output_path
    ]
    
    print(f"[*] Starting FFmpeg desktop capture...")
    print(f"    Output: {output_path}")
    print(f"    Duration: {duration} seconds")
    
    return subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
    )


async def record_netflix(title_id: str, duration: int, output_dir: str = "output"):
    """
    Record Netflix by capturing the desktop while video plays.
    """
    print("\n" + "="*70)
    print("NETFLIX DESKTOP RECORDING")
    print("="*70)
    print(f"Title: {title_id}")
    print(f"Duration: {duration} seconds")
    print()
    print("IMPORTANT:")
    print("  - Keep the browser window MAXIMIZED and VISIBLE")
    print("  - Do NOT minimize or cover the window")
    print("  - Do NOT move other windows over the video")
    print("="*70)
    
    storage_state = get_storage_state()
    if not storage_state:
        print("\n[ERROR] No cookies found!")
        return None
    
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Create title folder
    title_folder = output_path / f"Netflix_{title_id}"
    title_folder.mkdir(exist_ok=True)
    video_folder = title_folder / "video"
    video_folder.mkdir(exist_ok=True)
    
    output_file = video_folder / "desktop_recording.mp4"
    
    async with async_playwright() as p:
        print("\n[*] Launching browser (MAXIMIZED)...")
        
        try:
            browser = await p.chromium.launch(
                channel='msedge',
                headless=False,
                args=[
                    '--start-maximized',
                    '--disable-blink-features=AutomationControlled',
                    '--autoplay-policy=no-user-gesture-required',
                    '--kiosk',  # Fullscreen mode
                ]
            )
        except:
            browser = await p.chromium.launch(
                headless=False,
                args=[
                    '--start-maximized',
                    '--kiosk'
                ]
            )
        
        context = await browser.new_context(
            viewport=None,  # No viewport restriction
            storage_state=storage_state,
            no_viewport=True
        )
        
        page = await context.new_page()
        
        # Navigate
        watch_url = f"https://www.netflix.com/watch/{title_id}"
        print(f"[*] Opening: {watch_url}")
        
        await page.goto(watch_url, wait_until='domcontentloaded', timeout=60000)
        
        print("[*] Waiting for video to load...")
        await asyncio.sleep(10)
        
        # Get title
        title = await page.evaluate("""() => {
            return document.title.replace(' | Netflix', '').replace('Netflix - ', '') || 'Netflix';
        }""")
        print(f"[OK] Title: {title}")
        
        # Dismiss popups
        for sel in ['[data-uia="interrupt-button"]', '[data-uia="player-skip-intro"]']:
            try:
                btn = await page.query_selector(sel)
                if btn:
                    await btn.click()
            except:
                pass
        
        # Make fullscreen
        print("[*] Entering fullscreen mode...")
        await page.keyboard.press('f')
        await asyncio.sleep(3)
        
        # Hide cursor by moving it off-screen
        await page.mouse.move(-100, -100)
        
        # Ensure video is playing
        await page.evaluate("document.querySelector('video')?.play()")
        await asyncio.sleep(2)
        
        print("\n[*] STARTING DESKTOP RECORDING NOW!")
        print("[*] Keep this window VISIBLE and UNOBSTRUCTED!")
        print("-"*50)
        
        # Start FFmpeg recording
        ffmpeg_proc = start_desktop_recording(str(output_file), duration)
        
        # Monitor playback while recording
        start_time = time.time()
        while time.time() - start_time < duration:
            elapsed = int(time.time() - start_time)
            remaining = duration - elapsed
            print(f"\r    Recording: {elapsed}/{duration}s (remaining: {remaining}s)    ", end='', flush=True)
            
            # Keep video playing
            try:
                is_paused = await page.evaluate("document.querySelector('video')?.paused || false")
                if is_paused:
                    await page.evaluate("document.querySelector('video')?.play()")
            except:
                pass
            
            # Skip intro
            try:
                skip = await page.query_selector('[data-uia="player-skip-intro"]')
                if skip:
                    await skip.click()
            except:
                pass
            
            await asyncio.sleep(1)
        
        print(f"\r    Recording: {duration}/{duration}s (complete!)        ")
        print("\n[*] Waiting for recording to finalize...")
        
        # Wait for FFmpeg to finish properly (it will stop after -t duration)
        try:
            stdout, stderr = ffmpeg_proc.communicate(timeout=60)
            print(f"    FFmpeg finished with return code: {ffmpeg_proc.returncode}")
        except subprocess.TimeoutExpired:
            print("    [WARN] FFmpeg taking too long, terminating...")
            ffmpeg_proc.terminate()
            try:
                ffmpeg_proc.wait(timeout=10)
            except:
                ffmpeg_proc.kill()
        
        # Give it a moment to flush buffers
        await asyncio.sleep(3)
        
        # Exit fullscreen
        await page.keyboard.press('Escape')
        await asyncio.sleep(1)
        
        await browser.close()
    
    # Check output
    if output_file.exists():
        file_size = output_file.stat().st_size / (1024*1024)
        
        if file_size > 1:  # At least 1 MB
            # Update filename with title
            safe_title = re.sub(r'[<>:"/\\|?*]', '', title).strip() or f"Netflix_{title_id}"
            final_folder = output_path / safe_title
            
            # Don't rename if same folder
            if final_folder != title_folder:
                if final_folder.exists():
                    # Merge into existing
                    import shutil
                    for f in video_folder.glob('*'):
                        shutil.move(str(f), str(final_folder / "video" / f.name))
                else:
                    title_folder.rename(final_folder)
                title_folder = final_folder
                video_folder = title_folder / "video"
                output_file = video_folder / "desktop_recording.mp4"
            
            # Get video info
            print("\n[*] Verifying recording...")
            try:
                info_result = subprocess.run([
                    'ffprobe', '-v', 'error',
                    '-show_entries', 'format=duration,bit_rate:stream=width,height',
                    '-of', 'json', str(output_file)
                ], capture_output=True, text=True)
                
                if info_result.returncode == 0:
                    info = json.loads(info_result.stdout)
                    vid_duration = float(info.get('format', {}).get('duration', 0))
                    vid_bitrate = int(info.get('format', {}).get('bit_rate', 0)) / 1000
                    
                    stream = info.get('streams', [{}])[0]
                    width = stream.get('width', 0)
                    height = stream.get('height', 0)
                    
                    print(f"    Resolution: {width}x{height}")
                    print(f"    Duration: {vid_duration:.1f}s")
                    print(f"    Bitrate: {vid_bitrate:.0f} kbps")
            except:
                pass
            
            # Save metadata
            metadata = {
                'title_id': title_id,
                'title': title,
                'recorded_at': datetime.now().isoformat(),
                'duration_seconds': duration,
                'file_size_mb': round(file_size, 2),
                'method': 'Desktop recording (FFmpeg gdigrab)',
                'playable': True,
                'note': 'Full screen desktop recording - may include desktop UI'
            }
            
            with open(title_folder / "movie_info.json", 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)
            
            print("\n" + "="*70)
            print("RECORDING COMPLETE!")
            print("="*70)
            print(f"Title: {title}")
            print(f"Output: {output_file}")
            print(f"Size: {file_size:.1f} MB")
            print("\nThis video file is PLAYABLE!")
            print("="*70)
            
            return {
                'success': True,
                'title': title,
                'file': str(output_file),
                'size_mb': file_size
            }
        else:
            print(f"\n[ERROR] Recording too small ({file_size:.1f} MB)")
    else:
        print("\n[ERROR] No output file created")
    
    return None


async def main():
    parser = argparse.ArgumentParser(
        description="Netflix Desktop Recording - Captures the playing video"
    )
    
    parser.add_argument('--title', '-t', type=str, required=True,
                        help='Netflix title ID')
    parser.add_argument('--duration', '-d', type=int, default=120,
                        help='Recording duration in seconds (default: 120)')
    parser.add_argument('--output', '-o', type=str, default='output',
                        help='Output directory')
    
    args = parser.parse_args()
    
    print("\n" + "!"*70)
    print("IMPORTANT: This will record your ENTIRE DESKTOP!")
    print("Make sure the Netflix video is VISIBLE and MAXIMIZED!")
    print("!"*70)
    
    input("\nPress Enter when ready to start...")
    
    result = await record_netflix(
        args.title,
        args.duration,
        args.output
    )
    
    if not result:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

