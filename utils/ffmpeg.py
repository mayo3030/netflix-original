"""
FFmpeg Wrapper
===============
Handles video decryption and muxing using FFmpeg.
"""

import os
import subprocess
import shutil
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass


@dataclass
class FFmpegResult:
    """Result of FFmpeg operation."""
    success: bool
    output_path: str = ""
    error: str = ""
    duration: float = 0.0


class FFmpegWrapper:
    """
    Wrapper for FFmpeg operations.
    
    Handles:
    - Decryption of CENC encrypted video
    - Muxing video, audio, and subtitles
    - Format conversion
    """
    
    def __init__(self, ffmpeg_path: str = "ffmpeg"):
        """
        Initialize FFmpeg wrapper.
        
        Args:
            ffmpeg_path: Path to ffmpeg binary
        """
        self.ffmpeg_path = ffmpeg_path
        self.ffprobe_path = ffmpeg_path.replace("ffmpeg", "ffprobe")
        
        # Verify FFmpeg is available
        self._verify_ffmpeg()
    
    def _verify_ffmpeg(self):
        """Check if FFmpeg is installed and accessible."""
        try:
            result = subprocess.run(
                [self.ffmpeg_path, "-version"],
                capture_output=True,
                text=True
            )
            if result.returncode == 0:
                version_line = result.stdout.split('\n')[0]
                print(f"[FFmpeg] {version_line}")
                return True
        except FileNotFoundError:
            pass
        
        # Try to find FFmpeg in common locations
        common_paths = [
            "ffmpeg",
            "C:/ffmpeg/bin/ffmpeg.exe",
            "C:/Program Files/ffmpeg/bin/ffmpeg.exe",
            "/usr/bin/ffmpeg",
            "/usr/local/bin/ffmpeg"
        ]
        
        for path in common_paths:
            if shutil.which(path):
                self.ffmpeg_path = path
                self.ffprobe_path = path.replace("ffmpeg", "ffprobe")
                return True
        
        print("[FFmpeg] WARNING: FFmpeg not found!")
        return False
    
    def decrypt(self, 
                input_path: str, 
                output_path: str, 
                key: str,
                kid: str = None) -> FFmpegResult:
        """
        Decrypt CENC encrypted video using FFmpeg.
        
        Args:
            input_path: Path to encrypted video
            output_path: Path for decrypted output
            key: Decryption key (hex)
            kid: Key ID (hex, optional)
            
        Returns:
            FFmpegResult object
        """
        if not os.path.exists(input_path):
            return FFmpegResult(success=False, error=f"Input file not found: {input_path}")
        
        # Build decryption key option
        if kid:
            decryption_key = f"{kid}:{key}"
        else:
            decryption_key = key
        
        cmd = [
            self.ffmpeg_path,
            "-y",  # Overwrite output
            "-decryption_key", decryption_key,
            "-i", input_path,
            "-c", "copy",  # Copy streams without re-encoding
            output_path
        ]
        
        print(f"[FFmpeg] Decrypting: {os.path.basename(input_path)}")
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True
            )
            
            if result.returncode == 0 and os.path.exists(output_path):
                size_mb = os.path.getsize(output_path) / (1024 * 1024)
                print(f"[FFmpeg] Decrypted: {os.path.basename(output_path)} ({size_mb:.2f} MB)")
                return FFmpegResult(success=True, output_path=output_path)
            else:
                error = result.stderr[-500:] if result.stderr else "Unknown error"
                print(f"[FFmpeg] Decryption failed: {error}")
                return FFmpegResult(success=False, error=error)
                
        except Exception as e:
            return FFmpegResult(success=False, error=str(e))
    
    def mux(self,
            video_path: str,
            audio_path: str,
            output_path: str,
            subtitle_paths: List[str] = None,
            metadata: Dict[str, str] = None) -> FFmpegResult:
        """
        Mux video, audio, and subtitles into single file.
        
        Args:
            video_path: Path to video file
            audio_path: Path to audio file
            output_path: Output file path
            subtitle_paths: List of subtitle file paths
            metadata: Metadata to embed (title, year, etc.)
            
        Returns:
            FFmpegResult object
        """
        cmd = [self.ffmpeg_path, "-y"]
        
        # Add inputs
        cmd.extend(["-i", video_path])
        cmd.extend(["-i", audio_path])
        
        if subtitle_paths:
            for sub_path in subtitle_paths:
                if os.path.exists(sub_path):
                    cmd.extend(["-i", sub_path])
        
        # Map streams
        cmd.extend(["-map", "0:v:0"])  # Video from first input
        cmd.extend(["-map", "1:a:0"])  # Audio from second input
        
        if subtitle_paths:
            for i in range(len(subtitle_paths)):
                cmd.extend(["-map", f"{i+2}:s:0"])  # Subtitles
        
        # Copy codecs (no re-encoding)
        cmd.extend(["-c", "copy"])
        
        # Add metadata
        if metadata:
            for key, value in metadata.items():
                cmd.extend(["-metadata", f"{key}={value}"])
        
        cmd.append(output_path)
        
        print(f"[FFmpeg] Muxing: {os.path.basename(output_path)}")
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True
            )
            
            if result.returncode == 0 and os.path.exists(output_path):
                size_mb = os.path.getsize(output_path) / (1024 * 1024)
                print(f"[FFmpeg] Muxed: {os.path.basename(output_path)} ({size_mb:.2f} MB)")
                return FFmpegResult(success=True, output_path=output_path)
            else:
                error = result.stderr[-500:] if result.stderr else "Unknown error"
                return FFmpegResult(success=False, error=error)
                
        except Exception as e:
            return FFmpegResult(success=False, error=str(e))
    
    def remux(self, input_path: str, output_path: str) -> FFmpegResult:
        """
        Remux file to fix container issues.
        
        Args:
            input_path: Input file
            output_path: Output file
            
        Returns:
            FFmpegResult object
        """
        cmd = [
            self.ffmpeg_path,
            "-y",
            "-i", input_path,
            "-c", "copy",
            output_path
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True
            )
            
            if result.returncode == 0 and os.path.exists(output_path):
                return FFmpegResult(success=True, output_path=output_path)
            else:
                return FFmpegResult(success=False, error=result.stderr[-500:])
                
        except Exception as e:
            return FFmpegResult(success=False, error=str(e))
    
    def get_duration(self, file_path: str) -> float:
        """
        Get duration of a video file in seconds.
        
        Args:
            file_path: Path to video file
            
        Returns:
            Duration in seconds or 0 on error
        """
        cmd = [
            self.ffprobe_path,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True
            )
            
            if result.returncode == 0:
                return float(result.stdout.strip())
        except:
            pass
        
        return 0.0
    
    def get_video_info(self, file_path: str) -> Dict:
        """
        Get video file information.
        
        Args:
            file_path: Path to video file
            
        Returns:
            Dict with video info
        """
        cmd = [
            self.ffprobe_path,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            file_path
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True
            )
            
            if result.returncode == 0:
                import json
                return json.loads(result.stdout)
        except:
            pass
        
        return {}
    
    def convert_subtitles(self, 
                          input_path: str, 
                          output_path: str,
                          format: str = "srt") -> FFmpegResult:
        """
        Convert subtitle format.
        
        Args:
            input_path: Input subtitle file
            output_path: Output file path
            format: Target format (srt, vtt, ass)
            
        Returns:
            FFmpegResult object
        """
        cmd = [
            self.ffmpeg_path,
            "-y",
            "-i", input_path,
            output_path
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True
            )
            
            if result.returncode == 0 and os.path.exists(output_path):
                return FFmpegResult(success=True, output_path=output_path)
            else:
                return FFmpegResult(success=False, error=result.stderr[-500:])
                
        except Exception as e:
            return FFmpegResult(success=False, error=str(e))


def decrypt_with_keys(input_path: str, 
                      output_path: str, 
                      keys: Dict[str, str],
                      ffmpeg_path: str = "ffmpeg") -> bool:
    """
    Decrypt file using multiple keys.
    
    Args:
        input_path: Encrypted video path
        output_path: Decrypted output path
        keys: Dict mapping KID to Key
        ffmpeg_path: Path to ffmpeg
        
    Returns:
        True if successful
    """
    wrapper = FFmpegWrapper(ffmpeg_path)
    
    # Try each key until one works
    for kid, key in keys.items():
        result = wrapper.decrypt(input_path, output_path, key, kid)
        if result.success:
            return True
    
    # Try without KID
    for key in keys.values():
        result = wrapper.decrypt(input_path, output_path, key)
        if result.success:
            return True
    
    return False

