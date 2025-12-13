"""
Netflix Manifest Parser
========================
Parses Netflix manifests to extract video/audio URLs and PSSH.
"""

import base64
import re
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
from xml.etree import ElementTree as ET


@dataclass
class VideoTrack:
    """Video track information."""
    track_id: str
    width: int
    height: int
    bitrate: int
    codec: str
    profile: str = ""
    urls: List[str] = field(default_factory=list)
    init_url: str = ""
    pssh: str = ""
    content_type: str = "video"
    
    @property
    def resolution(self) -> str:
        return f"{self.width}x{self.height}"
    
    @property
    def quality(self) -> str:
        if self.height >= 2160:
            return "4K"
        elif self.height >= 1080:
            return "1080p"
        elif self.height >= 720:
            return "720p"
        elif self.height >= 480:
            return "480p"
        else:
            return f"{self.height}p"


@dataclass
class AudioTrack:
    """Audio track information."""
    track_id: str
    language: str
    bitrate: int
    codec: str
    channels: str = "2.0"
    urls: List[str] = field(default_factory=list)
    init_url: str = ""
    content_type: str = "audio"


@dataclass
class SubtitleTrack:
    """Subtitle track information."""
    track_id: str
    language: str
    language_code: str
    format: str  # webvtt, dfxp
    urls: List[str] = field(default_factory=list)
    is_forced: bool = False
    content_type: str = "subtitle"


@dataclass
class ParsedManifest:
    """Complete parsed manifest."""
    title_id: str
    video_tracks: List[VideoTrack] = field(default_factory=list)
    audio_tracks: List[AudioTrack] = field(default_factory=list)
    subtitle_tracks: List[SubtitleTrack] = field(default_factory=list)
    pssh: str = ""
    license_url: str = ""
    duration_seconds: int = 0


