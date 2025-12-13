"""
Netflix MSL Client
===================
Handles Netflix Message Security Layer communication.
"""

import base64
import json
import os
import time
import gzip
from typing import Dict, List, Optional, Any
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Random import get_random_bytes
import requests

from .crypto import MSLCrypto


class MSLClient:
    """
    Netflix MSL (Message Security Layer) Client.
    
    Handles key exchange, manifest requests, and license acquisition.
    """
    
    MANIFEST_ENDPOINT = "https://www.netflix.com/nq/msl_v1/cadmium/pbo_manifests/%5E1.0.0/router"
    LICENSE_ENDPOINT = "https://www.netflix.com/nq/msl_v1/cadmium/pbo_licenses/%5E1.0.0/router"
    
    # Netflix API endpoints
    SHAKTI_ENDPOINT = "https://www.netflix.com/api/shakti"
    
    def __init__(self, cookies: List[Dict], esn: str = None):
        """
        Initialize MSL client.
        
        Args:
            cookies: Netflix session cookies
            esn: Electronic Serial Number (device identifier)
        """
        self.cookies = {c['name']: c['value'] for c in cookies}
        self.esn = esn or self._generate_esn()
        self.crypto = MSLCrypto()
        
        # Session
        self.session = requests.Session()
        self.session.cookies.update(self.cookies)
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://www.netflix.com',
            'Referer': 'https://www.netflix.com/'
        })
        
        # MSL state
        self.mastertoken = None
        self.sequence_number = 0
        self.encryption_key = None
        self.sign_key = None
        
        # RSA keypair for key exchange
        self.rsa_key = RSA.generate(2048)
    
    def _generate_esn(self) -> str:
        """Generate a Chrome ESN for Windows."""
        # Chrome ESN format: NFCDCH-02-{random}
        import random
        import string
        random_part = ''.join(random.choices(string.ascii_uppercase + string.digits, k=30))
        return f"NFCDCH-02-{random_part}"
    
    def get_build_identifier(self) -> str:
        """Get Netflix BUILD_IDENTIFIER from homepage."""
        try:
            resp = self.session.get("https://www.netflix.com/browse")
            import re
            match = re.search(r'"BUILD_IDENTIFIER":"([^"]+)"', resp.text)
            if match:
                return match.group(1)
        except:
            pass
        return "v1234567890"  # Fallback
    
    def _create_header(self, is_handshake: bool = False) -> Dict:
        """Create MSL message header."""
        header = {
            'sender': self.esn,
            'renewable': True,
            'capabilities': {
                'languages': ['en-US'],
                'compressionalgos': ['gzip']
            }
        }
        
        if is_handshake:
            # Key exchange header
            header['keyrequestdata'] = [{
                'scheme': 'ASYMMETRIC_WRAPPED',
                'keydata': {
                    'keypairid': 'rsaKeypairId',
                    'mechanism': 'JWK_RSA',
                    'publickey': self._get_public_key_b64()
                }
            }]
        elif self.mastertoken:
            header['mastertoken'] = self.mastertoken
        
        return header
    
    def _get_public_key_b64(self) -> str:
        """Get RSA public key in base64 JWK format."""
        public_key = self.rsa_key.publickey()
        n = base64.urlsafe_b64encode(
            public_key.n.to_bytes((public_key.n.bit_length() + 7) // 8, 'big')
        ).decode().rstrip('=')
        e = base64.urlsafe_b64encode(
            public_key.e.to_bytes((public_key.e.bit_length() + 7) // 8, 'big')
        ).decode().rstrip('=')
        
        return json.dumps({
            'kty': 'RSA',
            'n': n,
            'e': e
        })
    
    def _decrypt_key_data(self, wrapped_key: str) -> bytes:
        """Decrypt wrapped key using RSA private key."""
        cipher = PKCS1_OAEP.new(self.rsa_key)
        encrypted = base64.b64decode(wrapped_key)
        return cipher.decrypt(encrypted)
    
    def handshake(self) -> bool:
        """
        Perform MSL handshake to establish encryption keys.
        
        Returns:
            True if handshake successful
        """
        print("[MSL] Performing handshake...")
        
        # Create handshake message
        header = self._create_header(is_handshake=True)
        header_b64 = base64.b64encode(json.dumps(header).encode()).decode()
        
        # Empty payload for handshake
        payload = {
            'messageid': int(time.time() * 1000),
            'data': ''
        }
        payload_b64 = base64.b64encode(json.dumps(payload).encode()).decode()
        
        # Create message
        message = {
            'headerdata': header_b64,
            'signature': '',
            'mastertoken': None
        }
        
        try:
            resp = self.session.post(
                self.MANIFEST_ENDPOINT,
                json=message,
                timeout=30
            )
            
            if resp.status_code != 200:
                print(f"[MSL] Handshake failed: HTTP {resp.status_code}")
                return False
            
            # Parse response
            response_data = resp.json()
            
            # Extract master token and keys from response
            if 'headerdata' in response_data:
                header_data = json.loads(base64.b64decode(response_data['headerdata']))
                
                if 'keyresponsedata' in header_data:
                    key_response = header_data['keyresponsedata']
                    
                    # Decrypt encryption key
                    if 'keydata' in key_response:
                        key_data = key_response['keydata']
                        
                        if 'encryptionkey' in key_data:
                            self.encryption_key = self._decrypt_key_data(key_data['encryptionkey'])
                            self.crypto.encryption_key = self.encryption_key
                        
                        if 'hmackey' in key_data:
                            self.sign_key = self._decrypt_key_data(key_data['hmackey'])
                            self.crypto.sign_key = self.sign_key
                
                if 'mastertoken' in header_data:
                    self.mastertoken = header_data['mastertoken']
                    print("[MSL] Handshake successful - got master token")
                    return True
            
            print("[MSL] Handshake response did not contain expected data")
            return False
            
        except Exception as e:
            print(f"[MSL] Handshake error: {e}")
            return False
    
    def get_manifest(self, title_id: str, profiles: List[str] = None) -> Optional[Dict]:
        """
        Request manifest for a title.
        
        Args:
            title_id: Netflix title ID
            profiles: Video/audio profiles to request
            
        Returns:
            Manifest dict or None on failure
        """
        if not profiles:
            profiles = [
                # Video profiles
                'playready-h264mpl30-dash',
                'playready-h264mpl31-dash',
                'playready-h264mpl40-dash',
                'playready-h264hpl30-dash',
                'playready-h264hpl31-dash',
                'playready-h264hpl40-dash',
                # Audio profiles
                'heaac-2-dash',
                'heaac-5.1-dash',
                'ddplus-5.1-dash',
                'ddplus-atmos-dash',
                # Subtitles
                'webvtt-lssdh-ios8',
                'dfxp-ls-sdh'
            ]
        
        manifest_request = {
            'version': 2,
            'url': f'/manifest?{title_id}',
            'id': int(time.time() * 10000),
            'esn': self.esn,
            'languages': ['en-US'],
            'uiVersion': 'shakti-v4bf615c3',
            'clientVersion': '6.0026.291.011',
            'params': {
                'type': 'standard',
                'viewableId': int(title_id),
                'profiles': profiles,
                'flavor': 'STANDARD',
                'drmType': 'widevine',
                'drmVersion': 25,
                'usePsshBox': True,
                'isBranching': False,
                'useHttpsStreams': True,
                'supportsPreReleasePin': True,
                'supportsWatermark': True,
                'showAllSubDubTracks': False,
                'titleSpecificData': {
                    str(title_id): {
                        'unletterboxed': True
                    }
                },
                'videoOutputInfo': [{
                    'type': 'DigitalVideoOutputDescriptor',
                    'outputType': 'unknown',
                    'supportedHdcpVersions': ['2.2'],
                    'isHdcpEngaged': True
                }],
                'preferAssistiveAudio': False,
                'isNonMember': False
            }
        }
        
        print(f"[MSL] Requesting manifest for title {title_id}...")
        
        try:
            # For now, use simpler approach - direct API call
            # Full MSL encryption requires successful handshake
            
            resp = self.session.post(
                self.MANIFEST_ENDPOINT,
                json=manifest_request,
                timeout=60
            )
            
            if resp.status_code == 200:
                data = resp.content
                
                # Check if gzipped
                if data[:2] == b'\x1f\x8b':
                    data = gzip.decompress(data)
                
                try:
                    manifest = json.loads(data)
                    print(f"[MSL] Received manifest ({len(data)} bytes)")
                    return manifest
                except json.JSONDecodeError:
                    # Might be MSL encrypted
                    print(f"[MSL] Received encrypted manifest ({len(data)} bytes)")
                    return {'raw': base64.b64encode(data).decode()}
            else:
                print(f"[MSL] Manifest request failed: HTTP {resp.status_code}")
                return None
                
        except Exception as e:
            print(f"[MSL] Manifest error: {e}")
            return None
    
    def get_license(self, challenge: bytes, session_id: str) -> Optional[bytes]:
        """
        Request Widevine license.
        
        Args:
            challenge: Widevine license challenge
            session_id: CDM session ID
            
        Returns:
            License response bytes or None
        """
        license_request = {
            'version': 2,
            'url': '/license',
            'id': int(time.time() * 10000),
            'esn': self.esn,
            'languages': ['en-US'],
            'uiVersion': 'shakti-v4bf615c3',
            'clientVersion': '6.0026.291.011',
            'params': [{
                'sessionId': base64.b64encode(session_id.encode() if isinstance(session_id, str) else session_id).decode(),
                'clientTime': int(time.time()),
                'challengeBase64': base64.b64encode(challenge).decode(),
                'xid': str(int(time.time() * 1000))
            }],
            'echo': 'sessionId'
        }
        
        print("[MSL] Requesting Widevine license...")
        
        try:
            resp = self.session.post(
                self.LICENSE_ENDPOINT,
                json=license_request,
                timeout=30
            )
            
            if resp.status_code == 200:
                data = resp.json()
                
                if isinstance(data, list) and len(data) > 0:
                    if 'licenseResponseBase64' in data[0]:
                        license_b64 = data[0]['licenseResponseBase64']
                        print("[MSL] Received license response")
                        return base64.b64decode(license_b64)
                    elif 'error' in data[0]:
                        print(f"[MSL] License error: {data[0]['error']}")
                
                return None
            else:
                print(f"[MSL] License request failed: HTTP {resp.status_code}")
                return None
                
        except Exception as e:
            print(f"[MSL] License error: {e}")
            return None
    
    def get_metadata(self, title_id: str) -> Optional[Dict]:
        """
        Get title metadata from Netflix Shakti API.
        
        Args:
            title_id: Netflix title ID
            
        Returns:
            Metadata dict or None
        """
        build_id = self.get_build_identifier()
        
        url = f"https://www.netflix.com/api/shakti/{build_id}/metadata"
        params = {
            'movieid': title_id,
            '_': int(time.time() * 1000)
        }
        
        try:
            resp = self.session.get(url, params=params, timeout=30)
            
            if resp.status_code == 200:
                return resp.json()
            else:
                print(f"[MSL] Metadata request failed: HTTP {resp.status_code}")
                return None
                
        except Exception as e:
            print(f"[MSL] Metadata error: {e}")
            return None

