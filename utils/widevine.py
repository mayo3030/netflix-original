"""
Widevine DRM Integration
=========================
Handles Widevine license acquisition and key extraction using pywidevine.
"""

import base64
import os
from dataclasses import dataclass
from typing import List, Optional, Dict, Any, Callable
from pathlib import Path

try:
    from pywidevine.cdm import Cdm
    from pywidevine.device import Device
    from pywidevine.pssh import PSSH
    PYWIDEVINE_AVAILABLE = True
except ImportError:
    PYWIDEVINE_AVAILABLE = False
    print("[WARN] pywidevine not installed. DRM decryption will not work.")


@dataclass
class ContentKey:
    """Decrypted content key."""
    kid: str  # Key ID (hex)
    key: str  # Key (hex)
    type: str  # CONTENT, SIGNING, etc.
    
    def __str__(self) -> str:
        return f"{self.kid}:{self.key}"


class WidevineCDM:
    """
    Widevine Content Decryption Module wrapper.
    
    Uses pywidevine to handle Widevine DRM.
    """
    
    def __init__(self, device_path: str = None):
        """
        Initialize Widevine CDM.
        
        Args:
            device_path: Path to .wvd device file
        """
        if not PYWIDEVINE_AVAILABLE:
            raise RuntimeError("pywidevine is not installed")
        
        self.device_path = device_path
        self.device: Optional[Device] = None
        self.cdm: Optional[Cdm] = None
        self.session_id: Optional[bytes] = None
        self.keys: List[ContentKey] = []
        
        if device_path:
            self.load_device(device_path)
    
    def load_device(self, device_path: str) -> bool:
        """
        Load a Widevine device from .wvd file.
        
        Args:
            device_path: Path to .wvd file
            
        Returns:
            True if loaded successfully
        """
        try:
            path = Path(device_path)
            if not path.exists():
                print(f"[WV] Device file not found: {device_path}")
                return False
            
            self.device = Device.load(path)
            self.cdm = Cdm.from_device(self.device)
            print(f"[WV] Loaded device: {self.device.system_id}")
            return True
            
        except Exception as e:
            print(f"[WV] Failed to load device: {e}")
            return False
    
    def open_session(self) -> bool:
        """
        Open a CDM session.
        
        Returns:
            True if session opened successfully
        """
        if not self.cdm:
            print("[WV] CDM not initialized")
            return False
        
        try:
            self.session_id = self.cdm.open()
            print(f"[WV] Opened session: {self.session_id.hex()[:16]}...")
            return True
        except Exception as e:
            print(f"[WV] Failed to open session: {e}")
            return False
    
    def close_session(self):
        """Close the CDM session."""
        if self.cdm and self.session_id:
            try:
                self.cdm.close(self.session_id)
                print("[WV] Session closed")
            except:
                pass
        self.session_id = None
        self.keys = []
    
    def get_license_challenge(self, pssh: str) -> Optional[bytes]:
        """
        Generate a license challenge for the given PSSH.
        
        Args:
            pssh: PSSH data (base64 or hex)
            
        Returns:
            License challenge bytes or None
        """
        if not self.cdm or not self.session_id:
            print("[WV] No active session")
            return None
        
        try:
            # Parse PSSH
            if pssh.startswith('AAAA'):
                # Base64
                pssh_obj = PSSH(pssh)
            else:
                # Assume hex
                pssh_bytes = bytes.fromhex(pssh)
                pssh_obj = PSSH(base64.b64encode(pssh_bytes).decode())
            
            # Generate challenge
            challenge = self.cdm.get_license_challenge(self.session_id, pssh_obj)
            print(f"[WV] Generated challenge ({len(challenge)} bytes)")
            return challenge
            
        except Exception as e:
            print(f"[WV] Failed to generate challenge: {e}")
            return None
    
    def parse_license(self, license_response: bytes) -> List[ContentKey]:
        """
        Parse license response and extract content keys.
        
        Args:
            license_response: License response bytes from server
            
        Returns:
            List of ContentKey objects
        """
        if not self.cdm or not self.session_id:
            print("[WV] No active session")
            return []
        
        try:
            self.cdm.parse_license(self.session_id, license_response)
            
            self.keys = []
            for key in self.cdm.get_keys(self.session_id):
                content_key = ContentKey(
                    kid=key.kid.hex,
                    key=key.key.hex(),
                    type=str(key.type)
                )
                self.keys.append(content_key)
                print(f"[WV] Key [{key.type}]: {content_key.kid}:{content_key.key}")
            
            return self.keys
            
        except Exception as e:
            print(f"[WV] Failed to parse license: {e}")
            return []
    
    def get_content_key(self) -> Optional[str]:
        """
        Get the main content decryption key.
        
        Returns:
            Key in hex format (for ffmpeg) or None
        """
        for key in self.keys:
            if 'CONTENT' in key.type.upper():
                return key.key
        
        # Return first key if no CONTENT key found
        if self.keys:
            return self.keys[0].key
        
        return None
    
    def get_all_keys_for_ffmpeg(self) -> Dict[str, str]:
        """
        Get all keys formatted for ffmpeg decryption.
        
        Returns:
            Dict mapping KID to Key
        """
        return {key.kid: key.key for key in self.keys}


class WidevineDecryptor:
    """
    High-level interface for Widevine decryption.
    """
    
    def __init__(self, device_path: str, license_callback: Callable[[bytes], bytes]):
        """
        Initialize decryptor.
        
        Args:
            device_path: Path to .wvd device file
            license_callback: Function to get license from server
        """
        self.cdm = WidevineCDM(device_path)
        self.license_callback = license_callback
    
    def get_decryption_keys(self, pssh: str) -> Dict[str, str]:
        """
        Get decryption keys for a PSSH.
        
        Args:
            pssh: PSSH data (base64)
            
        Returns:
            Dict mapping KID to Key
        """
        if not self.cdm.open_session():
            return {}
        
        try:
            # Generate challenge
            challenge = self.cdm.get_license_challenge(pssh)
            if not challenge:
                return {}
            
            # Get license from server
            license_response = self.license_callback(challenge)
            if not license_response:
                return {}
            
            # Parse license
            self.cdm.parse_license(license_response)
            
            return self.cdm.get_all_keys_for_ffmpeg()
            
        finally:
            self.cdm.close_session()


def check_device_file(device_path: str) -> Dict[str, Any]:
    """
    Check if a device file is valid and get its info.
    
    Args:
        device_path: Path to .wvd file
        
    Returns:
        Dict with device info or error
    """
    if not PYWIDEVINE_AVAILABLE:
        return {'valid': False, 'error': 'pywidevine not installed'}
    
    try:
        device = Device.load(device_path)
        return {
            'valid': True,
            'system_id': device.system_id,
            'security_level': device.security_level,
            'type': str(device.type)
        }
    except Exception as e:
        return {'valid': False, 'error': str(e)}


def list_available_devices(devices_dir: str = 'devices') -> List[Dict]:
    """
    List all .wvd device files in a directory.
    
    Args:
        devices_dir: Directory to search
        
    Returns:
        List of device info dicts
    """
    devices = []
    
    path = Path(devices_dir)
    if not path.exists():
        return devices
    
    for wvd_file in path.glob('*.wvd'):
        info = check_device_file(str(wvd_file))
        info['file'] = wvd_file.name
        info['path'] = str(wvd_file)
        devices.append(info)
    
    return devices

