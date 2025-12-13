"""
MSL Cryptographic Operations
=============================
Handles encryption/decryption for MSL protocol.
"""

import base64
import json
import os
from typing import Dict, Tuple, Optional
from Crypto.Cipher import AES
from Crypto.Hash import HMAC, SHA256
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad, unpad


class MSLCrypto:
    """Handles MSL encryption and decryption."""
    
    def __init__(self):
        self.encryption_key: Optional[bytes] = None
        self.sign_key: Optional[bytes] = None
        self.hmac_key: Optional[bytes] = None
    
    def set_keys(self, encryption_key: bytes, sign_key: bytes):
        """Set the encryption and signing keys."""
        self.encryption_key = encryption_key
        self.sign_key = sign_key
        # Derive HMAC key from sign key
        self.hmac_key = sign_key
    
    def generate_keys(self) -> Tuple[bytes, bytes]:
        """Generate new random encryption and signing keys."""
        self.encryption_key = get_random_bytes(16)
        self.sign_key = get_random_bytes(32)
        self.hmac_key = self.sign_key
        return self.encryption_key, self.sign_key
    
    def encrypt(self, plaintext: bytes) -> Dict:
        """
        Encrypt data using AES-CBC with HMAC.
        
        Returns:
            Dict with iv, ciphertext (base64), and sha256 signature
        """
        if not self.encryption_key:
            raise ValueError("Encryption key not set")
        
        iv = get_random_bytes(16)
        cipher = AES.new(self.encryption_key, AES.MODE_CBC, iv)
        
        padded = pad(plaintext, AES.block_size)
        ciphertext = cipher.encrypt(padded)
        
        # Create signature
        h = HMAC.new(self.hmac_key, digestmod=SHA256)
        h.update(ciphertext)
        signature = h.hexdigest()
        
        return {
            'iv': base64.b64encode(iv).decode('utf-8'),
            'ciphertext': base64.b64encode(ciphertext).decode('utf-8'),
            'sha256': signature
        }
    
    def decrypt(self, iv_b64: str, ciphertext_b64: str) -> bytes:
        """
        Decrypt AES-CBC encrypted data.
        
        Args:
            iv_b64: Base64 encoded IV
            ciphertext_b64: Base64 encoded ciphertext
            
        Returns:
            Decrypted plaintext bytes
        """
        if not self.encryption_key:
            raise ValueError("Encryption key not set")
        
        iv = base64.b64decode(iv_b64)
        ciphertext = base64.b64decode(ciphertext_b64)
        
        cipher = AES.new(self.encryption_key, AES.MODE_CBC, iv)
        padded = cipher.decrypt(ciphertext)
        
        try:
            plaintext = unpad(padded, AES.block_size)
        except ValueError:
            # If unpadding fails, return as-is
            plaintext = padded
        
        return plaintext
    
    @staticmethod
    def base64_encode(data: bytes) -> str:
        """Encode bytes to base64 string."""
        return base64.b64encode(data).decode('utf-8')
    
    @staticmethod
    def base64_decode(data: str) -> bytes:
        """Decode base64 string to bytes."""
        return base64.b64decode(data)

