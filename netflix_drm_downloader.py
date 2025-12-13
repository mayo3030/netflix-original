#!/usr/bin/env python3
"""
Netflix DRM Video Downloader
=============================
Complete Netflix video downloader with Widevine DRM support.

Requirements:
- Netflix cookies (from browser)
- Widevine device file (.wvd)
- FFmpeg installed

Usage:
    python netflix_drm_downloader.py --title 81210788 --device device.wvd

For educational purposes only.
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from msl.client import MSLClient
from utils.manifest import ManifestParser, ParsedManifest
from utils.widevine import WidevineCDM, list_available_devices
from utils.downloader import SegmentDownloader
from utils.ffmpeg import FFmpegWrapper


class NetflixDRMDownloader:
    """
    Complete Netflix DRM video downloader.
    
    Workflow:
    1. Load Netflix cookies
    2. Initialize MSL client
    3. Request manifest
    4. Extract PSSH and stream URLs
    5. Get decryption keys via Widevine
    6. Download encrypted segments
    7. Decrypt with FFmpeg
    8. Mux video + audio + subtitles
    """
    
    def __init__(self, 
                 cookies_path: str = "netflix_cookies.json",
                 device_path: str = None,
                 output_dir: str = "output"):
        """
        Initialize downloader.
        
        Args:
            cookies_path: Path to Netflix cookies JSON
            device_path: Path to Widevine .wvd device file
            output_dir: Output directory for downloads
        """
        self.cookies_path = cookies_path
        self.device_path = device_path
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Components
        self.cookies: List[Dict] = []
        self.msl_client: Optional[MSLClient] = None
        self.cdm: Optional[WidevineCDM] = None
        self.ffmpeg = FFmpegWrapper()
        
        # State
        self.initialized = False
    
    def load_cookies(self) -> bool:
        """Load Netflix cookies from file."""
        try:
            with open(self.cookies_path, 'r', encoding='utf-8') as f:
                self.cookies = json.load(f)
            print(f"[OK] Loaded {len(self.cookies)} cookies")
            return True
        except Exception as e:
            print(f"[ERROR] Failed to load cookies: {e}")
            return False
    
    def initialize(self) -> bool:
        """Initialize all components."""
        print("\n" + "="*60)
        print("NETFLIX DRM DOWNLOADER")
        print("="*60)
        
        # Load cookies
        if not self.load_cookies():
            return False
        
        # Initialize MSL client
        print("[*] Initializing MSL client...")
        self.msl_client = MSLClient(self.cookies)
        print(f"[OK] ESN: {self.msl_client.esn}")
        
        # Initialize Widevine CDM if device provided
        if self.device_path:
            print(f"[*] Loading Widevine device: {self.device_path}")
            try:
                self.cdm = WidevineCDM(self.device_path)
                print(f"[OK] Device loaded")
            except Exception as e:
                print(f"[WARN] Widevine CDM not available: {e}")
                print("[WARN] Decryption will not be possible")
        else:
            print("[WARN] No Widevine device provided - decryption disabled")
        
        self.initialized = True
        return True
    
    def get_manifest(self, title_id: str) -> Optional[ParsedManifest]:
        """
        Get and parse manifest for a title.
        
        Args:
            title_id: Netflix title ID
            
        Returns:
            ParsedManifest or None
        """
        print(f"\n[*] Getting manifest for title {title_id}...")
        
        raw_manifest = self.msl_client.get_manifest(title_id)
        
        if not raw_manifest:
            print("[ERROR] Failed to get manifest")
            return None
        
        # Save raw manifest for debugging
        manifest_path = self.output_dir / f"manifest_{title_id}.json"
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(raw_manifest, f, indent=2, default=str)
        print(f"[OK] Saved manifest to {manifest_path}")
        
        # Parse manifest
        parsed = ManifestParser.parse_netflix_manifest(raw_manifest)
        parsed.title_id = title_id
        
        print(f"[OK] Found {len(parsed.video_tracks)} video tracks")
        print(f"[OK] Found {len(parsed.audio_tracks)} audio tracks")
        print(f"[OK] Found {len(parsed.subtitle_tracks)} subtitle tracks")
        
        if parsed.pssh:
            print(f"[OK] PSSH: {parsed.pssh[:50]}...")
        
        return parsed
    
    def get_decryption_keys(self, pssh: str) -> Dict[str, str]:
        """
        Get decryption keys for a PSSH.
        
        Args:
            pssh: PSSH data (base64)
            
        Returns:
            Dict mapping KID to Key
        """
        if not self.cdm:
            print("[WARN] No CDM available - cannot get keys")
            return {}
        
        print("\n[*] Getting decryption keys...")
        
        if not self.cdm.open_session():
            return {}
        
        try:
            # Generate challenge
            challenge = self.cdm.get_license_challenge(pssh)
            if not challenge:
                return {}
            
            # Get license from Netflix
            license_response = self.msl_client.get_license(
                challenge, 
                self.cdm.session_id.hex() if self.cdm.session_id else ""
            )
            
            if not license_response:
                print("[ERROR] Failed to get license")
                return {}
            
            # Parse license and extract keys
            self.cdm.parse_license(license_response)
            
            return self.cdm.get_all_keys_for_ffmpeg()
            
        finally:
            self.cdm.close_session()
    
    def download_title(self, 
                       title_id: str,
                       quality: str = "best",
                       download_subs: bool = True) -> Dict:
        """
        Download a Netflix title.
        
        Args:
            title_id: Netflix title ID
            quality: Quality to download (best, 1080p, 720p, 480p)
            download_subs: Whether to download subtitles
            
        Returns:
            Dict with download results
        """
        if not self.initialized:
            if not self.initialize():
                return {'success': False, 'error': 'Initialization failed'}
        
        result = {
            'title_id': title_id,
            'success': False,
            'files': [],
            'error': ''
        }
        
        # Get manifest
        manifest = self.get_manifest(title_id)
        if not manifest:
            result['error'] = 'Failed to get manifest'
            return result
        
        # Create output folder
        title_folder = self.output_dir / f"netflix_{title_id}"
        title_folder.mkdir(exist_ok=True)
        
        # Get decryption keys
        keys = {}
        if manifest.pssh:
            keys = self.get_decryption_keys(manifest.pssh)
            if keys:
                # Save keys
                keys_path = title_folder / "keys.json"
                with open(keys_path, 'w') as f:
                    json.dump(keys, f, indent=2)
                result['files'].append(str(keys_path))
                print(f"[OK] Saved keys to {keys_path}")
        
        # Select video track
        video_tracks = ManifestParser.sort_video_by_quality(manifest.video_tracks)
        
        if quality != "best":
            target_height = int(quality.replace('p', ''))
            video_tracks = ManifestParser.filter_video_by_resolution(video_tracks, target_height)
        
        if not video_tracks:
            result['error'] = 'No video tracks available'
            return result
        
        selected_video = video_tracks[0]
        print(f"\n[*] Selected video: {selected_video.quality} ({selected_video.resolution}) @ {selected_video.bitrate//1000} kbps")
        
        # Download video
        if selected_video.urls:
            print("\n[*] Downloading video segments...")
            
            video_folder = title_folder / "video"
            video_folder.mkdir(exist_ok=True)
            
            downloader = SegmentDownloader(
                output_dir=str(video_folder),
                cookies={c['name']: c['value'] for c in self.cookies}
            )
            
            video_result = downloader.download_segments(
                selected_video.urls,
                f"video_{selected_video.quality}",
                combine=True
            )
            
            if video_result.success:
                result['files'].append(video_result.file_path)
                
                # Decrypt if keys available
                if keys:
                    encrypted_path = video_result.file_path
                    decrypted_path = encrypted_path.replace('.mp4', '_decrypted.mp4')
                    
                    print("\n[*] Decrypting video...")
                    key = list(keys.values())[0] if keys else None
                    
                    if key:
                        decrypt_result = self.ffmpeg.decrypt(
                            encrypted_path,
                            decrypted_path,
                            key
                        )
                        
                        if decrypt_result.success:
                            result['files'].append(decrypted_path)
        
        # Download subtitles
        if download_subs and manifest.subtitle_tracks:
            print(f"\n[*] Downloading {len(manifest.subtitle_tracks)} subtitle tracks...")
            
            subs_folder = title_folder / "subtitles"
            subs_folder.mkdir(exist_ok=True)
            
            downloader = SegmentDownloader(
                output_dir=str(subs_folder),
                cookies={c['name']: c['value'] for c in self.cookies}
            )
            
            for sub in manifest.subtitle_tracks:
                if sub.urls:
                    sub_path = subs_folder / f"{sub.language_code or sub.language}.vtt"
                    if downloader.download_file(sub.urls[0], str(sub_path)):
                        result['files'].append(str(sub_path))
                        print(f"    Downloaded: {sub.language}")
        
        # Save metadata
        metadata = {
            'title_id': title_id,
            'downloaded_at': datetime.now().isoformat(),
            'video_quality': selected_video.quality,
            'video_resolution': selected_video.resolution,
            'video_bitrate': selected_video.bitrate,
            'audio_tracks': len(manifest.audio_tracks),
            'subtitle_tracks': len(manifest.subtitle_tracks),
            'has_keys': bool(keys),
            'files': result['files']
        }
        
        metadata_path = title_folder / "metadata.json"
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2)
        result['files'].append(str(metadata_path))
        
        result['success'] = True
        print(f"\n[OK] Download complete: {title_folder}")
        
        return result


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Netflix DRM Video Downloader",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Download with Widevine device (for decryption)
    python netflix_drm_downloader.py --title 81210788 --device devices/device.wvd
    
    # Download without decryption (encrypted only)
    python netflix_drm_downloader.py --title 81210788
    
    # Download specific quality
    python netflix_drm_downloader.py --title 81210788 --quality 720p
    
    # List available Widevine devices
    python netflix_drm_downloader.py --list-devices

IMPORTANT:
    - This tool requires a valid Widevine device file (.wvd) for decryption
    - Without a device file, only encrypted videos can be downloaded
    - For educational purposes only
        """
    )
    
    parser.add_argument('--title', '-t', type=str, help='Netflix title ID to download')
    parser.add_argument('--device', '-d', type=str, help='Path to Widevine .wvd device file')
    parser.add_argument('--cookies', '-c', type=str, default='netflix_cookies.json',
                        help='Path to Netflix cookies JSON file')
    parser.add_argument('--output', '-o', type=str, default='output',
                        help='Output directory')
    parser.add_argument('--quality', '-q', type=str, default='best',
                        choices=['best', '4k', '1080p', '720p', '480p', '360p'],
                        help='Video quality to download')
    parser.add_argument('--no-subs', action='store_true',
                        help='Skip subtitle download')
    parser.add_argument('--list-devices', action='store_true',
                        help='List available Widevine devices')
    
    args = parser.parse_args()
    
    # List devices
    if args.list_devices:
        print("\nAvailable Widevine Devices:")
        print("-" * 40)
        devices = list_available_devices('devices')
        if devices:
            for dev in devices:
                status = "[VALID]" if dev.get('valid') else "[INVALID]"
                print(f"  {status} {dev['file']}")
                if dev.get('valid'):
                    print(f"         System ID: {dev.get('system_id')}")
                    print(f"         Security: L{dev.get('security_level')}")
        else:
            print("  No .wvd files found in 'devices' folder")
            print("  Place your Widevine device file in the 'devices' folder")
        return
    
    # Validate arguments
    if not args.title:
        parser.print_help()
        print("\nError: --title is required")
        sys.exit(1)
    
    # Check cookies exist
    if not os.path.exists(args.cookies):
        print(f"Error: Cookies file not found: {args.cookies}")
        print("Run 'python netflix_login_save_cookies.py' to save cookies")
        sys.exit(1)
    
    # Initialize and run
    downloader = NetflixDRMDownloader(
        cookies_path=args.cookies,
        device_path=args.device,
        output_dir=args.output
    )
    
    result = downloader.download_title(
        title_id=args.title,
        quality=args.quality,
        download_subs=not args.no_subs
    )
    
    if result['success']:
        print("\n" + "="*60)
        print("DOWNLOAD SUCCESSFUL")
        print("="*60)
        print(f"\nFiles downloaded:")
        for f in result['files']:
            print(f"  - {f}")
    else:
        print(f"\nDownload failed: {result.get('error', 'Unknown error')}")
        sys.exit(1)


if __name__ == "__main__":
    main()

