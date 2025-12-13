"""
Video Segment Downloader
=========================
Downloads video/audio segments with progress tracking.
"""

import asyncio
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict, Optional, Callable
import aiohttp
import requests


@dataclass
class DownloadProgress:
    """Track download progress."""
    total_segments: int = 0
    downloaded_segments: int = 0
    total_bytes: int = 0
    downloaded_bytes: int = 0
    current_speed: float = 0.0  # bytes/sec
    eta_seconds: float = 0.0
    
    @property
    def percent(self) -> float:
        if self.total_segments == 0:
            return 0.0
        return (self.downloaded_segments / self.total_segments) * 100
    
    @property
    def downloaded_mb(self) -> float:
        return self.downloaded_bytes / (1024 * 1024)
    
    @property
    def speed_mbps(self) -> float:
        return (self.current_speed * 8) / (1024 * 1024)


@dataclass
class DownloadResult:
    """Result of download operation."""
    success: bool
    file_path: str = ""
    file_size: int = 0
    segments_downloaded: int = 0
    error: str = ""


class SegmentDownloader:
    """
    Downloads video/audio segments from URLs.
    
    Supports both sync and async downloads.
    """
    
    def __init__(self, 
                 output_dir: str = "downloads",
                 headers: Dict[str, str] = None,
                 cookies: Dict[str, str] = None,
                 progress_callback: Callable[[DownloadProgress], None] = None):
        """
        Initialize downloader.
        
        Args:
            output_dir: Directory for downloaded files
            headers: HTTP headers to use
            cookies: Cookies to include in requests
            progress_callback: Function to call with progress updates
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        self.headers = headers or {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        self.cookies = cookies or {}
        self.progress_callback = progress_callback
        
        self.progress = DownloadProgress()
        self._start_time = 0
        self._last_bytes = 0
    
    def _update_progress(self, bytes_downloaded: int):
        """Update progress statistics."""
        self.progress.downloaded_bytes += bytes_downloaded
        
        elapsed = time.time() - self._start_time
        if elapsed > 0:
            self.progress.current_speed = self.progress.downloaded_bytes / elapsed
            
            remaining_segments = self.progress.total_segments - self.progress.downloaded_segments
            if self.progress.downloaded_segments > 0:
                avg_time = elapsed / self.progress.downloaded_segments
                self.progress.eta_seconds = remaining_segments * avg_time
        
        if self.progress_callback:
            self.progress_callback(self.progress)
    
    def download_segment_sync(self, url: str, output_path: str) -> bool:
        """
        Download a single segment synchronously.
        
        Args:
            url: Segment URL
            output_path: Where to save the segment
            
        Returns:
            True if successful
        """
        try:
            resp = requests.get(
                url,
                headers=self.headers,
                cookies=self.cookies,
                timeout=60,
                stream=True
            )
            
            if resp.status_code == 200:
                with open(output_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                            self._update_progress(len(chunk))
                return True
            else:
                print(f"[DL] HTTP {resp.status_code} for {url[:60]}...")
                return False
                
        except Exception as e:
            print(f"[DL] Error downloading: {e}")
            return False
    
    async def download_segment_async(self, 
                                      session: aiohttp.ClientSession,
                                      url: str, 
                                      output_path: str) -> bool:
        """
        Download a single segment asynchronously.
        
        Args:
            session: aiohttp session
            url: Segment URL
            output_path: Where to save the segment
            
        Returns:
            True if successful
        """
        try:
            async with session.get(url, headers=self.headers) as resp:
                if resp.status == 200:
                    content = await resp.read()
                    
                    with open(output_path, 'wb') as f:
                        f.write(content)
                    
                    self._update_progress(len(content))
                    return True
                else:
                    print(f"[DL] HTTP {resp.status} for {url[:60]}...")
                    return False
                    
        except Exception as e:
            print(f"[DL] Async error: {e}")
            return False
    
    def download_segments(self,
                          urls: List[str],
                          output_file: str,
                          combine: bool = True) -> DownloadResult:
        """
        Download multiple segments synchronously.
        
        Args:
            urls: List of segment URLs
            output_file: Output filename (without extension)
            combine: Whether to combine segments into single file
            
        Returns:
            DownloadResult object
        """
        self.progress = DownloadProgress(total_segments=len(urls))
        self._start_time = time.time()
        
        # Create temp dir for segments
        temp_dir = self.output_dir / f"{output_file}_segments"
        temp_dir.mkdir(exist_ok=True)
        
        segment_files = []
        
        print(f"[DL] Downloading {len(urls)} segments...")
        
        for i, url in enumerate(urls):
            segment_path = temp_dir / f"segment_{i:05d}.mp4"
            
            if self.download_segment_sync(url, str(segment_path)):
                segment_files.append(segment_path)
                self.progress.downloaded_segments += 1
                
                # Print progress
                if (i + 1) % 10 == 0 or i == len(urls) - 1:
                    print(f"    Progress: {self.progress.downloaded_segments}/{len(urls)} "
                          f"({self.progress.percent:.1f}%) - "
                          f"{self.progress.downloaded_mb:.2f} MB")
        
        if not segment_files:
            return DownloadResult(success=False, error="No segments downloaded")
        
        # Combine segments
        if combine:
            output_path = self.output_dir / f"{output_file}.mp4"
            print(f"[DL] Combining {len(segment_files)} segments...")
            
            with open(output_path, 'wb') as outfile:
                for seg_file in sorted(segment_files):
                    with open(seg_file, 'rb') as infile:
                        outfile.write(infile.read())
            
            # Cleanup temp files
            for seg_file in segment_files:
                try:
                    seg_file.unlink()
                except:
                    pass
            try:
                temp_dir.rmdir()
            except:
                pass
            
            file_size = output_path.stat().st_size
            print(f"[DL] Saved: {output_path} ({file_size / (1024*1024):.2f} MB)")
            
            return DownloadResult(
                success=True,
                file_path=str(output_path),
                file_size=file_size,
                segments_downloaded=len(segment_files)
            )
        else:
            return DownloadResult(
                success=True,
                file_path=str(temp_dir),
                file_size=self.progress.downloaded_bytes,
                segments_downloaded=len(segment_files)
            )
    
    async def download_segments_async(self,
                                       urls: List[str],
                                       output_file: str,
                                       max_concurrent: int = 5,
                                       combine: bool = True) -> DownloadResult:
        """
        Download multiple segments asynchronously.
        
        Args:
            urls: List of segment URLs
            output_file: Output filename
            max_concurrent: Maximum concurrent downloads
            combine: Whether to combine segments
            
        Returns:
            DownloadResult object
        """
        self.progress = DownloadProgress(total_segments=len(urls))
        self._start_time = time.time()
        
        temp_dir = self.output_dir / f"{output_file}_segments"
        temp_dir.mkdir(exist_ok=True)
        
        segment_files = []
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def download_with_semaphore(idx: int, url: str):
            async with semaphore:
                segment_path = temp_dir / f"segment_{idx:05d}.mp4"
                async with aiohttp.ClientSession(cookies=self.cookies) as session:
                    success = await self.download_segment_async(session, url, str(segment_path))
                    if success:
                        self.progress.downloaded_segments += 1
                        return segment_path
                return None
        
        print(f"[DL] Downloading {len(urls)} segments (async, {max_concurrent} concurrent)...")
        
        tasks = [download_with_semaphore(i, url) for i, url in enumerate(urls)]
        results = await asyncio.gather(*tasks)
        
        segment_files = [r for r in results if r is not None]
        
        if not segment_files:
            return DownloadResult(success=False, error="No segments downloaded")
        
        if combine:
            output_path = self.output_dir / f"{output_file}.mp4"
            print(f"[DL] Combining {len(segment_files)} segments...")
            
            with open(output_path, 'wb') as outfile:
                for seg_file in sorted(segment_files):
                    with open(seg_file, 'rb') as infile:
                        outfile.write(infile.read())
            
            # Cleanup
            for seg_file in segment_files:
                try:
                    seg_file.unlink()
                except:
                    pass
            try:
                temp_dir.rmdir()
            except:
                pass
            
            file_size = output_path.stat().st_size
            print(f"[DL] Saved: {output_path} ({file_size / (1024*1024):.2f} MB)")
            
            return DownloadResult(
                success=True,
                file_path=str(output_path),
                file_size=file_size,
                segments_downloaded=len(segment_files)
            )
        else:
            return DownloadResult(
                success=True,
                file_path=str(temp_dir),
                file_size=self.progress.downloaded_bytes,
                segments_downloaded=len(segment_files)
            )
    
    def download_file(self, url: str, output_path: str) -> bool:
        """
        Download a single file (e.g., subtitle).
        
        Args:
            url: File URL
            output_path: Where to save
            
        Returns:
            True if successful
        """
        try:
            resp = requests.get(
                url,
                headers=self.headers,
                cookies=self.cookies,
                timeout=60
            )
            
            if resp.status_code == 200:
                with open(output_path, 'wb') as f:
                    f.write(resp.content)
                return True
            return False
            
        except Exception as e:
            print(f"[DL] File download error: {e}")
            return False


def print_progress(progress: DownloadProgress):
    """Default progress callback - prints to console."""
    print(f"\r    Progress: {progress.downloaded_segments}/{progress.total_segments} "
          f"({progress.percent:.1f}%) - {progress.downloaded_mb:.2f} MB "
          f"@ {progress.speed_mbps:.2f} Mbps", end='')