class ManifestParser:
    """
    Parses Netflix manifest responses.
    
    Supports:
    - Netflix JSON manifest (MSL response)
    - DASH MPD manifest
    """
    
    @staticmethod
    def parse_netflix_manifest(manifest: Dict) -> ParsedManifest:
        """
        Parse Netflix JSON manifest from MSL response.
        
        Args:
            manifest: Netflix manifest dict
            
        Returns:
            ParsedManifest object
        """
        result = ParsedManifest(title_id="")
        
        # Handle raw/encrypted manifest
        if 'raw' in manifest:
            # Encrypted manifest - can't parse without decryption
            return result
        
        # Get PSSH
        if 'drmContextId' in manifest:
            # PSSH might be in drmContextId or separate field
            pass
        
        # Extract from video_tracks
        if 'video_tracks' in manifest:
            for track in manifest['video_tracks']:
                track_id = track.get('downloadableId', str(track.get('bitrate', '')))
                
                for stream in track.get('streams', []):
                    video = VideoTrack(
                        track_id=str(track_id),
                        width=stream.get('res_w', 0),
                        height=stream.get('res_h', 0),
                        bitrate=stream.get('bitrate', 0),
                        codec=stream.get('content_profile', ''),
                        profile=stream.get('profile', ''),
                        urls=stream.get('urls', [])
                    )
                    
                    # Extract PSSH if present
                    if 'pssh' in stream:
                        video.pssh = stream['pssh']
                        result.pssh = stream['pssh']
                    
                    result.video_tracks.append(video)
        
        # Extract from audio_tracks
        if 'audio_tracks' in manifest:
            for track in manifest['audio_tracks']:
                track_id = track.get('downloadableId', '')
                language = track.get('language', 'unknown')
                
                for stream in track.get('streams', []):
                    audio = AudioTrack(
                        track_id=str(track_id),
                        language=language,
                        bitrate=stream.get('bitrate', 0),
                        codec=stream.get('content_profile', ''),
                        channels=stream.get('channels', '2.0'),
                        urls=stream.get('urls', [])
                    )
                    result.audio_tracks.append(audio)
        
        # Extract from timedtext_tracks (subtitles)
        if 'timedtext_tracks' in manifest:
            for track in manifest['timedtext_tracks']:
                subtitle = SubtitleTrack(
                    track_id=track.get('trackId', ''),
                    language=track.get('language', 'unknown'),
                    language_code=track.get('bcp47', ''),
                    format=track.get('profile', 'webvtt'),
                    is_forced=track.get('isForced', False),
                    urls=track.get('urls', []) or [track.get('url', '')]
                )
                result.subtitle_tracks.append(subtitle)
        
        # Get license URL
        if 'links' in manifest and 'license' in manifest['links']:
            result.license_url = manifest['links']['license'].get('href', '')
        
        # Get duration
        if 'runtime' in manifest:
            result.duration_seconds = manifest.get('runtime', 0)
        
        return result
    
    @staticmethod
    def parse_mpd(mpd_content: str) -> ParsedManifest:
        """
        Parse DASH MPD manifest.
        
        Args:
            mpd_content: MPD XML string
            
        Returns:
            ParsedManifest object
        """
        result = ParsedManifest(title_id="")
        
        # Parse XML
        namespaces = {
            'mpd': 'urn:mpeg:dash:schema:mpd:2011',
            'cenc': 'urn:mpeg:cenc:2013'
        }
        
        try:
            root = ET.fromstring(mpd_content)
        except ET.ParseError:
            return result
        
        # Find all AdaptationSets
        for adaptation in root.findall('.//mpd:AdaptationSet', namespaces) or root.findall('.//AdaptationSet'):
            content_type = adaptation.get('contentType', '')
            mime_type = adaptation.get('mimeType', '')
            
            # Determine content type
            if 'video' in content_type or 'video' in mime_type:
                ManifestParser._parse_video_adaptation(adaptation, result, namespaces)
            elif 'audio' in content_type or 'audio' in mime_type:
                ManifestParser._parse_audio_adaptation(adaptation, result, namespaces)
            elif 'text' in content_type or 'text' in mime_type:
                ManifestParser._parse_subtitle_adaptation(adaptation, result, namespaces)
        
        # Extract PSSH from ContentProtection
        for protection in root.findall('.//cenc:pssh', namespaces) or root.findall('.//{urn:mpeg:cenc:2013}pssh'):
            if protection.text:
                result.pssh = protection.text.strip()
                break
        
        return result
    
    @staticmethod
    def _parse_video_adaptation(adaptation: ET.Element, result: ParsedManifest, namespaces: dict):
        """Parse video AdaptationSet."""
        representations = adaptation.findall('.//mpd:Representation', namespaces) or adaptation.findall('.//Representation')
        
        for rep in representations:
            track = VideoTrack(
                track_id=rep.get('id', ''),
                width=int(rep.get('width', 0)),
                height=int(rep.get('height', 0)),
                bitrate=int(rep.get('bandwidth', 0)),
                codec=rep.get('codecs', ''),
                profile=rep.get('mimeType', '')
            )
            
            # Get segment URLs
            segment_template = rep.find('.//mpd:SegmentTemplate', namespaces) or rep.find('.//SegmentTemplate')
            if segment_template is not None:
                track.init_url = segment_template.get('initialization', '')
                media_template = segment_template.get('media', '')
                # Store template for later resolution
                track.urls = [media_template]
            
            base_url = rep.find('.//mpd:BaseURL', namespaces) or rep.find('.//BaseURL')
            if base_url is not None and base_url.text:
                track.urls.append(base_url.text)
            
            result.video_tracks.append(track)
    
    @staticmethod
    def _parse_audio_adaptation(adaptation: ET.Element, result: ParsedManifest, namespaces: dict):
        """Parse audio AdaptationSet."""
        language = adaptation.get('lang', 'unknown')
        representations = adaptation.findall('.//mpd:Representation', namespaces) or adaptation.findall('.//Representation')
        
        for rep in representations:
            track = AudioTrack(
                track_id=rep.get('id', ''),
                language=language,
                bitrate=int(rep.get('bandwidth', 0)),
                codec=rep.get('codecs', ''),
                channels=rep.get('audioChannelConfiguration', {}).get('value', '2')
            )
            
            base_url = rep.find('.//mpd:BaseURL', namespaces) or rep.find('.//BaseURL')
            if base_url is not None and base_url.text:
                track.urls.append(base_url.text)
            
            result.audio_tracks.append(track)
    
    @staticmethod
    def _parse_subtitle_adaptation(adaptation: ET.Element, result: ParsedManifest, namespaces: dict):
        """Parse subtitle AdaptationSet."""
        language = adaptation.get('lang', 'unknown')
        representations = adaptation.findall('.//mpd:Representation', namespaces) or adaptation.findall('.//Representation')
        
        for rep in representations:
            track = SubtitleTrack(
                track_id=rep.get('id', ''),
                language=language,
                language_code=language,
                format=rep.get('mimeType', 'text/vtt')
            )
            
            base_url = rep.find('.//mpd:BaseURL', namespaces) or rep.find('.//BaseURL')
            if base_url is not None and base_url.text:
                track.urls.append(base_url.text)
            
            result.subtitle_tracks.append(track)
    
    @staticmethod
    def extract_pssh(data: bytes) -> Optional[str]:
        """
        Extract PSSH box from MP4 init segment.
        
        Args:
            data: MP4 init segment bytes
            
        Returns:
            Base64 encoded PSSH or None
        """
        # PSSH box type
        PSSH_BOX = b'pssh'
        
        pos = 0
        while pos < len(data) - 8:
            box_size = int.from_bytes(data[pos:pos+4], 'big')
            box_type = data[pos+4:pos+8]
            
            if box_size == 0:
                break
            
            if box_type == PSSH_BOX:
                pssh_data = data[pos:pos+box_size]
                return base64.b64encode(pssh_data).decode()
            
            pos += box_size
        
        return None
    
    @staticmethod
    def sort_video_by_quality(tracks: List[VideoTrack]) -> List[VideoTrack]:
        """Sort video tracks by bitrate (highest first)."""
        return sorted(tracks, key=lambda t: t.bitrate, reverse=True)
    
    @staticmethod
    def filter_video_by_resolution(tracks: List[VideoTrack], max_height: int = 9999) -> List[VideoTrack]:
        """Filter video tracks by maximum resolution."""
        return [t for t in tracks if t.height <= max_height]

